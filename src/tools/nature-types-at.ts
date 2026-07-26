import { z } from "zod";

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
  natureTypeSchema,
  paginationWarnings,
  projectFeatures,
  projectNatureType,
  projectPagination,
} from "./shared/geo.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe(
        "Return each locality's full GeoJSON polygon. Off by default because polygons are large.",
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
  natureTypes: z.array(natureTypeSchema),
  pagination: featurePaginationSchema,
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  const response = await context.getSdk().environment.getNatureTypesAt(
    {
      latitude: input.latitude,
      longitude: input.longitude,
      limit: input.limit,
      maxPages: 2,
    },
    { signal },
  );

  const projected = projectFeatures(response.data.features, {
    field: "natureTypes",
    include: input.includeGeometry,
    tracker,
    budget,
    geometryOf: (feature) => feature.geometry,
    project: projectNatureType,
  });

  const pagination = projectPagination(response.data.pagination, 0);

  const warnings = [
    NATURBASE_SCOPE_NOTE,
    CRS_NOTE,
    "Nature types here are the modern NiN localities of national importance selected for this " +
      "release — red-listed, threatened or centrally functional ecosystems. Legacy DN-håndbok 13 " +
      "localities and locally valuable nature are separate layers this server does not query, and " +
      "large parts of Norway have never been surveyed at all.",
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    ...geometryWarnings(projected.summaries),
    ...paginationWarnings(pagination),
    ...tracker.warnings(),
  ];

  if (projected.items.some((locality) => locality.poorlyMapped === true)) {
    warnings.push(
      "At least one locality is flagged by the surveyor as poorly delimited, so its boundary is " +
        "indicative rather than precise.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      location: { latitude: input.latitude, longitude: input.longitude },
      natureTypes: projected.items,
      pagination,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = `${data.location.latitude}, ${data.location.longitude}`;

  if (data.natureTypes.length === 0) {
    return renderWithEnvelope(
      `Naturbase maps no NiN nature locality of national importance at ${where}. Large areas of ` +
        "Norway are unsurveyed, so this is not evidence that the ground has no natural value.",
      envelope,
    );
  }

  const body = data.natureTypes
    .map((locality) =>
      [
        `${locality.natureType ?? "(unclassified)"} — ${locality.id}`,
        ...fields([
          ["Area name", locality.areaName],
          ["NiN code", locality.natureTypeCode],
          ["Municipalities", locality.municipalities],
          ["Major ecosystem", locality.majorEcosystem],
          ["Locality quality", locality.localityQuality],
          ["Condition", locality.conditionDescription ?? locality.condition],
          ["Biodiversity", locality.biodiversityDescription ?? locality.biodiversity],
          ["Red-listed", locality.redListed],
          ["Near-threatened", locality.nearThreatened],
          ["Central ecosystem function", locality.centralEcosystemFunction],
          ["Surveyed", locality.surveyedAt ?? locality.surveyYear],
          ["Uncertainty", locality.uncertaintyDescription],
          ["Fact sheet", locality.factSheetUrl],
          ["Geometry", describeGeometry(locality.geometrySummary)],
        ]),
      ].join("\n"),
    )
    .join("\n\n");

  return renderWithEnvelope(
    `${data.natureTypes.length} mapped nature locality(ies) at ${where}:\n\n${body}`,
    envelope,
  );
}

export const natureTypesAtTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_nature_types_at",
  title: "Get mapped nature localities at a coordinate",
  description:
    "Identify mapped NiN nature localities of national importance at one coordinate — habitat " +
    "type, condition score, biodiversity value, red-list status and survey year — from Naturbase. " +
    "Needs no credentials. " +
    "Use this when the user asks what habitat or ecosystem has been recorded at a place, or " +
    "whether a threatened nature type is registered there. " +
    "Do not use this for legal protection status, which is get_protected_areas_at, and do not " +
    "conclude from an empty result that the habitat is unremarkable: most of the country has " +
    "never been surveyed for these localities.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
