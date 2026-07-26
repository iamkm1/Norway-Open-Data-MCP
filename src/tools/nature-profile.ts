import { z } from "zod";
import type { FeaturePagePagination } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  AR50_CODE_NOTE,
  AR50_SCOPE_NOTE,
  CRS_NOTE,
  GEOMETRY_NOTE,
  GeometryBudget,
  INTERVENTION_FREE_VINTAGE_NOTE,
  NATURBASE_SCOPE_NOTE,
  describeGeometry,
  featurePaginationSchema,
  geometryWarnings,
  interventionFreeAreaSchema,
  landResourceSchema,
  natureTypeSchema,
  paginationWarnings,
  projectFeatures,
  projectInterventionFreeArea,
  projectLandResource,
  projectNatureType,
  projectPagination,
  projectProposedProtectedArea,
  projectProtectedArea,
  proposedProtectedAreaSchema,
  protectedAreaSchema,
  renderProtectedArea,
  type GeometrySummary,
  type ProjectedFeaturePagination,
} from "./shared/geo.js";
import {
  componentSchema,
  componentProvenance,
  componentWarnings,
  compositeSourceSchema,
  missingSections,
  projectComponents,
  projectCompositeSource,
} from "./shared/profile.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
/** The SDK's own ceiling for this profile is 100; this is the MCP-side cap. */
const MAX_LIMIT = 50;
/**
 * Two, for the reason `get_intervention_free_nature_at` documents: a limit of 1
 * makes the SDK ask the intervention-free WFS for a single feature, which that
 * service answers with a page the SDK rejects. Here it costs only that one
 * component — the profile still returns, with the failure in `partial` — but
 * losing a section on every call is not a sensible default to allow.
 */
const MIN_LIMIT = 2;
const MAX_COMPONENTS = 20;
const MAX_WARNINGS = 20;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe(
        "Return full GeoJSON polygons for every section. Off by default: five datasets of polygons at once is the largest payload this server can produce.",
      ),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(
        MIN_LIMIT,
        `Limit must be at least ${MIN_LIMIT}: a limit of 1 makes Miljødirektoratet's intervention-free WFS return a page the SDK rejects, costing that section on every call.`,
      )
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .default(DEFAULT_LIMIT)
      .describe("Maximum features per dataset. Applies to each section independently."),
  })
  .strict();

const dataSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  /** Inferred from the nearest official place name, not from a boundary lookup. */
  municipality: z
    .object({
      code: z.string().optional(),
      name: z.string().optional(),
      countyCode: z.string().optional(),
      countyName: z.string().optional(),
    })
    .nullable(),
  nearestPlace: z
    .object({
      name: z.string(),
      type: z.string().optional(),
      municipalityName: z.string().optional(),
      countyName: z.string().optional(),
    })
    .nullable(),
  /** Null means the section's provider failed; an empty array means it answered with nothing. */
  protectedAreas: z.array(protectedAreaSchema).nullable(),
  proposedProtectedAreas: z.array(proposedProtectedAreaSchema).nullable(),
  natureTypes: z.array(natureTypeSchema).nullable(),
  interventionFreeAreas: z.array(interventionFreeAreaSchema).nullable(),
  landResources: z.array(landResourceSchema).nullable(),
  pagination: z.object({
    protectedAreas: featurePaginationSchema.nullable(),
    proposedProtectedAreas: featurePaginationSchema.nullable(),
    natureTypes: featurePaginationSchema.nullable(),
    interventionFreeAreas: featurePaginationSchema.nullable(),
    landResources: featurePaginationSchema.nullable(),
  }),
  /**
   * The SDK's synthetic identity for the composition. Carries no licence: the
   * real providers and their terms are in the envelope's `sources`.
   */
  compositeSource: compositeSourceSchema,
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

function paginationOf(
  pagination: FeaturePagePagination | undefined,
): ProjectedFeaturePagination | null {
  return pagination === undefined ? null : projectPagination(pagination, 0);
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  // One SDK call. The five dataset lookups, the place lookup, their independent
  // failure handling and their per-component provenance are the SDK's job.
  const response = await context
    .getSdk()
    .profiles.natureAtLocation(
      { latitude: input.latitude, longitude: input.longitude, limit: input.limit },
      { signal },
    );
  const profile = response.data;
  const summaries: GeometrySummary[] = [];

  // Each section is projected independently and stays `null` when the SDK
  // omitted it, so "the provider failed" and "the provider found nothing" never
  // collapse into the same empty array.
  const protectedAreas =
    profile.protectedAreas === undefined
      ? null
      : projectFeatures(profile.protectedAreas, {
          field: "protectedAreas",
          include: input.includeGeometry,
          tracker,
          budget,
          geometryOf: (feature) => feature.geometry,
          project: projectProtectedArea,
        });

  const proposedProtectedAreas =
    profile.proposedProtectedAreas === undefined
      ? null
      : projectFeatures(profile.proposedProtectedAreas, {
          field: "proposedProtectedAreas",
          include: input.includeGeometry,
          tracker,
          budget,
          geometryOf: (feature) => feature.geometry,
          project: projectProposedProtectedArea,
        });

  const natureTypes =
    profile.natureTypes === undefined
      ? null
      : projectFeatures(profile.natureTypes, {
          field: "natureTypes",
          include: input.includeGeometry,
          tracker,
          budget,
          geometryOf: (feature) => feature.geometry,
          project: projectNatureType,
        });

  const interventionFreeAreas =
    profile.interventionFreeAreas === undefined
      ? null
      : projectFeatures(profile.interventionFreeAreas, {
          field: "interventionFreeAreas",
          include: input.includeGeometry,
          tracker,
          budget,
          geometryOf: (feature) => feature.geometry,
          project: projectInterventionFreeArea,
        });

  const landResources =
    profile.landResources === undefined
      ? null
      : projectFeatures(profile.landResources, {
          field: "landResources",
          include: input.includeGeometry,
          tracker,
          budget,
          geometryOf: (feature) => feature.geometry,
          project: projectLandResource,
        });

  for (const projected of [
    protectedAreas,
    proposedProtectedAreas,
    natureTypes,
    interventionFreeAreas,
    landResources,
  ]) {
    if (projected) summaries.push(...projected.summaries);
  }

  const components = tracker.limitArray(
    "components",
    projectComponents(profile.components),
    MAX_COMPONENTS,
  );

  const pagination = {
    protectedAreas: paginationOf(profile.pagination.protectedAreas),
    proposedProtectedAreas: paginationOf(profile.pagination.proposedProtectedAreas),
    natureTypes: paginationOf(profile.pagination.natureTypes),
    interventionFreeAreas: paginationOf(profile.pagination.interventionFreeAreas),
    landResources: paginationOf(profile.pagination.landResources),
  };

  const place = profile.nearestPlace;

  const warnings = [
    NATURBASE_SCOPE_NOTE,
    AR50_SCOPE_NOTE,
    AR50_CODE_NOTE,
    INTERVENTION_FREE_VINTAGE_NOTE,
    CRS_NOTE,
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    // The SDK's own per-provider failure and truncation notices, kept verbatim.
    ...tracker.limitArray("providerWarnings", profile.warnings, MAX_WARNINGS),
    ...componentWarnings(components),
    ...geometryWarnings(summaries),
    ...Object.values(pagination).flatMap((entry) => (entry ? paginationWarnings(entry) : [])),
    ...tracker.warnings(),
  ];

  if (place !== undefined) {
    warnings.push(
      "The municipality is inferred from the nearest official Kartverket place name within 5 km, " +
        "not from an administrative boundary lookup. Near a border it can name the neighbouring " +
        "municipality.",
    );
  }

  const missing = missingSections(components);

  return buildEnvelope<Data>({
    data: {
      location: { latitude: profile.location.latitude, longitude: profile.location.longitude },
      municipality: profile.municipality ? { ...profile.municipality } : null,
      nearestPlace:
        place === undefined
          ? null
          : {
              name: place.name,
              ...(place.type !== undefined ? { type: place.type } : {}),
              ...(place.municipalityName !== undefined
                ? { municipalityName: place.municipalityName }
                : {}),
              ...(place.countyName !== undefined ? { countyName: place.countyName } : {}),
            },
      protectedAreas: protectedAreas?.items ?? null,
      proposedProtectedAreas: proposedProtectedAreas?.items ?? null,
      natureTypes: natureTypes?.items ?? null,
      interventionFreeAreas: interventionFreeAreas?.items ?? null,
      landResources: landResources?.items ?? null,
      pagination,
      compositeSource: projectCompositeSource(response.source),
      components,
    },
    // Never `[response]`: the top-level source is the SDK's synthetic composite
    // and carries no licence and no attribution. Provenance comes from the
    // components and the SDK's own `sources` array, which hold the real
    // providers — including the intervention-free layer's distinct terms.
    responses: componentProvenance(response),
    warnings,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason: "One or more nature datasets could not be retrieved for this location.",
          }
        : null,
  });
}

function renderSection<T>(
  label: string,
  items: readonly T[] | null,
  describe: (item: T) => string,
): string {
  if (items === null) {
    return `${label}: unavailable — its provider failed. See the notes and components.`;
  }
  if (items.length === 0) {
    return `${label}: none mapped at this point (not an environmental clearance).`;
  }
  return `${label} (${items.length}):\n${items.map(describe).join("\n")}`;
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [];
  const where = `${data.location.latitude}, ${data.location.longitude}`;

  sections.push(
    [
      `Nature profile for ${where}`,
      ...fields([
        ["Nearest place", data.nearestPlace?.name],
        ["Place type", data.nearestPlace?.type],
        ["Municipality", data.municipality?.name ?? data.nearestPlace?.municipalityName],
        ["County", data.municipality?.countyName ?? data.nearestPlace?.countyName],
      ]),
    ].join("\n"),
  );

  sections.push(
    data.protectedAreas === null
      ? "Protected areas: unavailable — Naturbase failed for this section."
      : data.protectedAreas.length === 0
        ? "Protected areas: none cover this point (not an environmental clearance)."
        : `Protected areas (${data.protectedAreas.length}):\n\n${data.protectedAreas
            .map(renderProtectedArea)
            .join("\n\n")}`,
  );

  sections.push(
    renderSection(
      "Proposed protected areas",
      data.proposedProtectedAreas,
      (area) =>
        `- ${area.name ?? "(unnamed)"} (${area.protectionForm ?? "form not stated"}) — proposal only, no legal effect`,
    ),
  );

  sections.push(
    renderSection(
      "Nature localities",
      data.natureTypes,
      (locality) =>
        `- ${locality.natureType ?? "(unclassified)"}${
          locality.redListed === true ? " [red-listed]" : ""
        }${locality.localityQuality !== undefined ? ` — quality ${String(locality.localityQuality)}` : ""}`,
    ),
  );

  sections.push(
    renderSection(
      "Intervention-free nature (January 2023)",
      data.interventionFreeAreas,
      (zone) => `- zone ${zone.zone}: ${zone.zoneDescription}`,
    ),
  );

  sections.push(
    renderSection(
      "AR50 land resources",
      data.landResources,
      (area) =>
        `- ${area.landType ?? `land type ${area.landTypeCode ?? "(unstated)"}`}${
          area.geometrySummary.type === "none" ? " (no geometry published)" : ""
        }`,
    ),
  );

  const geometryLines = [
    ...(data.protectedAreas ?? []),
    ...(data.natureTypes ?? []),
    ...(data.interventionFreeAreas ?? []),
  ]
    .filter((feature) => feature.geometrySummary.included)
    .map((feature) => `- ${feature.id}: ${describeGeometry(feature.geometrySummary) ?? ""}`);
  if (geometryLines.length > 0) {
    sections.push(`Geometry returned:\n${geometryLines.join("\n")}`);
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const natureProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_nature_profile",
  title: "Get nature profile for a coordinate",
  description:
    "Answer ONE Norwegian coordinate from Miljødirektoratet, NIBIO and Kartverket at once, " +
    "composing protected and proposed conservation areas, mapped nature localities, " +
    "intervention-free status, AR50 land-resource classes and the nearest official place name " +
    "with its municipality. Every section reports its own provider, licence, retrieval time and " +
    "why it is present or absent, and a provider that fails costs only its own section. Needs no " +
    "credentials. " +
    "Use this when the user asks broadly what the nature at a place is like, or wants several of " +
    "these answers together. " +
    "Do not use this when only one dataset is wanted — the single-purpose tools return more " +
    "detail per feature and cost one request — and do not read an empty section as proof that " +
    "nothing of environmental value exists there.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
