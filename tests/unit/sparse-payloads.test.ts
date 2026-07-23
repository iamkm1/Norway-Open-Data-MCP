/**
 * Sparse-payload behaviour.
 *
 * Almost every field the SDK returns is optional, and real providers routinely
 * omit them. Each tool therefore has to survive a payload carrying only the
 * required fields, without emitting `undefined` into structured output (which
 * would fail output-schema validation) or `"undefined"` into the text form.
 *
 * These are the cases the sample fixtures — which are deliberately rich — do
 * not reach.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../helpers/harness.js";
import { SOURCES, createFakeSdk, respond } from "../../src/testing/fake-sdk.js";
import { TruncationTracker, enforceSerializedBudget } from "../../src/limits/budget.js";
import { ResultTooLargeError } from "../../src/errors/map.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/**
 * Guards against `undefined` leaking into rendered output.
 *
 * `null` is *not* a leak: the envelope schema uses it deliberately to mean
 * "this section is absent" (`location: null`, `weather: null`). What must never
 * appear is the string "undefined" in prose, or "[object Object]" from a value
 * that was stringified without being projected first.
 */
function expectNoUndefinedLeakage(envelope: { text: string; data: Record<string, unknown> }): void {
  expect(envelope.text).not.toContain("undefined");
  expect(envelope.text).not.toContain("[object Object]");
  expect(JSON.stringify(envelope.data)).not.toContain('"undefined"');
}

describe("tools tolerate minimal provider payloads", () => {
  it("search_norwegian_companies with only the required company fields", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        companies: {
          search: () =>
            Promise.resolve(
              respond(
                {
                  items: [{ organizationNumber: "999999999", name: "MINIMAL AS" }],
                  pagination: { page: 0, size: 10, totalItems: 1, totalPages: 1 },
                },
                SOURCES["brreg"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_norwegian_companies", { name: "Minimal" });

    expect(envelope.data["companies"]).toEqual([
      { organizationNumber: "999999999", name: "MINIMAL AS" },
    ]);
    expectNoUndefinedLeakage(envelope);
  });

  it("get_norwegian_company_profile with no location and no components", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          company: () =>
            Promise.resolve(
              respond(
                { company: { organizationNumber: "999999999", name: "MINIMAL AS" } },
                SOURCES["brreg"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_company_profile", {
      organizationNumber: "999999999",
    });

    expect(envelope.data["location"]).toBeNull();
    expect(envelope.data["components"]).toEqual([]);
    expect(envelope.partial).toBeNull();
    expectNoUndefinedLeakage(envelope);
  });

  it("search_norwegian_addresses with an address carrying no coordinate", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        addresses: {
          search: () =>
            Promise.resolve(
              respond({ items: [{ addressText: "Ukjent vei 1" }] }, SOURCES["kartverket"]!),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_norwegian_addresses", { query: "Ukjent vei 1" });

    expect(envelope.data["addresses"]).toEqual([{ addressText: "Ukjent vei 1" }]);
    expect(envelope.data["totalAvailable"]).toBeUndefined();
    expectNoUndefinedLeakage(envelope);
  });

  it("get_norwegian_location_profile with no weather, roads or matches", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () =>
            Promise.resolve(
              respond(
                { address: { addressText: "Ukjent vei 1" }, hazards: [] },
                SOURCES["kartverket"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Ukjent vei 1",
    });

    expect(envelope.data["weather"]).toBeNull();
    expect(envelope.data["roads"]).toEqual([]);
    expect(envelope.data["roadSearch"]).toBeNull();
    expect(envelope.data["hazardMatchEvidence"]).toEqual([]);
    expectNoUndefinedLeakage(envelope);
  });

  it("get_norwegian_municipality_profile with every optional section absent", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          municipality: () =>
            Promise.resolve(
              respond(
                {
                  municipality: { code: "9999", name: "Ukjent", countyCode: "99" },
                  hazards: [],
                },
                SOURCES["ssb"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_municipality_profile", { query: "9999" });

    expect(envelope.data["population"]).toBeNull();
    expect(envelope.data["lifeExpectancy"]).toBeNull();
    expect(envelope.data["registeredCompanies"]).toBeNull();
    expectNoUndefinedLeakage(envelope);
  });

  it("get_norwegian_weather_forecast with entries carrying only a timestamp", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        weather: {
          forecast: () =>
            Promise.resolve(
              respond(
                {
                  coordinates: { latitude: 59.9, longitude: 10.7 },
                  timeseries: [{ time: "2026-07-23T12:00:00Z" }],
                },
                SOURCES["met"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_weather_forecast", {
      latitude: 59.9,
      longitude: 10.7,
    });

    expect(envelope.data["timeseries"]).toEqual([{ time: "2026-07-23T12:00:00Z" }]);
    expect(envelope.data["updatedAt"]).toBeUndefined();
    expectNoUndefinedLeakage(envelope);
  });

  it("get_current_norwegian_hazards with a warning carrying only a type", async () => {
    const bare = () => Promise.resolve(respond([{ type: "flood" as const }], SOURCES["nve"]!));
    harness = await createHarness({
      sdk: createFakeSdk({
        hazards: {
          getFloodWarnings: bare,
          getAvalancheWarnings: () => Promise.resolve(respond([], SOURCES["nve"]!)),
          getLandslideWarnings: () => Promise.resolve(respond([], SOURCES["nve"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_current_norwegian_hazards", {});

    expect(envelope.data["warnings"]).toEqual([{ type: "flood" }]);
    expect(envelope.text).toContain("(no title)");
    expect(envelope.text).not.toContain("undefined");
  });

  it("get_norwegian_transport_departures with a departure carrying no line or realtime flag", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        transport: {
          autocomplete: () => Promise.resolve(respond([], SOURCES["entur"]!)),
          departures: () =>
            Promise.resolve(
              respond([{ aimedDepartureTime: "2026-07-23T12:05:00+02:00" }], SOURCES["entur"]!),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_transport_departures", {
      stopPlaceId: "NSR:StopPlace:1",
    });

    expect(envelope.data["departures"]).toEqual([
      { aimedDepartureTime: "2026-07-23T12:05:00+02:00" },
    ]);
    expect(envelope.data["resolvedStop"]).toEqual({ id: "NSR:StopPlace:1" });
    expect(envelope.text).not.toContain("undefined");
  });

  it("query_norwegian_statistics with an unlabelled dimension and no rows", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        statistics: {
          getTableMetadata: () =>
            Promise.resolve(respond({ tableId: "07459", dimensions: [] }, SOURCES["ssb"]!)),
          query: () =>
            Promise.resolve(
              respond(
                {
                  tableId: "07459",
                  dimensions: [{ code: "Region", values: [{ code: "0301" }] }],
                  rows: [],
                },
                SOURCES["ssb"]!,
              ),
            ),
        },
      }),
    });

    const metadata = await harness.callOk("query_norwegian_statistics", { tableId: "07459" });
    expect(metadata.data["dimensions"]).toEqual([]);
    expect(metadata.data["title"]).toBeUndefined();

    const data = await harness.callOk("query_norwegian_statistics", {
      tableId: "07459",
      selections: { Region: ["0301"] },
    });
    expect(data.data["rows"]).toEqual([]);
    expect(data.text).toContain("no observations");
  });

  it("get_norwegian_electricity_prices with a single published hour", async () => {
    const single = [
      {
        area: "NO1" as const,
        startsAt: "2026-07-23T00:00:00+02:00",
        endsAt: "2026-07-23T01:00:00+02:00",
        nokPerKwh: 0.5,
        eurPerKwh: 0.04,
        exchangeRate: 11.5,
      },
    ];
    harness = await createHarness({
      sdk: createFakeSdk({
        electricity: {
          getPrices: () => Promise.resolve(respond(single, SOURCES["hvakosterstrommen"]!)),
          // The provider returns undefined outside the published day.
          getCurrentPrice: () => Promise.resolve(respond(undefined, SOURCES["hvakosterstrommen"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO1" });

    expect(envelope.data["currentPrice"]).toBeNull();
    expect(envelope.data["summary"]).toMatchObject({ minNokPerKwh: 0.5, maxNokPerKwh: 0.5 });
    expect(envelope.warnings.join(" ")).toContain("1 hourly intervals");
  });

  it("get_norwegian_electricity_prices with no published prices at all", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        electricity: {
          getPrices: () => Promise.resolve(respond([], SOURCES["hvakosterstrommen"]!)),
          getCurrentPrice: () => Promise.resolve(respond(undefined, SOURCES["hvakosterstrommen"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_electricity_prices", { area: "NO2" });

    expect(envelope.data["prices"]).toEqual([]);
    expect(envelope.data["summary"]).toBeNull();
    expect(envelope.text).toContain("No published prices");
  });
});

describe("budget guard edge cases", () => {
  it("records an externally supplied truncation entry", () => {
    const tracker = new TruncationTracker();
    tracker.record({ field: "items", returned: 5, reason: "budget" });

    expect(tracker.report()).toEqual({
      truncated: true,
      fields: [{ field: "items", returned: 5, reason: "budget" }],
    });
    expect(tracker.warnings()[0]).toContain("output budget");
  });

  it("honours a custom string clamp limit", () => {
    const tracker = new TruncationTracker();
    expect(tracker.clampString("field", "abcdefghij", 5)).toBe("abcd…");
  });

  it("refuses to reduce a payload whose data is not an object", () => {
    expect(() => enforceSerializedBudget({ data: "x".repeat(200) }, () => {}, 50)).toThrow(
      ResultTooLargeError,
    );
  });

  it("treats a zero limit as returning nothing rather than everything", () => {
    const tracker = new TruncationTracker();
    expect(tracker.limitArray("items", [1, 2, 3], 0)).toEqual([]);
  });
});
