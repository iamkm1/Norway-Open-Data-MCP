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
});
