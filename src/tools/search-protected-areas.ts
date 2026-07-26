import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  CRS_NOTE,
  GEOMETRY_NOTE,
  GeometryBudget,
  NATURBASE_SCOPE_NOTE,
  describePagination,
  featurePaginationSchema,
  geometryWarnings,
  paginationWarnings,
  projectFeatures,
  projectPagination,
  projectProtectedArea,
  protectedAreaSchema,
  renderProtectedArea,
} from "./shared/geo.js";
import { featureBoundingBoxSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

const inputSchema = z
  .object({
    boundingBox: featureBoundingBoxSchema.describe(
      "WGS84 rectangle to search. Bounded by this server: at most 2 degrees of latitude by 4 of longitude.",
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
    offset: z
      .number()
      .int("Offset must be a whole number.")
      .min(0, "Offset is zero-based and cannot be negative.")
      .max(MAX_OFFSET, `Offset must be at most ${MAX_OFFSET}.`)
      .default(0),
  })
  .strict();

const dataSchema = z.object({
  boundingBox: z.object({
    south: z.number(),
    west: z.number(),
    north: z.number(),
    east: z.number(),
  }),
  /** Areas whose geometry intersects the box, in the provider's own order. */
  protectedAreas: z.array(protectedAreaSchema),
  pagination: featurePaginationSchema,
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  const response = await context.getSdk().environment.searchProtectedAreas(
    {
      boundingBox: input.boundingBox,
      limit: input.limit,
      // Three provider requests at most, whatever the caller asked for.
      maxPages: 3,
      offset: input.offset,
    },
    { signal },
  );

  const projected = projectFeatures(response.data.features, {
    field: "protectedAreas",
    include: input.includeGeometry,
    tracker,
    budget,
    geometryOf: (feature) => feature.geometry,
    project: projectProtectedArea,
  });

  const pagination = projectPagination(response.data.pagination, input.offset);

  const warnings = [
    NATURBASE_SCOPE_NOTE,
    CRS_NOTE,
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    ...geometryWarnings(projected.summaries),
    ...paginationWarnings(pagination),
    ...tracker.warnings(),
  ];

  return buildEnvelope<Data>({
    data: {
      boundingBox: { ...input.boundingBox },
      protectedAreas: projected.items,
      pagination,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
    continuation: pagination.hasMore
      ? {
          hasMore: true,
          nextArguments: {
            ...input,
            offset: pagination.nextOffset ?? input.offset + pagination.returned,
          },
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const box = data.boundingBox;
  const where = `S ${box.south}, W ${box.west}, N ${box.north}, E ${box.east}`;

  if (data.protectedAreas.length === 0) {
    return renderWithEnvelope(
      `No Naturbase protected area intersects the box (${where}). This is not an environmental clearance — see the notes.`,
      envelope,
    );
  }

  return renderWithEnvelope(
    [
      `Protected areas intersecting the box (${where}).`,
      describePagination(data.pagination),
      "",
      data.protectedAreas.map(renderProtectedArea).join("\n\n"),
    ].join("\n"),
    envelope,
  );
}

export const searchProtectedAreasTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_protected_areas",
  title: "Search protected areas in an area",
  description:
    "List every conservation area intersecting a bounded rectangle of Norwegian territory, with " +
    "its protection form, IUCN category, managing authority and the regulation that established " +
    "it. The rectangle is capped by this server, and the page is explicitly bounded and reports " +
    "whether more exist. Needs no credentials. " +
    "Use this when the user asks which reserves or parks lie within a region, valley, fjord or " +
    "municipality-sized window. " +
    "Do not use this for a single site — get_protected_areas_at answers one coordinate — and do " +
    "not treat one page as a complete inventory of the region.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
