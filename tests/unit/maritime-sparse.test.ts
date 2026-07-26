/**
 * Sparse maritime payloads.
 *
 * The maritime records are unusually optional: a `FishingVessel` requires only
 * `id`, an `AquacultureSite` only `siteNumber`, and an AIS position report can
 * legitimately arrive with no coordinate at all. The rich fixtures in
 * `fake-sdk.ts` never reach those branches.
 *
 * Every test here asserts the same two things the older sparse suite does — no
 * `undefined` in the rendered text, no `"undefined"` in structured output — plus
 * that the result still validates against the declared output schema, which is
 * what the harness's `callOk` enforces.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { AisPosition } from "norway-open-data-sdk";

import { createHarness, type Harness } from "../helpers/harness.js";
import { SOURCES, createFakeSdk, createFakeStream, respond } from "../../src/testing/fake-sdk.js";
import type { ServerConfig } from "../../src/config/types.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const MARITIME_CONFIG: Partial<ServerConfig> = {
  barentswatchClientId: "bw-api-client-id",
  barentswatchClientSecret: "bw-api-client-secret",
  barentswatchAisClientId: "bw-ais-client-id",
  barentswatchAisClientSecret: "bw-ais-client-secret",
};

const BOX = { south: 63.3, west: 10.2, north: 63.6, east: 10.7 };

function expectNoUndefinedLeakage(envelope: { text: string; data: Record<string, unknown> }): void {
  expect(envelope.text).not.toContain("undefined");
  expect(envelope.text).not.toContain("[object Object]");
  expect(JSON.stringify(envelope.data)).not.toContain('"undefined"');
}

describe("sparse fishing-vessel records", () => {
  it("renders a vessel carrying only its register id", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () => Promise.resolve(respond({ id: "1" }, SOURCES["fiskeridir-vessels"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_fishing_vessel", { id: "1" });
    const vessel = envelope.data["vessel"] as Record<string, unknown>;

    expect(Object.keys(vessel)).toEqual(["id"]);
    // No ownership was published, so no owner-privacy note is attached.
    expect(envelope.warnings).toEqual([]);
    expectNoUndefinedLeakage(envelope);
  });

  it("renders a tonnage whose tonnage type the register omitted", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () =>
            Promise.resolve(
              respond(
                { id: "2", name: "SPARSE", tonnage: 88, width: 4.2, rebuildYear: 2019 },
                SOURCES["fiskeridir-vessels"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_fishing_vessel", { id: "2" });

    // The unit is unknown rather than assumed, and says so.
    expect(envelope.text).toContain("88 (?)");
    expectNoUndefinedLeakage(envelope);
  });

  it("reports a vessel owned only by natural persons as a count with no names", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () =>
            Promise.resolve(
              respond(
                {
                  id: "3",
                  name: "PRIVAT",
                  owners: [{ entityType: "person" }, { entityType: "person" }],
                },
                SOURCES["fiskeridir-vessels"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_fishing_vessel", { id: "3" });
    const vessel = envelope.data["vessel"] as Record<string, unknown>;

    expect(vessel["privateOwnerCount"]).toBe(2);
    expect(vessel["companyOwners"]).toBeUndefined();
    expect(envelope.warnings.join(" ")).toContain("never identified");
    expectNoUndefinedLeakage(envelope);
  });

  it("keeps a company owner whose fields the register left blank", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getVessel: () =>
            Promise.resolve(
              respond(
                { id: "4", owners: [{ entityType: "company" }] },
                SOURCES["fiskeridir-vessels"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_fishing_vessel", { id: "4" });
    const vessel = envelope.data["vessel"] as { companyOwners?: unknown[] };

    expect(vessel.companyOwners).toEqual([{}]);
    expect(envelope.text).toContain("(unnamed)");
    expectNoUndefinedLeakage(envelope);
  });

  it("survives an empty search page", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          searchVessels: () =>
            Promise.resolve(
              respond(
                { items: [], pagination: { page: 1, pageSize: 10, hasMore: false } },
                SOURCES["fiskeridir-vessels"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_fishing_vessels", { query: "nothing" });

    expect(envelope.data["vessels"]).toEqual([]);
    expect(envelope.continuation).toBeNull();
    expect(envelope.text).toContain("No vessels matched");
    expectNoUndefinedLeakage(envelope);
  });
});

describe("sparse aquaculture records", () => {
  it("renders a site carrying only its site number", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getAquacultureSite: () =>
            Promise.resolve(respond({ siteNumber: "1" }, SOURCES["fiskeridir-aqua"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_aquaculture_location", { siteNumber: "1" });
    const site = envelope.data["site"] as Record<string, unknown>;

    expect(Object.keys(site)).toEqual(["siteNumber"]);
    // No capacity was published, so the unit caveat is not attached.
    expect(envelope.warnings).toEqual([]);
    expectNoUndefinedLeakage(envelope);
  });

  it("says the unit is not stated rather than assuming tonnes", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          getAquacultureSite: () =>
            Promise.resolve(
              respond(
                { siteNumber: "2", capacity: 500, latitude: 63.1, placement: {}, licences: [{}] },
                SOURCES["fiskeridir-aqua"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_aquaculture_location", { siteNumber: "2" });
    const site = envelope.data["site"] as Record<string, unknown>;

    expect(envelope.text).toContain("(unit not stated)");
    // A latitude with no longitude must not render as "63.1, undefined".
    expect(envelope.text).toContain("63.1, ?");
    // An empty placement and a licence with no number contribute nothing.
    expect(site["municipalityCode"]).toBeUndefined();
    expect(site["licenceNumbers"]).toBeUndefined();
    expect(envelope.warnings.join(" ")).toContain("not comparable across sites");
    expectNoUndefinedLeakage(envelope);
  });

  it("survives an empty search page and offers no continuation", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          searchAquacultureSites: () =>
            Promise.resolve(
              respond(
                { items: [], pagination: { offset: 0, limit: 10, hasMore: false } },
                SOURCES["fiskeridir-aqua"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_aquaculture_locations", {
      municipalityCode: "9999",
    });

    expect(envelope.data["sites"]).toEqual([]);
    expect(envelope.continuation).toBeNull();
    expect(envelope.text).toContain("No sites matched");
    expectNoUndefinedLeakage(envelope);
  });

  it("offers an offset continuation when the page came back full", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        fisheries: {
          searchAquacultureSites: () =>
            Promise.resolve(
              respond(
                {
                  items: [{ siteNumber: "10318", name: "STORVIKA" }],
                  pagination: { offset: 0, limit: 1, hasMore: true },
                },
                SOURCES["fiskeridir-aqua"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("search_aquaculture_locations", {
      countyCode: "50",
      limit: 1,
    });

    expect(envelope.continuation?.hasMore).toBe(true);
    expect(envelope.continuation?.nextArguments["offset"]).toBe(1);
    expectNoUndefinedLeakage(envelope);
  });
});

describe("sparse AIS records", () => {
  it("renders a track point with no coordinate", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          getTrackLast24Hours: () =>
            Promise.resolve(
              respond(
                {
                  mmsi: "257000001",
                  points: [{ mmsi: "257000001", messageTime: "2026-07-23T12:00:00Z" }],
                  from: "2026-07-23T12:00:00Z",
                  to: "2026-07-23T12:00:00Z",
                },
                SOURCES["barentswatch-ais"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_track", { mmsi: "257000001" });
    const points = envelope.data["points"] as Record<string, unknown>[];

    expect(Object.keys(points[0]!)).toEqual(["messageTime"]);
    expectNoUndefinedLeakage(envelope);
  });

  it("renders a track whose window the provider did not report", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        ais: {
          getTrack: () =>
            Promise.resolve(
              respond(
                {
                  mmsi: "257000002",
                  points: [
                    { mmsi: "257000002", messageTime: "2026-07-21T00:00:00Z", latitude: 63.1 },
                  ],
                },
                SOURCES["barentswatch-ais"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_track", {
      mmsi: "257000002",
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-22T00:00:00Z",
    });

    expect(envelope.data["from"]).toBeUndefined();
    // A latitude with no longitude must not render as "63.1, undefined".
    expect(envelope.text).toContain("63.1, ?");
    expectNoUndefinedLeakage(envelope);
  });

  it("renders a live position report carrying only its required fields", async () => {
    const bare: AisPosition[] = [
      {
        kind: "position",
        mmsi: "257000003",
        messageTime: "2026-07-23T12:00:00Z",
        messageType: 1,
      },
    ];
    const fake = createFakeStream(bare);
    harness = await createHarness({
      sdk: createFakeSdk({ ais: { streamPositions: fake.stream } }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_live_vessel_positions", {
      boundingBox: BOX,
      limit: 10,
      timeoutMs: 1000,
    });

    const positions = envelope.data["positions"] as Record<string, unknown>[];
    expect(Object.keys(positions[0]!).sort()).toEqual(["messageTime", "mmsi"]);
    expect(fake.closed()).toBe(true);
    expectNoUndefinedLeakage(envelope);
  });
});

describe("sparse vessel profiles", () => {
  it("renders a profile with nothing but an MMSI and an AIS status", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(
              respond(
                { mmsi: "257000004", ais: { status: "no-recent-data" as const } },
                SOURCES["barentswatch-ais"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257000004" });

    expect(envelope.data["components"]).toEqual([]);
    expect(envelope.data["registration"]).toBeUndefined();
    expect(envelope.partial).toBeNull();
    // With no AIS identity and no register entry, the MMSI is the heading.
    expect(envelope.text).toContain("MMSI 257000004");
    expectNoUndefinedLeakage(envelope);
  });

  it("renders an identity, weather and place carrying only their required fields", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          vessel: () =>
            Promise.resolve(
              respond(
                {
                  mmsi: "257000005",
                  ais: {
                    status: "available" as const,
                    latestPosition: {
                      mmsi: "257000005",
                      messageTime: "2026-07-23T12:00:00Z",
                    },
                    track: { mmsi: "257000005", points: [] },
                    identity: {},
                  },
                  weather: { time: "2026-07-23T12:00:00Z" },
                  nearestPlace: { name: "Ukjent" },
                  components: [
                    {
                      operation: "places.nearby" as const,
                      section: "place" as const,
                      status: "omitted" as const,
                      source: SOURCES["kartverket"]!,
                      reason: "not-found" as const,
                    },
                    {
                      operation: "weather.current" as const,
                      section: "weather" as const,
                      status: "omitted" as const,
                      source: SOURCES["met"]!,
                      reason: "not-covered" as const,
                    },
                    {
                      operation: "fisheries.searchVessels" as const,
                      section: "registration" as const,
                      status: "omitted" as const,
                      source: SOURCES["fiskeridir-vessels"]!,
                      reason: "missing-coordinate" as const,
                    },
                  ],
                },
                SOURCES["barentswatch-ais"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_vessel_profile", { mmsi: "257000005" });
    const notes = envelope.warnings.join(" ");

    // The three ordinary-absence reasons are each explained, and none of them
    // makes the result partial.
    expect(notes).toContain("holds no matching record");
    expect(notes).toContain("publishes nothing for this subject");
    expect(notes).toContain("has no coordinate");
    expect(envelope.partial).toBeNull();
    expect(envelope.data["trackPointCount"]).toBeUndefined();
    expectNoUndefinedLeakage(envelope);
  });
});

describe("sparse marine forecasts", () => {
  it("renders forecasts carrying only their required fields", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getWaveForecast: () =>
            Promise.resolve(
              respond({ latitude: 63.75, longitude: 9.25 }, SOURCES["barentswatch"]!),
            ),
          getSeaCurrent: () =>
            Promise.resolve(
              respond(
                { speed: 0.1, direction: 90, latitude: 63.75, longitude: 9.25 },
                SOURCES["barentswatch"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
    });

    const waves = envelope.data["waves"] as Record<string, unknown>;
    expect(Object.keys(waves).sort()).toEqual(["latitude", "longitude"]);
    expectNoUndefinedLeakage(envelope);
  });

  it("reports a single requested section that failed as a total failure", async () => {
    // Only `waves` was asked for and only `waves` failed, so there is no
    // provenance to return and no partial answer to give.
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getWaveForecast: () => Promise.reject(new Error("network down")),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const error = await harness.callErr("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
      include: ["waves"],
    });

    expect(error.code).toBe("provider_error");
  });

  it("returns only the current when only the current was requested", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        marine: {
          getSeaCurrent: () =>
            Promise.resolve(
              respond(
                { speed: 0.3, direction: 12, latitude: 63.75, longitude: 9.25 },
                SOURCES["barentswatch"]!,
              ),
            ),
        },
      }),
      config: MARITIME_CONFIG,
    });

    const envelope = await harness.callOk("get_marine_forecast", {
      latitude: 63.74,
      longitude: 9.22,
      include: ["current"],
    });

    expect(envelope.data["waves"]).toBeNull();
    expect(envelope.data["current"]).not.toBeNull();
    // A section that was never requested is not reported as uncovered.
    expect(envelope.warnings.join(" ")).not.toContain("No wave model covers");
    expect(envelope.text).toContain("no forecast available");
    expectNoUndefinedLeakage(envelope);
  });
});
