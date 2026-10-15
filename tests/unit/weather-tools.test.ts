/**
 * The three MET Norway point products added in 0.5.0: weather warnings, the
 * precipitation nowcast and sun times.
 *
 * Each tool is driven through the real MCP path against fakes shaped exactly
 * like `norway-open-data-sdk@0.9.0` output, covering the test-plan matrix.
 * Cancellation is covered for every tool by tests/unit/cancellation.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeoJsonGeometry, WeatherWarning } from "norway-open-data-sdk";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import { registrySource } from "../helpers/registry.js";
import { BUDGET } from "../../src/limits/budget.js";
import { allTools } from "../../src/tools/registry.js";
import {
  SOURCES,
  createFakeSdk,
  respond,
  sampleCancelledWarning,
  sampleMidnightSunTimes,
  sampleNowcast,
  samplePolarNightSunTimes,
  sampleStormSurgeWarning,
  sampleSunTimes,
  sampleWeatherWarning,
  sampleWeatherWarnings,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const POINT = { latitude: 60.39, longitude: 5.32 };

function dataSchemaOf(name: string) {
  const tool = allTools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`No tool ${name}`);
  return tool.dataSchema;
}

/** The provider failures every tool must map, with what must survive. */
const PROVIDER_FAILURES = [
  [
    "a provider outage",
    sdkError("ProviderError", "MET Norway returned HTTP 503.", {
      provider: "met",
      statusCode: 503,
    }),
    { code: "provider_error", retryable: true, provider: "met", statusCode: 503 },
  ],
  [
    "a rate limit",
    sdkError("RateLimitError", "Too many requests.", {
      provider: "met",
      statusCode: 429,
      retryAfter: 30,
    }),
    { code: "rate_limited", retryable: true, retryAfter: 30 },
  ],
  [
    "a timeout",
    sdkError("RequestTimeoutError", "MET Norway did not answer in time.", { provider: "met" }),
    { code: "timeout", retryable: true },
  ],
] as const;

// ---------------------------------------------------------------------------
// get_norwegian_weather_warnings
// ---------------------------------------------------------------------------

describe("get_norwegian_weather_warnings", () => {
  const TOOL = "get_norwegian_weather_warnings";
  const warningsOf = (warnings: WeatherWarning[], lastChange = true) => ({
    ...(lastChange ? { lastChange: "2026-07-23T09:41:12+00:00" } : {}),
    language: "no" as const,
    warnings,
  });
  const getWarnings = (collection = sampleWeatherWarnings) =>
    vi.fn(() => Promise.resolve(respond(collection, SOURCES["met"]!)));

  it("returns every warning for a point, in MetAlerts order, with message type and validity", async () => {
    const spy = getWarnings();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getWarnings: spy } }) });

    const envelope = await harness.callOk(TOOL, POINT);

    expect(spy).toHaveBeenCalledWith(
      { latitude: 60.39, longitude: 5.32, language: "no" },
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
    const warnings = envelope.data["warnings"] as {
      id: string;
      messageType: string;
      geographicDomain?: string;
      onset?: string;
      expires?: string;
      awarenessLevel: { level: number; color: string };
      geometry: unknown;
      geometrySummary: { type: string; included: boolean; omittedReason?: string };
    }[];
    expect(warnings.map((warning) => warning.id)).toEqual([
      sampleWeatherWarning.id,
      sampleStormSurgeWarning.id,
      sampleCancelledWarning.id,
    ]);
    expect(warnings[0]).toMatchObject({
      messageType: "Alert",
      geographicDomain: "land",
      onset: "2026-07-23T08:00:00+00:00",
      expires: "2026-07-23T20:00:00+00:00",
      awarenessLevel: { level: 2, color: "yellow", severity: "Moderate" },
    });
    expect(warnings[2]!.messageType).toBe("Cancel");
    // Geometry is off by default, but its shape is still reported.
    expect(warnings[0]!.geometry).toBeNull();
    expect(warnings[0]!.geometrySummary).toMatchObject({
      type: "Polygon",
      included: false,
      omittedReason: "not-requested",
    });
    expect(warnings[2]!.geometrySummary).toMatchObject({
      type: "none",
      omittedReason: "not-published",
    });
    expect(envelope.data).toMatchObject({
      query: { scope: "point", latitude: 60.39, longitude: 5.32 },
      lastChange: "2026-07-23T09:41:12+00:00",
      language: "no",
      totalWarnings: 3,
      cancelledCount: 1,
    });
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });

  it("never reads a cancellation as an active warning and points rainFlood to NVE", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings() } }),
    });

    const envelope = await harness.callOk(TOOL, POINT);
    const notes = envelope.warnings.join("\n");

    expect(notes).toContain('1 of these messages has messageType "Cancel"');
    expect(notes).toContain("not an active warning");
    expect(notes).toContain("rainFlood and stormSurge are MET Norway weather warnings");
    expect(notes).toContain("get_current_norwegian_hazards");
    expect(envelope.text).toContain("CANCELLED — not active");
  });

  it("asks for every current warning in Norway with no filter at all", async () => {
    const spy = getWarnings();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getWarnings: spy } }) });

    const envelope = await harness.callOk(TOOL, {});

    expect(spy).toHaveBeenCalledWith({ language: "no" }, expect.anything());
    expect(envelope.data["query"]).toEqual({ scope: "norway" });
    expect(envelope.text).toContain("MET Norway weather warnings for Norway");
  });

  it("forwards every filter at its limit and returns the areas whole when asked", async () => {
    const spy = getWarnings();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getWarnings: spy } }) });

    const envelope = await harness.callOk(TOOL, {
      countyCode: "46",
      event: "stormSurge",
      geographicDomain: "marine",
      language: "en",
      includeGeometry: true,
    });

    expect(spy).toHaveBeenCalledWith(
      { countyCode: "46", event: "stormSurge", geographicDomain: "marine", language: "en" },
      expect.anything(),
    );
    const warnings = envelope.data["warnings"] as {
      geometry: { type: string; coordinates: unknown[] } | null;
      geometrySummary: { included: boolean; holeCount: number; partCount: number };
    }[];
    // The polygon keeps its hole, ring for ring; the multipolygon keeps both parts.
    expect(warnings[0]!.geometry).toEqual({
      type: "Polygon",
      coordinates: (sampleWeatherWarning.geometry as { coordinates: unknown[] }).coordinates,
    });
    expect(warnings[0]!.geometrySummary).toMatchObject({ included: true, holeCount: 1 });
    expect(warnings[1]!.geometry?.coordinates).toHaveLength(2);
    expect(warnings[1]!.geometrySummary).toMatchObject({ included: true, partCount: 2 });
    expect(envelope.data["query"]).toEqual({
      scope: "county",
      countyCode: "46",
      event: "stormSurge",
      geographicDomain: "marine",
    });
    expect(envelope.warnings.join(" ")).toContain(
      "Geometry is returned exactly as the provider published it",
    );
    expect(envelope.text).toContain("county 46 (stormSurge, marine)");
  });

  it.each([
    ["latitude without longitude", { latitude: 60.39 }],
    ["longitude without latitude", { longitude: 5.32 }],
    ["a point and a county together", { ...POINT, countyCode: "46" }],
    ["a one-digit county", { countyCode: "4" }],
    ["an NVE hazard type", { event: "flood" }],
    ["an unknown domain", { geographicDomain: "sea" }],
    ["an unsupported language", { language: "de" }],
    ["NaN latitude", { latitude: Number.NaN, longitude: 5.32 }],
    ["latitude out of range", { latitude: 91, longitude: 5.32 }],
    ["a non-boolean geometry flag", { includeGeometry: "yes" }],
    ["an unknown property", { region: "Vestland" }],
  ])("rejects %s before contacting MET Norway", async (_label, args) => {
    const spy = getWarnings();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getWarnings: spy } }) });

    const result = await harness.call(TOOL, args);

    expect(result.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("says an empty list is not an all-clear and points to NVE's warnings", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings(warningsOf([], false)) } }),
    });

    const envelope = await harness.callOk(TOOL, { countyCode: "03" });

    expect(envelope.data["warnings"]).toEqual([]);
    expect(envelope.data["totalWarnings"]).toBe(0);
    expect(envelope.data["lastChange"]).toBeUndefined();
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("MET Norway returned no current weather warnings for county 03");
    expect(notes).toContain("not an all-clear");
    expect(notes).toContain("get_current_norwegian_hazards");
    expect(envelope.text).toContain("This is not an all-clear");
  });

  it("returns a single warning without claiming truncation", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        weather: { getWarnings: getWarnings(warningsOf([sampleWeatherWarning])) },
      }),
    });

    const envelope = await harness.callOk(TOOL, POINT);

    expect(envelope.data["warnings"]).toHaveLength(1);
    expect(envelope.truncation).toBeNull();
    expect(envelope.text).toContain("1 warning,");
    // Neither the cancellation note nor the NVE overlap note applies.
    expect(envelope.warnings.join(" ")).not.toContain("Cancel");
    expect(envelope.warnings.join(" ")).not.toContain("rainFlood and stormSurge");
  });

  it("cuts a very large set at fifty in MetAlerts order and says how to narrow it", async () => {
    const many = Array.from({ length: 60 }, (_unused, index) => ({
      ...sampleWeatherWarning,
      id: `warning-${index}`,
      description: index === 0 ? "x".repeat(2_000) : sampleWeatherWarning.description,
    }));
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings(warningsOf(many)) } }),
    });

    const envelope = await harness.callOk(TOOL, {});

    const warnings = envelope.data["warnings"] as { id: string; description: string }[];
    expect(warnings).toHaveLength(50);
    expect(warnings[49]!.id).toBe("warning-49");
    expect(warnings[0]!.description).toHaveLength(BUDGET.maxStringChars);
    expect(envelope.data["totalWarnings"]).toBe(60);
    expect(envelope.truncation?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "warnings", returned: 50 }),
        expect.objectContaining({ field: "warnings[0].description" }),
      ]),
    );
    expect(envelope.warnings.join(" ")).toContain("MetAlerts published 60 warnings");
    expect(envelope.warnings.join(" ")).toContain(
      "Narrow by countyCode, event or geographicDomain",
    );
    expect(envelope.text).toContain("50 of 60 warnings");
  });

  it("returns every GeoJSON shape MetAlerts may publish, and drops an oversized area whole", async () => {
    const shaped = (id: string, geometry: GeoJsonGeometry | null): WeatherWarning => ({
      ...sampleWeatherWarning,
      id,
      geometry,
    });
    const ring = Array.from({ length: 4_100 }, (_unused, index): [number, number] => [
      5 + index / 10_000,
      60,
    ]);
    const warnings = [
      shaped("point", { type: "Point", coordinates: [5.32, 60.39] }),
      shaped("multipoint", {
        type: "MultiPoint",
        coordinates: [
          [5.3, 60.3],
          [5.4, 60.4],
        ],
      }),
      shaped("line", {
        type: "LineString",
        coordinates: [
          [5.3, 60.3],
          [5.4, 60.4],
          [5.5, 60.5],
        ],
      }),
      shaped("huge", { type: "Polygon", coordinates: [ring] }),
    ];
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings(warningsOf(warnings)) } }),
    });

    const envelope = await harness.callOk(TOOL, { includeGeometry: true });

    const result = envelope.data["warnings"] as {
      geometry: { type: string } | null;
      geometrySummary: {
        type: string;
        partCount: number;
        vertexCount: number;
        omittedReason?: string;
      };
    }[];
    expect(result[0]!.geometry).toEqual({ type: "Point", coordinates: [5.32, 60.39] });
    expect(result[0]!.geometrySummary).toMatchObject({ partCount: 1, vertexCount: 1 });
    expect(result[1]!.geometrySummary).toMatchObject({ type: "MultiPoint", partCount: 2 });
    expect(result[2]!.geometrySummary).toMatchObject({ type: "LineString", vertexCount: 3 });
    expect(result[3]!.geometry).toBeNull();
    expect(result[3]!.geometrySummary).toMatchObject({
      vertexCount: 4_100,
      omittedReason: "too-large",
    });
    expect(envelope.truncation?.fields).toContainEqual(
      expect.objectContaining({ field: "warnings[3].geometry", reason: "limit" }),
    );
    expect(envelope.warnings.join(" ")).toContain(
      "1 warning area was omitted for exceeding 4000 vertices",
    );
  });

  it("stops returning areas once the result's geometry budget is spent", async () => {
    const ring = (offset: number) =>
      Array.from({ length: 2_500 }, (_unused, index): [number, number] => [
        offset + index / 10_000,
        60,
      ]);
    const warnings = [0, 1].map((index) => ({
      ...sampleWeatherWarning,
      id: `budget-${index}`,
      geometry: { type: "Polygon" as const, coordinates: [ring(index)] },
    }));
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings(warningsOf(warnings)) } }),
    });

    const envelope = await harness.callOk(TOOL, { includeGeometry: true });

    const result = envelope.data["warnings"] as {
      geometrySummary: { included: boolean; omittedReason?: string };
    }[];
    expect(result[0]!.geometrySummary.included).toBe(true);
    expect(result[1]!.geometrySummary.omittedReason).toBe("result-budget");
    expect(envelope.warnings.join(" ")).toContain("spent its geometry budget");
  });

  it.each(PROVIDER_FAILURES)("maps %s", async (_label, error, expected) => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: () => Promise.reject(error) } }),
    });
    expect(await harness.callErr(TOOL, POINT)).toMatchObject(expected);
  });

  it("refuses to run without the contact email MET Norway requires, naming it exactly", async () => {
    const spy = getWarnings();
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: spy } }),
      config: { contactEmail: undefined },
    });

    const error = await harness.callErr(TOOL, POINT);

    expect(error).toMatchObject({
      code: "missing_configuration",
      requiredConfiguration: ["NORWAY_MCP_CONTACT_EMAIL"],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("credits MET Norway exactly as the SDK registry declares it", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings() } }),
    });

    const envelope = await harness.callOk(TOOL, POINT);

    expect(envelope.sources).toEqual([registrySource("met")]);
    expect(envelope.text).toContain("Credit the Norwegian Meteorological Institute");
  });

  it("renders deterministic, bounded text with the essentials", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings() } }),
    });

    const first = await harness.callOk(TOOL, POINT);
    const second = await harness.callOk(TOOL, POINT);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(first.text).toContain("[yellow, level 2]");
    expect(first.text).toContain("Valid 2026-07-23T08:00:00+00:00 to 2026-07-23T20:00:00+00:00");
    expect(first.text).toContain("Named event: Testuværet");
    expect(first.text).toContain("the point 60.39, 5.32");
  });

  it("renders a warning stripped to its required fields without inventing any", async () => {
    const sparse: WeatherWarning = {
      id: "sparse",
      event: "snow",
      title: "Snø",
      area: "Innlandet",
      description: "Mye snø.",
      awarenessLevel: { level: 2, color: "yellow", severity: "Moderate" },
      severity: "Moderate",
      certainty: "Likely",
      messageType: "Alert",
      status: "Actual",
      countyCodes: [],
      municipalityCodes: [],
      resources: [],
      geometry: null,
    };
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getWarnings: getWarnings(warningsOf([sparse])) } }),
    });

    const envelope = await harness.callOk(TOOL, {});

    expect(envelope.text).not.toContain("undefined");
    expect(envelope.text).toContain("snow — Innlandet");
    expect(envelope.text).not.toContain("Valid ");
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_norwegian_precipitation_nowcast
// ---------------------------------------------------------------------------

describe("get_norwegian_precipitation_nowcast", () => {
  const TOOL = "get_norwegian_precipitation_nowcast";
  const getNowcast = (nowcast: typeof sampleNowcast = sampleNowcast) =>
    vi.fn(() =>
      Promise.resolve(respond<typeof sampleNowcast | undefined>(nowcast, SOURCES["met"]!)),
    );
  /** MET Norway's answer for a point outside the radar area. */
  const outsideRadar = () =>
    vi.fn(() =>
      Promise.resolve(respond<typeof sampleNowcast | undefined>(undefined, SOURCES["met"]!)),
    );

  it("returns the five-minute steps for a covered point", async () => {
    const spy = getNowcast();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getNowcast: spy } }) });

    const envelope = await harness.callOk(TOOL, { latitude: 59.91, longitude: 10.75 });

    expect(spy).toHaveBeenCalledWith({ latitude: 59.91, longitude: 10.75 }, expect.anything());
    expect(envelope.data["coverage"]).toBe("covered");
    const nowcast = envelope.data["nowcast"] as {
      radarCoverage: string;
      coordinates: { altitude: number };
      entries: { time: string; precipitationRate?: number; windGust?: number }[];
    };
    expect(nowcast.entries).toHaveLength(25);
    expect(nowcast.entries[0]).toMatchObject({ windGust: 6.5, precipitationRate: 0 });
    expect(nowcast.coordinates.altitude).toBe(23);
    expect(envelope.truncation).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("roughly the next two hours");
    expect(envelope.warnings.join(" ")).not.toContain("radar coverage");
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });

  it("accepts coordinates at the edge of their ranges", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: getNowcast() } }),
    });
    await harness.callOk(TOOL, { latitude: 90, longitude: -180 });
  });

  it("treats a point outside the radar area as an answer, not an error", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: outsideRadar() } }),
    });

    // Longyearbyen, Svalbard: outside the Nordic radar network.
    const envelope = await harness.callOk(TOOL, { latitude: 78.22, longitude: 15.65 });

    expect(envelope.data["coverage"]).toBe("outside-radar-area");
    expect(envelope.data["nowcast"]).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("which excludes Svalbard");
    expect(envelope.warnings.join(" ")).toContain("get_norwegian_weather_forecast");
    expect(envelope.text).toContain("outside MET Norway's radar area");
    expect(envelope.sources).toEqual([registrySource("met")]);
  });

  it("warns when the radar is not reporting ok", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        weather: {
          getNowcast: getNowcast({ ...sampleNowcast, radarCoverage: "temporarily unavailable" }),
        },
      }),
    });

    const envelope = await harness.callOk(TOOL, POINT);

    expect(envelope.warnings.join(" ")).toContain(
      'MET Norway reports radar coverage "temporarily unavailable"',
    );
    expect(envelope.text).toContain("(radar: temporarily unavailable)");
  });

  it.each([
    ["a missing longitude", { latitude: 59.91 }],
    ["NaN", { latitude: Number.NaN, longitude: 10.75 }],
    ["latitude out of range", { latitude: -91, longitude: 10.75 }],
    ["longitude out of range", { latitude: 59.91, longitude: 181 }],
    ["an unknown property", { ...POINT, minutes: 30 }],
  ])("rejects %s before contacting MET Norway", async (_label, args) => {
    const spy = getNowcast();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getNowcast: spy } }) });

    expect((await harness.call(TOOL, args)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("handles a covered point with no steps, and a single sparse step", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        weather: {
          getNowcast: getNowcast({ coordinates: { latitude: 60, longitude: 5 }, entries: [] }),
        },
      }),
    });
    const empty = await harness.callOk(TOOL, POINT);
    expect(empty.text).toContain("MET Norway returned no nowcast steps.");
    await harness.close();

    harness = await createHarness({
      sdk: createFakeSdk({
        weather: {
          getNowcast: getNowcast({
            coordinates: { latitude: 60, longitude: 5 },
            entries: [{ time: "2026-07-23T10:00:00Z" }],
          }),
        },
      }),
    });
    const one = await harness.callOk(TOOL, POINT);
    expect((one.data["nowcast"] as { entries: unknown[] }).entries).toEqual([
      { time: "2026-07-23T10:00:00Z" },
    ]);
    expect(one.text).not.toContain("undefined");
    expect(one.text).toContain("- 2026-07-23T10:00:00Z");
  });

  it("bounds an over-long series and reports it", async () => {
    const entries = Array.from({ length: 40 }, (_unused, index) => ({
      time: new Date(Date.UTC(2026, 6, 23, 10, index * 5)).toISOString(),
      precipitationRate: 0.5,
    }));
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: getNowcast({ ...sampleNowcast, entries }) } }),
    });

    const envelope = await harness.callOk(TOOL, POINT);

    expect((envelope.data["nowcast"] as { entries: unknown[] }).entries).toHaveLength(30);
    expect(envelope.truncation?.fields[0]).toMatchObject({
      field: "nowcast.entries",
      returned: 30,
    });
    expect(envelope.warnings.join(" ")).toContain(
      'Showing 30 of 40 available for "nowcast.entries"',
    );
  });

  it.each(PROVIDER_FAILURES)("maps %s", async (_label, error, expected) => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: () => Promise.reject(error) } }),
    });
    expect(await harness.callErr(TOOL, POINT)).toMatchObject(expected);
  });

  it("refuses to run without the contact email, naming it exactly", async () => {
    const spy = getNowcast();
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: spy } }),
      config: { contactEmail: undefined },
    });

    expect(await harness.callErr(TOOL, POINT)).toMatchObject({
      code: "missing_configuration",
      requiredConfiguration: ["NORWAY_MCP_CONTACT_EMAIL"],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders deterministic, bounded text", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getNowcast: getNowcast() } }),
    });

    const first = await harness.callOk(TOOL, POINT);
    const second = await harness.callOk(TOOL, POINT);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(first.text).toContain(
      "Precipitation nowcast for 60.39, 5.32, updated 2026-07-23T09:55:00Z (radar: ok).",
    );
    expect(first.text).toContain("1.2 mm/h");
    expect(first.text).toContain("18.4°C | wind 3.1 m/s");
  });
});

// ---------------------------------------------------------------------------
// get_norwegian_sun_times
// ---------------------------------------------------------------------------

describe("get_norwegian_sun_times", () => {
  const TOOL = "get_norwegian_sun_times";
  const getSunTimes = (sun: typeof sampleSunTimes = sampleSunTimes) =>
    vi.fn(() => Promise.resolve(respond(sun, SOURCES["met"]!)));

  it("returns sunrise and sunset with the Oslo offset for the date asked", async () => {
    const spy = getSunTimes();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getSunTimes: spy } }) });

    const envelope = await harness.callOk(TOOL, {
      latitude: 59.9139,
      longitude: 10.7522,
      date: "2026-07-23",
    });

    expect(spy).toHaveBeenCalledWith(
      { latitude: 59.9139, longitude: 10.7522, date: "2026-07-23" },
      expect.anything(),
    );
    expect(envelope.data).toMatchObject({
      date: "2026-07-23",
      sunrise: { time: "2026-07-23T04:38+02:00", azimuth: 40.2 },
      sunset: { time: "2026-07-23T22:12+02:00" },
      solarNoon: { time: "2026-07-23T13:25+02:00", elevation: 51.8, visible: true },
      polarCondition: null,
    });
    expect(envelope.warnings).toEqual([expect.stringContaining("Europe/Oslo UTC offset")]);
    expect(envelope.truncation).toBeNull();
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });

  it("defaults the date to today in Europe/Oslo from the injected clock", async () => {
    const spy = getSunTimes();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getSunTimes: spy } }) });

    await harness.callOk(TOOL, POINT);

    expect(spy).toHaveBeenCalledWith({ ...POINT, date: "2026-07-23" }, expect.anything());
  });

  it("reports midnight sun as the answer, not as missing data", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: getSunTimes(sampleMidnightSunTimes) } }),
    });

    const envelope = await harness.callOk(TOOL, {
      latitude: 69.6492,
      longitude: 18.9553,
      date: "2026-06-21",
    });

    expect(envelope.data).toMatchObject({
      sunrise: null,
      sunset: null,
      polarCondition: "midnight-sun",
    });
    expect(envelope.warnings.join(" ")).toContain("Midnight sun: the sun stays above the horizon");
    expect(envelope.warnings.join(" ")).toContain("not missing data");
    expect(envelope.text).toContain("Midnight sun — the sun does not set on this date.");
  });

  it("reports polar night the same way", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: getSunTimes(samplePolarNightSunTimes) } }),
    });

    const envelope = await harness.callOk(TOOL, { ...POINT, date: "2026-12-21" });

    expect(envelope.data["polarCondition"]).toBe("polar-night");
    expect(envelope.warnings.join(" ")).toContain("Polar night: the sun stays below the horizon");
    expect(envelope.text).toContain("Polar night — the sun does not rise on this date.");
  });

  it("explains a missing sunrise or sunset that MET did not call polar", async () => {
    const day = {
      date: sampleSunTimes.date,
      coordinates: sampleSunTimes.coordinates,
      solarNoon: sampleSunTimes.solarNoon!,
      solarMidnight: sampleSunTimes.solarMidnight!,
    };
    const noSunset = { ...day, sunrise: sampleSunTimes.sunrise! };
    const noSunrise = { ...day, sunset: sampleSunTimes.sunset! };
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: getSunTimes(noSunset) } }),
    });
    const one = await harness.callOk(TOOL, POINT);
    expect(one.data["sunset"]).toBeNull();
    expect(one.warnings.join(" ")).toContain("MET Norway published no sunset for this date");
    expect(one.text).toContain("Sunset: none on this date");
    await harness.close();

    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: getSunTimes(noSunrise) } }),
    });
    const other = await harness.callOk(TOOL, POINT);
    expect(other.warnings.join(" ")).toContain("MET Norway published no sunrise for this date");
    await harness.close();

    harness = await createHarness({
      sdk: createFakeSdk({
        weather: {
          getSunTimes: getSunTimes({
            date: "2026-05-20",
            coordinates: { latitude: 70.9, longitude: 25.7 },
          }),
        },
      }),
    });
    const neither = await harness.callOk(TOOL, POINT);
    expect(neither.data).toMatchObject({
      solarNoon: null,
      solarMidnight: null,
      polarCondition: null,
    });
    expect(neither.warnings.join(" ")).toContain("published no sunrise or sunset for this date");
    expect(neither.text).not.toContain("undefined");
  });

  it.each([
    ["an impossible date", { ...POINT, date: "2026-02-30" }],
    ["a Norwegian-style date", { ...POINT, date: "23.07.2026" }],
    ["NaN longitude", { latitude: 60, longitude: Number.NaN }],
    ["a missing latitude", { longitude: 5.32 }],
    ["an unknown property", { ...POINT, timezone: "UTC" }],
  ])("rejects %s before contacting MET Norway", async (_label, args) => {
    const spy = getSunTimes();
    harness = await createHarness({ sdk: createFakeSdk({ weather: { getSunTimes: spy } }) });

    expect((await harness.call(TOOL, args)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(PROVIDER_FAILURES)("maps %s", async (_label, error, expected) => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: () => Promise.reject(error) } }),
    });
    expect(await harness.callErr(TOOL, POINT)).toMatchObject(expected);
  });

  it("refuses to run without the contact email, naming it exactly", async () => {
    const spy = getSunTimes();
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: spy } }),
      config: { contactEmail: undefined },
    });

    const result = await harness.call(TOOL, POINT);
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("NORWAY_MCP_CONTACT_EMAIL");
    expect(spy).not.toHaveBeenCalled();
  });

  it("credits MET Norway and renders deterministic, bounded text", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { getSunTimes: getSunTimes() } }),
    });

    const first = await harness.callOk(TOOL, POINT);
    const second = await harness.callOk(TOOL, POINT);

    expect(first.sources).toEqual([registrySource("met")]);
    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(first.text).toContain("Sunrise: 2026-07-23T04:38+02:00");
    expect(first.text).toContain("Solar noon: 2026-07-23T13:25+02:00");
  });
});
