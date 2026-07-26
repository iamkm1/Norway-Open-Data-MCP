/**
 * A bounded sample of a live feed — never the feed itself.
 *
 * `sdk.ais.streamPositions()` is an endless `AsyncIterable`: BarentsWatch holds
 * the connection open and pushes AIS messages until something closes it. MCP
 * has no way to express that. A tool call is one request and one result, so
 * exposing the stream directly would mean a handler that never resolves and a
 * connection that is never released.
 *
 * This tool therefore takes a **sample**. Three independent bounds are
 * mandatory arguments rather than defaults, because each one alone is
 * insufficient:
 *
 * - `boundingBox` limits how much of the sea is subscribed to at all.
 * - `limit` stops a busy area from filling the result budget.
 * - `timeoutMs` stops a quiet area from hanging the call, since a bounding box
 *   with no traffic in it emits nothing at all.
 *
 * Whichever bound is reached first ends the sample, and the connection is
 * closed on every path — normal completion, limit reached, timeout, caller
 * cancellation and provider error alike.
 */

import { z } from "zod";
import type { AisPosition } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { AIS_COVERAGE_NOTE, requiresAisCredentials } from "./shared/maritime.js";
import { boundingBoxSchema, mmsiSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

/** Hard ceiling on the sample, independent of what the caller asks for. */
const MAX_LIMIT = 200;
/**
 * Hard ceiling on how long a tool call may sit on an open connection.
 *
 * Deliberately short. This is a sample of live traffic, not a subscription: a
 * caller who wants to keep watching calls the tool again.
 */
const MAX_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 500;

const inputSchema = z
  .object({
    boundingBox: boundingBoxSchema.describe(
      "Required. The sea area to sample, in WGS84 decimal degrees. Capped at 6 degrees of latitude " +
        "by 12 of longitude — a limit of this MCP server, not of BarentsWatch — because a sample of " +
        "a larger area is not representative of it.",
    ),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .describe("Required. Stop after this many position reports."),
    timeoutMs: z
      .number()
      .int("Timeout must be a whole number of milliseconds.")
      .min(MIN_TIMEOUT_MS, `Timeout must be at least ${MIN_TIMEOUT_MS} ms.`)
      .max(MAX_TIMEOUT_MS, `Timeout must be at most ${MAX_TIMEOUT_MS} ms.`)
      .describe(
        "Required. Stop after this long even if the limit was not reached. A quiet area emits nothing at all.",
      ),
    mmsi: z
      .array(mmsiSchema)
      .min(1, "Provide at least one MMSI, or omit the filter entirely.")
      .max(50, "At most 50 MMSIs may be filtered on.")
      .optional()
      .describe("Optional. Restrict the sample to these vessels."),
    downsample: z
      .boolean()
      .default(true)
      .describe(
        "Ask the provider for at most one message per minute per vessel. On by default; turn it off only for a very small area.",
      ),
  })
  .strict();

const positionSchema = z.object({
  mmsi: z.string(),
  messageTime: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  /** Degrees true, 0-359.9. */
  courseOverGround: z.number().optional(),
  /** Knots. */
  speedOverGround: z.number().optional(),
  /** Degrees true. */
  trueHeading: z.number().optional(),
  /** Raw AIS navigational-status code; not normalized to text. */
  navigationalStatus: z.number().optional(),
  /** Receiver network the message came from, as the provider labelled it. */
  stream: z.string().optional(),
});

const dataSchema = z.object({
  boundingBox: z.object({
    south: z.number(),
    west: z.number(),
    north: z.number(),
    east: z.number(),
  }),
  /** Which bound ended the sample. */
  stoppedBecause: z.enum(["limit-reached", "timeout", "stream-ended"]),
  /** How long the connection was actually held open, in milliseconds. */
  sampledForMs: z.number(),
  positionCount: z.number(),
  /** Distinct MMSIs seen in the sample. */
  vesselCount: z.number(),
  positions: z.array(positionSchema),
});

type Data = z.infer<typeof dataSchema>;

function projectPosition(position: AisPosition): z.infer<typeof positionSchema> {
  return {
    mmsi: position.mmsi,
    messageTime: position.messageTime,
    ...(position.latitude !== undefined ? { latitude: position.latitude } : {}),
    ...(position.longitude !== undefined ? { longitude: position.longitude } : {}),
    ...(position.courseOverGround !== undefined
      ? { courseOverGround: position.courseOverGround }
      : {}),
    ...(position.speedOverGround !== undefined
      ? { speedOverGround: position.speedOverGround }
      : {}),
    ...(position.trueHeading !== undefined ? { trueHeading: position.trueHeading } : {}),
    ...(position.navigationalStatus !== undefined
      ? { navigationalStatus: position.navigationalStatus }
      : {}),
    ...(position.stream !== undefined ? { stream: position.stream } : {}),
  };
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const positions: z.infer<typeof positionSchema>[] = [];
  const started = Date.now();

  // One controller drives every way this sample can end, so the SDK sees a
  // single abort source and closes the connection exactly once.
  const controller = new AbortController();
  const abortForCaller = (): void => controller.abort();
  signal.addEventListener("abort", abortForCaller, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  // A stray tool call must never hold the event loop open on its own.
  timer.unref?.();

  let stoppedBecause: Data["stoppedBecause"] = "stream-ended";

  try {
    const stream = context.getSdk().ais.streamPositions({
      boundingBox: input.boundingBox,
      ...(input.mmsi !== undefined ? { mmsi: input.mmsi } : {}),
      downsample: input.downsample,
      signal: controller.signal,
    });

    // `break` runs the iterator's `return()`, which is how the SDK closes the
    // connection cleanly. `controller.abort()` in `finally` is the backstop for
    // an iterator that does not implement it.
    for await (const position of stream) {
      positions.push(projectPosition(position));
      if (positions.length >= input.limit) {
        stoppedBecause = "limit-reached";
        break;
      }
    }
    // Checked after the loop as well as in the catch: an iterator that returns
    // cleanly on abort rather than throwing would otherwise let a cancelled
    // call resolve as a successful, silently truncated sample.
    if (signal.aborted) {
      throw Object.assign(new Error("The sample was cancelled by the client."), {
        name: "AbortError",
      });
    }
    if (stoppedBecause !== "limit-reached" && timedOut) stoppedBecause = "timeout";
  } catch (error) {
    // The caller's own cancellation is theirs to hear about, so it propagates
    // and is mapped to `cancelled`.
    if (signal.aborted) throw error;
    // Our own timeout surfaces from the SDK as an abort. That is a successful
    // sample that ran out of time, not a failure: whatever arrived is returned.
    if (!timedOut) throw error;
    stoppedBecause = "timeout";
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortForCaller);
    // Idempotent, and the only guarantee that the connection is released when
    // the loop exited by `break` or by throwing.
    controller.abort();
  }

  const sampledForMs = Date.now() - started;
  const vesselCount = new Set(positions.map((position) => position.mmsi)).size;

  const warnings = [
    AIS_COVERAGE_NOTE,
    "This is a bounded sample of a live feed, not a complete picture of the area. It ended at " +
      `the first bound reached (${stoppedBecause}); vessels transmitting later or less often are absent.`,
  ];
  if (positions.length === 0) {
    warnings.push(
      "No AIS position was received in this window. That can mean the area is quiet, outside " +
        "BarentsWatch coverage, or that the sample was simply too short.",
    );
  }
  if (stoppedBecause === "limit-reached") {
    warnings.push(
      "The limit was reached before the timeout, so more vessels are almost certainly " +
        "transmitting in this area than are shown.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      boundingBox: input.boundingBox,
      stoppedBecause,
      sampledForMs,
      positionCount: positions.length,
      vesselCount,
      positions,
    },
    // A stream carries no per-response provenance, so the envelope is built
    // from the provider descriptor the SDK publishes for this feed.
    responses: [
      {
        data: null,
        source: {
          id: "barentswatch-ais",
          name: "BarentsWatch AIS",
          homepage: "https://www.barentswatch.no/",
          documentation: "https://developer.barentswatch.no/docs/AIS/live-ais-api/",
          license: "Norwegian Licence for Open Government Data (NLOD)",
          attribution:
            "AIS data is provided by the Norwegian Coastal Administration (Kystverket) via BarentsWatch; credit both.",
        },
        retrievedAt: new Date(started).toISOString(),
        cached: false,
      },
    ],
    warnings,
    truncation:
      stoppedBecause === "limit-reached"
        ? {
            truncated: true,
            fields: [{ field: "positions", returned: positions.length, reason: "limit" }],
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const box = data.boundingBox;
  const header =
    `Live AIS sample for ${box.south},${box.west} to ${box.north},${box.east} — ` +
    `${data.positionCount} position report(s) from ${data.vesselCount} vessel(s) in ${data.sampledForMs} ms ` +
    `(stopped: ${data.stoppedBecause}).`;

  if (data.positions.length === 0) {
    return renderWithEnvelope(`${header}\n\nNo positions were received.`, envelope);
  }

  const rows = data.positions
    .map((position) => {
      const parts = [`MMSI ${position.mmsi}`, position.messageTime];
      if (position.latitude !== undefined) {
        parts.push(`${position.latitude}, ${position.longitude ?? "?"}`);
      }
      if (position.speedOverGround !== undefined) parts.push(`${position.speedOverGround} kn`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  return renderWithEnvelope(`${header}\n\n${rows}`, envelope);
}

export const liveVesselPositionsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_live_vessel_positions",
  title: "Sample live vessel positions",
  description:
    "Take a short, bounded sample of the live BarentsWatch AIS feed for one sea area and return " +
    "the vessel positions received during it. A bounding box, a result limit and a timeout in " +
    "milliseconds are all required, and the sample ends at whichever is reached first — this is " +
    "a snapshot of a live feed, never a subscription. " +
    "Use this when the user asks what vessels are in an area right now, or to watch traffic " +
    "somewhere over a few seconds. " +
    "Do not use this to follow one known vessel — get_vessel_track returns its recorded history " +
    "and get_vessel_profile its latest position — and do not treat the result as a complete " +
    "census of the area. Requires NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID and " +
    "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresAisCredentials,
  handler,
  render,
};
