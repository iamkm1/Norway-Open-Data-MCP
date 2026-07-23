import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  createFakeSdk,
  respond,
  sampleAddressSearch,
  sampleDepartures,
  sampleStatisticsResult,
  sampleStops,
  sampleTableMetadata,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("search_norwegian_addresses", () => {
  const search = () => Promise.resolve(respond(sampleAddressSearch, SOURCES["kartverket"]!));

  it("returns candidate addresses with coordinates and Kartverket attribution", async () => {
    harness = await createHarness({ sdk: createFakeSdk({ addresses: { search } }) });

    const envelope = await harness.callOk("search_norwegian_addresses", {
      query: "Karl Johans gate 1",
    });

    expect(envelope.data["addresses"]).toEqual([
      expect.objectContaining({ postalCode: "0154", latitude: 59.9098 }),
    ]);
    expect(envelope.sources[0]).toMatchObject({
      id: "kartverket",
      attribution: expect.stringContaining("Attribute Kartverket"),
    });
  });

  it("warns that a county filter is applied locally to one page", async () => {
    harness = await createHarness({ sdk: createFakeSdk({ addresses: { search } }) });

    const envelope = await harness.callOk("search_norwegian_addresses", {
      query: "Storgata",
      countyCode: "03",
    });

    expect(envelope.warnings.join(" ")).toContain("no county filter");
  });

  it("returns an empty list without inventing a warning", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        addresses: {
          search: () => Promise.resolve(respond({ items: [], total: 0 }, SOURCES["kartverket"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("search_norwegian_addresses", { query: "zzzz" });

    expect(envelope.data["addresses"]).toEqual([]);
    expect(envelope.warnings).toEqual([]);
    expect(envelope.text).toContain("No addresses matched");
  });

  it("truncates a large page to the requested limit", async () => {
    const many = {
      items: Array.from({ length: 80 }, (_unused, index) => ({
        ...sampleAddressSearch.items[0]!,
        addressText: `Storgata ${index}`,
      })),
      total: 900,
    };
    harness = await createHarness({
      sdk: createFakeSdk({
        addresses: { search: () => Promise.resolve(respond(many, SOURCES["kartverket"]!)) },
      }),
    });

    const envelope = await harness.callOk("search_norwegian_addresses", {
      query: "Storgata",
      limit: 25,
    });

    expect(envelope.data["addresses"]).toHaveLength(25);
    expect(envelope.truncation!.fields[0]).toMatchObject({ availableUpstream: 900 });
  });

  it.each([
    ["a blank query", { query: "   " }],
    ["a one-character query", { query: "a" }],
    ["an over-long query", { query: "x".repeat(201) }],
    ["a bad postal code", { query: "Storgata", postalCode: "12" }],
    ["a bad county code", { query: "Storgata", countyCode: "123" }],
    ["a limit above the maximum", { query: "Storgata", limit: 51 }],
    ["an unknown property", { query: "Storgata", extra: 1 }],
  ])("rejects %s", async (_label, args) => {
    harness = await createHarness({ sdk: createFakeSdk({ addresses: { search } }) });
    const call = await harness.call("search_norwegian_addresses", args);
    expect(call.isError).toBe(true);
  });
});

describe("get_norwegian_transport_departures", () => {
  function transportSdk(overrides: Record<string, unknown> = {}) {
    return createFakeSdk({
      transport: {
        autocomplete: () => Promise.resolve(respond(sampleStops, SOURCES["entur"]!)),
        departures: () => Promise.resolve(respond(sampleDepartures, SOURCES["entur"]!)),
        ...overrides,
      },
    });
  }

  it("resolves a stop name to a stop place and reports alternatives", async () => {
    const departures = vi.fn(() => Promise.resolve(respond(sampleDepartures, SOURCES["entur"]!)));
    harness = await createHarness({ sdk: transportSdk({ departures }) });

    const envelope = await harness.callOk("get_norwegian_transport_departures", {
      stopName: "Majorstuen",
    });

    expect(envelope.data["resolvedStop"]).toMatchObject({ id: "NSR:StopPlace:58366" });
    // The non-stop-place geocoder hit must not be offered as an alternative.
    expect(envelope.data["alternatives"]).toEqual([
      { id: "NSR:StopPlace:58367", name: "Majorstuen T" },
    ]);
    expect(departures).toHaveBeenCalledWith(
      expect.objectContaining({ stopPlaceId: "NSR:StopPlace:58366" }),
      expect.anything(),
    );
    expect(envelope.warnings.join(" ")).toContain("more than one stop place");
  });

  it("skips resolution when a stop place ID is supplied", async () => {
    const autocomplete = vi.fn(() => Promise.resolve(respond(sampleStops, SOURCES["entur"]!)));
    harness = await createHarness({ sdk: transportSdk({ autocomplete }) });

    const envelope = await harness.callOk("get_norwegian_transport_departures", {
      stopPlaceId: "NSR:StopPlace:58366",
    });

    expect(autocomplete).not.toHaveBeenCalled();
    expect(envelope.data["usedStopNameResolution"]).toBe(false);
  });

  it("reports a name that matches no stop place as not found", async () => {
    harness = await createHarness({
      sdk: transportSdk({
        // Only a non-stop-place result comes back.
        autocomplete: () =>
          Promise.resolve(respond([{ id: "NSR:Address:9", name: "Nowhere" }], SOURCES["entur"]!)),
      }),
    });

    const error = await harness.callErr("get_norwegian_transport_departures", {
      stopName: "Nowhere at all",
    });

    expect(error.code).toBe("not_found");
    expect(error.provider).toBe("entur");
  });

  it("treats a stop with no departures as an empty result, not an error", async () => {
    harness = await createHarness({
      sdk: transportSdk({ departures: () => Promise.resolve(respond([], SOURCES["entur"]!)) }),
    });

    const envelope = await harness.callOk("get_norwegian_transport_departures", {
      stopPlaceId: "NSR:StopPlace:58366",
    });

    expect(envelope.data["departures"]).toEqual([]);
    expect(envelope.text).toContain("No upcoming departures");
  });

  it.each([
    ["neither stopName nor stopPlaceId", {}],
    ["both stopName and stopPlaceId", { stopName: "Majorstuen", stopPlaceId: "NSR:StopPlace:1" }],
    ["a malformed stop place ID", { stopPlaceId: "58366" }],
    ["a blank stop name", { stopName: "  " }],
    ["an invalid dateTime", { stopPlaceId: "NSR:StopPlace:1", dateTime: "not-a-date" }],
    ["a limit above the maximum", { stopPlaceId: "NSR:StopPlace:1", limit: 51 }],
  ])("rejects %s", async (_label, args) => {
    harness = await createHarness({ sdk: transportSdk() });
    const call = await harness.call("get_norwegian_transport_departures", args);
    expect(call.isError).toBe(true);
    expect(errorText(call).length).toBeGreaterThan(0);
  });
});

describe("query_norwegian_statistics", () => {
  function statisticsSdk(overrides: Record<string, unknown> = {}) {
    return createFakeSdk({
      statistics: {
        getTableMetadata: () => Promise.resolve(respond(sampleTableMetadata, SOURCES["ssb"]!)),
        query: () => Promise.resolve(respond(sampleStatisticsResult, SOURCES["ssb"]!)),
        ...overrides,
      },
    });
  }

  it("returns dimensions and instructions when called without selections", async () => {
    const query = vi.fn(() => Promise.resolve(respond(sampleStatisticsResult, SOURCES["ssb"]!)));
    harness = await createHarness({ sdk: statisticsSdk({ query }) });

    const envelope = await harness.callOk("query_norwegian_statistics", { tableId: "07459" });

    expect(envelope.data["mode"]).toBe("metadata");
    expect(envelope.data["rows"]).toEqual([]);
    expect(envelope.data["dimensions"]).toHaveLength(2);
    // Discovery must cost exactly one provider call.
    expect(query).not.toHaveBeenCalled();
    expect(envelope.warnings.join(" ")).toContain("Call this tool again with `selections`");
  });

  it("returns rows when called with selections", async () => {
    const getTableMetadata = vi.fn(() =>
      Promise.resolve(respond(sampleTableMetadata, SOURCES["ssb"]!)),
    );
    harness = await createHarness({ sdk: statisticsSdk({ getTableMetadata }) });

    const envelope = await harness.callOk("query_norwegian_statistics", {
      tableId: "07459",
      selections: { Region: ["0301", "5401"], Tid: ["2025"] },
    });

    expect(envelope.data["mode"]).toBe("data");
    expect(envelope.data["rows"]).toHaveLength(2);
    expect(envelope.data["rowCount"]).toBe(2);
    // The data path must not also fetch metadata against SSB's tight budget.
    expect(getTableMetadata).not.toHaveBeenCalled();
  });

  it("truncates rows to the requested limit and reports it", async () => {
    const many = {
      ...sampleStatisticsResult,
      rows: Array.from({ length: 300 }, (_unused, index) => ({
        Region: String(index),
        Tid: "2025",
        value: index,
      })),
    };
    harness = await createHarness({
      sdk: statisticsSdk({ query: () => Promise.resolve(respond(many, SOURCES["ssb"]!)) }),
    });

    const envelope = await harness.callOk("query_norwegian_statistics", {
      tableId: "07459",
      selections: { Region: ["*"] },
      limit: 50,
    });

    expect(envelope.data["rows"]).toHaveLength(50);
    expect(envelope.truncation!.fields.some((field) => field.field === "rows")).toBe(true);
  });

  it("maps an invalid dimension code to a correctable input error", async () => {
    harness = await createHarness({
      sdk: statisticsSdk({
        query: () =>
          Promise.reject(
            sdkError("InputValidationError", "Unknown value code for dimension Region.", {
              provider: "ssb",
              cause: { issues: [{ path: ["selections", "Region"], message: "Unknown code 9999" }] },
            }),
          ),
      }),
    });

    const error = await harness.callErr("query_norwegian_statistics", {
      tableId: "07459",
      selections: { Region: ["9999"] },
    });

    expect(error.code).toBe("invalid_input");
    expect(error.retryable).toBe(false);
    expect(error.fields).toEqual([{ path: "selections.Region", message: "Unknown code 9999" }]);
  });

  it("reports an unknown table as not found", async () => {
    harness = await createHarness({
      sdk: statisticsSdk({
        getTableMetadata: () =>
          Promise.reject(
            sdkError("NotFoundError", "Table 99999 was not found.", {
              provider: "ssb",
              statusCode: 404,
            }),
          ),
      }),
    });

    const error = await harness.callErr("query_norwegian_statistics", { tableId: "99999" });
    expect(error.code).toBe("not_found");
  });

  it.each([
    ["a blank table id", { tableId: "  " }],
    ["a too-short table id", { tableId: "abc" }],
    ["a table id with punctuation", { tableId: "07459!" }],
    ["an empty value array", { tableId: "07459", selections: { Region: [] } }],
    ["too many value codes", { tableId: "07459", selections: { Region: Array(51).fill("x") } }],
    ["a non-array selection value", { tableId: "07459", selections: { Region: "0301" } }],
    ["a limit above the maximum", { tableId: "07459", limit: 501 }],
    ["an unsupported language", { tableId: "07459", language: "fr" }],
  ])("rejects %s", async (_label, args) => {
    harness = await createHarness({ sdk: statisticsSdk() });
    const call = await harness.call("query_norwegian_statistics", args);
    expect(call.isError).toBe(true);
  });
});
