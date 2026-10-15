import { z } from "zod";
import type { ClimateStationSearchParameters, OpenDataResponse } from "norway-open-data-sdk";

import { InvalidToolInputError, UpstreamNotFoundError } from "../errors/map.js";
import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  daysBetween,
  isoDateSchema,
  latitudeSchema,
  longitudeSchema,
  osloToday,
} from "./shared/schemas.js";
import {
  FROST_EXPERIMENTAL_NOTE,
  OBSERVATION_GAP_NOTE,
  climateStationSchema,
  observationRecordSchema,
  projectClimateStation,
  projectObservationRecord,
  remoteStationNote,
  renderObservation,
  requiresFrostClientId,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

/**
 * The elements this tool offers, and the Frost element IDs they map to.
 *
 * A fixed list rather than free-form IDs: Frost has thousands of elements and a
 * model guessing at their exact spelling would ask for series that do not
 * exist. These are Frost's documented IDs for the questions people ask; the SDK
 * marks Frost experimental, so they are confirmed by the opt-in live suite.
 */
const HOURLY_ELEMENTS = {
  air_temperature: "air_temperature",
  wind_speed: "wind_speed",
  relative_humidity: "relative_humidity",
  precipitation: "sum(precipitation_amount PT1H)",
} as const;

const DAILY_ELEMENTS = {
  mean_air_temperature: "mean(air_temperature P1D)",
  min_air_temperature: "min(air_temperature P1D)",
  max_air_temperature: "max(air_temperature P1D)",
  precipitation: "sum(precipitation_amount P1D)",
  max_wind_gust: "max(wind_speed_of_gust P1D)",
} as const;

/** Monthly 1991–2020 normals, the period Frost and MET Norway use today. */
const NORMAL_ELEMENTS = {
  mean_air_temperature: "mean(air_temperature P1M)",
  precipitation: "sum(precipitation_amount P1M)",
} as const;
const NORMAL_PERIOD = "1991/2020";

/**
 * Window bounds, in whole UTC days. Four hourly days is 96 values and a
 * hundred daily ones is 100: both inside the 100-item array budget, so no
 * period is ever silently shortened.
 */
const RESOLUTIONS = {
  hourly: { elements: HOURLY_ELEMENTS, timeResolution: "PT1H", maxDays: 4 },
  daily: { elements: DAILY_ELEMENTS, timeResolution: "P1D", maxDays: 100 },
} as const;

type Resolution = keyof typeof RESOLUTIONS;

const ELEMENT_NAMES = [
  "air_temperature",
  "wind_speed",
  "relative_humidity",
  "precipitation",
  "mean_air_temperature",
  "min_air_temperature",
  "max_air_temperature",
  "max_wind_gust",
] as const;

const MAX_RECORDS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const stationIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(
        /^SN\d{1,9}$/,
        "Station ID must be a Frost station ID such as SN18700, without a sensor suffix.",
      ),
  );

const inputSchema = z
  .object({
    latitude: latitudeSchema
      .optional()
      .describe("WGS84 latitude. With longitude, uses the nearest station reporting the elements."),
    longitude: longitudeSchema.optional().describe("WGS84 longitude. Give with latitude."),
    stationId: stationIdSchema
      .optional()
      .describe("A Frost station ID such as SN18700 (Oslo – Blindern). Instead of a point."),
    resolution: z
      .enum(["hourly", "daily"])
      .default("daily")
      .describe("hourly covers up to 4 days; daily covers up to 100 days."),
    startDate: isoDateSchema.describe("First day, YYYY-MM-DD, as a UTC day. Not in the future."),
    endDate: isoDateSchema
      .optional()
      .describe("Last day, YYYY-MM-DD, inclusive. Defaults to startDate."),
    elements: z
      .array(z.enum(ELEMENT_NAMES))
      .min(1, "Request at least one element.")
      .max(5, "Request at most five elements.")
      .refine((value) => new Set(value).size === value.length, "Elements must be unique.")
      .optional()
      .describe(
        "hourly: air_temperature, wind_speed, relative_humidity, precipitation. daily: " +
          "mean_air_temperature, min_air_temperature, max_air_temperature, precipitation, " +
          "max_wind_gust. Defaults to every element of the resolution.",
      ),
    includeNormals: z
      .boolean()
      .default(false)
      .describe("Add the station's 1991–2020 monthly temperature and precipitation normals."),
  })
  .strict()
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "Give latitude and longitude together, or neither.",
    path: ["longitude"],
  })
  .refine((value) => (value.latitude === undefined) !== (value.stationId === undefined), {
    message: "Give exactly one of a point (latitude and longitude) or a stationId.",
    path: ["stationId"],
  })
  .refine((value) => daysBetween(value.startDate, value.endDate ?? value.startDate) >= 0, {
    message: "endDate must be on or after startDate.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      daysBetween(value.startDate, value.endDate ?? value.startDate) <
      RESOLUTIONS[value.resolution].maxDays,
    {
      message:
        "The range is too long: hourly history covers at most 4 days (96 values) and daily history at most 100 days.",
      path: ["endDate"],
    },
  )
  .refine(
    (value) =>
      value.elements === undefined ||
      value.elements.every((element) => element in RESOLUTIONS[value.resolution].elements),
    {
      message:
        "An element does not exist at this resolution. hourly: air_temperature, wind_speed, " +
        "relative_humidity, precipitation. daily: mean_air_temperature, min_air_temperature, " +
        "max_air_temperature, precipitation, max_wind_gust.",
      path: ["elements"],
    },
  );

const elementSchema = z.object({
  /** This server's name for the element. */
  element: z.string(),
  /** The Frost element ID it maps to. */
  elementId: z.string(),
});

const dataSchema = z.object({
  station: climateStationSchema,
  selectedBy: z
    .enum(["nearest-station", "station-id"])
    .describe("nearest-station: the closest Frost station reporting every requested element."),
  window: z.object({
    startDate: z.string(),
    endDate: z.string(),
    /** UTC, inclusive. */
    from: z.string(),
    /** UTC, exclusive, as Frost treats it. */
    to: z.string(),
    resolution: z.enum(["hourly", "daily"]),
    timeResolution: z.string(),
  }),
  elements: z.array(elementSchema),
  records: z.array(observationRecordSchema),
  recordCount: z.number(),
  normals: z
    .object({
      period: z.string(),
      /** Months the window touches, 1–12. */
      months: z.array(z.number()),
      values: z.array(
        elementSchema.extend({
          month: z.number(),
          /** Null when Frost holds no value for this element and month. */
          normal: z.number().nullable(),
        }),
      ),
    })
    .nullable()
    .describe("Null unless includeNormals was set and the normals request succeeded."),
});

type Data = z.infer<typeof dataSchema>;

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** Calendar months a UTC date range touches, in order. At most five for 100 days. */
function monthsCovered(startDate: string, endDate: string): number[] {
  const months: number[] = [];
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  // A schema cannot see the clock, so the one rule that needs it runs here,
  // before any request. A future window would only ever come back empty.
  if (input.startDate > osloToday(context.now())) {
    throw new InvalidToolInputError(
      "startDate",
      `startDate ${input.startDate} is in the future. Weather history covers observations already made; for what will happen, use get_norwegian_weather_forecast.`,
    );
  }

  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const resolution: Resolution = input.resolution;
  const config = RESOLUTIONS[resolution];
  const endDate = input.endDate ?? input.startDate;

  const requested = new Set<string>(input.elements ?? Object.keys(config.elements));
  const elements = Object.entries(config.elements)
    .filter(([name]) => requested.has(name))
    .map(([element, elementId]) => ({ element, elementId }));
  const elementIds = elements.map((entry) => entry.elementId);
  const labels = new Map<string, string>(elements.map((entry) => [entry.elementId, entry.element]));

  // Frost calls are sequential: they share one provider's courtesy budget.
  const search: ClimateStationSearchParameters =
    input.stationId !== undefined
      ? { ids: [input.stationId] }
      : {
          near: {
            latitude: input.latitude as number,
            longitude: input.longitude as number,
            maxCount: 1,
          },
          elements: elementIds,
        };
  const stationResponse = await sdk.climate.searchStations(search, { signal });
  const found = stationResponse.data[0];
  if (found === undefined) {
    throw new UpstreamNotFoundError(
      input.stationId !== undefined
        ? `Frost has no weather station ${input.stationId}.`
        : "Frost found no weather station reporting the requested elements near that point.",
      "met-frost",
    );
  }
  const station = projectClimateStation(found);

  const from = `${input.startDate}T00:00:00Z`;
  const to = `${nextDay(endDate)}T00:00:00Z`;
  const observationsResponse = await sdk.climate.getObservations(
    {
      stationIds: [station.id],
      elements: elementIds,
      from,
      to,
      timeResolutions: [config.timeResolution],
    },
    { signal },
  );
  const responses: OpenDataResponse<unknown>[] = [stationResponse, observationsResponse];

  const records = tracker
    .limitArray("records", observationsResponse.data, MAX_RECORDS)
    .map((record, index) =>
      projectObservationRecord(record, tracker, `records[${index}]`, (id) => labels.get(id)),
    );

  const notes = [FROST_EXPERIMENTAL_NOTE, OBSERVATION_GAP_NOTE];
  notes.push(
    `The window is the UTC days ${input.startDate} to ${endDate}: Frost was asked from ${from} up ` +
      `to, but not including, ${to}. Daily values keep Frost's own reference times and offsets.`,
  );
  if (input.stationId === undefined) {
    notes.push(
      "The station is the nearest Frost station reporting every requested element, which can be " +
        "farther away than the nearest station of any kind.",
      ...remoteStationNote(station),
    );
  }
  if (records.length === 0) {
    notes.push(
      `Frost returned no observations for ${station.name} (${station.id}) in this window. That ` +
        "means no data for this station and period, not an error; another station or a different " +
        "period may have data.",
    );
  }

  let normals: Data["normals"] = null;
  let normalsFailed = false;
  if (input.includeNormals) {
    const normalLabels = new Map<string, string>(
      Object.entries(NORMAL_ELEMENTS).map(([element, elementId]) => [elementId, element]),
    );
    try {
      const normalsResponse = await sdk.climate.getClimateNormals(
        {
          stationIds: [station.id],
          elements: Object.values(NORMAL_ELEMENTS),
          period: NORMAL_PERIOD,
        },
        { signal },
      );
      responses.push(normalsResponse);
      const months = monthsCovered(input.startDate, endDate);
      const values = normalsResponse.data.flatMap((normal) => {
        const element = normalLabels.get(normal.elementId);
        // Monthly normals only: a day-of-month normal answers a different question.
        if (
          element === undefined ||
          normal.month === undefined ||
          normal.day !== undefined ||
          !months.includes(normal.month)
        ) {
          return [];
        }
        return [
          {
            element,
            elementId: normal.elementId,
            month: normal.month,
            normal: normal.normal ?? null,
          },
        ];
      });
      normals = { period: NORMAL_PERIOD, months, values };
      notes.push(
        values.length === 0
          ? `Frost holds no ${NORMAL_PERIOD} monthly normals for this station and these months.`
          : `Normals are the station's ${NORMAL_PERIOD} monthly averages for the months this window ` +
              "touches: a thirty-year reference, not an observation.",
      );
    } catch (error) {
      // Cancellation is the caller's and aborts the call; any other failure
      // costs only the normals, which are a supplement to the observations.
      if (signal.aborted) throw error;
      normalsFailed = true;
      notes.push(
        "The climate-normal request failed, so normals are missing. The observations are " +
          "complete. This is a partial result.",
      );
      context.logger.warn("Frost normals request failed; returning observations alone.", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  notes.push(...tracker.warnings());

  return buildEnvelope<Data>({
    data: {
      station,
      selectedBy: input.stationId !== undefined ? "station-id" : "nearest-station",
      window: {
        startDate: input.startDate,
        endDate,
        from,
        to,
        resolution,
        timeResolution: config.timeResolution,
      },
      elements,
      records,
      recordCount: records.length,
      normals,
    },
    responses,
    warnings: notes,
    truncation: tracker.report(),
    partial: normalsFailed
      ? {
          complete: false,
          missing: ["normals"],
          reason: "The Frost climate-normal request failed.",
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const station = data.station;
  const sections = [
    [
      `Weather history at ${station.name} (${station.id})`,
      ...fields([
        ["Distance from the point (km)", station.distanceKm],
        ["Elevation (m)", station.elevationMetres],
        ["Municipality", station.municipality],
        [
          "Window (UTC days)",
          data.window.startDate === data.window.endDate
            ? data.window.startDate
            : `${data.window.startDate} to ${data.window.endDate}`,
        ],
        ["Resolution", data.window.resolution],
        ["Records", data.recordCount],
      ]),
    ].join("\n"),
  ];

  sections.push(
    data.records.length === 0
      ? "No observations in this window."
      : data.records
          .map(
            (record) =>
              `- ${record.referenceTime}: ${record.observations.map(renderObservation).join("; ")}`,
          )
          .join("\n"),
  );

  if (data.normals !== null && data.normals.values.length > 0) {
    sections.push(
      `Normals ${data.normals.period}:\n${data.normals.values
        .map(
          (value) =>
            `- ${MONTHS[value.month - 1] ?? `month ${value.month}`}: ${value.element} ${
              value.normal === null ? "no value" : String(value.normal)
            }`,
        )
        .join("\n")}`,
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const weatherHistoryTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_weather_history",
  title: "Get Norwegian weather history (Frost)",
  description:
    "Get past weather observations from MET Norway's Frost archive at the nearest weather station " +
    "to a coordinate, or at a given Frost station: hourly temperature, wind, humidity and " +
    "precipitation over up to four days, or daily mean, minimum and maximum temperature, " +
    "precipitation and gusts over up to 100 days, optionally beside the station's 1991–2020 " +
    "monthly normals. Experimental. " +
    "Use this when the user asks what the weather was — how cold it got last week, how much rain " +
    "fell in a month, or how a period compared with normal. " +
    "Do not use this for what will happen, which is get_norwegian_weather_forecast, or for " +
    "conditions right now, which is get_weather_conditions_profile. Values are never filled or " +
    "interpolated. " +
    "Requires the NORWAY_MCP_MET_FROST_CLIENT_ID environment variable.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresFrostClientId,
  handler,
  render,
};
