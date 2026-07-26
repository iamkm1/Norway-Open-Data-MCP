import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  AR50_CODE_NOTE,
  AR50_SCOPE_NOTE,
  CRS_NOTE,
  GEOMETRY_NOTE,
  GeometryBudget,
  describeGeometry,
  featurePaginationSchema,
  geometryWarnings,
  landResourceSchema,
  paginationWarnings,
  projectFeatures,
  projectLandResource,
  projectPagination,
} from "./shared/geo.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe("Return each AR50 polygon's full GeoJSON geometry. Off by default."),
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
  landResources: z.array(landResourceSchema),
  pagination: featurePaginationSchema,
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  const response = await context.getSdk().land.getLandResourcesAt(
    {
      latitude: input.latitude,
      longitude: input.longitude,
      limit: input.limit,
      maxPages: 2,
    },
    { signal },
  );

  const projected = projectFeatures(response.data.features, {
    field: "landResources",
    include: input.includeGeometry,
    tracker,
    budget,
    geometryOf: (feature) => feature.geometry,
    project: projectLandResource,
  });

  const pagination = projectPagination(response.data.pagination, 0);

  const warnings = [
    AR50_SCOPE_NOTE,
    AR50_CODE_NOTE,
    CRS_NOTE,
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    ...geometryWarnings(projected.summaries),
    ...paginationWarnings(pagination),
    ...tracker.warnings(),
  ];

  if (
    projected.items.some((area) => area.landTypeCode !== undefined && area.landType === undefined)
  ) {
    warnings.push(
      "At least one land-type code is outside the published AR50 code list this server can label, " +
        "so the raw code is returned unlabelled rather than guessed at.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      location: { latitude: input.latitude, longitude: input.longitude },
      landResources: projected.items,
      pagination,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = `${data.location.latitude}, ${data.location.longitude}`;

  if (data.landResources.length === 0) {
    return renderWithEnvelope(
      `AR50 returned no land-resource polygon at ${where}. Offshore coordinates and points ` +
        "outside the mapped extent both give this result.",
      envelope,
    );
  }

  const body = data.landResources
    .map((area) =>
      [
        `${area.landType ?? `Land type ${area.landTypeCode ?? "(unstated)"}`} — ${area.id}`,
        ...fields([
          ["Land type code", area.landTypeCode],
          ["Forest productivity code", area.forestProductivityCode],
          ["Tree type code", area.treeTypeCode],
          ["Agriculture code", area.agricultureCode],
          ["Vegetation cover code", area.vegetationCoverCode],
          ["Object type", area.objectType],
          ["Updated", area.updatedAt],
          ["Geometry", describeGeometry(area.geometrySummary)],
        ]),
      ].join("\n"),
    )
    .join("\n\n");

  return renderWithEnvelope(`AR50 land resources at ${where}:\n\n${body}`, envelope);
}

export const landResourcesAtTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_land_resources_at",
  title: "Get AR50 land-resource classification at a coordinate",
  description:
    "Classify the ground at one coordinate using NIBIO's generalized AR50 land-resource map: land " +
    "type, forest productivity, tree species, agricultural and vegetation-cover class codes. " +
    "Needs no credentials. " +
    "Use this when the user asks what kind of terrain, forest, farmland, bog or glacier is at a " +
    "place. " +
    "Do not use this at property precision — AR50 generalizes, merging patches under roughly 15 " +
    "decares — and do not use it for conservation status, which is get_protected_areas_at. The " +
    "detailed AR5 map and soil-quality products are not available through this server.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
