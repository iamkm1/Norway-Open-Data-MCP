import { z } from "zod";
import type { OpenDataResponse, WaterLevels } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import {
  TIDE_MODEL_NOTE,
  TIDE_NOT_COVERED_NOTE,
  TIDE_TIME_NOTE,
  describeTideLocation,
  projectServiceMessages,
  projectTideLocation,
  projectTideTable,
  referenceLevelNote,
  renderTideEvents,
  tideLocationSchema,
  tideTableSchema,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HOURS = 48;
/** A week. The SDK allows 366 days; a week of high and low waters is about 28 events. */
const MAX_HOURS = 168;
/**
 * Water levels are hourly series — up to four of them — so they are bounded more
 * tightly than the tide table: 48 hours is at most about 50 values per series.
 */
const MAX_WATER_LEVEL_HOURS = 48;
const MAX_WATER_LEVEL_VALUES = 60;
const MAX_SERIES = 6;

const REFERENCE_LEVELS = ["chart-datum", "mean-sea-level", "nn2000"] as const;

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude of a point on or near the Norwegian coast."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    hours: z
      .number()
      .int("Hours must be a whole number.")
      .min(1, "Hours must be at least 1.")
      .max(MAX_HOURS, `Hours must be at most ${MAX_HOURS} (one week).`)
      .default(DEFAULT_HOURS)
      .describe("Hours ahead from now to cover. The window is computed by this server."),
    referenceLevel: z
      .enum(REFERENCE_LEVELS)
      .default("chart-datum")
      .describe(
        "Level heights are measured from: chart-datum (as in tide tables and charts), " +
          "mean-sea-level, or nn2000 (Norway's land-height datum).",
      ),
    includeWaterLevels: z
      .boolean()
      .default(false)
      .describe(
        `Also return hourly observed, predicted, weather-effect and forecast water levels for the first ${MAX_WATER_LEVEL_HOURS} hours.`,
      ),
  })
  .strict();

const windowSchema = z.object({
  /** UTC, ISO-8601. */
  from: z.string(),
  to: z.string(),
  hours: z.number(),
});

const waterLevelsSchema = z.object({
  window: windowSchema.extend({ intervalMinutes: z.number() }),
  location: tideLocationSchema,
  referenceLevel: z.string(),
  serviceMessages: z.array(z.string()),
  series: z.array(
    z.object({
      /** observation, prediction, weathereffect or forecast, kept separate. */
      type: z.string(),
      unit: z.string(),
      quality: z
        .object({
          flag: z.number(),
          class: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
      values: z.array(
        z.object({
          time: z.string(),
          value: z.number(),
          flag: z.string().optional(),
          uncertainty: z
            .object({
              lowerPercentile: z.number().optional(),
              lowPercentile: z.number().optional(),
              highPercentile: z.number().optional(),
              higherPercentile: z.number().optional(),
            })
            .optional(),
        }),
      ),
    }),
  ),
});

const dataSchema = z.object({
  requested: z.object({ latitude: z.number(), longitude: z.number() }),
  window: windowSchema,
  /** The reference level asked for; Kartverket's own code for it is in each section. */
  referenceLevel: z.enum(REFERENCE_LEVELS),
  /** False inland and far offshore, where Kartverket publishes no sea level. */
  covered: z.boolean(),
  tideTable: tideTableSchema.nullable(),
  waterLevels: waterLevelsSchema
    .nullable()
    .describe("Null unless includeWaterLevels was set and Kartverket returned levels."),
});

type Data = z.infer<typeof dataSchema>;

function projectWaterLevels(
  levels: WaterLevels,
  window: z.infer<typeof waterLevelsSchema>["window"],
  tracker: TruncationTracker,
): z.infer<typeof waterLevelsSchema> {
  return {
    window,
    location: projectTideLocation(levels.location, tracker, "waterLevels.location"),
    referenceLevel: levels.referenceLevel,
    serviceMessages: projectServiceMessages(
      levels.serviceMessages,
      tracker,
      "waterLevels.serviceMessages",
    ),
    series: tracker
      .limitArray("waterLevels.series", levels.series, MAX_SERIES)
      .map((series, index) => ({
        type: series.type,
        unit: series.unit,
        ...(series.quality !== undefined
          ? {
              quality: {
                flag: series.quality.flag,
                ...(series.quality.class !== undefined ? { class: series.quality.class } : {}),
                ...(series.quality.description !== undefined
                  ? { description: series.quality.description }
                  : {}),
              },
            }
          : {}),
        values: tracker
          .limitArray(`waterLevels.series[${index}].values`, series.values, MAX_WATER_LEVEL_VALUES)
          .map((value) => ({
            time: value.time,
            value: value.value,
            ...(value.flag !== undefined ? { flag: value.flag } : {}),
            ...(value.uncertainty !== undefined ? { uncertainty: { ...value.uncertainty } } : {}),
          })),
      })),
  };
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const point = { latitude: input.latitude, longitude: input.longitude };

  // The window is built here, from the injected clock: an ISO-8601 timestamp
  // with an explicit offset, which is what the SDK requires.
  const start = context.now().getTime();
  const window = {
    from: new Date(start).toISOString(),
    to: new Date(start + input.hours * HOUR_MS).toISOString(),
    hours: input.hours,
  };

  const tableResponse = await sdk.tides.getTideTable(
    { ...point, from: window.from, to: window.to, referenceLevel: input.referenceLevel },
    { signal },
  );
  const responses: OpenDataResponse<unknown>[] = [tableResponse];
  const table =
    tableResponse.data === undefined
      ? null
      : projectTideTable(tableResponse.data, tracker, "tideTable");

  const notes = [TIDE_TIME_NOTE];
  let waterLevels: Data["waterLevels"] = null;
  let waterLevelsFailed = false;

  if (table === null) {
    notes.push(TIDE_NOT_COVERED_NOTE);
  } else {
    notes.push(referenceLevelNote(input.referenceLevel), TIDE_MODEL_NOTE);

    // Asked for only where the tide table shows the point is covered: an
    // uncovered point has no water levels either, and the second request would
    // spend the provider's budget to learn nothing.
    if (input.includeWaterLevels) {
      const hours = Math.min(input.hours, MAX_WATER_LEVEL_HOURS);
      const levelWindow = {
        from: window.from,
        to: new Date(start + hours * HOUR_MS).toISOString(),
        hours,
        intervalMinutes: 60,
      };
      if (hours < input.hours) {
        notes.push(
          `Water levels cover the first ${hours} of the ${input.hours} requested hours; the tide ` +
            "table covers all of them.",
        );
      }

      try {
        const levelsResponse = await sdk.tides.getWaterLevels(
          {
            ...point,
            from: levelWindow.from,
            to: levelWindow.to,
            interval: 60,
            referenceLevel: input.referenceLevel,
          },
          { signal },
        );
        responses.push(levelsResponse);
        if (levelsResponse.data === undefined) {
          notes.push("Kartverket returned no water levels for this position and window.");
        } else {
          waterLevels = projectWaterLevels(levelsResponse.data, levelWindow, tracker);
          if (waterLevels.series.some((series) => series.type === "forecast")) {
            notes.push(
              "Forecast water levels carry Kartverket's uncertainty band in each value's " +
                "uncertainty percentiles.",
            );
          }
        }
      } catch (error) {
        // Cancellation is the caller's and aborts the whole call. Detected by the
        // signal, because the SDK reports an aborted request as a ProviderError.
        if (signal.aborted) throw error;
        waterLevelsFailed = true;
        notes.push(
          "The water-level request failed, so water levels are missing. The tide table above is " +
            "complete. This is a partial result.",
        );
        context.logger.warn("Water-level request failed; returning the tide table alone.", {
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  notes.push(...tracker.warnings());

  return buildEnvelope<Data>({
    data: {
      requested: point,
      window,
      referenceLevel: input.referenceLevel,
      covered: table !== null,
      tideTable: table,
      waterLevels,
    },
    responses,
    warnings: notes,
    truncation: tracker.report(),
    partial: waterLevelsFailed
      ? {
          complete: false,
          missing: ["waterLevels"],
          reason: "The Kartverket water-level request failed.",
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const where = `${data.requested.latitude}, ${data.requested.longitude}`;
  if (data.tideTable === null) {
    return renderWithEnvelope(
      `No tide data for ${where}: Kartverket covers the Norwegian coast, not inland or far-offshore points.`,
      envelope,
    );
  }

  const table = data.tideTable;
  const sections = [
    [
      `Tides at ${where}, ${data.window.from} to ${data.window.to} (UTC).`,
      `Heights in ${table.unit} above ${data.referenceLevel} (Kartverket code ${table.referenceLevel}).`,
      `Modelled from ${describeTideLocation(table.location)}.`,
    ].join("\n"),
    renderTideEvents(table),
  ];

  if (table.serviceMessages.length > 0) {
    sections.push(
      `Kartverket notices:\n${table.serviceMessages.map((message) => `- ${message}`).join("\n")}`,
    );
  }

  if (data.waterLevels !== null) {
    const levels = data.waterLevels;
    sections.push(
      [
        `Water levels, hourly, first ${levels.window.hours} h (UTC):`,
        ...levels.series.map((series) => {
          const first = series.values[0];
          const last = series.values.at(-1);
          return `- ${series.type}: ${series.values.length} values${
            first !== undefined && last !== undefined
              ? `, ${first.value} ${series.unit} at ${first.time} to ${last.value} ${series.unit} at ${last.time}`
              : ""
          }`;
        }),
      ].join("\n"),
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const tidesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_tides",
  title: "Get Norwegian tides and water levels",
  description:
    "Get Kartverket's predicted high and low tides (tidevann, flo og fjære) for a point on the " +
    "Norwegian coast over the next hours or days, optionally with hourly observed, predicted, " +
    "weather-effect and forecast water levels. " +
    "Every result states the reference level and the station, factor and delay the values were " +
    "modelled from, and all times are UTC. " +
    "Use this when the user asks about high or low tide, the water level, or storm-surge water " +
    "levels at a harbour or shore. " +
    "Do not use this for waves, swell or sea currents — that is get_marine_forecast — or for " +
    "weather. An inland or far-offshore point is not covered and returns a null tide table, not " +
    "an error. Needs no credentials.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
