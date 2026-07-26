import { z } from "zod";
import type { AisTrack, OpenDataResponse } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  AIS_COVERAGE_NOTE,
  projectTrackPoint,
  requiresAisCredentials,
  trackPointSchema,
} from "./shared/maritime.js";
import { isoDateTimeSchema, limitSchema, mmsiSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** BarentsWatch retains 14 days; a longer window cannot be answered. */
const MAX_WINDOW_DAYS = 14;
const MAX_WINDOW_MS = MAX_WINDOW_DAYS * 86_400_000;

const inputSchema = z
  .object({
    mmsi: mmsiSchema.describe("Maritime Mobile Service Identity of the vessel, 1-9 digits."),
    from: isoDateTimeSchema
      .optional()
      .describe("Start of the window, ISO-8601. Omit both from and to for the last 24 hours."),
    to: isoDateTimeSchema.optional().describe("End of the window, ISO-8601."),
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT).describe(
      "Maximum track points to return. The full recorded count is always reported.",
    ),
  })
  .strict()
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message:
      "Provide both from and to, or neither. Omitting both returns the last 24 hours, which is the common case.",
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.to) > Date.parse(value.from),
    { message: "The end of the window must be later than its start." },
  )
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.to) - Date.parse(value.from) <= MAX_WINDOW_MS,
    {
      message: `The window must be at most ${MAX_WINDOW_DAYS} days. BarentsWatch retains no more than that.`,
    },
  );

const dataSchema = z.object({
  mmsi: z.string(),
  window: z.object({
    /** `last-24-hours` when no explicit window was given. */
    mode: z.enum(["last-24-hours", "explicit"]),
    requestedFrom: z.string().optional(),
    requestedTo: z.string().optional(),
  }),
  /** Earliest recorded point time, absent when the track is empty. */
  from: z.string().optional(),
  /** Latest recorded point time, absent when the track is empty. */
  to: z.string().optional(),
  pointsRecorded: z.number(),
  pointsReturned: z.number(),
  points: z.array(trackPointSchema),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const ais = context.getSdk().ais;
  const explicit = input.from !== undefined && input.to !== undefined;

  // Two SDK entry points rather than one with defaulted dates: the provider
  // serves the last-24-hours case from its own endpoint, and going through the
  // ranged one instead would lose that.
  const response: OpenDataResponse<AisTrack> = explicit
    ? await ais.getTrack({ mmsi: input.mmsi, from: input.from!, to: input.to! }, { signal })
    : await ais.getTrackLast24Hours(input.mmsi, { signal });

  const track = response.data;
  const recorded = track.points.length;
  const limited = tracker.limitArray("points", track.points, input.limit, recorded);

  const warnings = [...tracker.warnings(), AIS_COVERAGE_NOTE];
  if (recorded === 0) {
    warnings.push(
      "BarentsWatch recorded no positions for this MMSI in the requested window. That is not " +
        "evidence the vessel did not sail.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      mmsi: track.mmsi,
      window: {
        mode: explicit ? "explicit" : "last-24-hours",
        ...(input.from !== undefined ? { requestedFrom: input.from } : {}),
        ...(input.to !== undefined ? { requestedTo: input.to } : {}),
      },
      ...(track.from !== undefined ? { from: track.from } : {}),
      ...(track.to !== undefined ? { to: track.to } : {}),
      pointsRecorded: recorded,
      pointsReturned: limited.length,
      points: limited.map(projectTrackPoint),
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.points.length === 0) {
    return renderWithEnvelope(
      `BarentsWatch recorded no AIS positions for MMSI ${data.mmsi} in the requested window.`,
      envelope,
    );
  }

  const rows = data.points
    .map((point) => {
      const parts = [point.messageTime];
      if (point.latitude !== undefined) {
        parts.push(`${point.latitude}, ${point.longitude ?? "?"}`);
      }
      if (point.speedOverGround !== undefined) parts.push(`${point.speedOverGround} kn`);
      if (point.courseOverGround !== undefined) parts.push(`course ${point.courseOverGround}°`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const header =
    `Track for MMSI ${data.mmsi} (${data.window.mode === "explicit" ? "requested window" : "last 24 hours"}) — ` +
    `${data.pointsReturned} of ${data.pointsRecorded} recorded points` +
    `${data.from !== undefined ? `, ${data.from} to ${data.to ?? "?"}` : ""}.`;

  return renderWithEnvelope(`${header}\n\n${rows}`, envelope);
}

export const vesselTrackTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_vessel_track",
  title: "Get vessel track",
  description:
    "Return the recorded BarentsWatch AIS positions for one vessel over a bounded past window — " +
    "where it went, when, at what speed and on what course. Defaults to the last 24 hours; an " +
    "explicit from/to window of up to 14 days is accepted. " +
    "Use this when the user asks where a vessel has been, its route, or its movement over time. " +
    "Do not use this for a single current position with identity and register details, which is " +
    "get_vessel_profile, and do not use it to watch traffic in an area right now, which is " +
    "get_live_vessel_positions. Requires NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID and " +
    "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresAisCredentials,
  handler,
  render,
};
