/**
 * Opt-in live provider tests.
 *
 * **Not part of CI.** Run with `pnpm test:live`, which sets
 * `RUN_LIVE_TESTS=true`. Without it every test here is skipped.
 *
 * Design rules, so this can never become a source of provider load:
 *
 * - Only anonymous, credential-free providers are contacted.
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
