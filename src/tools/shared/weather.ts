/**
 * Shared projections for the MET Norway, Kartverket tide and Frost tools.
 *
 * The conditions profile presents the same SDK objects the single-purpose
 * tools do — MET warnings, the nowcast, sun times, the tide table and Frost
 * observations — so each projection lives here once, together with the caveat
 * it must carry. Every projection whitelists the fields it copies: nothing
 * reaches a tool result because the SDK happened to include it.
 */

import { z } from "zod";
import type {
  ClimateNormal,
  ClimateObservationRecord,
  ClimateStation,
  GeoJsonGeometry,
  MetPoint,
  Nowcast,
  SunTimes,
  TideLocation,
  TideReferenceLevel,
  TideTable,
  WeatherWarning,
} from "norway-open-data-sdk";

import { ENV_VARS, type ServerConfig } from "../../config/types.js";
import type { TruncationTracker } from "../../limits/budget.js";
import { MAX_GEOMETRY_VERTICES_PER_FEATURE, type GeometryBudget } from "./geo.js";

// ---------------------------------------------------------------------------
// Configuration gates
// ---------------------------------------------------------------------------

/**
 * MET Norway requires every caller to identify itself with a real contact
 * address, and no default is safe: an invented one would be sent upstream as
 * the caller's identity.
 */
export function requiresContactEmail(config: ServerConfig): string[] {
  return config.contactEmail === undefined ? [ENV_VARS.contactEmail] : [];
}

/** Frost answers only callers presenting a client ID; it is free but personal. */
export function requiresFrostClientId(config: ServerConfig): string[] {
  return config.metFrostClientId === undefined ? [ENV_VARS.metFrostClientId] : [];
}

// ---------------------------------------------------------------------------
// Standing notes
// ---------------------------------------------------------------------------

/** Attached to every result that carries MET Norway weather warnings. */
export const MET_WARNING_DISCLAIMER =
  "MET Norway weather warnings are never an all-clear: an empty list means only that MetAlerts " +
  "published no current warning matching the query. They cover weather — wind, gale, rain, snow, " +
  "ice, icing, storm surge, forest-fire danger, lightning and polar lows. Flood, landslide and " +
  "avalanche warnings are issued by NVE: use get_current_norwegian_hazards (varsom.no). Check " +
  "yr.no, varsom.no and local authorities before any safety decision.";

/**
 * MetAlerts' `rainFlood` and `stormSurge` sound like NVE products and are not:
 * they are MET Norway's weather warnings about the rain and the water level.
 */
export const MET_FLOOD_OVERLAP_NOTE =
  "rainFlood and stormSurge are MET Norway weather warnings about heavy rain and high water, not " +
  "NVE flood or landslide warnings. Check get_current_norwegian_hazards for NVE's official flood " +
  "and landslide warnings as well.";

export function cancelledWarningsNote(count: number): string {
  return (
    `${count} of these messages ${count === 1 ? "has" : "have"} messageType "Cancel": ` +
    `${count === 1 ? "it withdraws" : "they withdraw"} an earlier warning and ` +
    `${count === 1 ? "is not an active warning" : "are not active warnings"}.`
  );
}

export const NOWCAST_SCOPE_NOTE =
  "The nowcast is MET Norway's radar-based precipitation for roughly the next two hours in " +
  "five-minute steps, with current conditions. It is not a forecast for later in the day.";

export const NOWCAST_NOT_COVERED_NOTE =
  "MET Norway publishes no nowcast for this point: it lies outside the Nordic weather-radar area, " +
  "which excludes Svalbard. This is not an error. get_norwegian_weather_forecast covers the point " +
  "hour by hour.";

export function radarCoverageNote(coverage: string): string {
  return (
    `MET Norway reports radar coverage "${coverage}" for this point. Precipitation values are ` +
    'unreliable unless it is "ok".'
  );
}

export const SUN_TIME_OFFSET_NOTE =
  "Sun times carry the Europe/Oslo UTC offset in force on that date (+01:00 in winter, +02:00 in " +
  "summer).";

const POLAR_CONDITION_NOTES = {
  "midnight-sun":
    "Midnight sun: the sun stays above the horizon all day, so this date has no sunrise and no " +
    "sunset. That is the answer, not missing data.",
  "polar-night":
    "Polar night: the sun stays below the horizon all day, so this date has no sunrise and no " +
    "sunset. That is the answer, not missing data.",
} as const;

export const TIDE_TIME_NOTE =
  "All tide and water-level times are UTC, as Kartverket requests and returns them.";

export const TIDE_MODEL_NOTE =
  "Away from a permanent tide gauge the values are modelled, not measured: Kartverket scales a " +
  "reference station's prediction by its factor and shifts it by its delay. The station, factor " +
  "and delay used are in location.";

export const TIDE_NOT_COVERED_NOTE =
  "Kartverket publishes no sea-level data for this position: it is inland or too far offshore. " +
  "This is not an error.";

const REFERENCE_LEVEL_NOTES: Record<TideReferenceLevel, string> = {
  "chart-datum":
    "Heights are above chart datum, the level used for depths in nautical charts and for tide " +
    "tables — not above mean sea level.",
  "mean-sea-level": "Heights are relative to mean sea level, the 1996–2014 mean.",
  nn2000: "Heights are relative to NN2000, Norway's land-height datum.",
};

export function referenceLevelNote(level: TideReferenceLevel): string {
  return REFERENCE_LEVEL_NOTES[level];
}

export const FROST_EXPERIMENTAL_NOTE =
  "Experimental: norway-open-data-sdk 0.9.0 marks its Frost integration experimental. Its schemas " +
  "follow Frost's published models and had not been verified against the live service when the " +
  "SDK was released.";

export const OBSERVATION_GAP_NOTE =
  "Observations are exactly as Frost published them. A missing hour or day is a gap in the " +
  "station's record, never a zero, and is not filled or interpolated.";

/** The SDK's own threshold for calling a station too distant to represent a point. */
export const REMOTE_STATION_KM = 25;

export function remoteStationNote(station: {
  name: string;
  distanceKm?: number | undefined;
}): string[] {
  if (station.distanceKm === undefined || station.distanceKm <= REMOTE_STATION_KM) return [];
  return [
    `The station, ${station.name}, is ${station.distanceKm} km from the point; its observations ` +
      "may not represent conditions there.",
  ];
}

// ---------------------------------------------------------------------------
// MET Norway points
// ---------------------------------------------------------------------------

export const metPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().optional(),
});

export function projectMetPoint(point: MetPoint): z.infer<typeof metPointSchema> {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    ...(point.altitude !== undefined ? { altitude: point.altitude } : {}),
  };
}

// ---------------------------------------------------------------------------
// MetAlerts warnings
// ---------------------------------------------------------------------------

/** Counties a warning names. Norway has fifteen; this is a backstop. */
const MAX_WARNING_COUNTIES = 20;
/** Municipalities a warning names. A county-wide warning can list dozens. */
const MAX_WARNING_MUNICIPALITIES = 100;

export const weatherWarningSchema = z.object({
  id: z.string(),
  event: z.string(),
  eventName: z.string().optional(),
  title: z.string(),
  area: z.string(),
  description: z.string(),
  instruction: z.string().optional(),
  consequences: z.string().optional(),
  awarenessLevel: z.object({
    level: z.number(),
    color: z.string(),
    severity: z.string(),
  }),
  riskMatrixColor: z.string().optional(),
  severity: z.string(),
  certainty: z.string(),
  messageType: z.string().describe("Alert, Update or Cancel. A Cancel is not an active warning."),
  status: z.string(),
  response: z.string().optional(),
  seriousness: z.string().optional(),
  triggerLevel: z.string().optional(),
  geographicDomain: z.string().optional(),
  countyCodes: z.array(z.string()),
  municipalityCodes: z.array(z.string()),
  incidentName: z.string().optional(),
  onset: z.string().optional(),
  expires: z.string().optional(),
  eventEndingTime: z.string().optional(),
  web: z.string().optional(),
});

export type ProjectedWeatherWarning = z.infer<typeof weatherWarningSchema>;

/**
 * Projects one warning without its geometry.
 *
 * `field` names the warning in truncation reports, e.g. `warnings[3]`.
 */
export function projectWeatherWarning(
  warning: WeatherWarning,
  tracker: TruncationTracker,
  field: string,
): ProjectedWeatherWarning {
  return {
    id: warning.id,
    event: warning.event,
    ...(warning.eventName !== undefined ? { eventName: warning.eventName } : {}),
    title: warning.title,
    area: warning.area,
    description: tracker.clampString(`${field}.description`, warning.description),
    ...(warning.instruction !== undefined
      ? { instruction: tracker.clampString(`${field}.instruction`, warning.instruction) }
      : {}),
    ...(warning.consequences !== undefined
      ? { consequences: tracker.clampString(`${field}.consequences`, warning.consequences) }
      : {}),
    awarenessLevel: {
      level: warning.awarenessLevel.level,
      color: warning.awarenessLevel.color,
      severity: warning.awarenessLevel.severity,
    },
    ...(warning.riskMatrixColor !== undefined ? { riskMatrixColor: warning.riskMatrixColor } : {}),
    severity: warning.severity,
    certainty: warning.certainty,
    messageType: warning.messageType,
    status: warning.status,
    ...(warning.response !== undefined ? { response: warning.response } : {}),
    ...(warning.seriousness !== undefined ? { seriousness: warning.seriousness } : {}),
    ...(warning.triggerLevel !== undefined ? { triggerLevel: warning.triggerLevel } : {}),
    ...(warning.geographicDomain !== undefined
      ? { geographicDomain: warning.geographicDomain }
      : {}),
    countyCodes: tracker.limitArray(
      `${field}.countyCodes`,
      warning.countyCodes,
      MAX_WARNING_COUNTIES,
    ),
    municipalityCodes: tracker.limitArray(
      `${field}.municipalityCodes`,
      warning.municipalityCodes,
      MAX_WARNING_MUNICIPALITIES,
    ),
    ...(warning.incidentName !== undefined ? { incidentName: warning.incidentName } : {}),
    ...(warning.onset !== undefined ? { onset: warning.onset } : {}),
    ...(warning.expires !== undefined ? { expires: warning.expires } : {}),
    ...(warning.eventEndingTime !== undefined ? { eventEndingTime: warning.eventEndingTime } : {}),
    ...(warning.web !== undefined ? { web: warning.web } : {}),
  };
}

/** Notes every warning-bearing result needs, beyond the standing disclaimer. */
export function weatherWarningNotes(
  warnings: readonly { event: string; messageType: string }[],
): string[] {
  const notes: string[] = [];
  const cancelled = warnings.filter((warning) => warning.messageType === "Cancel").length;
  if (cancelled > 0) notes.push(cancelledWarningsNote(cancelled));
  if (warnings.some((warning) => warning.event === "rainFlood" || warning.event === "stormSurge")) {
    notes.push(MET_FLOOD_OVERLAP_NOTE);
  }
  return notes;
}

export function renderWeatherWarning(warning: ProjectedWeatherWarning): string {
  const status = warning.messageType === "Cancel" ? "CANCELLED — not active" : warning.messageType;
  const lines = [
    `- ${warning.title} [${warning.awarenessLevel.color}, level ${warning.awarenessLevel.level}] (${status})`,
    `  ${warning.eventName ?? warning.event}${
      warning.geographicDomain !== undefined ? `, ${warning.geographicDomain}` : ""
    } — ${warning.area}`,
  ];
  if (warning.onset !== undefined || warning.expires !== undefined) {
    lines.push(
      `  Valid ${warning.onset ?? "(start not stated)"} to ${warning.expires ?? "(end not stated)"}`,
    );
  }
  if (warning.incidentName !== undefined) lines.push(`  Named event: ${warning.incidentName}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Warning geometry: any GeoJSON type, whole or not at all
// ---------------------------------------------------------------------------

const positionSchema = z.tuple([z.number(), z.number()]);

/**
 * MetAlerts may publish any GeoJSON geometry, so this is wider than the
 * polygon-only schema of the Naturbase and NIBIO tools. The rule is the same:
 * the provider's geometry, exactly, or none.
 */
export const warningGeometrySchema = z
  .union([
    z.object({ type: z.literal("Point"), coordinates: positionSchema }),
    z.object({ type: z.literal("MultiPoint"), coordinates: z.array(positionSchema) }),
    z.object({ type: z.literal("LineString"), coordinates: z.array(positionSchema) }),
    z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema)) }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(z.array(positionSchema))),
    }),
  ])
  .nullable()
  .describe(
    "The warning area as GeoJSON in WGS84, exactly as MET Norway published it, or null when it was " +
      "not requested, not published or omitted for size. Check geometrySummary.",
  );

export const warningGeometrySummarySchema = z
  .object({
    type: z.enum(["Point", "MultiPoint", "LineString", "Polygon", "MultiPolygon", "none"]),
    /** Polygons of a multipolygon, points of a multipoint; 1 otherwise, 0 with no geometry. */
    partCount: z.number(),
    /** Interior rings across every polygon. */
    holeCount: z.number(),
    vertexCount: z.number(),
    included: z.boolean(),
    omittedReason: z
      .enum(["not-requested", "not-published", "too-large", "result-budget"])
      .optional(),
  })
  .describe("Shape of the published warning area, reported whether or not it was returned.");

type WarningGeometry = z.infer<typeof warningGeometrySchema>;
type WarningGeometrySummary = z.infer<typeof warningGeometrySummarySchema>;

function measure(geometry: GeoJsonGeometry): {
  partCount: number;
  holeCount: number;
  vertexCount: number;
} {
  switch (geometry.type) {
    case "Point":
      return { partCount: 1, holeCount: 0, vertexCount: 1 };
    case "MultiPoint":
      return {
        partCount: geometry.coordinates.length,
        holeCount: 0,
        vertexCount: geometry.coordinates.length,
      };
    case "LineString":
      return { partCount: 1, holeCount: 0, vertexCount: geometry.coordinates.length };
    case "Polygon":
      return {
        partCount: 1,
        holeCount: Math.max(0, geometry.coordinates.length - 1),
        vertexCount: geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0),
      };
    case "MultiPolygon":
      return {
        partCount: geometry.coordinates.length,
        holeCount: geometry.coordinates.reduce(
          (sum, part) => sum + Math.max(0, part.length - 1),
          0,
        ),
        vertexCount: geometry.coordinates.reduce(
          (sum, part) => sum + part.reduce((inner, ring) => inner + ring.length, 0),
          0,
        ),
      };
  }
}

const copyPosition = (position: readonly [number, number]): [number, number] => [
  position[0],
  position[1],
];

/** Copies structurally, so the result cannot alias the SDK's cached response. */
function copyGeometry(geometry: GeoJsonGeometry): NonNullable<WarningGeometry> {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: copyPosition(geometry.coordinates) };
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: geometry.coordinates.map(copyPosition) };
    case "LineString":
      return { type: "LineString", coordinates: geometry.coordinates.map(copyPosition) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map(copyPosition)),
      };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((part) => part.map((ring) => ring.map(copyPosition))),
      };
  }
}

/**
 * Decides whether one warning's area travels, and records the decision.
 *
 * Mirrors `projectGeometry` in geo.ts: returned untouched or not at all, never
 * simplified, with oversized and over-budget areas reported in `truncation`.
 */
export function projectWarningGeometry(
  geometry: GeoJsonGeometry | null,
  options: { include: boolean; budget: GeometryBudget; tracker: TruncationTracker; field: string },
): { geometry: WarningGeometry; geometrySummary: WarningGeometrySummary } {
  if (geometry === null) {
    return {
      geometry: null,
      geometrySummary: {
        type: "none",
        partCount: 0,
        holeCount: 0,
        vertexCount: 0,
        included: false,
        omittedReason: "not-published",
      },
    };
  }

  const base = { type: geometry.type, ...measure(geometry) };
  if (!options.include) {
    return {
      geometry: null,
      geometrySummary: { ...base, included: false, omittedReason: "not-requested" },
    };
  }

  const verdict = options.budget.admit(base.vertexCount);
  if (verdict !== "ok") {
    options.tracker.record({
      field: options.field,
      returned: 0,
      availableUpstream: base.vertexCount,
      reason: verdict === "too-large" ? "limit" : "budget",
    });
    return {
      geometry: null,
      geometrySummary: { ...base, included: false, omittedReason: verdict },
    };
  }

  return { geometry: copyGeometry(geometry), geometrySummary: { ...base, included: true } };
}

/** Prose for warning areas this server chose not to return. */
export function warningGeometryNotes(summaries: readonly WarningGeometrySummary[]): string[] {
  const notes: string[] = [];
  const tooLarge = summaries.filter((summary) => summary.omittedReason === "too-large").length;
  if (tooLarge > 0) {
    notes.push(
      `${tooLarge} warning area${tooLarge === 1 ? " was" : "s were"} omitted for exceeding ` +
        `${MAX_GEOMETRY_VERTICES_PER_FEATURE} vertices. An area is dropped whole rather than ` +
        "simplified; geometrySummary still reports its parts, holes and vertex count.",
    );
  }
  const budgeted = summaries.filter((summary) => summary.omittedReason === "result-budget").length;
  if (budgeted > 0) {
    notes.push(
      `${budgeted} warning area${budgeted === 1 ? " was" : "s were"} omitted after this result ` +
        "spent its geometry budget. Narrow the query by countyCode, event or geographicDomain to " +
        "get the areas you need.",
    );
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Nowcast
// ---------------------------------------------------------------------------

/** MET publishes about 25 five-minute steps; this is a backstop. */
export const MAX_NOWCAST_ENTRIES = 30;

export const nowcastSchema = z.object({
  updatedAt: z.string().optional(),
  coordinates: metPointSchema,
  radarCoverage: z.string().optional(),
  entries: z.array(
    z.object({
      time: z.string(),
      /** mm/h, from weather radar. */
      precipitationRate: z.number().optional(),
      temperature: z.number().optional(),
      apparentTemperature: z.number().optional(),
      humidity: z.number().optional(),
      windSpeed: z.number().optional(),
      windGust: z.number().optional(),
      windDirection: z.number().optional(),
      uvIndexClearSky: z.number().optional(),
      symbolCode: z.string().optional(),
      /** mm over the coming hour. */
      precipitationNextHour: z.number().optional(),
    }),
  ),
});

export type ProjectedNowcast = z.infer<typeof nowcastSchema>;

export function projectNowcast(
  nowcast: Nowcast,
  tracker: TruncationTracker,
  field: string,
): ProjectedNowcast {
  return {
    ...(nowcast.updatedAt !== undefined ? { updatedAt: nowcast.updatedAt } : {}),
    coordinates: projectMetPoint(nowcast.coordinates),
    ...(nowcast.radarCoverage !== undefined ? { radarCoverage: nowcast.radarCoverage } : {}),
    entries: tracker.limitArray(field, nowcast.entries, MAX_NOWCAST_ENTRIES).map((entry) => ({
      time: entry.time,
      ...(entry.precipitationRate !== undefined
        ? { precipitationRate: entry.precipitationRate }
        : {}),
      ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
      ...(entry.apparentTemperature !== undefined
        ? { apparentTemperature: entry.apparentTemperature }
        : {}),
      ...(entry.humidity !== undefined ? { humidity: entry.humidity } : {}),
      ...(entry.windSpeed !== undefined ? { windSpeed: entry.windSpeed } : {}),
      ...(entry.windGust !== undefined ? { windGust: entry.windGust } : {}),
      ...(entry.windDirection !== undefined ? { windDirection: entry.windDirection } : {}),
      ...(entry.uvIndexClearSky !== undefined ? { uvIndexClearSky: entry.uvIndexClearSky } : {}),
      ...(entry.symbolCode !== undefined ? { symbolCode: entry.symbolCode } : {}),
      ...(entry.precipitationNextHour !== undefined
        ? { precipitationNextHour: entry.precipitationNextHour }
        : {}),
    })),
  };
}

/** The radar-status note, when the status is anything but `ok`. */
export function nowcastNotes(nowcast: ProjectedNowcast): string[] {
  return nowcast.radarCoverage !== undefined && nowcast.radarCoverage !== "ok"
    ? [radarCoverageNote(nowcast.radarCoverage)]
    : [];
}

// ---------------------------------------------------------------------------
// Sun times
// ---------------------------------------------------------------------------

const celestialEventSchema = z.object({
  time: z.string(),
  /** Compass direction of the event, degrees. */
  azimuth: z.number().optional(),
});

const celestialPositionSchema = z.object({
  time: z.string(),
  /** Elevation of the sun's centre above the horizon, degrees. */
  elevation: z.number().optional(),
  visible: z.boolean().optional(),
});

export const sunTimesSchema = z.object({
  date: z.string(),
  coordinates: metPointSchema,
  sunrise: celestialEventSchema.nullable(),
  sunset: celestialEventSchema.nullable(),
  solarNoon: celestialPositionSchema.nullable(),
  solarMidnight: celestialPositionSchema.nullable(),
  polarCondition: z
    .enum(["midnight-sun", "polar-night"])
    .nullable()
    .describe(
      "Why there is no sunrise or sunset, when there is none. An answer, not missing data.",
    ),
});

export type ProjectedSunTimes = z.infer<typeof sunTimesSchema>;

export function projectSunTimes(sun: SunTimes): ProjectedSunTimes {
  const event = (value: SunTimes["sunrise"]) =>
    value === undefined
      ? null
      : { time: value.time, ...(value.azimuth !== undefined ? { azimuth: value.azimuth } : {}) };
  const position = (value: SunTimes["solarNoon"]) =>
    value === undefined
      ? null
      : {
          time: value.time,
          ...(value.elevation !== undefined ? { elevation: value.elevation } : {}),
          ...(value.visible !== undefined ? { visible: value.visible } : {}),
        };

  return {
    date: sun.date,
    coordinates: projectMetPoint(sun.coordinates),
    sunrise: event(sun.sunrise),
    sunset: event(sun.sunset),
    solarNoon: position(sun.solarNoon),
    solarMidnight: position(sun.solarMidnight),
    polarCondition: sun.polarCondition ?? null,
  };
}

/** Explains a day without a sunrise or sunset, so the gap is never left unexplained. */
export function sunTimesNotes(sun: ProjectedSunTimes): string[] {
  if (sun.polarCondition !== null) return [POLAR_CONDITION_NOTES[sun.polarCondition]];
  if (sun.sunrise === null || sun.sunset === null) {
    return [
      `MET Norway published no ${
        sun.sunrise === null && sun.sunset === null
          ? "sunrise or sunset"
          : sun.sunrise === null
            ? "sunrise"
            : "sunset"
      } for this date and did not report a polar day or night. Near the start or end of a ` +
        "polar period the sun can rise without setting on the same date, or the reverse.",
    ];
  }
  return [];
}

export function renderSunTimes(sun: ProjectedSunTimes): string[] {
  if (sun.polarCondition === "midnight-sun") {
    return ["Midnight sun — the sun does not set on this date."];
  }
  if (sun.polarCondition === "polar-night") {
    return ["Polar night — the sun does not rise on this date."];
  }
  return [
    `Sunrise: ${sun.sunrise?.time ?? "none on this date"}`,
    `Sunset: ${sun.sunset?.time ?? "none on this date"}`,
  ];
}

// ---------------------------------------------------------------------------
// Tides
// ---------------------------------------------------------------------------

/** A week holds about 28 high and low waters; this is a backstop. */
export const MAX_TIDE_EVENTS = 60;
const MAX_SERVICE_MESSAGES = 10;

export const tideLocationSchema = z.object({
  /** Reference station the values were modelled from. */
  name: z.string(),
  code: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  /** Amplitude correction applied to the reference prediction. */
  factor: z.number().optional(),
  /** Time shift applied to the reference prediction, in minutes. */
  delayMinutes: z.number().optional(),
  /** Permanent gauge supplying the observed weather effect (surge). */
  surgeStationName: z.string().optional(),
  surgeStationCode: z.string().optional(),
  description: z.string().optional(),
});

export type ProjectedTideLocation = z.infer<typeof tideLocationSchema>;

export function projectTideLocation(
  location: TideLocation,
  tracker: TruncationTracker,
  field: string,
): ProjectedTideLocation {
  return {
    name: location.name,
    code: location.code,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(location.factor !== undefined ? { factor: location.factor } : {}),
    ...(location.delayMinutes !== undefined ? { delayMinutes: location.delayMinutes } : {}),
    ...(location.surgeStationName !== undefined
      ? { surgeStationName: location.surgeStationName }
      : {}),
    ...(location.surgeStationCode !== undefined
      ? { surgeStationCode: location.surgeStationCode }
      : {}),
    ...(location.description !== undefined
      ? { description: tracker.clampString(`${field}.description`, location.description) }
      : {}),
  };
}

export function projectServiceMessages(
  messages: readonly string[],
  tracker: TruncationTracker,
  field: string,
): string[] {
  return tracker
    .limitArray(field, messages, MAX_SERVICE_MESSAGES)
    .map((message, index) => tracker.clampString(`${field}[${index}]`, message));
}

export const tideTableSchema = z.object({
  location: tideLocationSchema,
  /** Kartverket's reference code, e.g. `CD` for chart datum. */
  referenceLevel: z.string(),
  unit: z.string(),
  serviceMessages: z.array(z.string()),
  events: z.array(z.object({ time: z.string(), value: z.number(), kind: z.enum(["high", "low"]) })),
});

export type ProjectedTideTable = z.infer<typeof tideTableSchema>;

export function projectTideTable(
  table: TideTable,
  tracker: TruncationTracker,
  field: string,
): ProjectedTideTable {
  return {
    location: projectTideLocation(table.location, tracker, `${field}.location`),
    referenceLevel: table.referenceLevel,
    unit: table.unit,
    serviceMessages: projectServiceMessages(
      table.serviceMessages,
      tracker,
      `${field}.serviceMessages`,
    ),
    events: tracker
      .limitArray(`${field}.events`, table.events, MAX_TIDE_EVENTS)
      .map((event) => ({ time: event.time, value: event.value, kind: event.kind })),
  };
}

/** "modelled from Bergen (BGO), factor 1.04, delay 12 min" */
export function describeTideLocation(location: ProjectedTideLocation): string {
  const parts = [`${location.name} (${location.code})`];
  if (location.factor !== undefined) parts.push(`factor ${location.factor}`);
  if (location.delayMinutes !== undefined) parts.push(`delay ${location.delayMinutes} min`);
  const surge =
    location.surgeStationName !== undefined || location.surgeStationCode !== undefined
      ? `; weather effect from ${location.surgeStationName ?? location.surgeStationCode ?? ""}${
          location.surgeStationName !== undefined && location.surgeStationCode !== undefined
            ? ` (${location.surgeStationCode})`
            : ""
        }`
      : "";
  return `${parts.join(", ")}${surge}`;
}

export function renderTideEvents(table: ProjectedTideTable): string {
  if (table.events.length === 0) return "No high or low water falls inside this window.";
  return table.events
    .map(
      (event) =>
        `- ${event.time} ${event.kind === "high" ? "high" : "low "} ${event.value} ${table.unit}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Frost
// ---------------------------------------------------------------------------

export const climateStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** From the requested point, when the station was found by proximity. */
  distanceKm: z.number().optional(),
  elevationMetres: z.number().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  /** Frost's own administrative metadata, which can predate later reforms. */
  municipality: z.string().optional(),
  county: z.string().optional(),
  validFrom: z.string().optional(),
  /** End of operation, for a station that has closed. */
  validTo: z.string().optional(),
});

export type ProjectedClimateStation = z.infer<typeof climateStationSchema>;

/**
 * Whitelists station fields. The SDK already withholds Frost's station-holder
 * names; copying only these fields means no later SDK field can bring them, or
 * anything else, back.
 */
export function projectClimateStation(station: ClimateStation): ProjectedClimateStation {
  return {
    id: station.id,
    name: station.name,
    ...(station.distanceKm !== undefined ? { distanceKm: station.distanceKm } : {}),
    ...(station.elevationMetres !== undefined ? { elevationMetres: station.elevationMetres } : {}),
    ...(station.coordinates !== undefined
      ? { latitude: station.coordinates.latitude, longitude: station.coordinates.longitude }
      : {}),
    ...(station.municipality !== undefined ? { municipality: station.municipality } : {}),
    ...(station.county !== undefined ? { county: station.county } : {}),
    ...(station.validFrom !== undefined ? { validFrom: station.validFrom } : {}),
    ...(station.validTo !== undefined ? { validTo: station.validTo } : {}),
  };
}

/** Values Frost reports per element and reference time; a backstop. */
const MAX_OBSERVATIONS_PER_RECORD = 20;

export const observationRecordSchema = z.object({
  referenceTime: z.string(),
  observations: z.array(
    z.object({
      /** This server's name for the element, when it offers one. */
      element: z.string().optional(),
      elementId: z.string(),
      /** A number, or a UTC timestamp for time-valued elements. */
      value: z.union([z.number(), z.string()]),
      unit: z.string().optional(),
      /** Offset from referenceTime, as Frost publishes it. */
      timeOffset: z.string().optional(),
      timeResolution: z.string().optional(),
      /** Frost's quality-control code, passed through. */
      qualityCode: z.number().optional(),
    }),
  ),
});

export type ProjectedObservationRecord = z.infer<typeof observationRecordSchema>;

export function projectObservationRecord(
  record: ClimateObservationRecord,
  tracker: TruncationTracker,
  field: string,
  labelOf: (elementId: string) => string | undefined = () => undefined,
): ProjectedObservationRecord {
  return {
    referenceTime: record.referenceTime,
    observations: tracker
      .limitArray(`${field}.observations`, record.observations, MAX_OBSERVATIONS_PER_RECORD)
      .map((observation) => {
        const element = labelOf(observation.elementId);
        return {
          ...(element !== undefined ? { element } : {}),
          elementId: observation.elementId,
          value: observation.value,
          ...(observation.unit !== undefined ? { unit: observation.unit } : {}),
          ...(observation.timeOffset !== undefined ? { timeOffset: observation.timeOffset } : {}),
          ...(observation.timeResolution !== undefined
            ? { timeResolution: observation.timeResolution }
            : {}),
          ...(observation.qualityCode !== undefined
            ? { qualityCode: observation.qualityCode }
            : {}),
        };
      }),
  };
}

export const climateNormalSchema = z.object({
  elementId: z.string(),
  /** Normal period, e.g. `1991/2020`. */
  period: z.string(),
  month: z.number().optional(),
  /** Null when Frost holds no value for this element and month. */
  normal: z.number().nullable(),
});

export function projectClimateNormal(normal: ClimateNormal): z.infer<typeof climateNormalSchema> {
  return {
    elementId: normal.elementId,
    period: normal.period,
    ...(normal.month !== undefined ? { month: normal.month } : {}),
    normal: normal.normal ?? null,
  };
}

export function renderObservation(
  observation: ProjectedObservationRecord["observations"][number],
): string {
  return `${observation.element ?? observation.elementId} ${String(observation.value)}${
    observation.unit !== undefined ? ` ${observation.unit}` : ""
  }`;
}
