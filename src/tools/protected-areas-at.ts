import { z } from "zod";
import type {
  NaturbaseFeatureResult,
  OpenDataResponse,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
} from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  CRS_NOTE,
  GEOMETRY_NOTE,
  GeometryBudget,
  NATURBASE_SCOPE_NOTE,
  describeGeometry,
  featurePaginationSchema,
  geometryWarnings,
  paginationWarnings,
  projectFeatures,
  projectPagination,
  projectProposedProtectedArea,
  projectProtectedArea,
  proposedProtectedAreaSchema,
  protectedAreaSchema,
  renderProtectedArea,
} from "./shared/geo.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    includeProposed: z
      .boolean()
      .default(false)
      .describe(
        "Also query areas proposed for protection but not yet protected. A proposal carries no legal effect on its own.",
      ),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe(
        "Return each area's full GeoJSON polygon. Off by default because polygons are large.",
      ),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .default(DEFAULT_LIMIT),
  })
  .strict();

const dataSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  /** Areas whose mapped geometry contains or touches the point. */
  protectedAreas: z.array(protectedAreaSchema),
  protectedAreaPagination: featurePaginationSchema,
  /** Present only when includeProposed was set and the lookup succeeded. */
  proposedProtectedAreas: z.array(proposedProtectedAreaSchema).nullable(),
  proposedPagination: featurePaginationSchema.nullable(),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();
  const sdk = context.getSdk();

  const query = {
    latitude: input.latitude,
    longitude: input.longitude,
    limit: input.limit,
    maxPages: 2,
  };

  // Two independent datasets. `allSettled` so a Naturbase failure on the
  // proposal layer cannot destroy a successful answer about legal protection,
  // which is the part that matters.
  const [currentResult, proposedResult] = await Promise.allSettled([
    sdk.environment.getProtectedAreasAt(query, { signal }),
    input.includeProposed
      ? sdk.environment.getProposedProtectedAreasAt(query, { signal })
      : Promise.resolve(undefined),
  ]);

  if (currentResult.status === "rejected") throw currentResult.reason;
  const current: OpenDataResponse<NaturbaseFeatureResult<ProtectedAreaFeature>> =
    currentResult.value;

  const proposed:
    OpenDataResponse<NaturbaseFeatureResult<ProposedProtectedAreaFeature>> | undefined =
    proposedResult.status === "fulfilled" ? proposedResult.value : undefined;

  const currentFeatures = projectFeatures(current.data.features, {
    field: "protectedAreas",
    include: input.includeGeometry,
    tracker,
    budget,
    geometryOf: (feature) => feature.geometry,
    project: projectProtectedArea,
  });

  const proposedFeatures = proposed
    ? projectFeatures(proposed.data.features, {
        field: "proposedProtectedAreas",
        include: input.includeGeometry,
        tracker,
        budget,
        geometryOf: (feature) => feature.geometry,
        project: projectProposedProtectedArea,
      })
    : undefined;

  const protectedAreaPagination = projectPagination(current.data.pagination, 0);
  const proposedPagination = proposed ? projectPagination(proposed.data.pagination, 0) : null;

  const warnings = [
    NATURBASE_SCOPE_NOTE,
    CRS_NOTE,
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    ...geometryWarnings([...currentFeatures.summaries, ...(proposedFeatures?.summaries ?? [])]),
    ...paginationWarnings(protectedAreaPagination),
    ...(proposedPagination ? paginationWarnings(proposedPagination) : []),
    ...tracker.warnings(),
  ];

  if (proposedFeatures !== undefined && proposedFeatures.items.length > 0) {
    warnings.push(
      "Proposed protected areas are candidates under consideration. They are not protected, " +
        "carry no restriction by themselves, and may never be adopted.",
    );
  }

  const failedProposal = input.includeProposed && proposedResult.status === "rejected";
  if (failedProposal) {
    warnings.push(
      "The proposed-protection lookup failed, so proposals are unknown here. The current " +
        "protection result above is unaffected and complete.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      location: { latitude: input.latitude, longitude: input.longitude },
      protectedAreas: currentFeatures.items,
      protectedAreaPagination,
      proposedProtectedAreas: proposedFeatures?.items ?? null,
      proposedPagination,
    },
    responses: proposed ? [current, proposed] : [current],
    warnings,
    truncation: tracker.report(),
    partial: failedProposal
      ? {
          complete: false,
          missing: ["proposed-protected-areas"],
          reason: "Miljødirektoratet did not answer for proposed protected areas.",
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [];
  const where = `${data.location.latitude}, ${data.location.longitude}`;

  sections.push(
    data.protectedAreas.length === 0
      ? `No Naturbase protected area covers ${where}. This is not an environmental clearance — see the notes.`
      : `${data.protectedAreas.length} protected area(s) cover ${where}:\n\n` +
          data.protectedAreas.map(renderProtectedArea).join("\n\n"),
  );

  if (data.proposedProtectedAreas !== null) {
    sections.push(
      data.proposedProtectedAreas.length === 0
        ? "No proposed protected area covers this point."
        : `${data.proposedProtectedAreas.length} proposed protected area(s) cover this point:\n\n` +
            data.proposedProtectedAreas
              .map((area) =>
                [
                  `${area.name ?? "(unnamed)"} — ${area.id}`,
                  ...fields([
                    ["Proposed form", area.protectionForm],
                    ["Plan", area.protectionPlan],
                    ["Municipality", area.municipality],
                    ["Geometry", describeGeometry(area.geometrySummary)],
                  ]),
                ].join("\n"),
              )
              .join("\n\n"),
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const protectedAreasAtTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_protected_areas_at",
  title: "Get protected areas at a coordinate",
  description:
    "Report which Norwegian nature-conservation areas legally cover one WGS84 coordinate, " +
    "optionally including areas only proposed for protection, from Miljødirektoratet's Naturbase. " +
    "Each area comes with its protection form, IUCN category, managing authority, protection date " +
    "and the regulation that established it. Needs no credentials. " +
    "Use this when the user asks whether a specific point or site lies inside a national park, " +
    "nature reserve or other protected area. " +
    "Do not use this to survey a region — search_protected_areas takes a bounding box — and do " +
    "not read an empty result as proof that nothing of environmental value is present.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
