/**
 * Opt-in live provider tests.
 *
 * **Not part of CI.** Run with `pnpm test:live`, which sets
 * `RUN_LIVE_TESTS=true`. Without it every test here is skipped.
 *
 * Design rules, so this can never become a source of provider load:
 *
 * - Anonymous providers are always contacted. The BarentsWatch tests are gated
 *   a second time on credentials being present and return early without them.
 * - One request per test, no pagination, no loops, no retries beyond the SDK's.
 * - Assertions are on **shape**, never on values that legitimately change.
 * - The suite is serial with a pause between tests, so it cannot approach even
 *   the tightest documented budget (10 requests/minute).
 * - Nothing here is designed to provoke a 429.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNorwayOpenDataMcpServer } from "../../src/server/factory.js";
import { silentLogger } from "../../src/logging/logger.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const LIVE = process.env["RUN_LIVE_TESTS"] === "true";
const describeLive = LIVE ? describe : describe.skip;

/** Courtesy gap between live calls. */
const PAUSE_MS = 2_000;
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

/**
 * BarentsWatch tests are gated a second time, on credentials.
 *
 * `RUN_LIVE_TESTS` alone only permits the anonymous providers. Without a
 * registered AIS client these tests have nothing to assert, so they return
 * early rather than failing — the gating case covers the unconfigured path.
 */
const HAS_AIS_CREDENTIALS =
  (process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID"]?.length ?? 0) > 0 &&
  (process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET"]?.length ?? 0) > 0;

/**
 * MET Norway's point products need the caller's identity and Frost needs a
 * client ID. Without them the tests below assert the clean configuration error
 * instead, which makes no request at all.
 */
const HAS_CONTACT_EMAIL = (process.env["NORWAY_MCP_CONTACT_EMAIL"]?.trim().length ?? 0) > 0;
const HAS_FROST_CLIENT_ID = (process.env["NORWAY_MCP_MET_FROST_CLIENT_ID"]?.trim().length ?? 0) > 0;

/** A UTC calendar date `days` before now, for windows that must lie in the past. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * A vessel in the covered area. Berthed traffic in the Trondheimsfjord is
 * stable enough for a track lookup, and a miss is tolerated rather than failing
 * the suite: an MMSI can legitimately fall out of the 14-day window.
 */
const LIVE_MMSI = "257057980";

/** A stretch of the Trondheimsfjord with reliable traffic. */
const BUSY_BOX = { south: 63.2, west: 9.8, north: 63.7, east: 10.8 } as const;

describeLive("live providers (opt-in, low volume)", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const instance = createNorwayOpenDataMcpServer({ logger: silentLogger });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "live-test", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), instance.server.connect(serverTransport)]);
    close = async () => {
      await client.close();
      await instance.close();
    };
  });

  afterAll(async () => {
    await close?.();
  });

  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    await pause();
    return result;
  };

  it("Brønnøysundregistrene returns a well-formed company search", async () => {
    const result = await call("search_norwegian_companies", { name: "Equinor", limit: 3 });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { companies: unknown[] };
      sources: { id: string }[];
    };
    expect(Array.isArray(envelope.data.companies)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("brreg");
  });

  it("Kartverket returns a well-formed address search", async () => {
    const result = await call("search_norwegian_addresses", {
      query: "Karl Johans gate 1",
      limit: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as { sources: { id: string }[] };
    expect(envelope.sources[0]?.id).toBe("kartverket");
  });

  it("SSB returns table metadata with discoverable dimension codes", async () => {
    const result = await call("query_norwegian_statistics", { tableId: "07459" });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { mode: string; dimensions: { code: string }[] };
    };
    expect(envelope.data.mode).toBe("metadata");
    expect(envelope.data.dimensions.length).toBeGreaterThan(0);
  });

  it("NVE returns hazard warnings, or an empty list, without failing", async () => {
    const result = await call("get_current_norwegian_hazards", { types: ["flood"] });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { warnings: unknown[] };
      warnings: string[];
    };
    expect(Array.isArray(envelope.data.warnings)).toBe(true);
    // The safety caveat must survive contact with the real provider.
    expect(envelope.warnings.join(" ")).toContain("never an all-clear");
  });

  it("SSB Klass returns a well-formed, bounded classification-code search", async () => {
    // Anonymous, credential-free: municipality 0301 (Oslo) in classification 131.
    const result = await call("search_norwegian_classification_codes", {
      classificationId: 131,
      codePattern: "0301",
      date: "2024-01-01",
      limit: 5,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { codes: { code: string; name: string }[]; returnedCount: number };
      sources: { id: string }[];
    };
    expect(Array.isArray(envelope.data.codes)).toBe(true);
    expect(envelope.data.returnedCount).toBeLessThanOrEqual(5);
    expect(envelope.sources[0]?.id).toBe("ssb-klass");
  });

  it("SSB Klass resolves a historical municipality code with an explicit status", async () => {
    // 1142 (Rennesøy) was merged into 1103 (Stavanger) in 2020.
    const result = await call("resolve_norwegian_administrative_code", {
      kind: "municipality",
      code: "1142",
      targetDate: "2024-01-01",
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { status: string; matches: unknown[] };
      sources: { id: string }[];
    };
    expect(typeof envelope.data.status).toBe("string");
    expect(Array.isArray(envelope.data.matches)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("ssb-klass");
  });

  it("Fiskeridirektoratet returns a well-formed fishing-vessel search", async () => {
    // Anonymous and credential-free, so this runs like the other open providers.
    const result = await call("search_fishing_vessels", { municipalityCode: "1103", limit: 3 });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { vessels: unknown[] };
      sources: { id: string }[];
    };
    expect(Array.isArray(envelope.data.vessels)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("fiskeridir-vessels");
  });

  it("never returns a natural-person owner's details from the live register", async () => {
    // The privacy claim is asserted against the real provider, not only a fake:
    // a shape change upstream must not be able to introduce a leak silently.
    const result = await call("search_fishing_vessels", { minLength: 15, limit: 5 });

    expect(result.isError).toBeFalsy();
    const serialized = JSON.stringify(result.structuredContent);
    // The SDK's person branch is `{ entityType: "person" }` and nothing else;
    // this server drops the discriminator entirely and reports only a count.
    expect(serialized).not.toContain("entityType");
    expect(serialized).not.toContain('"person"');
  });

  it("Fiskeridirektoratet returns a well-formed aquaculture search", async () => {
    const result = await call("search_aquaculture_locations", {
      municipalityCode: "5055",
      limit: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { sites: unknown[] };
      sources: { id: string }[];
    };
    expect(Array.isArray(envelope.data.sites)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("fiskeridir-aqua");
  });

  it("gates the BarentsWatch tools cleanly when no AIS credentials are configured", async () => {
    const result = await call("get_vessel_profile", { mmsi: "257123456" });

    if (process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID"] === undefined) {
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]!.text;
      expect(text).toContain("NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID");
      // The error must name the variable, never echo a value.
      expect(text).not.toContain("client_secret");
    } else {
      // With credentials present, either a profile or a clean not-found is fine;
      // what must hold is a well-formed MCP result carrying the attribution.
      expect(result).toHaveProperty("content");
    }
  });

  it("takes a genuinely bounded live AIS sample when credentials are configured", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    const started = Date.now();
    const result = await call("get_live_vessel_positions", {
      // A small box in the Trondheimsfjord, a low limit and a short timeout:
      // this opens one connection for at most three seconds.
      boundingBox: { south: 63.4, west: 10.3, north: 63.5, east: 10.5 },
      limit: 5,
      timeoutMs: 3000,
    });
    const elapsed = Date.now() - started;

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { positionCount: number; stoppedBecause: string };
      sources: { id: string; attribution?: string }[];
    };

    expect(envelope.data.positionCount).toBeLessThanOrEqual(5);
    expect(["limit-reached", "timeout", "stream-ended"]).toContain(envelope.data.stoppedBecause);
    // The bound is real against the live feed, not only against a fake. The
    // pause between live calls is included, so this is generous.
    expect(elapsed).toBeLessThan(20_000);
    expect(envelope.sources[0]?.id).toBe("barentswatch-ais");
    expect(envelope.sources[0]?.attribution).toContain("Kystverket");
  });

  it("credits the real providers on a live vessel profile, not the SDK's composite source", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    // Regression guard for a defect only a live call exposes. A composed
    // profile's top-level `source` is a synthetic composite carrying no licence
    // and no attribution; crediting it would drop the BarentsWatch AIS
    // requirement that Kystverket be credited.
    const result = await call("get_vessel_profile", { mmsi: LIVE_MMSI });
    if (result.isError) return; // an MMSI can legitimately fall out of the feed

    const envelope = result.structuredContent as {
      sources: { id: string; license?: string; attribution?: string }[];
    };

    expect(envelope.sources.map((source) => source.id)).not.toContain(
      "barentswatch-ais+kartverket",
    );
    for (const source of envelope.sources) {
      expect(source.license, `${source.id} licence`).toBeTruthy();
      expect(source.attribution, `${source.id} attribution`).toBeTruthy();
    }
    const ais = envelope.sources.find((source) => source.id === "barentswatch-ais");
    expect(ais?.attribution).toContain("Kystverket");
  });

  it("ends a live sample on its timeout when the sea area is quiet", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    const started = Date.now();
    const result = await call("get_live_vessel_positions", {
      // Open ocean west of the coast: inside BarentsWatch coverage but with
      // little traffic, so only the timeout can end the sample.
      boundingBox: { south: 64.0, west: 2.0, north: 64.5, east: 3.0 },
      limit: 50,
      timeoutMs: 4000,
    });
    const elapsed = Date.now() - started;

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as { data: { stoppedBecause: string } };
    expect(envelope.data.stoppedBecause).toBe("timeout");
    // Honoured, and not appreciably overrun. The courtesy pause is included.
    expect(elapsed).toBeGreaterThanOrEqual(3_800);
    expect(elapsed).toBeLessThan(20_000);
  });

  it("cancels a live sample promptly instead of running to its timeout", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    const controller = new AbortController();
    const started = Date.now();
    const pending = client.callTool(
      {
        name: "get_live_vessel_positions",
        // A 15-second budget: without working cancellation this takes 15 s.
        arguments: { boundingBox: BUSY_BOX, limit: 200, timeoutMs: 15_000 },
      },
      undefined,
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 1_200);

    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(8_000);
    await pause();
  });

  it("does not accumulate connections across repeated cancelled live samples", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    // The real guarantee for a long-running server. A leaked connection per
    // cancelled sample would show as a socket count climbing with each pass;
    // a pooled, reused one stays flat.
    const socketCount = (): number =>
      (
        (
          process as unknown as { _getActiveHandles?: () => { constructor: { name: string } }[] }
        )._getActiveHandles?.() ?? []
      ).filter((handle) => ["Socket", "TLSSocket"].includes(handle?.constructor?.name)).length;

    const counts: number[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const controller = new AbortController();
      const pending = client.callTool(
        {
          name: "get_live_vessel_positions",
          arguments: { boundingBox: BUSY_BOX, limit: 200, timeoutMs: 15_000 },
        },
        undefined,
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 900);
      await pending.catch(() => undefined);
      // Teardown is asynchronous; sampling instantly would catch a connection
      // mid-close and report a leak that is not one.
      await pause();
      counts.push(socketCount());
    }

    expect(counts[counts.length - 1]).toBeLessThanOrEqual(counts[0]!);
  });

  it("leaks no credential into a live result, a live error, or stderr", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    const secrets = [
      process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID"],
      process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET"],
      process.env["NORWAY_MCP_BARENTSWATCH_CLIENT_ID"],
      process.env["NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET"],
    ].filter((value): value is string => typeof value === "string" && value.length >= 4);

    expect(secrets.length).toBeGreaterThan(0);

    const ok = await call("get_vessel_track", { mmsi: LIVE_MMSI, limit: 2 });
    const serialized = JSON.stringify(ok);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    // No Authorization header echoed back from the provider either.
    expect(/bearer\s+[A-Za-z0-9._-]{8,}/i.test(serialized)).toBe(false);
  });

  it("rejects a wrong secret cleanly, echoing neither the secret nor the client id", async () => {
    if (!HAS_AIS_CREDENTIALS) return;

    // A real client id with a deliberately wrong secret: the token endpoint
    // rejects it, which is the most likely path for a credential to surface in
    // an error message.
    const wrong = "deliberately-wrong-secret-value-for-this-test";
    const instance = createNorwayOpenDataMcpServer({
      logger: silentLogger,
      config: {
        barentswatchAisClientId: process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID"],
        barentswatchAisClientSecret: wrong,
      },
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const isolated = new Client({ name: "live-auth-fail", version: "1.0.0" });
    await Promise.all([isolated.connect(ct), instance.server.connect(st)]);

    try {
      const result = (await isolated.callTool({
        name: "get_vessel_track",
        arguments: { mmsi: LIVE_MMSI },
      })) as CallToolResult;

      expect(result.isError).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(wrong);
      expect(serialized).not.toContain(process.env["NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID"]!);
    } finally {
      await isolated.close();
      await instance.close();
      await pause();
    }
  });

  // -------------------------------------------------------------------------
  // Geospatial providers — all anonymous, all bounded to one small request.
  // -------------------------------------------------------------------------

  it("Geonorge returns a bounded, well-formed dataset catalogue search", async () => {
    const result = await call("search_geonorge_datasets", { query: "verneområder", limit: 3 });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { datasets: { id: string }[]; pagination: { totalItems: number } };
      sources: { id: string; license?: string; attribution?: string }[];
    };
    expect(Array.isArray(envelope.data.datasets)).toBe(true);
    expect(envelope.data.datasets.length).toBeLessThanOrEqual(3);
    expect(envelope.sources[0]?.id).toBe("geonorge");
    expect(envelope.sources[0]?.attribution).toContain("Kartverket");
  });

  it("Geonorge returns a full catalogue record for an identifier it just published", async () => {
    // Chained off the search rather than hard-coding a UUID, so this cannot rot
    // when Kartverket retires a record.
    const search = await call("search_geonorge_datasets", { query: "naturvernområder", limit: 1 });
    if (search.isError) return;

    const first = (search.structuredContent as { data: { datasets: { id: string }[] } }).data
      .datasets[0];
    if (first === undefined) return;

    const result = await call("get_geonorge_metadata", { id: first.id });
    expect(result.isError).toBeFalsy();

    const envelope = result.structuredContent as {
      data: { id: string; title: string; type: string; distributions: unknown[] };
      sources: { id: string }[];
      warnings: string[];
    };
    expect(envelope.data.id).toBe(first.id);
    expect(typeof envelope.data.title).toBe("string");
    expect(envelope.sources[0]?.id).toBe("geonorge");
    // No named individual survives the projection, against the live record.
    expect(JSON.stringify(envelope.data)).not.toMatch(/"email"/);
  });

  it("Naturbase answers a protected-area point lookup inside Jotunheimen", async () => {
    // Galdhøpiggen: inside Jotunheimen national park, so a match is expected —
    // but an empty result is tolerated rather than failed, since the assertion
    // that matters is the shape, the bound and the attribution.
    const result = await call("get_protected_areas_at", {
      latitude: 61.6365,
      longitude: 8.3126,
      limit: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { protectedAreas: { id: string; geometrySummary: { included: boolean } }[] };
      sources: { id: string; license?: string; attribution?: string }[];
      warnings: string[];
    };

    expect(Array.isArray(envelope.data.protectedAreas)).toBe(true);
    expect(envelope.data.protectedAreas.length).toBeLessThanOrEqual(3);
    // Geometry is off by default even against the live provider.
    for (const area of envelope.data.protectedAreas) {
      expect(area.geometrySummary.included).toBe(false);
    }
    expect(envelope.sources[0]?.id).toBe("naturbase");
    expect(envelope.sources[0]?.license).toContain("NLOD");
    expect(envelope.sources[0]?.attribution).toContain("Miljødirektoratet");
    // The safety caveat must survive contact with the real provider.
    expect(envelope.warnings.join(" ")).toContain("not evidence that no species");
  });

  it("returns real live geometry, with its holes and parts intact and within budget", async () => {
    const result = await call("get_protected_areas_at", {
      latitude: 61.6365,
      longitude: 8.3126,
      limit: 1,
      includeGeometry: true,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        protectedAreas: {
          geometry: { type: string; coordinates: unknown[] } | null;
          geometrySummary: {
            type: string;
            polygonCount: number;
            holeCount: number;
            vertexCount: number;
            included: boolean;
            omittedReason?: string;
          };
        }[];
      };
    };

    const area = envelope.data.protectedAreas[0];
    if (area === undefined) return; // an empty result is a valid outcome

    if (area.geometry === null) {
      // Refusal is allowed, but it must be explained rather than silent.
      expect(area.geometrySummary.included).toBe(false);
      expect(area.geometrySummary.omittedReason).toBeTruthy();
    } else {
      expect(["Polygon", "MultiPolygon"]).toContain(area.geometry.type);
      expect(area.geometry.coordinates.length).toBe(
        area.geometry.type === "Polygon"
          ? 1 + area.geometrySummary.holeCount
          : area.geometrySummary.polygonCount,
      );
      expect(area.geometrySummary.included).toBe(true);
    }
    // Whatever happened, the payload stayed inside the serialized budget.
    expect(JSON.stringify(result.structuredContent).length).toBeLessThanOrEqual(120_000);
  });

  it("Naturbase answers a bounded protected-area bounding-box search", async () => {
    const result = await call("search_protected_areas", {
      // A small window inside Jotunheimen, far below this server's span cap.
      boundingBox: { south: 61.5, west: 8.2, north: 61.7, east: 8.5 },
      limit: 5,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        protectedAreas: unknown[];
        pagination: { returned: number; truncated: boolean; hasMore: boolean };
      };
      sources: { id: string }[];
    };

    expect(envelope.data.protectedAreas.length).toBeLessThanOrEqual(5);
    expect(envelope.data.pagination.hasMore).toBe(envelope.data.pagination.truncated);
    expect(envelope.sources[0]?.id).toBe("naturbase");
  });

  it("Naturbase answers a nature-locality point lookup, or an empty one, without failing", async () => {
    const result = await call("get_nature_types_at", {
      latitude: 63.4305,
      longitude: 10.3951,
      limit: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { natureTypes: unknown[] };
      sources: { id: string }[];
      warnings: string[];
    };
    expect(Array.isArray(envelope.data.natureTypes)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("naturbase");
    expect(envelope.warnings.join(" ")).toContain("never been surveyed");
  });

  it("Naturbase answers intervention-free nature with its own attribution wording", async () => {
    const result = await call("get_intervention_free_nature_at", {
      latitude: 61.6365,
      longitude: 8.3126,
      limit: 2,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { interventionFreeAreas: { zone: string; statusDate: string }[] };
      sources: { id: string; license?: string; attribution?: string }[];
      warnings: string[];
    };

    expect(Array.isArray(envelope.data.interventionFreeAreas)).toBe(true);
    for (const zone of envelope.data.interventionFreeAreas) {
      expect(["1", "2", "v"]).toContain(zone.zone);
      expect(zone.statusDate).toBe("2023-01");
    }
    // The layer's distinct licence and wording must survive the live path, not
    // be collapsed into the general Naturbase terms.
    expect(envelope.sources[0]?.id).toBe("naturbase");
    if (envelope.data.interventionFreeAreas.length > 0) {
      expect(envelope.sources[0]?.attribution).toContain("inngrepsfri natur");
    }
    expect(envelope.warnings.join(" ")).toContain("January 2023 status only");
  });

  it("NIBIO classifies land resources at a mainland coordinate", async () => {
    const result = await call("get_land_resources_at", {
      latitude: 61.6365,
      longitude: 8.3126,
      limit: 2,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { landResources: { landTypeCode?: string; landType?: string }[] };
      sources: { id: string; license?: string; attribution?: string }[];
      warnings: string[];
    };

    expect(Array.isArray(envelope.data.landResources)).toBe(true);
    expect(envelope.sources[0]?.id).toBe("nibio");
    expect(envelope.sources[0]?.attribution).toBe("Kilde: NIBIO.");
    expect(envelope.warnings.join(" ")).toContain("generalized national land-resource map");
  });

  it("composes a live nature profile that credits every provider that answered", async () => {
    const result = await call("get_nature_profile", {
      latitude: 61.6365,
      longitude: 8.3126,
      limit: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        compositeSource: { id: string };
        components: { section: string; status: string; provider: string }[];
      };
      sources: { id: string; license?: string; attribution?: string }[];
      partial: { missing: string[] } | null;
    };

    // The synthetic composite is preserved as data but never as attribution.
    expect(envelope.data.compositeSource.id).toContain("+");
    expect(envelope.sources.map((source) => source.id)).not.toContain(
      envelope.data.compositeSource.id,
    );
    expect(envelope.sources.length).toBeGreaterThan(0);
    for (const source of envelope.sources) {
      expect(source.license, `${source.id} licence`).toBeTruthy();
      expect(source.attribution, `${source.id} attribution`).toBeTruthy();
    }
    // Every dataset reports its own outcome, whether or not it succeeded.
    expect(envelope.data.components.length).toBeGreaterThan(0);
  });

  it("refuses an oversized live bounding box without contacting the provider", async () => {
    const started = Date.now();
    const result = await call("search_protected_areas", {
      // The whole country: far past this server's span cap.
      boundingBox: { south: 58, west: 4, north: 71, east: 31 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("limit of this MCP server");
    // Rejected locally: no provider round trip could have fitted in this time
    // (the courtesy pause is included in the elapsed measurement).
    expect(Date.now() - started).toBeLessThan(PAUSE_MS + 2_000);
  });

  it("never accepts a service URL, even against live providers", async () => {
    const result = await call("get_geonorge_metadata", {
      id: "https://kart.miljodirektoratet.no/geoserver/wfs",
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text.toLowerCase()).toContain("identifier");
  });

  it("skips the weather tool cleanly when no contact email is configured", async () => {
    const result = await call("get_norwegian_weather_forecast", {
      latitude: 59.9139,
      longitude: 10.7522,
      hours: 3,
    });

    if (process.env["NORWAY_MCP_CONTACT_EMAIL"] === undefined) {
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]!.text;
      expect(text).toContain("NORWAY_MCP_CONTACT_EMAIL");
    } else {
      expect(result.isError).toBeFalsy();
    }
  });

  // -------------------------------------------------------------------------
  // Weather, tides and climate (0.5.0)
  // -------------------------------------------------------------------------

  it("Kartverket's Hydrographic Service returns a credited tide table for Bergen", async () => {
    const result = await call("get_norwegian_tides", {
      latitude: 60.398,
      longitude: 5.32,
      hours: 24,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        covered: boolean;
        window: { from: string; to: string };
        tideTable: {
          referenceLevel: string;
          unit: string;
          location: { name: string; code: string };
          events: { time: string; kind: string; value: number }[];
        } | null;
      };
      sources: { id: string; license?: string; attribution?: string }[];
      warnings: string[];
    };
    expect(envelope.data.covered).toBe(true);
    const table = envelope.data.tideTable!;
    // A day on the Norwegian coast always holds at least one high or low water.
    expect(table.events.length).toBeGreaterThan(0);
    for (const event of table.events) expect(["high", "low"]).toContain(event.kind);
    expect(table.location.code.length).toBeGreaterThan(0);
    expect(table.referenceLevel.length).toBeGreaterThan(0);
    expect(envelope.sources[0]?.id).toBe("kartverket-tides");
    expect(envelope.sources[0]?.license).toContain("CC BY 4.0");
    expect(envelope.sources[0]?.attribution).toContain("Hydrographic Service");
    expect(envelope.warnings.join(" ")).toContain("UTC");
  });

  it("returns live hourly water levels with each series type kept separate", async () => {
    const result = await call("get_norwegian_tides", {
      latitude: 60.398,
      longitude: 5.32,
      hours: 6,
      includeWaterLevels: true,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { waterLevels: { series: { type: string; values: unknown[] }[] } | null };
      partial: unknown;
    };
    if (envelope.partial === null) {
      const types = envelope.data.waterLevels!.series.map((series) => series.type);
      expect(types.length).toBeGreaterThan(0);
      expect(new Set(types).size).toBe(types.length);
    }
  });

  it("treats an inland point as not covered by the tide service, not as an error", async () => {
    // Lillehammer, far from the sea.
    const result = await call("get_norwegian_tides", { latitude: 61.115, longitude: 10.466 });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: { covered: boolean; tideTable: unknown };
    };
    expect(envelope.data.covered).toBe(false);
    expect(envelope.data.tideTable).toBeNull();
  });

  it("composes a live conditions profile that credits each provider that answered", async () => {
    const result = await call("get_weather_conditions_profile", {
      latitude: 60.398,
      longitude: 5.32,
      hours: 3,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        municipality: { municipalityCode: string } | null;
        tides: unknown;
        forecast: unknown;
        observations: unknown;
        components: { operation: string }[];
        compositeSource: { id: string };
      };
      sources: { id: string; license?: string }[];
      partial: { missing: string[] } | null;
    };
    expect(envelope.data.municipality?.municipalityCode).toBe("4601");
    expect(envelope.data.components).toHaveLength(14);
    const ids = envelope.sources.map((source) => source.id);
    expect(ids).toContain("kartverket");
    expect(ids).not.toContain(envelope.data.compositeSource.id);
    for (const source of envelope.sources) expect(source.license, source.id).toBeTruthy();

    if (!HAS_CONTACT_EMAIL) {
      expect(envelope.data.forecast).toBeNull();
      expect(envelope.partial?.missing).toContain("forecast: not-configured");
    } else {
      expect(ids).toContain("met");
    }
    if (!HAS_FROST_CLIENT_ID) {
      expect(envelope.data.observations).toBeNull();
      expect(envelope.partial?.missing).toContain("observations: not-configured");
    } else {
      expect(ids).toContain("met-frost");
    }
  });

  it("gates the three MET Norway weather tools cleanly without a contact email", async () => {
    if (HAS_CONTACT_EMAIL) return;
    for (const [name, args] of [
      ["get_norwegian_weather_warnings", {}],
      ["get_norwegian_precipitation_nowcast", { latitude: 59.91, longitude: 10.75 }],
      ["get_norwegian_sun_times", { latitude: 59.91, longitude: 10.75 }],
    ] as [string, Record<string, unknown>][]) {
      const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
      expect(result.isError, name).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]!.text;
      expect(text, name).toContain("NORWAY_MCP_CONTACT_EMAIL");
    }
  });

  it("MET Norway returns current warnings for Norway, or none, without failing", async () => {
    if (!HAS_CONTACT_EMAIL) return;
    const result = await call("get_norwegian_weather_warnings", {});

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        warnings: { messageType: string; geometry: unknown; awarenessLevel: { level: number } }[];
      };
      warnings: string[];
      sources: { id: string }[];
    };
    for (const warning of envelope.data.warnings) {
      expect(["Alert", "Update", "Cancel"]).toContain(warning.messageType);
      expect([1, 2, 3, 4]).toContain(warning.awarenessLevel.level);
      expect(warning.geometry).toBeNull();
    }
    expect(envelope.warnings.join(" ")).toContain("never an all-clear");
    expect(envelope.sources[0]?.id).toBe("met");
  });

  it("MET Norway returns a radar nowcast for Oslo and none for Svalbard", async () => {
    if (!HAS_CONTACT_EMAIL) return;
    const oslo = await call("get_norwegian_precipitation_nowcast", {
      latitude: 59.9139,
      longitude: 10.7522,
    });
    const svalbard = await call("get_norwegian_precipitation_nowcast", {
      latitude: 78.2232,
      longitude: 15.6267,
    });

    expect(oslo.isError).toBeFalsy();
    expect((oslo.structuredContent as { data: { coverage: string } }).data.coverage).toBe(
      "covered",
    );
    expect(svalbard.isError).toBeFalsy();
    expect(
      (svalbard.structuredContent as { data: { coverage: string; nowcast: unknown } }).data,
    ).toMatchObject({ coverage: "outside-radar-area", nowcast: null });
  });

  it("MET Norway reports polar night in Tromsø as an answer, with the Oslo offset", async () => {
    if (!HAS_CONTACT_EMAIL) return;
    const result = await call("get_norwegian_sun_times", {
      latitude: 69.6492,
      longitude: 18.9553,
      date: "2026-12-21",
    });

    expect(result.isError).toBeFalsy();
    const data = (
      result.structuredContent as {
        data: {
          polarCondition: string | null;
          sunrise: unknown;
          solarNoon: { time: string } | null;
        };
      }
    ).data;
    expect(data.polarCondition).toBe("polar-night");
    expect(data.sunrise).toBeNull();
    expect(data.solarNoon?.time).toContain("+01:00");
  });

  it("gates the Frost history tool cleanly without a client ID", async () => {
    if (HAS_FROST_CLIENT_ID) return;
    const result = (await client.callTool({
      name: "get_norwegian_weather_history",
      arguments: { stationId: "SN18700", startDate: daysAgo(7) },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("NORWAY_MCP_MET_FROST_CLIENT_ID");
    expect(text).not.toContain('credentials["met-frost"]');
  });

  it("Frost returns every offered daily element at Blindern, confirming their IDs", async () => {
    if (!HAS_FROST_CLIENT_ID) return;
    const result = await call("get_norwegian_weather_history", {
      stationId: "SN18700",
      resolution: "daily",
      startDate: daysAgo(10),
      endDate: daysAgo(4),
      includeNormals: true,
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        station: { id: string; name: string };
        records: { observations: { elementId: string }[] }[];
        normals: { period: string; values: unknown[] } | null;
      };
      sources: { id: string }[];
    };
    expect(envelope.data.station.id).toBe("SN18700");
    const seen = new Set(
      envelope.data.records.flatMap((record) =>
        record.observations.map((value) => value.elementId),
      ),
    );
    for (const id of [
      "mean(air_temperature P1D)",
      "min(air_temperature P1D)",
      "max(air_temperature P1D)",
      "sum(precipitation_amount P1D)",
      "max(wind_speed_of_gust P1D)",
    ]) {
      expect(seen, `Frost returned no ${id} at Blindern`).toContain(id);
    }
    expect(envelope.data.normals?.period).toBe("1991/2020");
    expect(envelope.data.normals?.values.length).toBeGreaterThan(0);
    expect(envelope.sources[0]?.id).toBe("met-frost");
  });

  it("Frost returns every offered hourly element at the station nearest Oslo, confirming their IDs", async () => {
    if (!HAS_FROST_CLIENT_ID) return;
    const result = await call("get_norwegian_weather_history", {
      latitude: 59.9139,
      longitude: 10.7522,
      resolution: "hourly",
      startDate: daysAgo(3),
    });

    expect(result.isError).toBeFalsy();
    const envelope = result.structuredContent as {
      data: {
        station: { distanceKm?: number };
        records: { observations: { elementId: string }[] }[];
      };
    };
    expect(envelope.data.station.distanceKm).toBeTypeOf("number");
    const seen = new Set(
      envelope.data.records.flatMap((record) =>
        record.observations.map((value) => value.elementId),
      ),
    );
    for (const id of [
      "air_temperature",
      "wind_speed",
      "relative_humidity",
      "sum(precipitation_amount PT1H)",
    ]) {
      expect(seen, `Frost returned no ${id} at the nearest station`).toContain(id);
    }
  });
});
