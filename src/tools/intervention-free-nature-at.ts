import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  CRS_NOTE,
  GEOMETRY_NOTE,
  GeometryBudget,
  INTERVENTION_FREE_VINTAGE_NOTE,
  NATURBASE_SCOPE_NOTE,
  describeGeometry,
  featurePaginationSchema,
  geometryWarnings,
  interventionFreeAreaSchema,
  paginationWarnings,
  projectFeatures,
  projectInterventionFreeArea,
  projectPagination,
} from "./shared/geo.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

/**
 * Two, not one.
 *
 * The SDK derives its upstream page size from the remaining limit, so a limit of
 * 1 makes it ask Miljødirektoratet's WFS for `COUNT=1`. Verified live against
 * `norway-open-data-sdk@0.8.0`: whenever that request would match at least one
 * zone, the service answers with a page the SDK rejects as invalid, and the call
 * fails with `upstream_invalid_response`. It is deterministic and specific to
 * this layer — the ArcGIS-backed Naturbase layers answer a limit of 1 fine.
 *
 * Refusing the one input known to break is a schema decision, which is this
 * layer's job. Papering over it by rewriting the caller's limit would not be:
 * the result would silently be a different query from the one requested.
 */
const MIN_LIMIT = 2;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe(
        "Return the full GeoJSON polygon of each zone. Off by default: these polygons are among the largest Naturbase publishes.",
      ),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(
        MIN_LIMIT,
        `Limit must be at least ${MIN_LIMIT}. Miljødirektoratet's intervention-free WFS returns a page the SDK rejects when asked for exactly one feature, so this tool refuses that request rather than failing upstream.`,
      )
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .default(DEFAULT_LIMIT),
  })
  .strict();

const dataSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  /** Empty means the point was within 1 km of major infrastructure in January 2023. */
  interventionFreeAreas: z.array(interventionFreeAreaSchema),
  pagination: featurePaginationSchema,
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  const response = await context.getSdk().environment.getInterventionFreeAreasAt(
    {
      latitude: input.latitude,
      longitude: input.longitude,
      limit: input.limit,
      maxPages: 2,
    },
    { signal },
  );

  const projected = projectFeatures(response.data.features, {
    field: "interventionFreeAreas",
    include: input.includeGeometry,
    tracker,
    budget,
    geometryOf: (feature) => feature.geometry,
    project: projectInterventionFreeArea,
  });

  const pagination = projectPagination(response.data.pagination, 0);

  const warnings = [
    INTERVENTION_FREE_VINTAGE_NOTE,
    NATURBASE_SCOPE_NOTE,
    CRS_NOTE,
    ...(input.includeGeometry ? [GEOMETRY_NOTE] : []),
    ...geometryWarnings(projected.summaries),
    ...paginationWarnings(pagination),
    ...tracker.warnings(),
  ];

  if (projected.items.length === 0) {
    warnings.push(
      "No zone covers this point, which in this dataset means it lay within about a kilometre of " +
        "major infrastructure as of January 2023. Intervention-free status is a distance measure, " +
        "not an assessment of ecological quality, and its absence says nothing about the value of " +
        "the nature there.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      location: { latitude: input.latitude, longitude: input.longitude },
      interventionFreeAreas: projected.items,
      pagination,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = `${data.location.latitude}, ${data.location.longitude}`;

  if (data.interventionFreeAreas.length === 0) {
    return renderWithEnvelope(
      `No intervention-free zone covered ${where} in the January 2023 status, meaning the point ` +
        "was within roughly one kilometre of major infrastructure at that date.",
      envelope,
    );
  }

  const body = data.interventionFreeAreas
    .map((zone) =>
      [
        `Zone ${zone.zone} — ${zone.id}`,
        ...fields([
          ["Meaning", zone.zoneDescription],
          ["Area (km²)", zone.areaSquareKilometers],
          ["Status date", zone.statusDate],
          ["Geometry", describeGeometry(zone.geometrySummary)],
        ]),
      ].join("\n"),
    )
    .join("\n\n");

  return renderWithEnvelope(`Intervention-free nature at ${where}:\n\n${body}`, envelope);
}

export const interventionFreeNatureAtTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_intervention_free_nature_at",
  title: "Get intervention-free nature status at a coordinate",
  description:
    "Tell whether a coordinate lay inside Norway's January 2023 intervention-free nature zones, " +
    "which measure distance from major infrastructure and are the standard national indicator of " +
    "remaining wilderness-like land. Zone 1 is 1-3 km out, zone 2 is 3-5 km, and zone v is at " +
    "least 5 km. Needs no credentials. " +
    "Use this when the user asks how untouched or roadless somewhere is, or how a development " +
    "would affect wilderness-like land. " +
    "Do not use this as a conservation status — it confers no protection whatever — and do not " +
    "present it as current: the layer has one fixed vintage and ignores anything built since.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
