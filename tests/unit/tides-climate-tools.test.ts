/**
 * Kartverket's tides and MET Norway Frost's weather history, added in 0.5.0.
 *
 * Driven through the real MCP path against fakes shaped like
 * `norway-open-data-sdk@0.9.0` output. Cancellation is covered for every tool
 * by tests/unit/cancellation.test.ts; the abort paths of each tool's second,
 * optional request are covered here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ClimateNormal,
  ClimateObservationRecord,
  ClimateStation,
  TideTable,
  WaterLevels,
} from "norway-open-data-sdk";

import { FIXED_NOW, createHarness, type Harness } from "../helpers/harness.js";
import { registrySource } from "../helpers/registry.js";
import { BUDGET } from "../../src/limits/budget.js";
import { allTools } from "../../src/tools/registry.js";
import {
  SOURCES,
  abortable,
  createFakeSdk,
  respond,
  sampleClimateNormals,
  sampleClimateStation,
  sampleDailyObservations,
  sampleHourlyObservations,
  sampleTideLocation,
  sampleTideTable,
  sampleWaterLevels,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const HOUR_MS = 60 * 60 * 1000;
const BERGEN = { latitude: 60.398, longitude: 5.32 };
const FROST_CONFIG = { metFrostClientId: "test-frost-client-id" } as const;

function dataSchemaOf(name: string) {
  const tool = allTools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`No tool ${name}`);
  return tool.dataSchema;
}

const failures = (provider: string) =>
  [
    [
      "a provider outage",
      sdkError("ProviderError", "The provider returned HTTP 503.", { provider, statusCode: 503 }),
      { code: "provider_error", retryable: true, provider, statusCode: 503 },
    ],
    [
      "a rate limit",
      sdkError("RateLimitError", "Too many requests.", {
        provider,
        statusCode: 429,
        retryAfter: 45,
      }),
      { code: "rate_limited", retryable: true, retryAfter: 45 },
    ],
    [
      "a timeout",
      sdkError("RequestTimeoutError", "The provider did not answer in time.", { provider }),
      { code: "timeout", retryable: true },
    ],
  ] as const;

// ---------------------------------------------------------------------------
// get_norwegian_tides
// ---------------------------------------------------------------------------

describe("get_norwegian_tides", () => {
  const TOOL = "get_norwegian_tides";
  const tideTable = (table: TideTable = sampleTideTable) =>
    vi.fn(() =>
      Promise.resolve(respond<TideTable | undefined>(table, SOURCES["kartverket-tides"]!)),
    );
  const notCovered = () =>
    vi.fn(() =>
      Promise.resolve(respond<TideTable | undefined>(undefined, SOURCES["kartverket-tides"]!)),
    );
  const waterLevels = (levels: WaterLevels = sampleWaterLevels) =>
    vi.fn(() =>
      Promise.resolve(respond<WaterLevels | undefined>(levels, SOURCES["kartverket-tides"]!)),
    );
  const noWaterLevels = () =>
    vi.fn(() =>
      Promise.resolve(respond<WaterLevels | undefined>(undefined, SOURCES["kartverket-tides"]!)),
    );

  it("builds a 48-hour UTC window from the clock and states where the values come from", async () => {
    const table = tideTable();
    const levels = waterLevels();
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: table, getWaterLevels: levels } }),
    });

    const envelope = await harness.callOk(TOOL, BERGEN);

    const from = FIXED_NOW.toISOString();
    const to = new Date(FIXED_NOW.getTime() + 48 * HOUR_MS).toISOString();
    expect(table).toHaveBeenCalledWith(
      { ...BERGEN, from, to, referenceLevel: "chart-datum" },
      expect.anything(),
    );
    // Water levels are opt-in, and their request is never made by default.
    expect(levels).not.toHaveBeenCalled();
    expect(envelope.data).toMatchObject({
      window: { from, to, hours: 48 },
      referenceLevel: "chart-datum",
      covered: true,
      waterLevels: null,
      tideTable: {
        referenceLevel: "CD",
        unit: "cm",
        location: {
          name: "Bergen",
          code: "BGO",
          factor: 1,
          delayMinutes: 0,
          surgeStationCode: "BGO",
        },
      },
    });
    expect((envelope.data["tideTable"] as { events: unknown[] }).events).toHaveLength(4);
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("times are UTC");
    expect(notes).toContain("above chart datum");
    expect(notes).toContain("modelled, not measured");
    expect(envelope.partial).toBeNull();
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });

  it("takes every input at its limit, keeping the water-level series separate", async () => {
    const table = tideTable();
    const levels = waterLevels();
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: table, getWaterLevels: levels } }),
    });

    const envelope = await harness.callOk(TOOL, {
      ...BERGEN,
      hours: 168,
      referenceLevel: "nn2000",
      includeWaterLevels: true,
    });

    expect(table).toHaveBeenCalledWith(
      expect.objectContaining({
        to: new Date(FIXED_NOW.getTime() + 168 * HOUR_MS).toISOString(),
        referenceLevel: "nn2000",
      }),
      expect.anything(),
    );
    // Water levels cover only the first 48 hours, hourly, and say so.
    expect(levels).toHaveBeenCalledWith(
      {
        ...BERGEN,
        from: FIXED_NOW.toISOString(),
        to: new Date(FIXED_NOW.getTime() + 48 * HOUR_MS).toISOString(),
        interval: 60,
        referenceLevel: "nn2000",
      },
      expect.anything(),
    );
    const water = envelope.data["waterLevels"] as {
      window: { hours: number; intervalMinutes: number };
      serviceMessages: string[];
      series: { type: string; quality?: { flag: number }; values: { uncertainty?: object }[] }[];
    };
    expect(water.window).toMatchObject({ hours: 48, intervalMinutes: 60 });
    expect(water.series.map((series) => series.type)).toEqual([
      "observation",
      "prediction",
      "weathereffect",
      "forecast",
    ]);
    expect(water.series[0]!.quality?.flag).toBe(1);
    expect(water.series[3]!.values[0]!.uncertainty).toBeDefined();
    expect(water.serviceMessages).toEqual(["Vannstandsmåleren i Bergen leverer forsinkede data."]);
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("Water levels cover the first 48 of the 168 requested hours");
    expect(notes).toContain("uncertainty band");
    expect(notes).toContain("relative to NN2000");
    expect(envelope.text).toContain("forecast: 24 values");
  });

  it.each([
    ["zero hours", { ...BERGEN, hours: 0 }],
    ["more than a week", { ...BERGEN, hours: 169 }],
    ["fractional hours", { ...BERGEN, hours: 1.5 }],
    ["an unknown reference level", { ...BERGEN, referenceLevel: "lowest-astronomical-tide" }],
    ["NaN latitude", { latitude: Number.NaN, longitude: 5.32 }],
    ["a missing longitude", { latitude: 60.398 }],
    ["a caller-supplied window", { ...BERGEN, from: "2026-07-23T00:00:00Z" }],
  ])("rejects %s before contacting Kartverket", async (_label, args) => {
    const table = tideTable();
    harness = await createHarness({ sdk: createFakeSdk({ tides: { getTideTable: table } }) });

    expect((await harness.call(TOOL, args)).isError).toBe(true);
    expect(table).not.toHaveBeenCalled();
  });

  it("treats an inland point as not covered, not as an error, and skips the water levels", async () => {
    const levels = waterLevels();
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: notCovered(), getWaterLevels: levels } }),
    });

    const envelope = await harness.callOk(TOOL, {
      latitude: 61.11,
      longitude: 10.46,
      includeWaterLevels: true,
    });

    expect(envelope.data).toMatchObject({ covered: false, tideTable: null, waterLevels: null });
    expect(levels).not.toHaveBeenCalled();
    expect(envelope.warnings.join(" ")).toContain("inland or too far offshore");
    expect(envelope.text).toContain("No tide data for 61.11, 10.46");
    // Kartverket still answered, so it is still credited.
    expect(envelope.sources).toEqual([registrySource("kartverket-tides")]);
  });

  it("returns an empty window, a single event and a full table as they come", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: { getTideTable: tideTable({ ...sampleTideTable, events: [] }) },
      }),
    });
    const empty = await harness.callOk(TOOL, { ...BERGEN, hours: 1 });
    expect((empty.data["tideTable"] as { events: unknown[] }).events).toEqual([]);
    expect(empty.text).toContain("No high or low water falls inside this window.");
    await harness.close();

    harness = await createHarness({
      sdk: createFakeSdk({
        tides: {
          getTideTable: tideTable({
            ...sampleTideTable,
            events: sampleTideTable.events.slice(0, 1),
          }),
        },
      }),
    });
    const one = await harness.callOk(TOOL, { ...BERGEN, hours: 6 });
    expect((one.data["tideTable"] as { events: unknown[] }).events).toHaveLength(1);
    expect(one.text).toContain("2026-07-23T11:42:00+00:00 high 152.3 cm");
  });

  it("bounds an over-long table and water-level series, and reports both", async () => {
    const events = Array.from({ length: 80 }, (_unused, index) => ({
      time: new Date(Date.UTC(2026, 6, 23) + index * 6 * HOUR_MS).toISOString(),
      value: 100,
      kind: index % 2 === 0 ? ("high" as const) : ("low" as const),
    }));
    const long = Array.from({ length: 70 }, (_unused, index) => ({
      time: new Date(Date.UTC(2026, 6, 23) + index * HOUR_MS).toISOString(),
      value: 100,
    }));
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: {
          getTideTable: tideTable({ ...sampleTideTable, events }),
          getWaterLevels: waterLevels({
            ...sampleWaterLevels,
            series: [{ type: "prediction", unit: "cm", values: long }],
          }),
        },
      }),
    });

    const envelope = await harness.callOk(TOOL, { ...BERGEN, includeWaterLevels: true });

    expect((envelope.data["tideTable"] as { events: unknown[] }).events).toHaveLength(60);
    expect(envelope.truncation?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "tideTable.events", returned: 60 }),
        expect.objectContaining({ field: "waterLevels.series[0].values", returned: 60 }),
      ]),
    );
    expect(envelope.warnings.join(" ")).toContain(
      'Showing 60 of 80 available for "tideTable.events"',
    );
  });

  it("keeps the tide table when only the water-level request fails, as a partial result", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: {
          getTideTable: tideTable(),
          getWaterLevels: () =>
            Promise.reject(
              sdkError("ProviderError", "Kartverket returned HTTP 503.", {
                provider: "kartverket-tides",
                statusCode: 503,
              }),
            ),
        },
      }),
    });

    const envelope = await harness.callOk(TOOL, { ...BERGEN, includeWaterLevels: true });

    expect(envelope.data["tideTable"]).not.toBeNull();
    expect(envelope.data["waterLevels"]).toBeNull();
    expect(envelope.partial).toEqual({
      complete: false,
      missing: ["waterLevels"],
      reason: "The Kartverket water-level request failed.",
    });
    expect(envelope.warnings.join(" ")).toContain("The water-level request failed");
    expect(envelope.text).toContain("Partial result");
  });

  it("says so when Kartverket returns no water levels for a covered point", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: { getTideTable: tideTable(), getWaterLevels: noWaterLevels() },
      }),
    });

    const envelope = await harness.callOk(TOOL, { ...BERGEN, hours: 12, includeWaterLevels: true });

    expect(envelope.data["waterLevels"]).toBeNull();
    expect(envelope.partial).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("returned no water levels");
    // A window inside 48 hours is not shortened.
    expect(envelope.warnings.join(" ")).not.toContain("Water levels cover the first");
  });

  it("aborts the whole call when the caller cancels during the water-level request", async () => {
    const levels = vi.fn(abortable());
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: tideTable(), getWaterLevels: levels } }),
    });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      { name: TOOL, arguments: { ...BERGEN, includeWaterLevels: true } },
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(levels).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it.each(failures("kartverket-tides"))(
    "maps %s on the tide table",
    async (_label, error, expected) => {
      harness = await createHarness({
        sdk: createFakeSdk({ tides: { getTideTable: () => Promise.reject(error) } }),
      });
      expect(await harness.callErr(TOOL, BERGEN)).toMatchObject(expected);
    },
  );

  it("needs no configuration at all", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: tideTable() } }),
      config: { contactEmail: undefined, metFrostClientId: undefined },
    });
    await harness.callOk(TOOL, BERGEN);
  });

  it("credits the Hydrographic Service exactly as the SDK registry declares it", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ tides: { getTideTable: tideTable(), getWaterLevels: waterLevels() } }),
    });

    const envelope = await harness.callOk(TOOL, { ...BERGEN, includeWaterLevels: true });

    // Two requests to one provider, credited once.
    expect(envelope.sources).toEqual([registrySource("kartverket-tides")]);
    expect(envelope.text).toContain("Hydrographic Service");
  });

  it("renders deterministic, bounded text with the reference level and station", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: {
          getTideTable: tideTable({
            ...sampleTideTable,
            serviceMessages: ["Prediksjoner for Bergen er oppdatert."],
          }),
        },
      }),
    });

    const first = await harness.callOk(TOOL, BERGEN);
    const second = await harness.callOk(TOOL, BERGEN);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(first.text).toContain("Heights in cm above chart-datum (Kartverket code CD).");
    expect(first.text).toContain(
      "Modelled from Bergen (BGO), factor 1, delay 0 min; weather effect from Bergen (BGO).",
    );
    expect(first.text).toContain("Kartverket notices:\n- Prediksjoner for Bergen er oppdatert.");
  });

  it("renders a location stripped to its required fields without inventing any", async () => {
    const bare = {
      name: sampleTideLocation.name,
      code: sampleTideLocation.code,
      latitude: sampleTideLocation.latitude,
      longitude: sampleTideLocation.longitude,
    };
    harness = await createHarness({
      sdk: createFakeSdk({
        tides: {
          getTideTable: tideTable({ ...sampleTideTable, location: bare }),
          getWaterLevels: waterLevels({
            location: bare,
            referenceLevel: "CD",
            serviceMessages: [],
            series: [{ type: "prediction", unit: "cm", values: [] }],
          }),
        },
      }),
    });

    const envelope = await harness.callOk(TOOL, { ...BERGEN, includeWaterLevels: true });

    expect(envelope.text).toContain("Modelled from Bergen (BGO).");
    expect(envelope.text).toContain("- prediction: 0 values");
    expect(envelope.text).not.toContain("undefined");
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_norwegian_weather_history
// ---------------------------------------------------------------------------

describe("get_norwegian_weather_history", () => {
  const TOOL = "get_norwegian_weather_history";
  const stations = (found: ClimateStation[] = [sampleClimateStation]) =>
    vi.fn(() => Promise.resolve(respond(found, SOURCES["met-frost"]!)));
  const observations = (records: ClimateObservationRecord[] = sampleDailyObservations) =>
    vi.fn(() => Promise.resolve(respond(records, SOURCES["met-frost"]!)));
  const normals = (values: ClimateNormal[] = sampleClimateNormals) =>
    vi.fn(() => Promise.resolve(respond(values, SOURCES["met-frost"]!)));

  async function frostHarness(
    overrides: {
      searchStations?: ReturnType<typeof stations>;
      getObservations?: ReturnType<typeof observations>;
      getClimateNormals?: ReturnType<typeof normals>;
    } = {},
  ) {
    return createHarness({
      sdk: createFakeSdk({
        climate: {
          searchStations: overrides.searchStations ?? stations(),
          getObservations: overrides.getObservations ?? observations(),
          getClimateNormals: overrides.getClimateNormals ?? normals(),
        },
      }),
      config: FROST_CONFIG,
    });
  }

  it("reads daily values for a named station, labelled and exactly as Frost published them", async () => {
    const search = stations();
    const read = observations();
    harness = await frostHarness({ searchStations: search, getObservations: read });

    const envelope = await harness.callOk(TOOL, {
      stationId: "sn18700",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
    });

    expect(search).toHaveBeenCalledWith({ ids: ["SN18700"] }, expect.anything());
    expect(read).toHaveBeenCalledWith(
      {
        stationIds: ["SN18700"],
        elements: [
          "mean(air_temperature P1D)",
          "min(air_temperature P1D)",
          "max(air_temperature P1D)",
          "sum(precipitation_amount P1D)",
          "max(wind_speed_of_gust P1D)",
        ],
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-04T00:00:00Z",
        timeResolutions: ["P1D"],
      },
      expect.anything(),
    );
    expect(envelope.data).toMatchObject({
      selectedBy: "station-id",
      station: { id: "SN18700", name: "OSLO - BLINDERN", distanceKm: 3.4, elevationMetres: 94 },
      window: {
        startDate: "2026-01-01",
        endDate: "2026-01-03",
        resolution: "daily",
        timeResolution: "P1D",
      },
      recordCount: 3,
      normals: null,
    });
    const records = envelope.data["records"] as {
      referenceTime: string;
      observations: { element?: string; elementId: string; value: number; qualityCode?: number }[];
    }[];
    expect(records[1]!.observations).toEqual([
      expect.objectContaining({
        element: "mean_air_temperature",
        elementId: "mean(air_temperature P1D)",
        value: -4.2,
        qualityCode: 0,
      }),
      // A day with no rain is Frost's zero, kept as published.
      expect.objectContaining({ element: "precipitation", value: 0 }),
    ]);
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("Experimental");
    expect(notes).toContain("never a zero, and is not filled or interpolated");
    expect(notes).toContain("up to, but not including, 2026-01-04T00:00:00Z");
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });

  it("never carries a station field the server does not whitelist", async () => {
    harness = await frostHarness({
      searchStations: stations([
        {
          ...sampleClimateStation,
          // A field a future SDK might add; it must not reach the result.
          stationHolders: ["A private holder"],
        } as ClimateStation,
      ]),
    });

    const envelope = await harness.callOk(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    const station = envelope.data["station"] as Record<string, unknown>;
    expect(Object.keys(station).sort()).toEqual(
      [
        "county",
        "distanceKm",
        "elevationMetres",
        "id",
        "latitude",
        "longitude",
        "municipality",
        "name",
        "validFrom",
      ].sort(),
    );
    expect(JSON.stringify(envelope)).not.toContain("A private holder");
  });

  it("finds the nearest station reporting every element for a point, with its distance", async () => {
    const search = stations([{ ...sampleClimateStation, distanceKm: 40.2 }]);
    harness = await frostHarness({
      searchStations: search,
      getObservations: observations(sampleHourlyObservations),
    });

    const envelope = await harness.callOk(TOOL, {
      latitude: 59.91,
      longitude: 10.75,
      resolution: "hourly",
      startDate: "2026-07-20",
      endDate: "2026-07-23",
      elements: ["air_temperature", "wind_speed", "relative_humidity", "precipitation"],
      includeNormals: true,
    });

    expect(search).toHaveBeenCalledWith(
      {
        near: { latitude: 59.91, longitude: 10.75, maxCount: 1 },
        elements: [
          "air_temperature",
          "wind_speed",
          "relative_humidity",
          "sum(precipitation_amount PT1H)",
        ],
      },
      expect.anything(),
    );
    expect(envelope.data["selectedBy"]).toBe("nearest-station");
    expect(envelope.data["window"]).toMatchObject({
      to: "2026-07-24T00:00:00Z",
      resolution: "hourly",
      timeResolution: "PT1H",
    });
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("nearest Frost station reporting every requested element");
    expect(notes).toContain("is 40.2 km from the point");
    // Hourly in July: only July's normals, monthly ones only.
    expect(envelope.data["normals"]).toEqual({
      period: "1991/2020",
      months: [7],
      values: [
        expect.objectContaining({ element: "mean_air_temperature", month: 7 }),
        expect.objectContaining({ element: "precipitation", month: 7, normal: 78 }),
      ],
    });
  });

  it("asks for only the elements requested, in the server's order", async () => {
    const read = observations();
    harness = await frostHarness({ getObservations: read });

    await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2026-01-01",
      elements: ["precipitation", "min_air_temperature"],
    });

    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: ["min(air_temperature P1D)", "sum(precipitation_amount P1D)"],
      }),
      expect.anything(),
    );
  });

  it.each([
    [
      "both a point and a station",
      { latitude: 59.9, longitude: 10.7, stationId: "SN18700", startDate: "2026-01-01" },
    ],
    ["neither a point nor a station", { startDate: "2026-01-01" }],
    ["a latitude alone", { latitude: 59.9, startDate: "2026-01-01" }],
    ["a station without the SN prefix", { stationId: "18700", startDate: "2026-01-01" }],
    ["a station with a sensor suffix", { stationId: "SN18700:0", startDate: "2026-01-01" }],
    ["a reversed range", { stationId: "SN18700", startDate: "2026-01-05", endDate: "2026-01-01" }],
    [
      "five hourly days",
      {
        stationId: "SN18700",
        resolution: "hourly",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
      },
    ],
    ["101 daily days", { stationId: "SN18700", startDate: "2026-01-01", endDate: "2026-04-11" }],
    [
      "a daily element at hourly resolution",
      {
        stationId: "SN18700",
        resolution: "hourly",
        startDate: "2026-01-01",
        elements: ["max_wind_gust"],
      },
    ],
    [
      "an hourly element at daily resolution",
      { stationId: "SN18700", startDate: "2026-01-01", elements: ["relative_humidity"] },
    ],
    [
      "a repeated element",
      {
        stationId: "SN18700",
        startDate: "2026-01-01",
        elements: ["precipitation", "precipitation"],
      },
    ],
    ["an empty element list", { stationId: "SN18700", startDate: "2026-01-01", elements: [] }],
    [
      "a raw Frost element ID",
      { stationId: "SN18700", startDate: "2026-01-01", elements: ["mean(air_temperature P1D)"] },
    ],
    ["an impossible date", { stationId: "SN18700", startDate: "2026-02-30" }],
    [
      "an unknown resolution",
      { stationId: "SN18700", startDate: "2026-01-01", resolution: "monthly" },
    ],
    [
      "an unknown property",
      { stationId: "SN18700", startDate: "2026-01-01", timeOffsets: ["PT6H"] },
    ],
  ])("rejects %s before contacting Frost", async (_label, args) => {
    const search = stations();
    harness = await frostHarness({ searchStations: search });

    expect((await harness.call(TOOL, args)).isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("accepts the longest windows exactly at their limits", async () => {
    harness = await frostHarness();
    await harness.callOk(TOOL, {
      stationId: "SN18700",
      resolution: "hourly",
      startDate: "2026-01-01",
      endDate: "2026-01-04",
    });
    await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2026-01-01",
      endDate: "2026-04-10",
    });
  });

  it("refuses a future start date by the injected clock, naming the field", async () => {
    const search = stations();
    harness = await frostHarness({ searchStations: search });

    const error = await harness.callErr(TOOL, { stationId: "SN18700", startDate: "2026-07-24" });

    expect(error).toMatchObject({
      code: "invalid_input",
      fields: [
        {
          path: "startDate",
          message: expect.stringContaining("get_norwegian_weather_forecast") as string,
        },
      ],
    });
    expect(search).not.toHaveBeenCalled();
    // Today itself is history so far, and is accepted.
    await harness.callOk(TOOL, { stationId: "SN18700", startDate: "2026-07-23" });
  });

  it("treats no observations as no data for that station and window, not an error", async () => {
    harness = await frostHarness({ getObservations: observations([]) });

    const envelope = await harness.callOk(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    expect(envelope.data["records"]).toEqual([]);
    expect(envelope.data["recordCount"]).toBe(0);
    expect(envelope.warnings.join(" ")).toContain(
      "Frost returned no observations for OSLO - BLINDERN (SN18700) in this window",
    );
    expect(envelope.text).toContain("No observations in this window.");
  });

  it("returns a single record", async () => {
    harness = await frostHarness({
      getObservations: observations(sampleDailyObservations.slice(0, 1)),
    });

    const envelope = await harness.callOk(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    expect(envelope.data["recordCount"]).toBe(1);
    expect(envelope.truncation).toBeNull();
  });

  it("bounds records and values per record, and reports both", async () => {
    const many: ClimateObservationRecord[] = Array.from({ length: 120 }, (_unused, index) => ({
      stationId: "SN18700:0",
      referenceTime: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
      observations: Array.from({ length: index === 0 ? 25 : 1 }, () => ({
        elementId: "air_temperature",
        value: 1,
      })),
    }));
    harness = await frostHarness({ getObservations: observations(many) });

    const envelope = await harness.callOk(TOOL, {
      stationId: "SN18700",
      resolution: "hourly",
      startDate: "2026-01-01",
      endDate: "2026-01-04",
    });

    const records = envelope.data["records"] as { observations: unknown[] }[];
    expect(records).toHaveLength(100);
    expect(records[0]!.observations).toHaveLength(20);
    expect(envelope.truncation?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "records", returned: 100, availableUpstream: 120 }),
        expect.objectContaining({ field: "records[0].observations", returned: 20 }),
      ]),
    );
  });

  it("reports an unknown station as not found", async () => {
    harness = await frostHarness({ searchStations: stations([]) });

    const error = await harness.callErr(TOOL, { stationId: "SN99999999", startDate: "2026-01-01" });

    expect(error).toMatchObject({ code: "not_found", provider: "met-frost" });
    expect(error.message).toContain("Frost has no weather station SN99999999");
  });

  it("reports a point with no qualifying station as not found", async () => {
    harness = await frostHarness({ searchStations: stations([]) });

    const error = await harness.callErr(TOOL, {
      latitude: 71.1,
      longitude: 31,
      startDate: "2026-01-01",
    });

    expect(error.code).toBe("not_found");
    expect(error.message).toContain("no weather station reporting the requested elements");
  });

  it("selects monthly normals for the months the window touches, across a year end", async () => {
    harness = await frostHarness();

    const envelope = await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2025-12-30",
      endDate: "2026-02-02",
      includeNormals: true,
    });

    const normalValues = envelope.data["normals"] as {
      months: number[];
      values: { element: string; month: number; normal: number | null }[];
    };
    expect(normalValues.months).toEqual([12, 1, 2]);
    // Two elements for three months; the day-of-month normal is not included.
    expect(normalValues.values).toHaveLength(6);
    expect(normalValues.values).toContainEqual(
      expect.objectContaining({ element: "precipitation", month: 2, normal: null }),
    );
    expect(envelope.warnings.join(" ")).toContain("a thirty-year reference, not an observation");
    expect(envelope.text).toContain("Normals 1991/2020:");
    expect(envelope.text).toContain("- February: precipitation no value");
  });

  it("says so when Frost holds no normals for the station", async () => {
    harness = await frostHarness({
      getClimateNormals: normals([
        {
          stationId: "SN18700",
          elementId: "unrelated_element",
          period: "1991/2020",
          month: 1,
          normal: 3,
        },
        { stationId: "SN18700", elementId: "mean(air_temperature P1M)", period: "1991/2020" },
      ]),
    });

    const envelope = await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2026-01-01",
      includeNormals: true,
    });

    expect((envelope.data["normals"] as { values: unknown[] }).values).toEqual([]);
    expect(envelope.warnings.join(" ")).toContain("holds no 1991/2020 monthly normals");
    expect(envelope.text).not.toContain("Normals 1991/2020:");
  });

  it("keeps the observations when only the normals request fails, as a partial result", async () => {
    harness = await frostHarness({
      getClimateNormals: vi.fn(() =>
        Promise.reject(
          sdkError("ProviderError", "Frost returned HTTP 503.", { provider: "met-frost" }),
        ),
      ) as unknown as ReturnType<typeof normals>,
    });

    const envelope = await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2026-01-01",
      includeNormals: true,
    });

    expect(envelope.data["recordCount"]).toBe(3);
    expect(envelope.data["normals"]).toBeNull();
    expect(envelope.partial).toMatchObject({ complete: false, missing: ["normals"] });
    expect(envelope.warnings.join(" ")).toContain("The climate-normal request failed");
  });

  it("aborts the whole call when the caller cancels during the normals request", async () => {
    const pendingNormals = vi.fn(abortable());
    harness = await frostHarness({
      getClimateNormals: pendingNormals as unknown as ReturnType<typeof normals>,
    });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      {
        name: TOOL,
        arguments: { stationId: "SN18700", startDate: "2026-01-01", includeNormals: true },
      },
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(pendingNormals).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it.each(failures("met-frost"))("maps %s on the observations", async (_label, error, expected) => {
    harness = await frostHarness({
      getObservations: vi.fn(() => Promise.reject(error)) as unknown as ReturnType<
        typeof observations
      >,
    });
    expect(
      await harness.callErr(TOOL, { stationId: "SN18700", startDate: "2026-01-01" }),
    ).toMatchObject(expected);
  });

  it("refuses to run without a Frost client ID, naming the variable exactly", async () => {
    const search = stations();
    harness = await createHarness({
      sdk: createFakeSdk({ climate: { searchStations: search } }),
      config: { metFrostClientId: undefined },
    });

    const error = await harness.callErr(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    expect(error).toMatchObject({
      code: "missing_configuration",
      requiredConfiguration: ["NORWAY_MCP_MET_FROST_CLIENT_ID"],
    });
    expect(error.message).not.toContain('credentials["met-frost"]');
    expect(search).not.toHaveBeenCalled();
  });

  it("names the variable, not the SDK's credential path, when Frost rejects the ID", async () => {
    harness = await frostHarness({
      searchStations: vi.fn(() =>
        Promise.reject(
          sdkError(
            "ConfigurationError",
            'credentials["met-frost"].clientId must be a Frost client ID: printable ASCII without a colon.',
            { provider: "met-frost" },
          ),
        ),
      ) as unknown as ReturnType<typeof stations>,
    });

    const error = await harness.callErr(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    expect(error).toMatchObject({
      code: "missing_configuration",
      requiredConfiguration: ["NORWAY_MCP_MET_FROST_CLIENT_ID"],
    });
    expect(error.message).not.toContain("credentials[");
  });

  it("never echoes the Frost client ID or a Basic credential from a provider error", async () => {
    const clientId = "frost-secret-client-id";
    const basic = Buffer.from(`${clientId}:`).toString("base64");
    harness = await createHarness({
      sdk: createFakeSdk({
        climate: {
          searchStations: stations(),
          getObservations: () =>
            Promise.reject(
              sdkError(
                "ProviderError",
                `Frost refused client ${clientId}; request had Authorization: Basic ${basic}`,
                { provider: "met-frost", statusCode: 401 },
              ),
            ),
        },
      }),
      config: { metFrostClientId: clientId },
    });

    const result = await harness.call(TOOL, { stationId: "SN18700", startDate: "2026-01-01" });

    expect(result.isError).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(clientId);
    expect(serialized).not.toContain(basic);
    expect(serialized).toContain("[redacted]");
  });

  it("credits MET Norway Frost once, exactly as the SDK registry declares it", async () => {
    harness = await frostHarness();

    const envelope = await harness.callOk(TOOL, {
      stationId: "SN18700",
      startDate: "2026-01-01",
      includeNormals: true,
    });

    expect(envelope.sources).toEqual([registrySource("met-frost")]);
  });

  it("renders deterministic, bounded text with the station and every value", async () => {
    harness = await frostHarness();

    const args = {
      latitude: 59.91,
      longitude: 10.75,
      startDate: "2026-01-01",
      endDate: "2026-01-03",
    };
    const first = await harness.callOk(TOOL, args);
    const second = await harness.callOk(TOOL, args);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(first.text).toContain("Weather history at OSLO - BLINDERN (SN18700)");
    expect(first.text).toContain("Distance from the point (km): 3.4");
    expect(first.text).toContain("Window (UTC days): 2026-01-01 to 2026-01-03");
    expect(first.text).toContain(
      "- 2026-01-01T00:00:00.000Z: mean_air_temperature -4.1 degC; precipitation 1.4 mm",
    );
  });

  it("renders a sparse station and observation without inventing anything", async () => {
    harness = await frostHarness({
      searchStations: stations([
        { id: "SN99370", name: "SVALBARD LUFTHAVN", externalIds: [], icaoCodes: [] },
      ]),
      getObservations: observations([
        {
          stationId: "SN99370:0",
          referenceTime: "2026-01-01T00:00:00.000Z",
          observations: [{ elementId: "unlisted_element", value: "2026-01-01T06:00:00Z" }],
        },
      ]),
    });

    const envelope = await harness.callOk(TOOL, { stationId: "SN99370", startDate: "2026-01-01" });

    expect(envelope.data["station"]).toEqual({ id: "SN99370", name: "SVALBARD LUFTHAVN" });
    // An element this server does not name keeps Frost's ID, and a time value stays a string.
    expect(envelope.text).toContain("unlisted_element 2026-01-01T06:00:00Z");
    expect(envelope.text).toContain("Window (UTC days): 2026-01-01\n");
    expect(envelope.text).not.toContain("undefined");
    expect(dataSchemaOf(TOOL).safeParse(envelope.data).success).toBe(true);
  });
});
