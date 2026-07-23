import { z } from "zod";
import type { OpenDataResponse } from "norway-open-data-sdk";

import { UpstreamNotFoundError } from "../errors/map.js";
import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  isoDateTimeSchema,
  limitSchema,
  searchQuerySchema,
  stopPlaceIdSchema,
} from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_ALTERNATIVES = 5;
const AUTOCOMPLETE_LIMIT = 6;

const inputSchema = z
  .object({
    stopName: searchQuerySchema("Stop name", 2, 100).optional(),
    stopPlaceId: stopPlaceIdSchema.optional(),
    dateTime: isoDateTimeSchema.optional(),
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
  })
  .strict()
  .refine((value) => (value.stopName === undefined) !== (value.stopPlaceId === undefined), {
    message:
      "Provide exactly one of stopName or stopPlaceId. Use stopName when you only know what the stop is called.",
    path: ["stopName"],
  });

const departureSchema = z.object({
  line: z.string().optional(),
  destination: z.string().optional(),
  transportMode: z.string().optional(),
  aimedDepartureTime: z.string().optional(),
  expectedDepartureTime: z.string().optional(),
  realtime: z.boolean().optional(),
  cancelled: z.boolean().optional(),
});

const dataSchema = z.object({
  resolvedStop: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
  alternatives: z.array(z.object({ id: z.string(), name: z.string() })),
  departures: z.array(departureSchema),
  usedStopNameResolution: z.boolean(),
});

type Data = z.infer<typeof dataSchema>;

/**
 * A stop-place ID is not something a person knows, so a name is resolved first
 * through Entur's geocoder. Only stop places are usable for a departure board —
 * the geocoder also returns addresses and points of interest, which would
 * produce a confusing "no departures" answer if selected.
 */
function isStopPlace(id: string | undefined): id is string {
  return typeof id === "string" && /^NSR:StopPlace:\d+$/.test(id);
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const responses: OpenDataResponse<unknown>[] = [];

  let stopPlaceId = input.stopPlaceId;
  let stopName: string | undefined;
  let alternatives: { id: string; name: string }[] = [];

  if (stopPlaceId === undefined && input.stopName !== undefined) {
    const autocomplete = await sdk.transport.autocomplete(
      { text: input.stopName, limit: AUTOCOMPLETE_LIMIT },
      { signal },
    );
    responses.push(autocomplete);

    const stopPlaces = autocomplete.data.filter((place) => isStopPlace(place.id));
    const best = stopPlaces[0];
    if (!best?.id) {
      throw new UpstreamNotFoundError(
        `No Norwegian public transport stop matched "${input.stopName}". Try the exact stop name as it appears on the timetable.`,
        "entur",
      );
    }

    stopPlaceId = best.id;
    stopName = best.name;
    alternatives = tracker.limitArray(
      "alternatives",
      stopPlaces.slice(1).map((place) => ({ id: place.id as string, name: place.name })),
      MAX_ALTERNATIVES,
    );
  }

  const departuresResponse = await sdk.transport.departures(
    {
      stopPlaceId: stopPlaceId as string,
      ...(input.dateTime !== undefined ? { dateTime: input.dateTime } : {}),
      limit: input.limit,
    },
    { signal },
  );
  responses.push(departuresResponse);

  const departures = tracker.limitArray("departures", departuresResponse.data, input.limit);
  const resolvedName = stopName ?? departures[0]?.stopName;

  const warnings = tracker.warnings();
  if (alternatives.length > 0) {
    warnings.push(
      `The stop name matched more than one stop place. Showing "${resolvedName ?? stopPlaceId}". ` +
        `Other matches: ${alternatives.map((alt) => alt.name).join(", ")}. ` +
        "Ask the user which one they meant if the answer depends on it.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      resolvedStop: {
        id: stopPlaceId as string,
        ...(resolvedName !== undefined ? { name: resolvedName } : {}),
      },
      alternatives,
      departures: departures.map((departure) => ({
        ...(departure.line?.publicCode !== undefined || departure.line?.name !== undefined
          ? { line: departure.line.publicCode ?? departure.line.name }
          : {}),
        ...(departure.destinationDisplay !== undefined
          ? { destination: departure.destinationDisplay }
          : {}),
        ...(departure.transportMode !== undefined
          ? { transportMode: departure.transportMode }
          : {}),
        ...(departure.aimedDepartureTime !== undefined
          ? { aimedDepartureTime: departure.aimedDepartureTime }
          : {}),
        ...(departure.expectedDepartureTime !== undefined
          ? { expectedDepartureTime: departure.expectedDepartureTime }
          : {}),
        ...(departure.realtime !== undefined ? { realtime: departure.realtime } : {}),
        ...(departure.cancelled !== undefined ? { cancelled: departure.cancelled } : {}),
      })),
      usedStopNameResolution: input.stopName !== undefined,
    },
    responses,
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const header = `Departures from ${data.resolvedStop.name ?? data.resolvedStop.id} (${data.resolvedStop.id}):`;

  if (data.departures.length === 0) {
    return renderWithEnvelope(
      `${header}\n\nNo upcoming departures were returned for this stop at the requested time.`,
      envelope,
    );
  }

  const rows = data.departures
    .map((departure) => {
      const time = departure.expectedDepartureTime ?? departure.aimedDepartureTime ?? "";
      const realtime = departure.realtime === true ? " (realtime)" : " (scheduled)";
      const cancelled = departure.cancelled === true ? " CANCELLED" : "";
      return `- ${time.slice(11, 16)} ${departure.line ?? ""} ${departure.destination ?? ""}${realtime}${cancelled}`.replace(
        /\s+/g,
        " ",
      );
    })
    .join("\n");

  return renderWithEnvelope(`${header}\n\n${rows}`, envelope);
}

export const transportDeparturesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_transport_departures",
  title: "Get Norwegian public transport departures",
  description:
    "Get upcoming public transport departures from a Norwegian stop place — bus, tram, metro, " +
    "train or ferry — with real-time expected times where the operator publishes them. Accepts " +
    "either a stop name to look up (stopName) or a known Entur stop place ID (stopPlaceId); " +
    "provide exactly one. " +
    "Use this when the user asks when the next bus, train or tram leaves from a named stop, or " +
    "wants a departure board. " +
    "Do not use this when the user wants a route or travel plan between two places — journey " +
    "planning is not available in this server. Do not use this to look up a street address; that " +
    "is search_norwegian_addresses.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
