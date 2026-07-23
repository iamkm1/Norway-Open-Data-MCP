import { z } from "zod";

import { ENV_VARS, type ServerConfig } from "../config/types.js";
import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { altitudeSchema, latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_HOURS = 24;
// MET's compact forecast covers roughly ten days at declining resolution.
// 96 entries is four days of detail — beyond that the payload grows without
// adding much a model can use.
const MAX_HOURS = 96;

const inputSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    altitude: altitudeSchema.optional(),
    hours: z
      .number()
      .int("Hours must be a whole number.")
      .min(1, "Hours must be at least 1.")
      .max(MAX_HOURS, `Hours must be at most ${MAX_HOURS}.`)
      .default(DEFAULT_HOURS),
  })
  .strict();

const entrySchema = z.object({
  time: z.string(),
  temperature: z.number().optional(),
  windSpeed: z.number().optional(),
  windDirection: z.number().optional(),
  humidity: z.number().optional(),
  airPressure: z.number().optional(),
  cloudCover: z.number().optional(),
  precipitationNextHour: z.number().optional(),
  precipitationNextSixHours: z.number().optional(),
  symbolCode: z.string().optional(),
});

const dataSchema = z.object({
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
    altitude: z.number().optional(),
  }),
  updatedAt: z.string().optional(),
  timeseries: z.array(entrySchema),
  hoursReturned: z.number(),
  hoursAvailable: z.number(),
});

type Data = z.infer<typeof dataSchema>;

/**
 * MET Norway requires every caller to identify itself with a real contact
 * address. There is no safe default: inventing one would send a fake identity
 * upstream, which the provider's terms exist to prevent.
 */
function requiredEnvironment(config: ServerConfig): string[] {
  return config.contactEmail === undefined ? [ENV_VARS.contactEmail] : [];
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const response = await context.getSdk().weather.forecast(
    {
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.altitude !== undefined ? { altitude: input.altitude } : {}),
    },
    { signal },
  );

  const forecast = response.data;
  const available = forecast.timeseries.length;
  const limited = tracker.limitArray("timeseries", forecast.timeseries, input.hours, available);

  const warnings = [
    ...tracker.warnings(),
    "MET Norway Locationforecast is an automated model forecast with no service-level guarantee.",
  ];

  return buildEnvelope<Data>({
    data: {
      coordinates: {
        latitude: forecast.coordinates.latitude,
        longitude: forecast.coordinates.longitude,
        ...(forecast.coordinates.altitude !== undefined
          ? { altitude: forecast.coordinates.altitude }
          : {}),
      },
      ...(forecast.updatedAt !== undefined ? { updatedAt: forecast.updatedAt } : {}),
      timeseries: limited.map((entry) => ({
        time: entry.time,
        ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
        ...(entry.windSpeed !== undefined ? { windSpeed: entry.windSpeed } : {}),
        ...(entry.windDirection !== undefined ? { windDirection: entry.windDirection } : {}),
        ...(entry.humidity !== undefined ? { humidity: entry.humidity } : {}),
        ...(entry.airPressure !== undefined ? { airPressure: entry.airPressure } : {}),
        ...(entry.cloudCover !== undefined ? { cloudCover: entry.cloudCover } : {}),
        ...(entry.precipitationNextHour !== undefined
          ? { precipitationNextHour: entry.precipitationNextHour }
          : {}),
        ...(entry.precipitationNextSixHours !== undefined
          ? { precipitationNextSixHours: entry.precipitationNextSixHours }
          : {}),
        ...(entry.symbolCode !== undefined ? { symbolCode: entry.symbolCode } : {}),
      })),
      hoursReturned: limited.length,
      hoursAvailable: available,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.timeseries.length === 0) {
    return renderWithEnvelope(
      "MET Norway returned no forecast entries for that coordinate.",
      envelope,
    );
  }

  const rows = data.timeseries
    .map((entry) => {
      const parts = [entry.time];
      if (entry.temperature !== undefined) parts.push(`${entry.temperature}°C`);
      if (entry.windSpeed !== undefined) parts.push(`wind ${entry.windSpeed} m/s`);
      if (entry.precipitationNextHour !== undefined) {
        parts.push(`precip ${entry.precipitationNextHour} mm`);
      }
      if (entry.symbolCode !== undefined) parts.push(entry.symbolCode);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const header =
    `Forecast for ${data.coordinates.latitude}, ${data.coordinates.longitude}` +
    `${data.coordinates.altitude !== undefined ? ` at ${data.coordinates.altitude} m` : ""}` +
    ` — ${data.hoursReturned} of ${data.hoursAvailable} available entries.`;

  return renderWithEnvelope(`${header}\n\n${rows}`, envelope);
}

export const weatherForecastTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_weather_forecast",
  title: "Get Norwegian weather forecast",
  description:
    "Get an hourly weather forecast for a coordinate in or near Norway from MET Norway, including " +
    "temperature, wind, humidity, cloud cover and precipitation. " +
    "Use this when the user wants a weather forecast for a coordinate or over a period — today, " +
    "tonight or the next few days. " +
    "Do not use this when the user asks about official danger warnings for flood, avalanche or " +
    "landslide — that is get_current_norwegian_hazards, a different provider answering a " +
    "different question. For weather at a street address rather than a coordinate, " +
    "get_norwegian_location_profile resolves the address first. " +
    "Requires the NORWAY_MCP_CONTACT_EMAIL environment variable, because MET Norway requires " +
    "every caller to identify itself.",
  inputSchema,
  dataSchema,
  requiredEnvironment,
  handler,
  render,
};
