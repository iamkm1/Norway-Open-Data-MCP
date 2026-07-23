import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  createFakeSdk,
  respond,
  sampleForecast,
  sampleHazard,
  samplePrices,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("get_norwegian_weather_forecast", () => {
  const forecast = () => Promise.resolve(respond(sampleForecast, SOURCES["met"]!));

  it("returns a bounded time series with the default of 24 hours", async () => {
    harness = await createHarness({ sdk: createFakeSdk({ weather: { forecast } }) });

    const envelope = await harness.callOk("get_norwegian_weather_forecast", {
      latitude: 59.9098,
      longitude: 10.7469,
    });

    expect(envelope.data["timeseries"]).toHaveLength(24);
    expect(envelope.data["hoursAvailable"]).toBe(60);
    expect(envelope.truncation!.truncated).toBe(true);
    expect(envelope.warnings.join(" ")).toContain("no service-level guarantee");
  });

  it("honours the maximum of 96 hours without exceeding what is available", async () => {
    harness = await createHarness({ sdk: createFakeSdk({ weather: { forecast } }) });

    const envelope = await harness.callOk("get_norwegian_weather_forecast", {
      latitude: 59.9098,
      longitude: 10.7469,
      hours: 96,
    });

    expect(envelope.data["timeseries"]).toHaveLength(60);
    expect(envelope.truncation).toBeNull();
  });

  it("fails with a configuration error naming the exact variable when unconfigured", async () => {
    const spy = vi.fn(forecast);
    harness = await createHarness({
      sdk: createFakeSdk({ weather: { forecast: spy } }),
      config: { contactEmail: undefined },
    });

    const error = await harness.callErr("get_norwegian_weather_forecast", {
      latitude: 59.9,
      longitude: 10.75,
    });

    expect(error).toMatchObject({
      code: "missing_configuration",
      retryable: false,
      requiredConfiguration: ["NORWAY_MCP_CONTACT_EMAIL"],
    });
    // The provider must never be contacted without the identity it requires.
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps other tools working when the weather tool is unconfigured", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        weather: { forecast },
        electricity: {
          getPrices: () => Promise.resolve(respond(samplePrices, SOURCES["hvakosterstrommen"]!)),
          getCurrentPrice: () =>
            Promise.resolve(respond(samplePrices[0], SOURCES["hvakosterstrommen"]!)),
        },
      }),
      config: { contactEmail: undefined },
    });

    await harness.callErr("get_norwegian_weather_forecast", { latitude: 59.9, longitude: 10.75 });
    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO1" });

    expect(envelope.data["prices"]).toHaveLength(24);
  });

  it.each([
    ["latitude above range", { latitude: 91, longitude: 10 }],
    ["latitude below range", { latitude: -91, longitude: 10 }],
    ["longitude above range", { latitude: 59, longitude: 181 }],
    ["NaN latitude", { latitude: Number.NaN, longitude: 10 }],
    ["missing longitude", { latitude: 59 }],
    ["hours zero", { latitude: 59, longitude: 10, hours: 0 }],
    ["hours above maximum", { latitude: 59, longitude: 10, hours: 500 }],
    ["altitude out of range", { latitude: 59, longitude: 10, altitude: 100000 }],
    ["unknown property", { latitude: 59, longitude: 10, unexpected: true }],
  ])("rejects %s", async (_label, args) => {
    harness = await createHarness({ sdk: createFakeSdk({ weather: { forecast } }) });
    const call = await harness.call("get_norwegian_weather_forecast", args);
    expect(call.isError).toBe(true);
  });
});

describe("get_current_norwegian_hazards", () => {
  const feed =
    (warnings = [sampleHazard]) =>
    () =>
      Promise.resolve(respond(warnings, SOURCES["nve"]!));

  function hazardSdk(overrides: Record<string, unknown> = {}) {
    return createFakeSdk({
      hazards: {
        getFloodWarnings: feed(),
        getAvalancheWarnings: feed([]),
        getLandslideWarnings: feed([]),
        ...overrides,
      },
    });
  }

  it("queries all three feeds by default and defaults dates to today in Oslo", async () => {
    const flood = vi.fn(feed());
    harness = await createHarness({ sdk: hazardSdk({ getFloodWarnings: flood }) });

    const envelope = await harness.callOk("get_current_norwegian_hazards", {});

    expect(envelope.data["requestedTypes"]).toEqual(["flood", "avalanche", "landslide"]);
    expect(envelope.data["startDate"]).toBe("2026-07-23");
    expect(envelope.data["endDate"]).toBe("2026-07-23");
    expect(flood).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-07-23", endDate: "2026-07-23", language: "no" }),
      expect.anything(),
    );
  });

  it("returns a partial result when one feed fails but others succeed", async () => {
    harness = await createHarness({
      sdk: hazardSdk({
        getAvalancheWarnings: () =>
          Promise.reject(
            sdkError("ProviderError", "NVE 503", { provider: "nve", statusCode: 503 }),
          ),
      }),
    });

    const envelope = await harness.callOk("get_current_norwegian_hazards", {});

    expect(envelope.data["failedTypes"]).toEqual(["avalanche"]);
    expect(envelope.partial).toMatchObject({ complete: false, missing: ["avalanche"] });
    expect(envelope.warnings.join(" ")).toContain("not an all-clear for those types");
    // The flood warning still came through.
    expect(envelope.data["warnings"]).toHaveLength(1);
  });

  it("fails outright only when every feed fails", async () => {
    const reject = () =>
      Promise.reject(sdkError("ProviderError", "NVE down", { provider: "nve", statusCode: 503 }));
    harness = await createHarness({
      sdk: hazardSdk({
        getFloodWarnings: reject,
        getAvalancheWarnings: reject,
        getLandslideWarnings: reject,
      }),
    });

    const error = await harness.callErr("get_current_norwegian_hazards", {});

    expect(error.code).toBe("provider_error");
    expect(error.retryable).toBe(true);
  });

  it("only calls the requested feeds", async () => {
    const avalanche = vi.fn(feed([]));
    const flood = vi.fn(feed());
    harness = await createHarness({
      sdk: hazardSdk({ getAvalancheWarnings: avalanche, getFloodWarnings: flood }),
    });

    await harness.callOk("get_current_norwegian_hazards", { types: ["avalanche"] });

    expect(avalanche).toHaveBeenCalledOnce();
    expect(flood).not.toHaveBeenCalled();
  });

  it("always carries the non-all-clear notice, even with zero warnings", async () => {
    harness = await createHarness({
      sdk: hazardSdk({ getFloodWarnings: feed([]) }),
    });

    const envelope = await harness.callOk("get_current_norwegian_hazards", {});

    expect(envelope.data["warnings"]).toEqual([]);
    expect(envelope.warnings.join(" ")).toContain("never an all-clear");
  });

  it.each([
    ["a reversed date range", { startDate: "2026-07-20", endDate: "2026-07-10" }],
    ["a range longer than 14 days", { startDate: "2026-07-01", endDate: "2026-08-01" }],
    ["an impossible calendar date", { startDate: "2026-02-31" }],
    ["a malformed date", { startDate: "23-07-2026" }],
    ["an empty type list", { types: [] }],
    ["duplicate types", { types: ["flood", "flood"] }],
    ["an unsupported type", { types: ["earthquake"] }],
    ["an unsupported language", { language: "de" }],
    ["a limit above the maximum", { limit: 101 }],
  ])("rejects %s", async (_label, args) => {
    harness = await createHarness({ sdk: hazardSdk() });
    const call = await harness.call("get_current_norwegian_hazards", args);
    expect(call.isError).toBe(true);
    expect(errorText(call).length).toBeGreaterThan(0);
  });
});

describe("get_norwegian_electricity_prices", () => {
  function electricitySdk(overrides: Record<string, unknown> = {}) {
    return createFakeSdk({
      electricity: {
        getPrices: () => Promise.resolve(respond(samplePrices, SOURCES["hvakosterstrommen"]!)),
        getCurrentPrice: () =>
          Promise.resolve(respond(samplePrices[8], SOURCES["hvakosterstrommen"]!)),
        ...overrides,
      },
    });
  }

  it("returns a full day with a computed summary and the current hour", async () => {
    harness = await createHarness({ sdk: electricitySdk() });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO1" });

    expect(envelope.data["prices"]).toHaveLength(24);
    expect(envelope.data["summary"]).toMatchObject({
      minNokPerKwh: 0.4,
      maxNokPerKwh: 0.63,
      cheapestHour: expect.stringContaining("T00:00"),
    });
    expect(envelope.data["currentPrice"]).not.toBeNull();
    expect(envelope.data["date"]).toBe("2026-07-23");
  });

  it("states the third-party and excluded-cost caveats", async () => {
    harness = await createHarness({ sdk: electricitySdk() });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO1" });

    const joined = envelope.warnings.join(" ");
    expect(joined).toContain("exclude grid rent");
    expect(joined).toContain("not an official government");
  });

  it("normalises a lowercase area and rejects an unknown zone", async () => {
    harness = await createHarness({ sdk: electricitySdk() });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "no3" });
    expect(envelope.data["area"]).toBe("NO3");

    const bad = await harness.call("get_norwegian_electricity_prices", { area: "NO6" });
    expect(bad.isError).toBe(true);
  });

  it("does not request the current hour for a historical date", async () => {
    const current = vi.fn(() =>
      Promise.resolve(respond(samplePrices[0], SOURCES["hvakosterstrommen"]!)),
    );
    harness = await createHarness({ sdk: electricitySdk({ getCurrentPrice: current }) });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", {
      area: "NO1",
      date: "2026-07-01",
    });

    expect(current).not.toHaveBeenCalled();
    expect(envelope.data["currentPrice"]).toBeNull();
  });

  it("reports an unpublished day as not-found rather than as an empty result", async () => {
    harness = await createHarness({
      sdk: electricitySdk({
        getPrices: () =>
          Promise.reject(
            sdkError("NotFoundError", "Prices for 2026-07-24 are not published yet.", {
              provider: "hvakosterstrommen",
              statusCode: 404,
            }),
          ),
      }),
    });

    const error = await harness.callErr("get_norwegian_electricity_prices", {
      area: "NO1",
      date: "2026-07-24",
    });

    expect(error.code).toBe("not_found");
    expect(error.message).toContain("not published");
  });

  it("explains a 23- or 25-hour daylight-saving day", async () => {
    harness = await createHarness({
      sdk: electricitySdk({
        getPrices: () =>
          Promise.resolve(respond(samplePrices.slice(0, 23), SOURCES["hvakosterstrommen"]!)),
      }),
    });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO1" });

    expect(envelope.warnings.join(" ")).toContain("23 hourly intervals");
  });
});
