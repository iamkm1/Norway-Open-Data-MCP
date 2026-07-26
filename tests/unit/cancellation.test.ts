/**
 * Systematic cancellation audit.
 *
 * Rather than trusting that each tool remembered to forward `{ signal }`, this
 * drives **every** tool through the real MCP path with an SDK fake that records
 * the options it received, and asserts the caller's `AbortSignal` arrived.
 *
 * A new tool that forgets to propagate cancellation fails here automatically,
 * because the tool list is read from the registry rather than hard-coded.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AisPosition } from "norway-open-data-sdk";

import { createHarness, type Harness } from "../helpers/harness.js";
import { allTools } from "../../src/tools/registry.js";
import { SOURCES, createFakeSdk, respond, sampleStops } from "../../src/testing/fake-sdk.js";
import type { NorwayOpenDataLike } from "../../src/tools/types.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Minimal valid arguments for each tool. */
const ARGUMENTS: Record<string, Record<string, unknown>> = {
  search_norwegian_companies: { name: "Equinor" },
  get_norwegian_company_profile: { organizationNumber: "923609016" },
  search_norwegian_addresses: { query: "Storgata 1" },
  get_norwegian_location_profile: { query: "Storgata 1" },
  get_norwegian_municipality_profile: { query: "0301" },
  get_norwegian_weather_forecast: { latitude: 59.9, longitude: 10.7 },
  get_current_norwegian_hazards: { types: ["flood"] },
  get_norwegian_electricity_prices: { area: "NO1" },
  get_norwegian_transport_departures: { stopPlaceId: "NSR:StopPlace:1" },
  query_norwegian_statistics: { tableId: "07459" },
  resolve_norwegian_administrative_code: {
    kind: "municipality",
    code: "0301",
    targetDate: "2024-01-01",
  },
  search_norwegian_classification_codes: {
    classificationId: 131,
    codePattern: "0301",
    date: "2024-01-01",
  },
  get_vessel_profile: { mmsi: "257123456" },
  get_vessel_track: { mmsi: "257123456" },
  get_live_vessel_positions: {
    boundingBox: { south: 63.3, west: 10.2, north: 63.6, east: 10.7 },
    limit: 10,
    // Comfortably longer than the test's own abort, so the timeout can never be
    // what ends the sample here.
    timeoutMs: 10_000,
  },
  search_fishing_vessels: { query: "Havstraum" },
  get_fishing_vessel: { radioCallSign: "LDMV" },
  search_aquaculture_locations: { municipalityCode: "5055" },
  get_aquaculture_location: { siteNumber: "10318" },
  get_marine_forecast: { latitude: 63.74, longitude: 9.22 },
  search_geonorge_datasets: { query: "naturvern" },
  get_geonorge_metadata: { id: "dd9d5e94-5b3d-4e46-9b3c-000000000001" },
  get_protected_areas_at: { latitude: 61.1, longitude: 8.1 },
  search_protected_areas: {
    boundingBox: { south: 61.0, west: 8.0, north: 61.2, east: 8.4 },
  },
  get_nature_types_at: { latitude: 61.1, longitude: 8.1 },
  get_intervention_free_nature_at: { latitude: 61.1, longitude: 8.1 },
  get_land_resources_at: { latitude: 61.1, longitude: 8.1 },
  get_nature_profile: { latitude: 61.1, longitude: 8.1 },
};

/** Credentials the maritime tools are gated on; values are never sent anywhere. */
const MARITIME_CONFIG = {
  barentswatchClientId: "test-client-id",
  barentswatchClientSecret: "test-client-secret",
  barentswatchAisClientId: "test-ais-client-id",
  barentswatchAisClientSecret: "test-ais-client-secret",
} as const;

/**
 * An SDK whose every method hangs until its signal aborts, recording the
 * signals it was handed.
 */
function createSignalRecordingSdk(seen: AbortSignal[]): NorwayOpenDataLike {
  const hang = (...args: unknown[]): Promise<never> => {
    const options = args.at(-1) as { signal?: AbortSignal } | undefined;
    if (options?.signal) seen.push(options.signal);
    return new Promise<never>((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => {
          const error = new Error("Request aborted.");
          error.name = "ProviderError";
          reject(error);
        },
        { once: true },
      );
    });
  };

  return createFakeSdk({
    companies: { search: hang },
    profiles: {
      company: hang,
      address: hang,
      municipality: hang,
      vessel: hang,
      natureAtLocation: hang,
    },
    addresses: { search: hang },
    weather: { forecast: hang },
    hazards: {
      getFloodWarnings: hang,
      getAvalancheWarnings: hang,
      getLandslideWarnings: hang,
    },
    electricity: { getPrices: hang, getCurrentPrice: hang },
    // Autocomplete resolves so the departures tool reaches its second SDK call.
    transport: {
      autocomplete: () => Promise.resolve(respond(sampleStops, SOURCES["entur"]!)),
      departures: hang,
    },
    statistics: { getTableMetadata: hang, query: hang },
    klass: {
      resolveMunicipalityCode: hang,
      resolveCountyCode: hang,
      searchCodes: hang,
      getCode: hang,
    },
    ais: {
      getTrackLast24Hours: hang,
      getTrack: hang,
      // A stream is not a promise, so it cannot "hang" the same way. It records
      // the signal it was handed and then waits for that signal to abort, which
      // is exactly the contract under test.
      streamPositions: (parameters) => {
        if (parameters?.signal) seen.push(parameters.signal);
        // Written as a manual iterator rather than an async generator: it never
        // yields, and a generator with no `yield` is a code smell the linter is
        // right to reject.
        return {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              new Promise<IteratorResult<AisPosition>>((resolve) => {
                const done = (): void => resolve({ value: undefined, done: true });
                if (parameters?.signal?.aborted === true) {
                  done();
                  return;
                }
                parameters?.signal?.addEventListener("abort", done, { once: true });
              }),
          }),
        };
      },
    },
    marine: { getWaveForecast: hang, getSeaCurrent: hang },
    fisheries: {
      searchVessels: hang,
      getVessel: hang,
      searchAquacultureSites: hang,
      getAquacultureSite: hang,
    },
    geodata: { searchDatasets: hang, getMetadata: hang },
    environment: {
      getProtectedAreasAt: hang,
      searchProtectedAreas: hang,
      getProposedProtectedAreasAt: hang,
      getNatureTypesAt: hang,
      getInterventionFreeAreasAt: hang,
    },
    land: { getLandResourcesAt: hang },
  });
}

describe("every tool propagates the caller's abort signal into the SDK", () => {
  for (const tool of allTools) {
    it(`${tool.name} forwards the signal and aborts on cancellation`, async () => {
      const seen: AbortSignal[] = [];
      harness = await createHarness({
        sdk: createSignalRecordingSdk(seen),
        config: { ...MARITIME_CONFIG },
      });

      const controller = new AbortController();
      const pending = harness.client.callTool(
        { name: tool.name, arguments: ARGUMENTS[tool.name]! },
        undefined,
        { signal: controller.signal },
      );

      // The SDK method must have been reached and handed a live signal.
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen[0]!.aborted, `${tool.name} received an already-aborted signal`).toBe(false);

      controller.abort();

      await expect(pending).rejects.toThrow();
      // The abort must have reached the in-flight SDK call, not just the client.
      expect(seen[0]!.aborted, `${tool.name} did not propagate the abort`).toBe(true);
    });
  }

  it("does not share one caller's signal with an unrelated call", async () => {
    const seen: AbortSignal[] = [];
    harness = await createHarness({
      sdk: createSignalRecordingSdk(seen),
      config: { ...MARITIME_CONFIG },
    });

    const first = new AbortController();
    const second = new AbortController();

    const a = harness.client.callTool(
      { name: "search_norwegian_companies", arguments: { name: "Equinor" } },
      undefined,
      { signal: first.signal },
    );
    const b = harness.client.callTool(
      { name: "search_norwegian_addresses", arguments: { query: "Storgata 1" } },
      undefined,
      { signal: second.signal },
    );

    await vi.waitFor(() => expect(seen.length).toBe(2));
    expect(seen[0]).not.toBe(seen[1]);

    first.abort();
    await expect(a).rejects.toThrow();

    // Cancelling one request must leave the other untouched.
    expect(seen[1]!.aborted).toBe(false);

    second.abort();
    await expect(b).rejects.toThrow();
  });

  it("reports cancellation as cancelled, never as a provider failure", async () => {
    const seen: AbortSignal[] = [];
    harness = await createHarness({
      sdk: createSignalRecordingSdk(seen),
      config: { ...MARITIME_CONFIG },
    });

    // Calling the handler directly, since an aborted client request never
    // returns a result to inspect.
    const controller = new AbortController();
    const definition = allTools.find((tool) => tool.name === "search_norwegian_companies")!;

    const invocation = {
      signal: controller.signal,
      context: {
        getSdk: () => createSignalRecordingSdk(seen),
        config: {
          applicationName: "test",
          timeoutMs: 10_000,
          retries: 0,
          cacheEnabled: false,
          debug: false,
        },
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        redactor: { text: (value: string) => value, value: <T>(value: T) => value },
        now: () => new Date(),
      },
    };

    const pending = definition.handler(
      { name: "Equinor", limit: 10, page: 0 },
      invocation as never,
    );
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    controller.abort();

    // The SDK surfaces an abort as ProviderError; the mapper must reclassify it
    // using the signal. That behaviour is asserted in errors.test.ts; here we
    // only confirm the handler rejects rather than resolving with junk.
    await expect(pending).rejects.toThrow();
  });
});
