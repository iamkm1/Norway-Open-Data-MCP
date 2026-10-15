import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import {
  NOWCAST_NOT_COVERED_NOTE,
  NOWCAST_SCOPE_NOTE,
  nowcastNotes,
  nowcastSchema,
  projectNowcast,
  requiresContactEmail,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
  })
  .strict();

const dataSchema = z.object({
  requested: z.object({ latitude: z.number(), longitude: z.number() }),
  coverage: z
    .enum(["covered", "outside-radar-area"])
    .describe("outside-radar-area is a normal answer for points beyond the Nordic radar network."),
  nowcast: nowcastSchema
    .nullable()
    .describe("Null when the point lies outside the radar area, which excludes Svalbard."),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const requested = { latitude: input.latitude, longitude: input.longitude };

  const response = await context.getSdk().weather.getNowcast(requested, { signal });

  // `undefined` is MET Norway's answer for a point outside the radar area. It
  // is reported as a null section with its reason, never as a failure.
  const nowcast =
    response.data === undefined ? null : projectNowcast(response.data, tracker, "nowcast.entries");

  const warnings = [
    NOWCAST_SCOPE_NOTE,
    ...(nowcast === null ? [NOWCAST_NOT_COVERED_NOTE] : nowcastNotes(nowcast)),
    ...tracker.warnings(),
  ];

  return buildEnvelope<Data>({
    data: {
      requested,
      coverage: nowcast === null ? "outside-radar-area" : "covered",
      nowcast,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = `${data.requested.latitude}, ${data.requested.longitude}`;
  if (data.nowcast === null) {
    return renderWithEnvelope(
      `No precipitation nowcast for ${where}: the point lies outside MET Norway's radar area.`,
      envelope,
    );
  }

  const nowcast = data.nowcast;
  const header =
    `Precipitation nowcast for ${where}` +
    `${nowcast.updatedAt !== undefined ? `, updated ${nowcast.updatedAt}` : ""}` +
    `${nowcast.radarCoverage !== undefined ? ` (radar: ${nowcast.radarCoverage})` : ""}.`;

  if (nowcast.entries.length === 0) {
    return renderWithEnvelope(`${header}\n\nMET Norway returned no nowcast steps.`, envelope);
  }

  const rows = nowcast.entries
    .map((entry) => {
      const parts = [entry.time];
      if (entry.precipitationRate !== undefined) parts.push(`${entry.precipitationRate} mm/h`);
      if (entry.temperature !== undefined) parts.push(`${entry.temperature}°C`);
      if (entry.windSpeed !== undefined) parts.push(`wind ${entry.windSpeed} m/s`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  return renderWithEnvelope(`${header}\n\n${rows}`, envelope);
}

export const precipitationNowcastTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_precipitation_nowcast",
  title: "Get MET Norway precipitation nowcast",
  description:
    "Get MET Norway's radar-based precipitation nowcast for one coordinate: rain or snow intensity " +
    "in five-minute steps for roughly the next two hours, with current temperature and wind and " +
    "the radar status. " +
    "Use this when the user asks whether it will rain in the next hour or two, when the rain will " +
    "start or stop, or whether it is raining right now. " +
    "Do not use this for anything beyond about two hours or for a multi-day outlook — that is " +
    "get_norwegian_weather_forecast — and do not use it for weather warnings " +
    "(get_norwegian_weather_warnings). Outside the Nordic radar area, which excludes Svalbard, " +
    "the nowcast is null with the reason stated rather than an error. " +
    "Requires the NORWAY_MCP_CONTACT_EMAIL environment variable.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresContactEmail,
  handler,
  render,
};
