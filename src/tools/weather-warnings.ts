import { z } from "zod";
import type { WeatherWarningParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { GEOMETRY_NOTE, GeometryBudget } from "./shared/geo.js";
import {
  countyCodeSchema,
  languageSchema,
  latitudeSchema,
  longitudeSchema,
} from "./shared/schemas.js";
import {
  MET_WARNING_DISCLAIMER,
  projectWarningGeometry,
  projectWeatherWarning,
  renderWeatherWarning,
  requiresContactEmail,
  warningGeometryNotes,
  warningGeometrySchema,
  warningGeometrySummarySchema,
  weatherWarningNotes,
  weatherWarningSchema,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

/** The warning types MetAlerts published when SDK 0.9.0 was released. */
const WARNING_EVENTS = [
  "blowingSnow",
  "forestFire",
  "gale",
  "ice",
  "icing",
  "lightning",
  "polarLow",
  "rain",
  "rainFlood",
  "snow",
  "stormSurge",
  "wind",
] as const;

/**
 * Ceiling on warnings per result. MetAlerts publishes a few dozen nationwide on
 * a busy day; fifty keeps such a day whole while leaving the payload budget room
 * for their text. A larger set is cut in MetAlerts' own order and reported.
 */
const MAX_WARNINGS = 50;

const inputSchema = z
  .object({
    latitude: latitudeSchema
      .optional()
      .describe(
        "WGS84 latitude. With longitude, returns only warnings whose area contains the point.",
      ),
    longitude: longitudeSchema.optional().describe("WGS84 longitude. Give with latitude."),
    countyCode: countyCodeSchema
      .optional()
      .describe("Two-digit county number, e.g. 46 for Vestland. Not combined with a point."),
    event: z
      .enum(WARNING_EVENTS)
      .optional()
      .describe("Only this MetAlerts warning type, e.g. wind, gale, rain, snow or stormSurge."),
    geographicDomain: z
      .enum(["land", "marine"])
      .optional()
      .describe("land warnings cover counties and municipalities; marine ones cover sea areas."),
    language: languageSchema.describe("Language of the warning texts: no (default) or en."),
    includeGeometry: z
      .boolean()
      .default(false)
      .describe(
        "Return each warning's area as GeoJSON. Off by default: warning areas are large polygons.",
      ),
  })
  .strict()
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "Give latitude and longitude together, or neither.",
    path: ["longitude"],
  })
  .refine((value) => value.latitude === undefined || value.countyCode === undefined, {
    message:
      "Give either a point or a countyCode, not both: a point already selects the warnings whose area contains it.",
    path: ["countyCode"],
  });

const dataSchema = z.object({
  query: z.object({
    scope: z.enum(["point", "county", "norway"]),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    countyCode: z.string().optional(),
    event: z.string().optional(),
    geographicDomain: z.string().optional(),
  }),
  /** When MET Norway last changed the published set of warnings. */
  lastChange: z.string().optional(),
  language: z.string(),
  warnings: z.array(
    weatherWarningSchema.extend({
      geometry: warningGeometrySchema,
      geometrySummary: warningGeometrySummarySchema,
    }),
  ),
  /** Warnings MetAlerts returned, before this server's ceiling. */
  totalWarnings: z.number(),
  /** Returned messages of type Cancel, which withdraw a warning rather than issue one. */
  cancelledCount: z.number(),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const budget = new GeometryBudget();

  const point =
    input.latitude !== undefined && input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude }
      : undefined;

  const parameters: WeatherWarningParameters = {
    ...(point ?? {}),
    ...(input.countyCode !== undefined ? { countyCode: input.countyCode } : {}),
    ...(input.event !== undefined ? { event: input.event } : {}),
    ...(input.geographicDomain !== undefined ? { geographicDomain: input.geographicDomain } : {}),
    language: input.language,
  };

  const response = await context.getSdk().weather.getWarnings(parameters, { signal });
  const collection = response.data;

  const limited = tracker.limitArray("warnings", collection.warnings, MAX_WARNINGS);
  const warnings = limited.map((warning, index) => {
    const field = `warnings[${index}]`;
    return {
      ...projectWeatherWarning(warning, tracker, field),
      ...projectWarningGeometry(warning.geometry, {
        include: input.includeGeometry,
        budget,
        tracker,
        field: `${field}.geometry`,
      }),
    };
  });

  const scope =
    point !== undefined ? "point" : input.countyCode !== undefined ? "county" : "norway";

  const notes = [MET_WARNING_DISCLAIMER];
  if (collection.warnings.length === 0) {
    notes.push(
      `MET Norway returned no current weather warnings for ${describeScope(scope, input)}. That is ` +
        "not an all-clear. For flood, landslide and avalanche warnings, ask " +
        "get_current_norwegian_hazards.",
    );
  }
  if (collection.warnings.length > MAX_WARNINGS) {
    notes.push(
      `MetAlerts published ${collection.warnings.length} warnings for this query; the first ` +
        `${MAX_WARNINGS} are shown in MetAlerts' order. Narrow by countyCode, event or ` +
        "geographicDomain to see the rest.",
    );
  }
  notes.push(...weatherWarningNotes(warnings));
  if (input.includeGeometry) notes.push(GEOMETRY_NOTE);
  notes.push(...warningGeometryNotes(warnings.map((warning) => warning.geometrySummary)));
  notes.push(...tracker.warnings());

  return buildEnvelope<Data>({
    data: {
      query: {
        scope,
        ...(point ?? {}),
        ...(input.countyCode !== undefined ? { countyCode: input.countyCode } : {}),
        ...(input.event !== undefined ? { event: input.event } : {}),
        ...(input.geographicDomain !== undefined
          ? { geographicDomain: input.geographicDomain }
          : {}),
      },
      ...(collection.lastChange !== undefined ? { lastChange: collection.lastChange } : {}),
      language: collection.language,
      warnings,
      totalWarnings: collection.warnings.length,
      cancelledCount: warnings.filter((warning) => warning.messageType === "Cancel").length,
    },
    responses: [response],
    warnings: notes,
    truncation: tracker.report(),
  });
}

function describeScope(
  scope: Data["query"]["scope"],
  query: {
    latitude?: number | undefined;
    longitude?: number | undefined;
    countyCode?: string | undefined;
  },
): string {
  switch (scope) {
    case "point":
      return `the point ${query.latitude ?? "?"}, ${query.longitude ?? "?"}`;
    case "county":
      return `county ${query.countyCode ?? "?"}`;
    case "norway":
      return "Norway";
  }
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = describeScope(data.query.scope, data.query);
  const filters = [data.query.event, data.query.geographicDomain].filter(
    (value): value is string => value !== undefined,
  );
  const header =
    `MET Norway weather warnings for ${where}${filters.length > 0 ? ` (${filters.join(", ")})` : ""}` +
    ` — ${data.warnings.length}${
      data.totalWarnings > data.warnings.length ? ` of ${data.totalWarnings}` : ""
    } warning${data.totalWarnings === 1 ? "" : "s"}` +
    `${data.lastChange !== undefined ? `, last changed ${data.lastChange}` : ""}.`;

  if (data.warnings.length === 0) {
    return renderWithEnvelope(
      `${header}\n\nNo current MET Norway warning matches this query. This is not an all-clear, ` +
        "and NVE's flood, landslide and avalanche warnings are in get_current_norwegian_hazards.",
      envelope,
    );
  }

  return renderWithEnvelope(
    `${header}\n\n${data.warnings.map(renderWeatherWarning).join("\n")}`,
    envelope,
  );
}

export const weatherWarningsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_weather_warnings",
  title: "Get MET Norway weather warnings",
  description:
    "Get MET Norway's current official weather warnings (farevarsler) from MetAlerts — wind, " +
    "gale, rain, snow, ice, icing, storm surge, forest-fire danger, lightning and polar lows — for " +
    "a coordinate, a county or all of Norway, each with its awareness level and colour, validity " +
    "window and message type. " +
    "Use this when the user asks whether a weather warning applies somewhere: a yellow, orange or " +
    "red warning, gale or storm (kuling, storm, ekstremvær), heavy rain or snow, or storm surge. " +
    "Do not use this for flood, landslide or avalanche warnings — NVE issues those and they come " +
    "from get_current_norwegian_hazards; MET's rainFlood and stormSurge warnings describe the " +
    "rain and the water level, so check both tools when flooding is the question. Do not use this " +
    "for the forecast itself (temperature, rain amounts, wind by the hour), which is " +
    "get_norwegian_weather_forecast. An empty result is never an all-clear. " +
    "Requires the NORWAY_MCP_CONTACT_EMAIL environment variable.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresContactEmail,
  handler,
  render,
};
