import { z } from "zod";
import type { AirQualityForecast, OceanForecast, WeatherForecast } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import {
  HAZARD_DISCLAIMER,
  componentProvenance,
  componentSchema,
  componentWarnings,
  compositeSourceSchema,
  describeHazardMatches,
  hazardSchema,
  projectComponents,
  projectCompositeSource,
  projectHazard,
  renderHazardLines,
  type ProjectedComponent,
} from "./shared/profile.js";
import {
  MET_WARNING_DISCLAIMER,
  TIDE_MODEL_NOTE,
  TIDE_TIME_NOTE,
  climateNormalSchema,
  climateStationSchema,
  describeTideLocation,
  metPointSchema,
  nowcastSchema,
  observationRecordSchema,
  projectClimateNormal,
  projectClimateStation,
  projectMetPoint,
  projectNowcast,
  projectObservationRecord,
  projectSunTimes,
  projectTideTable,
  projectWeatherWarning,
  referenceLevelNote,
  renderObservation,
  renderSunTimes,
  renderTideEvents,
  renderWeatherWarning,
  sunTimesNotes,
  sunTimesSchema,
  tideTableSchema,
  weatherWarningNotes,
  weatherWarningSchema,
} from "./shared/weather.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_HOURS = 12;
const MAX_HOURS = 48;
const MAX_WARNINGS = 20;
const MAX_HAZARDS = 20;
const MAX_LATEST_RECORDS = 10;
const MAX_COMPONENTS = 20;
const MAX_NOTICES = 20;

const PROFILE_EXPERIMENTAL_NOTE =
  "Experimental: norway-open-data-sdk 0.9.0 marks the conditions profile experimental. Each " +
  "section is a separate provider answer; a missing section never removes another.";

const WARNING_AREA_NOTE =
  "MET Norway warning areas are not included here. get_norwegian_weather_warnings with " +
  "includeGeometry returns them.";

const AIR_QUALITY_NOTE =
  "Air quality is MET Norway's model forecast, published as product version 0.1 and marked " +
  "experimental by the SDK. Its values are forecasts, not measurements.";

const OCEAN_NOTE =
  "The ocean forecast is for the nearest MET Norway ocean-model cell, whose centre may be some " +
  "distance from the point.";

const inputSchema = z
  .object({
    latitude: latitudeSchema.describe("WGS84 latitude in decimal degrees."),
    longitude: longitudeSchema.describe("WGS84 longitude in decimal degrees."),
    hours: z
      .number()
      .int("Hours must be a whole number.")
      .min(1, "Hours must be at least 1.")
      .max(MAX_HOURS, `Hours must be at most ${MAX_HOURS}.`)
      .default(DEFAULT_HOURS)
      .describe(
        "Hours ahead for the forecast, ocean and air-quality sections. The tide table always covers at least 24 hours.",
      ),
  })
  .strict();

const forecastEntrySchema = z.object({
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

const oceanSchema = z.object({
  updatedAt: z.string().optional(),
  /** Centre of the model cell that answered. */
  coordinates: metPointSchema,
  entries: z.array(
    z.object({
      time: z.string(),
      /** °C. */
      seaTemperature: z.number().optional(),
      /** Significant wave height, metres. */
      waveHeight: z.number().optional(),
      /** Degrees the waves come from. */
      waveFromDirection: z.number().optional(),
      /** m/s. */
      currentSpeed: z.number().optional(),
      /** Degrees the current flows towards. */
      currentToDirection: z.number().optional(),
    }),
  ),
});

const pollutantSchema = z.object({
  /** µg/m³. */
  concentration: z.number().optional(),
  index: z.number().optional(),
});

const airAreaSchema = z.object({
  name: z.string(),
  areaClass: z.string(),
  areaCode: z.string(),
});

const airQualitySchema = z.object({
  referenceTime: z.string(),
  area: airAreaSchema,
  parentArea: airAreaSchema.optional(),
  entries: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      index: z.number().optional(),
      no2: pollutantSchema.optional(),
      pm10: pollutantSchema.optional(),
      pm25: pollutantSchema.optional(),
      o3: pollutantSchema.optional(),
    }),
  ),
});

const dataSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  /** From Kartverket's administrative-boundary lookup, not inferred from a place name. */
  municipality: z
    .object({
      municipalityCode: z.string(),
      municipalityName: z.string(),
      countyCode: z.string(),
      countyName: z.string(),
    })
    .nullable(),
  /**
   * Every section below is null when its provider was not asked, does not cover
   * the point, or failed. `components` says which, per operation.
   */
  forecast: z.array(forecastEntrySchema).nullable(),
  nowcast: nowcastSchema.nullable(),
  weatherWarnings: z.array(weatherWarningSchema).nullable(),
  hazards: z.array(hazardSchema).nullable(),
  hazardMatchEvidence: z.array(z.string()),
  sun: sunTimesSchema.nullable(),
  ocean: oceanSchema.nullable(),
  tides: tideTableSchema.nullable(),
  airQuality: airQualitySchema.nullable(),
  observations: z
    .object({
      station: climateStationSchema,
      latest: z.array(observationRecordSchema),
      monthlyTemperatureNormal: climateNormalSchema.nullable(),
    })
    .nullable(),
  /** The SDK's synthetic identity for the composition. Carries no licence. */
  compositeSource: compositeSourceSchema,
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

/** One hour of the MET forecast, as the SDK types it. */
type ForecastEntry = WeatherForecast["timeseries"][number];

function projectForecastEntry(entry: ForecastEntry): z.infer<typeof forecastEntrySchema> {
  return {
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
  };
}

function projectOcean(
  ocean: OceanForecast,
  tracker: TruncationTracker,
): z.infer<typeof oceanSchema> {
  return {
    ...(ocean.updatedAt !== undefined ? { updatedAt: ocean.updatedAt } : {}),
    coordinates: projectMetPoint(ocean.coordinates),
    entries: tracker.limitArray("ocean.entries", ocean.entries, MAX_HOURS).map((entry) => ({
      time: entry.time,
      ...(entry.seaTemperature !== undefined ? { seaTemperature: entry.seaTemperature } : {}),
      ...(entry.waveHeight !== undefined ? { waveHeight: entry.waveHeight } : {}),
      ...(entry.waveFromDirection !== undefined
        ? { waveFromDirection: entry.waveFromDirection }
        : {}),
      ...(entry.currentSpeed !== undefined ? { currentSpeed: entry.currentSpeed } : {}),
      ...(entry.currentToDirection !== undefined
        ? { currentToDirection: entry.currentToDirection }
        : {}),
    })),
  };
}

function projectPollutant(value: {
  concentration?: number;
  index?: number;
}): z.infer<typeof pollutantSchema> {
  return {
    ...(value.concentration !== undefined ? { concentration: value.concentration } : {}),
    ...(value.index !== undefined ? { index: value.index } : {}),
  };
}

function projectAirQuality(
  air: AirQualityForecast,
  tracker: TruncationTracker,
): z.infer<typeof airQualitySchema> {
  const area = (value: AirQualityForecast["area"]) => ({
    name: value.name,
    areaClass: value.areaClass,
    areaCode: value.areaCode,
  });
  return {
    referenceTime: air.referenceTime,
    area: area(air.area),
    ...(air.parentArea !== undefined ? { parentArea: area(air.parentArea) } : {}),
    entries: tracker.limitArray("airQuality.entries", air.entries, MAX_HOURS).map((entry) => ({
      from: entry.from,
      to: entry.to,
      ...(entry.index !== undefined ? { index: entry.index } : {}),
      ...(entry.no2 !== undefined ? { no2: projectPollutant(entry.no2) } : {}),
      ...(entry.pm10 !== undefined ? { pm10: projectPollutant(entry.pm10) } : {}),
      ...(entry.pm25 !== undefined ? { pm25: projectPollutant(entry.pm25) } : {}),
      ...(entry.o3 !== undefined ? { o3: projectPollutant(entry.o3) } : {}),
    })),
  };
}

/**
 * Sections that were wanted but not delivered, each with its reason.
 *
 * `not-configured` and `provider-error` make a result partial. `not-covered`,
 * `not-found` and `not-applicable` do not: a tide table inland or a nowcast on
 * Svalbard does not exist, which is an answer rather than a gap. Those are
 * explained in the warnings and in `components`.
 */
function missingWithReasons(components: readonly ProjectedComponent[]): string[] {
  return [
    ...new Set(
      components
        .filter(
          (component) =>
            component.status === "omitted" &&
            (component.reason === "not-configured" || component.reason === "provider-error"),
        )
        .map((component) => `${component.section}: ${component.reason ?? "omitted"}`),
    ),
  ];
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  // One SDK call. The fourteen operations, their prerequisites, their
  // independent failure handling and their provenance are the SDK's job.
  const response = await context
    .getSdk()
    .profiles.conditionsAtLocation(
      { latitude: input.latitude, longitude: input.longitude, hours: input.hours },
      { signal },
    );
  const profile = response.data;

  // When every provider fails the SDK itself rejects with a ProviderError, which
  // maps to `provider_error`; anything that resolves has at least one answer.
  const components = tracker.limitArray(
    "components",
    projectComponents(profile.components),
    MAX_COMPONENTS,
  );

  const weatherWarnings =
    profile.weatherWarnings === undefined
      ? null
      : tracker
          .limitArray("weatherWarnings", profile.weatherWarnings, MAX_WARNINGS)
          .map((warning, index) =>
            projectWeatherWarning(warning, tracker, `weatherWarnings[${index}]`),
          );

  const hazards =
    profile.hazards === undefined
      ? null
      : tracker
          .limitArray("hazards", profile.hazards, MAX_HAZARDS)
          .map((warning, index) => projectHazard(warning, tracker, index, "hazards"));

  const sun = profile.sun === undefined ? null : projectSunTimes(profile.sun);
  const tides =
    profile.tides === undefined ? null : projectTideTable(profile.tides, tracker, "tides");
  const airQuality =
    profile.airQuality === undefined ? null : projectAirQuality(profile.airQuality, tracker);
  const observations =
    profile.observations === undefined
      ? null
      : {
          station: projectClimateStation(profile.observations.station),
          latest: tracker
            .limitArray(
              "observations.latest",
              profile.observations.latest ?? [],
              MAX_LATEST_RECORDS,
            )
            .map((record, index) =>
              projectObservationRecord(record, tracker, `observations.latest[${index}]`),
            ),
          monthlyTemperatureNormal:
            profile.observations.monthlyTemperatureNormal === undefined
              ? null
              : projectClimateNormal(profile.observations.monthlyTemperatureNormal),
        };

  const notes = [PROFILE_EXPERIMENTAL_NOTE, HAZARD_DISCLAIMER];
  if (weatherWarnings !== null) {
    notes.push(MET_WARNING_DISCLAIMER, ...weatherWarningNotes(weatherWarnings));
    if (weatherWarnings.length > 0) notes.push(WARNING_AREA_NOTE);
  }
  if (sun !== null) notes.push(...sunTimesNotes(sun));
  if (profile.ocean !== undefined) notes.push(OCEAN_NOTE);
  if (tides !== null)
    notes.push(TIDE_TIME_NOTE, referenceLevelNote("chart-datum"), TIDE_MODEL_NOTE);
  if (airQuality !== null) notes.push(AIR_QUALITY_NOTE);
  // The SDK's own notices — provider failures, radar status, a distant station
  // — kept verbatim. They are SDK notices, not weather warnings.
  notes.push(...tracker.limitArray("sdkNotices", profile.warnings, MAX_NOTICES));
  notes.push(...componentWarnings(components));

  const missing = missingWithReasons(components);

  const data: Data = {
    location: { latitude: profile.location.latitude, longitude: profile.location.longitude },
    municipality:
      profile.municipality === undefined
        ? null
        : {
            municipalityCode: profile.municipality.municipalityCode,
            municipalityName: profile.municipality.municipalityName,
            countyCode: profile.municipality.countyCode,
            countyName: profile.municipality.countyName,
          },
    forecast:
      profile.forecast === undefined
        ? null
        : tracker.limitArray("forecast", profile.forecast, MAX_HOURS).map(projectForecastEntry),
    nowcast:
      profile.nowcast === undefined
        ? null
        : projectNowcast(profile.nowcast, tracker, "nowcast.entries"),
    weatherWarnings,
    hazards,
    hazardMatchEvidence: describeHazardMatches(profile.hazardMatches),
    sun,
    ocean: profile.ocean === undefined ? null : projectOcean(profile.ocean, tracker),
    tides,
    airQuality,
    observations,
    compositeSource: projectCompositeSource(response.source),
    components,
  };

  notes.push(...tracker.warnings());

  return buildEnvelope<Data>({
    data,
    // Never `[response]`: the top-level source is the SDK's synthetic composite
    // with no licence. The components and the SDK's `sources` array carry the
    // real providers, including separate `met` and `met-frost` entries.
    responses: componentProvenance(response),
    warnings: notes,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason:
              "Some sections were omitted because their provider is not configured or failed. " +
              "Each entry names the section and the reason; components has the detail.",
          }
        : null,
  });
}

function absent(label: string): string {
  return `${label}: not available — see the notes and components for why.`;
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [
    [
      `Conditions at ${data.location.latitude}, ${data.location.longitude}`,
      ...fields([
        ["Municipality", data.municipality?.municipalityName],
        ["County", data.municipality?.countyName],
      ]),
    ].join("\n"),
  ];

  if (data.forecast === null) {
    sections.push(absent("Forecast"));
  } else {
    const next = data.forecast[0];
    sections.push(
      `Forecast (${data.forecast.length} hours)${
        next === undefined
          ? ": no entries."
          : `: now ${next.temperature ?? "?"}°C, wind ${next.windSpeed ?? "?"} m/s${
              next.symbolCode !== undefined ? `, ${next.symbolCode}` : ""
            }.`
      }`,
    );
  }

  if (data.nowcast === null) {
    sections.push(absent("Nowcast"));
  } else {
    const wet = data.nowcast.entries.filter((entry) => (entry.precipitationRate ?? 0) > 0).length;
    sections.push(
      `Nowcast: ${wet} of ${data.nowcast.entries.length} five-minute steps with precipitation.`,
    );
  }

  sections.push(
    data.weatherWarnings === null
      ? absent("MET Norway weather warnings")
      : data.weatherWarnings.length === 0
        ? "MET Norway weather warnings: none for this point (not an all-clear)."
        : `MET Norway weather warnings (${data.weatherWarnings.length}):\n${data.weatherWarnings
            .map(renderWeatherWarning)
            .join("\n")}`,
  );

  sections.push(
    data.hazards === null
      ? absent("NVE hazard warnings")
      : `NVE hazard warnings:\n${renderHazardLines(data.hazards)}`,
  );

  sections.push(
    data.sun === null
      ? absent("Sun")
      : `Sun (${data.sun.date}): ${renderSunTimes(data.sun).join("; ")}`,
  );

  if (data.ocean !== null) {
    const first = data.ocean.entries[0];
    sections.push(
      `Ocean: ${
        first === undefined
          ? "no entries."
          : `sea ${first.seaTemperature ?? "?"}°C, waves ${first.waveHeight ?? "?"} m at ${first.time}.`
      }`,
    );
  }

  sections.push(
    data.tides === null
      ? absent("Tides")
      : `Tides (UTC, ${data.tides.unit} above chart datum, from ${describeTideLocation(
          data.tides.location,
        )}):\n${renderTideEvents(data.tides)}`,
  );

  if (data.airQuality !== null) {
    sections.push(
      `Air quality (experimental model forecast) for ${data.airQuality.area.name}: ${data.airQuality.entries.length} hourly entries.`,
    );
  }

  if (data.observations === null) {
    sections.push(absent("Observations"));
  } else {
    const { station, latest } = data.observations;
    const lines = [
      `Observations at ${station.name} (${station.id})${
        station.distanceKm !== undefined ? `, ${station.distanceKm} km away` : ""
      }:`,
      ...latest.map(
        (record) =>
          `- ${record.referenceTime}: ${record.observations.map(renderObservation).join("; ")}`,
      ),
    ];
    const normal = data.observations.monthlyTemperatureNormal;
    if (normal !== null && normal.normal !== null) {
      lines.push(`- ${normal.period} normal for this month: ${normal.normal}`);
    }
    sections.push(lines.join("\n"));
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const weatherConditionsProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_weather_conditions_profile",
  title: "Get weather and sea conditions for a coordinate",
  description:
    "Answer one coordinate's weather, sea and daylight conditions from several agencies at once: " +
    "the containing municipality, MET Norway's forecast, nowcast, weather warnings, sun times, " +
    "ocean forecast and air quality, NVE flood, avalanche and landslide warnings for the " +
    "municipality, Kartverket's tide table, and the latest observations at the nearest Frost " +
    "weather station. Experimental. Every section states its own source, or why it is absent. " +
    "Use this when the user asks broadly what conditions are like at a place right now or over " +
    "the next hours. " +
    "Do not use this for a street address — get_norwegian_location_profile resolves the address " +
    "and adds roads — for one product in full detail such as an hourly forecast " +
    "(get_norwegian_weather_forecast), or for a past period (get_norwegian_weather_history). " +
    "Needs no credentials: NORWAY_MCP_CONTACT_EMAIL adds the MET Norway sections and " +
    "NORWAY_MCP_MET_FROST_CLIENT_ID adds the observations.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
