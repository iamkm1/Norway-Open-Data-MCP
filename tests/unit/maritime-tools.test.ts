/**
 * The maritime tool set: registration, SDK delegation, input validation,
 * credential gating, privacy and partial results.
 *
 * Every test drives the real MCP path through the harness, so input schema
 * validation, output schema validation and error mapping are exercised
 * alongside the handler. Nothing here touches the network: the SDK surface is a
 * fake returning the exact shapes `norway-open-data-sdk@0.7.0` declares.
 *
 * The bounded live-feed tool has its own file; see `live-vessel-positions.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, type Harness } from "../helpers/harness.js";
import { EXPECTED_TOOL_COUNT, allTools } from "../../src/tools/registry.js";
import {
  COMPOSITE_PROFILE_SOURCES,
  SOURCES,
  createFakeSdk,
  respond,
  sampleAisTrack,
  sampleAquacultureSearch,
  sampleAquacultureSite,
  sampleFishingVessel,
  sampleFishingVesselSearch,
  samplePartialVesselProfile,
  sampleSeaCurrent,
  sampleVesselProfile,
  sampleWaveForecast,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import type { ServerConfig } from "../../src/config/types.js";
import type { NorwayOpenDataLike as SdkSurface } from "../../src/tools/types.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

/** Both BarentsWatch credential scopes configured. Values are never sent anywhere. */
const MARITIME_CONFIG: Partial<ServerConfig> = {
  barentswatchClientId: "bw-api-client-id",
  barentswatchClientSecret: "bw-api-client-secret",
  barentswatchAisClientId: "bw-ais-client-id",
  barentswatchAisClientSecret: "bw-ais-client-secret",
};

const MARITIME_TOOLS = [
  "get_vessel_profile",
  "get_vessel_track",
  "search_fishing_vessels",
  "get_fishing_vessel",
  "search_aquaculture_locations",
  "get_aquaculture_location",
  "get_marine_forecast",
  "get_live_vessel_positions",
] as const;

describe("maritime tool registration", () => {
  it("registers all eight maritime tools exactly once", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: MARITIME_CONFIG });
    const { tools } = await harness.client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const name of MARITIME_TOOLS) {
      expect(
        names.filter((candidate) => candidate === name),
        name,
      ).toHaveLength(1);
    }
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("preserves every previously shipped tool, unchanged in name and order", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    const { tools } = await harness.client.listTools();

    // The pre-existing twelve must still be the first twelve, in their original
    // order: `tools/list` order is part of what clients already see.
    expect(tools.slice(0, 12).map((tool) => tool.name)).toEqual([
      "search_norwegian_companies",
      "get_norwegian_company_profile",
      "search_norwegian_addresses",
      "get_norwegian_location_profile",
      "get_norwegian_municipality_profile",
      "get_norwegian_weather_forecast",
      "get_current_norwegian_hazards",
      "get_norwegian_electricity_prices",
      "get_norwegian_transport_departures",
      "query_norwegian_statistics",
      "resolve_norwegian_administrative_code",
      "search_norwegian_classification_codes",
    ]);
  });

  it("gives every maritime tool a strict schema, an output schema and read-only annotations", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: MARITIME_CONFIG });
    const { tools } = await harness.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of MARITIME_TOOLS) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.additionalProperties, name).toBe(false);
      expect(tool!.outputSchema, name).toBeDefined();
      expect(tool!.annotations?.readOnlyHint, name).toBe(true);
      expect(tool!.annotations?.destructiveHint, name).toBe(false);
      expect(tool!.description?.toLowerCase() ?? "", name).toContain("do not use this");
    }
  });

  it("exposes the three new namespaces on the injectable SDK surface", () => {
    const sdk = createFakeSdk();

    expect(typeof sdk.ais.getTrackLast24Hours).toBe("function");
    expect(typeof sdk.ais.getTrack).toBe("function");
    expect(typeof sdk.ais.streamPositions).toBe("function");
    expect(typeof sdk.marine.getWaveForecast).toBe("function");
    expect(typeof sdk.marine.getSeaCurrent).toBe("function");
    expect(typeof sdk.fisheries.searchVessels).toBe("function");
    expect(typeof sdk.fisheries.getVessel).toBe("function");
    expect(typeof sdk.fisheries.searchAquacultureSites).toBe("function");
    expect(typeof sdk.fisheries.getAquacultureSite).toBe("function");
    expect(typeof sdk.profiles.vessel).toBe("function");
  });
});

describe("credential gating", () => {
  it("fails clearly, naming both variables, when AIS credentials are absent", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: {} });

    const cases: [string, Record<string, unknown>][] = [
      ["get_vessel_profile", { mmsi: "257123456" }],
      ["get_vessel_track", { mmsi: "257123456" }],
      [
        "get_live_vessel_positions",
        {
          boundingBox: { south: 63.3, west: 10.2, north: 63.6, east: 10.7 },
          limit: 5,
          timeoutMs: 1000,
        },
      ],
    ];

    for (const [name, args] of cases) {
      const error = await harness.callErr(name, args);

      expect(error.code, name).toBe("missing_configuration");
      expect(error.requiredConfiguration, name).toEqual([
        "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID",
        "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET",
      ]);
      expect(error.retryable, name).toBe(false);
    }
  });

  it("fails clearly when the marine forecast credentials are absent", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: {} });

    const error = await harness.callErr("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
    });

    expect(error.code).toBe("missing_configuration");
    expect(error.requiredConfiguration).toEqual([
      "NORWAY_MCP_BARENTSWATCH_CLIENT_ID",
      "NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET",
    ]);
  });

  it("names only the half that is missing when one variable of a pair is set", async () => {
    harness = await createHarness({
      sdk: createFakeSdk(),
      config: { barentswatchAisClientId: "only-the-id" },
    });

    const error = await harness.callErr("get_vessel_profile", { mmsi: "257123456" });
    expect(error.requiredConfiguration).toEqual(["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET"]);
  });

  it("keeps the Fiskeridirektoratet tools working with no credentials at all", async () => {
    // Both registers are served anonymously; an empty configuration must not
    // gate them, and an AIS credential must not be required for them either.
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          searchVessels: () =>
            Promise.resolve(respond(sampleFishingVesselSearch, SOURCES["fiskeridir-vessels"]!)),
          getAquacultureSite: () =>
            Promise.resolve(respond(sampleAquacultureSite, SOURCES["fiskeridir-aqua"]!)),
        },
      }),
      config: { contactEmail: undefined },
    });

    const vessels = await harness.callOk("search_fishing_vessels", { query: "Havstraum" });
    expect(vessels.data["vessels"]).toHaveLength(1);

    const site = await harness.callOk("get_aquaculture_location", { siteNumber: "10318" });
    expect((site.data["site"] as { siteNumber: string }).siteNumber).toBe("10318");
  });

  it("gates exactly five of the twenty tools, and no more", () => {
    // The README states this count. Deriving it from the registry keeps the
    // claim from drifting the next time a tool is added.
    const gated = allTools
      .filter((tool) => (tool.requiredEnvironment?.({} as ServerConfig) ?? []).length > 0)
      .map((tool) => tool.name)
      .sort();

    expect(gated).toEqual([
      "get_live_vessel_positions",
      "get_marine_forecast",
      "get_norwegian_weather_forecast",
      "get_vessel_profile",
      "get_vessel_track",
    ]);
    expect(allTools.length - gated.length).toBe(15);
  });

  it("leaves every pre-existing tool working when no maritime credentials are set", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        klass: {
          searchCodes: () =>
            Promise.resolve(
              respond(
                {
                  items: [{ code: "0301", name: "Oslo", level: "1" }],
                  pagination: {
                    page: 0,
                    pageSize: 10,
                    totalItems: 1,
                    totalPages: 1,
                    upstreamPaged: false,
                  },
                },
                SOURCES["ssb-klass"]!,
              ),
            ),
        },
      }),
      config: {},
    });

    const envelope = await harness.callOk("search_norwegian_classification_codes", {
      classificationId: 131,
      codePattern: "03*",
      date: "2024-01-01",
    });
    expect(envelope.data["codes"]).toHaveLength(1);
  });
});

describe("get_vessel_profile", () => {
  it("delegates composition to sdk.profiles.vessel and returns its provenance", async () => {
    const vessel = vi.fn<SdkSurface["profiles"]["vessel"]>(() =>
      Promise.resolve(respond(sampleVesselProfile, SOURCES["barentswatch-ais"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ profiles: { vessel } }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });

    // One SDK call, the parameters the SDK declares, and the caller's signal.
    expect(vessel).toHaveBeenCalledTimes(1);
    expect(vessel.mock.calls[0]![0]).toEqual({ mmsi: "257123456" });
    expect((vessel.mock.calls[0]![1] as { signal: AbortSignal }).signal).toBeInstanceOf(
      AbortSignal,
    );

    expect(envelope.data["mmsi"]).toBe("257123456");
    expect(envelope.sources[0]?.id).toBe("barentswatch-ais");
    expect(envelope.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
    expect(envelope.warnings.join(" ")).toContain("BarentsWatch AIS coverage is partial");
  });

  it("preserves per-component provenance and reports a partial profile", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(respond(samplePartialVesselProfile, SOURCES["barentswatch-ais"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257000999" });
    const components = envelope.data["components"] as {
      section: string;
      status: string;
      reason?: string;
    }[];

    // Every section reports why it is present or absent.
    expect(components).toHaveLength(4);
    expect(components.find((c) => c.section === "weather")?.reason).toBe("not-configured");
    expect(components.find((c) => c.section === "place")?.reason).toBe("provider-error");
    expect(components.find((c) => c.section === "registration")?.reason).toBe("not-applicable");

    // A failed or unconfigured section is a partial result; "not-applicable" is not.
    expect(envelope.partial?.complete).toBe(false);
    expect(envelope.partial?.missing.sort()).toEqual(["place", "weather"]);

    const notes = envelope.warnings.join(" ");
    expect(notes).toContain("NORWAY_MCP_CONTACT_EMAIL");
    expect(notes).toContain("no AIS position for this MMSI");
    expect(notes).toContain("not evidence");
  });

  it("never returns private owner details from the joined register entry", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () => Promise.resolve(respond(sampleVesselProfile, SOURCES["barentswatch-ais"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });
    const registration = envelope.data["registration"] as {
      companyOwners?: { name?: string }[];
      privateOwnerCount?: number;
    };

    expect(registration.companyOwners).toEqual([
      {
        organizationNumber: "912345678",
        name: "HAVSTRAUM AS",
        postalCode: "4370",
        city: "EGERSUND",
      },
    ]);
    // The natural-person owner is counted, never described.
    expect(registration.privateOwnerCount).toBe(1);
    expect(JSON.stringify(envelope)).not.toContain("entityType");
    expect(envelope.warnings.join(" ")).toContain("Natural-person owners are counted but never");
  });

  it("rejects a malformed MMSI before contacting any provider", async () => {
    const vessel = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ profiles: { vessel } }),
      config: MARITIME_CONFIG,
    });

    for (const mmsi of ["", "  ", "abc", "1234567890", "257-123-456", "25712345.6"]) {
      const result = await harness.call("get_vessel_profile", { mmsi });
      expect(result.isError, `MMSI ${JSON.stringify(mmsi)}`).toBe(true);
    }
    expect(vessel).not.toHaveBeenCalled();
  });

  it("keeps a leading zero in an MMSI rather than treating it as a number", async () => {
    const vessel = vi.fn<SdkSurface["profiles"]["vessel"]>(() =>
      Promise.resolve(respond(sampleVesselProfile, SOURCES["barentswatch-ais"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ profiles: { vessel } }),
      config: MARITIME_CONFIG,
    });

    await harness.callOk("get_vessel_profile", { mmsi: "002310495" });
    expect(vessel.mock.calls[0]![0]).toEqual({ mmsi: "002310495" });
  });

  it("rejects unknown properties", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: MARITIME_CONFIG });
    const result = await harness.call("get_vessel_profile", {
      mmsi: "257123456",
      notARealField: true,
    });

    expect(result.isError).toBe(true);
  });
});

describe("get_vessel_track", () => {
  it("uses the last-24-hours endpoint when no window is given", async () => {
    const getTrackLast24Hours = vi.fn<SdkSurface["ais"]["getTrackLast24Hours"]>(() =>
      Promise.resolve(respond(sampleAisTrack, SOURCES["barentswatch-ais"]!)),
    );
    const getTrack = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { getTrackLast24Hours, getTrack } }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_track", { mmsi: "257123456" });

    expect(getTrackLast24Hours).toHaveBeenCalledTimes(1);
    expect(getTrackLast24Hours.mock.calls[0]![0]).toBe("257123456");
    expect(getTrack).not.toHaveBeenCalled();
    expect((envelope.data["window"] as { mode: string }).mode).toBe("last-24-hours");
    expect(envelope.data["pointsRecorded"]).toBe(12);
  });

  it("uses the ranged endpoint when an explicit window is given", async () => {
    const getTrack = vi.fn<SdkSurface["ais"]["getTrack"]>(() =>
      Promise.resolve(respond(sampleAisTrack, SOURCES["barentswatch-ais"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { getTrack } }),
      config: MARITIME_CONFIG,
    });

    await harness.callOk("get_vessel_track", {
      mmsi: "257123456",
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-22T00:00:00Z",
    });

    expect(getTrack.mock.calls[0]![0]).toEqual({
      mmsi: "257123456",
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-22T00:00:00Z",
    });
  });

  it("caps returned points while reporting the full recorded count", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          getTrackLast24Hours: () =>
            Promise.resolve(respond(sampleAisTrack, SOURCES["barentswatch-ais"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_track", { mmsi: "257123456", limit: 3 });

    expect(envelope.data["pointsReturned"]).toBe(3);
    expect(envelope.data["pointsRecorded"]).toBe(12);
    expect(envelope.truncation?.truncated).toBe(true);
    expect(envelope.warnings.join(" ")).toContain("Showing 3 of 12 available");
  });

  it("refuses a half-specified, reversed or over-long window", async () => {
    const getTrack = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { getTrack } }),
      config: MARITIME_CONFIG,
    });

    const rejected = [
      { mmsi: "257123456", from: "2026-07-20T00:00:00Z" },
      { mmsi: "257123456", to: "2026-07-22T00:00:00Z" },
      { mmsi: "257123456", from: "2026-07-22T00:00:00Z", to: "2026-07-20T00:00:00Z" },
      { mmsi: "257123456", from: "2026-06-01T00:00:00Z", to: "2026-07-22T00:00:00Z" },
      { mmsi: "257123456", from: "not-a-date", to: "2026-07-22T00:00:00Z" },
    ];

    for (const args of rejected) {
      const result = await harness.call("get_vessel_track", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(getTrack).not.toHaveBeenCalled();
  });

  it("says plainly that an empty track is not evidence the vessel did not sail", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          getTrackLast24Hours: () =>
            Promise.resolve(
              respond({ mmsi: "257123456", points: [] }, SOURCES["barentswatch-ais"]!),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_track", { mmsi: "257123456" });

    expect(envelope.data["pointsRecorded"]).toBe(0);
    expect(envelope.warnings.join(" ")).toContain("not evidence the vessel did not sail");
    expect(envelope.text).toContain("recorded no AIS positions");
  });
});

describe("search_fishing_vessels", () => {
  it("maps its filters onto the SDK's own search parameters", async () => {
    const searchVessels = vi.fn<SdkSurface["fisheries"]["searchVessels"]>(() =>
      Promise.resolve(respond(sampleFishingVesselSearch, SOURCES["fiskeridir-vessels"]!)),
    );
    harness = await createHarness({ sdk: createFakeSdk({ fisheries: { searchVessels } }) });

    await harness.callOk("search_fishing_vessels", {
      name: "Havstraum",
      municipalityCode: "1103",
      minLength: 20,
      maxLength: 40,
      limit: 25,
      page: 2,
    });

    expect(searchVessels.mock.calls[0]![0]).toEqual({
      name: "Havstraum",
      municipalityCode: "1103",
      minLength: 20,
      maxLength: 40,
      page: 2,
      pageSize: 25,
    });
  });

  it("normalizes a registration mark's case and passes it through for the SDK to rewrite", async () => {
    const searchVessels = vi.fn<SdkSurface["fisheries"]["searchVessels"]>(() =>
      Promise.resolve(respond(sampleFishingVesselSearch, SOURCES["fiskeridir-vessels"]!)),
    );
    harness = await createHarness({ sdk: createFakeSdk({ fisheries: { searchVessels } }) });

    await harness.callOk("search_fishing_vessels", { registrationMark: " r-62-h " });
    expect(searchVessels.mock.calls[0]![0]).toEqual({
      registrationMark: "R-62-H",
      page: 1,
      pageSize: 10,
    });
  });

  it("refuses an unfiltered walk of the whole register", async () => {
    const searchVessels = vi.fn();
    harness = await createHarness({ sdk: createFakeSdk({ fisheries: { searchVessels } }) });

    const result = await harness.call("search_fishing_vessels", {});
    expect(result.isError).toBe(true);
    expect(searchVessels).not.toHaveBeenCalled();
  });

  it("refuses a reversed length range and an out-of-range limit", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });

    for (const args of [
      { minLength: 40, maxLength: 20 },
      { query: "a" },
      { query: "Havstraum", limit: 0 },
      { query: "Havstraum", limit: 500 },
      { query: "Havstraum", page: 0 },
      { municipalityCode: "110" },
      { radioCallSign: "L!" },
    ]) {
      const result = await harness.call("search_fishing_vessels", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it("offers a continuation when the register page came back full", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          searchVessels: () =>
            Promise.resolve(
              respond(
                {
                  items: [sampleFishingVessel],
                  pagination: { page: 1, pageSize: 1, hasMore: true },
                },
                SOURCES["fiskeridir-vessels"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_fishing_vessels", {
      query: "Havstraum",
      limit: 1,
    });

    expect(envelope.continuation?.hasMore).toBe(true);
    expect(envelope.continuation?.nextArguments["page"]).toBe(2);
    // The inference behind `hasMore` is stated, not presented as an exact count.
    expect(envelope.warnings.join(" ")).toContain("reports no total count");
  });
});

describe("get_fishing_vessel", () => {
  it("builds the SDK's single-key lookup for each identifier", async () => {
    const cases: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{ id: "10412" }, { id: "10412" }, "id"],
      [{ registrationMark: "R-62-H" }, { registrationMark: "R-62-H" }, "registrationMark"],
      [{ radioCallSign: "ldmv" }, { radioCallSign: "LDMV" }, "radioCallSign"],
    ];

    for (const [args, expected, matchedBy] of cases) {
      const getVessel = vi.fn<SdkSurface["fisheries"]["getVessel"]>(() =>
        Promise.resolve(respond(sampleFishingVessel, SOURCES["fiskeridir-vessels"]!)),
      );
      const local = await createHarness({ sdk: createFakeSdk({ fisheries: { getVessel } }) });
      try {
        const envelope = await local.callOk("get_fishing_vessel", args);
        expect(getVessel.mock.calls[0]![0]).toEqual(expected);
        expect(envelope.data["matchedBy"]).toBe(matchedBy);
      } finally {
        await local.close();
      }
    }
  });

  it("refuses zero identifiers and refuses two at once", async () => {
    const getVessel = vi.fn();
    harness = await createHarness({ sdk: createFakeSdk({ fisheries: { getVessel } }) });

    for (const args of [{}, { id: "10412", radioCallSign: "LDMV" }]) {
      const result = await harness.call("get_fishing_vessel", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(getVessel).not.toHaveBeenCalled();
  });

  it("surfaces an ambiguous mark as not found rather than picking one", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () =>
            Promise.reject(
              sdkError("NotFoundError", "More than one vessel matches that registration mark.", {
                provider: "fiskeridir-vessels",
              }),
            ),
        },
      }),
    });

    const error = await harness.callErr("get_fishing_vessel", { registrationMark: "R-62-H" });
    expect(error.code).toBe("not_found");
    expect(error.retryable).toBe(false);
  });

  it("withholds private owner details on the single-vessel path too", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () =>
            Promise.resolve(respond(sampleFishingVessel, SOURCES["fiskeridir-vessels"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_fishing_vessel", { id: "10412" });
    const vessel = envelope.data["vessel"] as { privateOwnerCount?: number };

    expect(vessel.privateOwnerCount).toBe(1);
    expect(envelope.text).toContain("1 (not identified)");
    expect(envelope.warnings.join(" ")).toContain("never identified");
  });
});

describe("aquaculture register", () => {
  it("maps search filters onto the SDK's parameters and paginates by offset", async () => {
    const searchAquacultureSites = vi.fn<SdkSurface["fisheries"]["searchAquacultureSites"]>(() =>
      Promise.resolve(respond(sampleAquacultureSearch, SOURCES["fiskeridir-aqua"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ fisheries: { searchAquacultureSites } }),
    });

    await harness.callOk("search_aquaculture_locations", {
      municipalityCode: "5055",
      productionAreaCode: "6",
      waterType: "Salt",
      limit: 20,
      offset: 40,
    });

    expect(searchAquacultureSites.mock.calls[0]![0]).toEqual({
      municipalityCode: "5055",
      productionAreaCode: "6",
      waterType: "Salt",
      offset: 40,
      limit: 20,
    });
  });

  it("flattens placement and licences, and states that capacity needs its unit", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getAquacultureSite: () =>
            Promise.resolve(respond(sampleAquacultureSite, SOURCES["fiskeridir-aqua"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_aquaculture_location", { siteNumber: "10318" });
    const site = envelope.data["site"] as Record<string, unknown>;

    expect(site["municipalityName"]).toBe("Heim");
    expect(site["productionAreaStatus"]).toBe("GRØNN");
    expect(site["licenceNumbers"]).toEqual(["H-KM-0018"]);
    expect(site["capacityUnitType"]).toBe("TN");
    expect(envelope.warnings.join(" ")).toContain("not comparable across sites");
    expect(envelope.sources[0]?.id).toBe("fiskeridir-aqua");
  });

  it("refuses an unfiltered search and malformed identifiers", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });

    expect((await harness.call("search_aquaculture_locations", {})).isError).toBe(true);
    for (const args of [
      { productionAreaCode: "14" },
      { productionAreaCode: "0" },
      { countyCode: "500" },
      { organizationNumber: "12345" },
      { licenceNumber: "notalicence" },
    ]) {
      const result = await harness.call("search_aquaculture_locations", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }

    for (const siteNumber of ["", "abc", "12345678"]) {
      const result = await harness.call("get_aquaculture_location", { siteNumber });
      expect(result.isError, `site ${JSON.stringify(siteNumber)}`).toBe(true);
    }
  });
});

describe("get_marine_forecast", () => {
  it("delegates both model requests and merges their provenance", async () => {
    const getWaveForecast = vi.fn<SdkSurface["marine"]["getWaveForecast"]>(() =>
      Promise.resolve(respond(sampleWaveForecast, SOURCES["barentswatch"]!)),
    );
    const getSeaCurrent = vi.fn<SdkSurface["marine"]["getSeaCurrent"]>(() =>
      Promise.resolve(respond(sampleSeaCurrent, SOURCES["barentswatch"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ marine: { getWaveForecast, getSeaCurrent } }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
    });

    expect(getWaveForecast.mock.calls[0]![0]).toEqual({ latitude: 63.74, longitude: 9.22 });
    expect(getSeaCurrent.mock.calls[0]![0]).toEqual({ latitude: 63.74, longitude: 9.22 });
    expect(
      (envelope.data["waves"] as { significantWaveHeight: number }).significantWaveHeight,
    ).toBe(1.8);
    expect((envelope.data["current"] as { speed: number }).speed).toBe(0.42);
    expect(envelope.partial).toBeNull();
    expect(envelope.sources[0]?.id).toBe("barentswatch");
  });

  it("distinguishes an uncovered coordinate from a provider failure", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getWaveForecast: () => Promise.resolve(respond(undefined, SOURCES["barentswatch"]!)),
          getSeaCurrent: () => Promise.resolve(respond(undefined, SOURCES["barentswatch"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_marine_forecast", {
      latitude: 59.9,
      longitude: 10.75,
    });

    expect(envelope.data["waves"]).toBeNull();
    expect(envelope.data["current"]).toBeNull();
    // Not covered is not a failure, so no partial report.
    expect(envelope.partial).toBeNull();
    expect(envelope.data["failedSections"]).toEqual([]);
    expect(envelope.warnings.join(" ")).toContain("No wave model covers this coordinate");
  });

  it("returns the section that worked when the other one failed", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getWaveForecast: () =>
            Promise.resolve(respond(sampleWaveForecast, SOURCES["barentswatch"]!)),
          getSeaCurrent: () =>
            Promise.reject(
              sdkError("ProviderError", "BarentsWatch returned HTTP 503.", {
                provider: "barentswatch",
                statusCode: 503,
              }),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
    });

    expect(envelope.data["waves"]).not.toBeNull();
    expect(envelope.data["current"]).toBeNull();
    expect(envelope.data["failedSections"]).toEqual(["current"]);
    expect(envelope.partial).toEqual({
      complete: false,
      missing: ["current"],
      reason: "A BarentsWatch forecast request failed.",
    });
    expect(envelope.text).toContain("Partial result");
  });

  it("fails the call when every requested section failed", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getWaveForecast: () =>
            Promise.reject(sdkError("ProviderError", "down", { provider: "barentswatch" })),
          getSeaCurrent: () =>
            Promise.reject(sdkError("ProviderError", "down", { provider: "barentswatch" })),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const error = await harness.callErr("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
    });
    expect(error.code).toBe("provider_error");
  });

  it("only calls the model the caller asked for", async () => {
    const getWaveForecast = vi.fn();
    const getSeaCurrent = vi.fn<SdkSurface["marine"]["getSeaCurrent"]>(() =>
      Promise.resolve(respond(sampleSeaCurrent, SOURCES["barentswatch"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ marine: { getWaveForecast, getSeaCurrent } }),
      config: MARITIME_CONFIG,
    });

    await harness.callOk("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
      include: ["current"],
    });

    expect(getWaveForecast).not.toHaveBeenCalled();
    expect(getSeaCurrent).toHaveBeenCalledTimes(1);
  });

  it("rejects impossible coordinates and an empty include list", async () => {
    harness = await createHarness({ sdk: createFakeSdk(), config: MARITIME_CONFIG });

    for (const args of [
      { latitude: 91, longitude: 10 },
      { latitude: 63, longitude: 181 },
      { latitude: Number.NaN, longitude: 10 },
      { latitude: 63, longitude: 9, include: [] },
      { latitude: 63, longitude: 9, include: ["tides"] },
    ]) {
      const result = await harness.call("get_marine_forecast", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });
});

describe("secrets never leave this server", () => {
  it("redacts a configured client secret echoed back inside a provider error", async () => {
    // A provider that quotes the request back is the realistic leak path, and
    // the one a class-based check would miss.
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.reject(
              sdkError(
                "ProviderError",
                "Token request rejected for client_id=bw-ais-client-id with client_secret=bw-ais-client-secret (authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij)",
                { provider: "barentswatch-ais", statusCode: 401 },
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const result = await harness.call("get_vessel_profile", { mmsi: "257123456" });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("bw-ais-client-id");
    expect(serialized).not.toContain("bw-ais-client-secret");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts a credential that surfaces inside a successful result", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(
              respond(
                {
                  ...sampleVesselProfile,
                  ais: {
                    ...sampleVesselProfile.ais,
                    identity: {
                      ...sampleVesselProfile.ais.identity,
                      // A provider could not really do this; the point is that
                      // redaction runs over the whole outgoing payload, not
                      // only over error messages.
                      name: "bw-api-client-secret",
                    },
                  },
                },
                SOURCES["barentswatch-ais"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });
    expect(JSON.stringify(envelope.data)).not.toContain("bw-api-client-secret");
  });

  it("keeps provider homepages and documentation links intact while redacting", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () => Promise.resolve(respond(sampleVesselProfile, SOURCES["barentswatch-ais"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });
    expect(envelope.sources[0]?.homepage).toBe("https://www.barentswatch.no/");
  });
});

describe("maritime results carry the shared contract", () => {
  it("attaches provenance, a retrieval timestamp and attribution to every maritime tool", async () => {
    const maritimeNames = new Set<string>(MARITIME_TOOLS);
    // Registry-driven, so a maritime tool added later is covered automatically.
    expect(allTools.filter((tool) => maritimeNames.has(tool.name))).toHaveLength(
      MARITIME_TOOLS.length,
    );

    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(respond(sampleVesselProfile, COMPOSITE_PROFILE_SOURCES["vessel"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });

    expect(envelope.sources[0]).toMatchObject({
      id: "barentswatch-ais",
      name: "BarentsWatch AIS",
    });
    expect(envelope.sources[0]?.attribution).toContain("Kystverket");
    expect(envelope.text).toContain("Kystverket");
    expect(envelope.retrievedAt).toBeTruthy();
    expect(envelope.cached).toBe(false);
  });

  it("credits the real providers, never the SDK's synthetic composite source", async () => {
    // Regression guard for a defect found only by calling the live API. A
    // composed profile's top-level `source` is a composite the SDK builds for
    // the composition itself: it carries no licence and no attribution, and its
    // homepage is the SDK's own repository. Using it would silently drop the
    // BarentsWatch AIS requirement that Kystverket be credited.
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(respond(sampleVesselProfile, COMPOSITE_PROFILE_SOURCES["vessel"]!)),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257123456" });
    const ids = envelope.sources.map((source) => source.id);

    // The composite never appears, and every credited source carries a licence.
    expect(ids).not.toContain("barentswatch-ais+kartverket");
    expect(ids.sort()).toEqual(["barentswatch-ais", "fiskeridir-vessels"]);
    for (const source of envelope.sources) {
      expect(source.license, `${source.id} licence`).toBeTruthy();
      expect(source.attribution, `${source.id} attribution`).toBeTruthy();
    }
    // No attribution points at the SDK's repository rather than the provider.
    expect(JSON.stringify(envelope.sources)).not.toContain("github.com");
  });

  it("credits only the providers that actually answered", async () => {
    // An omitted provider supplied nothing, so it needs no attribution.
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(
              respond(samplePartialVesselProfile, COMPOSITE_PROFILE_SOURCES["vessel"]!),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257000999" });

    // Only the AIS component was `available` in that fixture.
    expect(envelope.sources.map((source) => source.id)).toEqual(["barentswatch-ais"]);
  });

  it("falls back to the composite when no component reported at all", async () => {
    // Without a fallback the envelope would carry no source and no timestamp,
    // which is worse than an imperfect one.
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(
              respond(
                { mmsi: "257000004", ais: { status: "no-recent-data" as const } },
                COMPOSITE_PROFILE_SOURCES["vessel"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257000004" });

    expect(envelope.sources).toHaveLength(1);
    expect(envelope.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
  });
});
