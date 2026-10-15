import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { isoDateSchema, latitudeSchema, longitudeSchema, osloToday } from "./shared/schemas.js";
import {
  SUN_TIME_OFFSET_NOTE,
  projectSunTimes,
  renderSunTimes,
  requiresContactEmail,
  sunTimesNotes,
  sunTimesSchema,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    date: isoDateSchema
      .optional()
      .describe("Calendar date YYYY-MM-DD in Norwegian time. Defaults to today in Europe/Oslo."),
  })
  .strict();

const dataSchema = sunTimesSchema;

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  // The date is resolved here, from the injected clock, rather than left to
  // the SDK's own default: the answer must be reproducible for a given call.
  const date = input.date ?? osloToday(context.now());

  const response = await context
    .getSdk()
    .weather.getSunTimes(
      { latitude: input.latitude, longitude: input.longitude, date },
      { signal },
    );
  const sun = projectSunTimes(response.data);

  return buildEnvelope<Data>({
    data: sun,
    responses: [response],
    warnings: [SUN_TIME_OFFSET_NOTE, ...sunTimesNotes(sun)],
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const lines = [
    `Sun times for ${data.coordinates.latitude}, ${data.coordinates.longitude} on ${data.date}`,
    ...renderSunTimes(data).map((line) => `  ${line}`),
    ...fields([
      ["Solar noon", data.solarNoon?.time],
      ["Sun elevation at noon (°)", data.solarNoon?.elevation],
      ["Solar midnight", data.solarMidnight?.time],
    ]),
  ];
  return renderWithEnvelope(lines.join("\n"), envelope);
}

export const sunTimesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_sun_times",
  title: "Get sunrise and sunset times",
  description:
    "Get sunrise, sunset, solar noon and solar midnight for a coordinate and date from MET Norway, " +
    "in the Europe/Oslo time offset for that date, including midnight sun and polar night when " +
    "the day has no sunrise or sunset. " +
    "Use this when the user asks when the sun rises or sets, how long the day is, or whether " +
    "there is midnight sun or polar night (midnattssol, mørketid) somewhere on a given date. " +
    "Do not use this for weather such as cloud cover or rain, which is " +
    "get_norwegian_weather_forecast, and do not read a missing sunrise as missing data: " +
    "polarCondition explains it. " +
    "Requires the NORWAY_MCP_CONTACT_EMAIL environment variable.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresContactEmail,
  handler,
  render,
};
