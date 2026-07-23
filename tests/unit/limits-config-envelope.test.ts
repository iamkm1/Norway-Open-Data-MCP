import { describe, expect, it } from "vitest";

import {
  BUDGET,
  TruncationTracker,
  clampText,
  enforceSerializedBudget,
} from "../../src/limits/budget.js";
import { ResultTooLargeError } from "../../src/errors/map.js";
import { buildEnvelope, mergeProvenance } from "../../src/formatting/envelope.js";
import { describeConfig, resolveConfig, secretsOf } from "../../src/config/env.js";
import { DEFAULT_APPLICATION_NAME } from "../../src/version.js";
import { SOURCES, respond } from "../../src/testing/fake-sdk.js";

describe("truncation", () => {
  it("takes a deterministic leading slice and preserves provider order", () => {
    const tracker = new TruncationTracker();
    const items = Array.from({ length: 30 }, (_unused, index) => index);

    const first = tracker.limitArray("items", items, 5);
    const second = new TruncationTracker().limitArray("items", items, 5);

    expect(first).toEqual([0, 1, 2, 3, 4]);
    expect(first).toEqual(second);
  });

  it("reports upstream availability even when the page was not itself truncated", () => {
    const tracker = new TruncationTracker();
    tracker.limitArray("items", [1, 2, 3], 10, 250);

    expect(tracker.report()).toEqual({
      truncated: true,
      fields: [{ field: "items", returned: 3, availableUpstream: 250, reason: "limit" }],
    });
    expect(tracker.warnings()[0]).toContain("of 250 available");
  });

  it("does not report truncation when everything fits", () => {
    const tracker = new TruncationTracker();
    tracker.limitArray("items", [1, 2, 3], 10, 3);
    expect(tracker.report()).toBeNull();
    expect(tracker.warnings()).toEqual([]);
  });

  it("applies the array backstop even when a tool asks for more", () => {
    const tracker = new TruncationTracker();
    const items = Array.from({ length: 500 }, (_unused, index) => index);

    const limited = tracker.limitArray("items", items, 400);

    expect(limited).toHaveLength(BUDGET.maxArrayItems);
    expect(tracker.entries[0]!.reason).toBe("backstop");
  });

  it("clamps a long string and marks the cut visibly", () => {
    const tracker = new TruncationTracker();
    const clamped = tracker.clampString("description", "x".repeat(5000));

    expect(clamped).toHaveLength(BUDGET.maxStringChars);
    expect(clamped.endsWith("…")).toBe(true);
    expect(tracker.report()!.truncated).toBe(true);
  });

  it("leaves a short string untouched and unreported", () => {
    const tracker = new TruncationTracker();
    expect(tracker.clampString("description", "short")).toBe("short");
    expect(tracker.report()).toBeNull();
  });
});

describe("serialized output budget", () => {
  it("passes a payload that already fits through unchanged", () => {
    const payload = { data: { items: [1, 2, 3] } };
    const reductions: unknown[] = [];

    const result = enforceSerializedBudget(payload, (entry) => reductions.push(entry));

    expect(result).toEqual(payload);
    expect(reductions).toEqual([]);
  });

  it("halves the largest array until the payload fits and reports every reduction", () => {
    const payload = {
      data: {
        big: Array.from({ length: 4000 }, (_unused, index) => ({
          index,
          text: "x".repeat(60),
        })),
        small: [1, 2, 3],
      },
    };
    const reductions: { field: string; reason: string }[] = [];

    const result = enforceSerializedBudget(payload, (entry) => reductions.push(entry));

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(BUDGET.maxSerializedChars);
    expect(reductions.some((entry) => entry.field === "big" && entry.reason === "budget")).toBe(
      true,
    );
    // Untouched fields keep their meaning.
    expect((result.data as { small: number[] }).small).toEqual([1, 2, 3]);
  });

  it("throws rather than silently emitting an oversized result it cannot reduce", () => {
    const payload = { data: { blob: "x".repeat(BUDGET.maxSerializedChars + 1000) } };
    expect(() => enforceSerializedBudget(payload, () => {})).toThrow(ResultTooLargeError);
  });

  it("clamps the rendered text block and says so", () => {
    const clamped = clampText("x".repeat(BUDGET.maxTextChars + 500));
    expect(clamped.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    expect(clamped).toContain("output truncated");
  });
});

describe("envelope provenance", () => {
  it("de-duplicates sources and keeps the newest retrieval time", () => {
    const provenance = mergeProvenance([
      respond({}, SOURCES["brreg"]!, { retrievedAt: "2026-07-23T10:00:00.000Z" }),
      respond({}, SOURCES["brreg"]!, { retrievedAt: "2026-07-23T12:00:00.000Z" }),
      respond({}, SOURCES["kartverket"]!, { retrievedAt: "2026-07-23T11:00:00.000Z" }),
    ]);

    expect(provenance.sources.map((source) => source.id)).toEqual(["brreg", "kartverket"]);
    expect(provenance.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
  });

  it("claims cached only when every contributing response was cached", () => {
    expect(
      mergeProvenance([
        respond({}, SOURCES["brreg"]!, { cached: true }),
        respond({}, SOURCES["ssb"]!, { cached: true }),
      ]).cached,
    ).toBe(true);

    expect(
      mergeProvenance([
        respond({}, SOURCES["brreg"]!, { cached: true }),
        respond({}, SOURCES["ssb"]!, { cached: false }),
      ]).cached,
    ).toBe(false);
  });

  it("never invents metadata the SDK did not supply", () => {
    const envelope = buildEnvelope({ data: { x: 1 }, responses: [respond({}, SOURCES["ssb"]!)] });

    expect(envelope.sources[0]).toEqual({
      id: "ssb",
      name: "Statistics Norway (SSB)",
      homepage: "https://www.ssb.no/en/",
      documentation: "https://www.ssb.no/en/api/pxwebapiv2",
      license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      attribution: "Attribute Statistics Norway when redistributing data.",
    });
    // brreg declares no attribution; the field must be absent, not empty.
    const brreg = buildEnvelope({ data: {}, responses: [respond({}, SOURCES["brreg"]!)] });
    expect(brreg.sources[0]).not.toHaveProperty("attribution");
  });

  it("defaults the empty parts of the envelope predictably", () => {
    const envelope = buildEnvelope({ data: {}, responses: [respond({}, SOURCES["ssb"]!)] });
    expect(envelope.warnings).toEqual([]);
    expect(envelope.truncation).toBeNull();
    expect(envelope.partial).toBeNull();
    expect(envelope.continuation).toBeNull();
  });
});

describe("configuration", () => {
  it("applies documented defaults with an empty environment", () => {
    const { config, problems } = resolveConfig({});

    expect(config).toMatchObject({
      applicationName: DEFAULT_APPLICATION_NAME,
      timeoutMs: 10_000,
      retries: 2,
      cacheEnabled: true,
      debug: false,
    });
    expect(config.contactEmail).toBeUndefined();
    expect(problems).toEqual([]);
  });

  it("never defaults a contact email", () => {
    expect(resolveConfig({}).config.contactEmail).toBeUndefined();
  });

  it("reads valid overrides", () => {
    const { config } = resolveConfig({
      NORWAY_MCP_APP_NAME: "my-app/2.0",
      NORWAY_MCP_CONTACT_EMAIL: "ola@example.com",
      NORWAY_MCP_TIMEOUT_MS: "20000",
      NORWAY_MCP_RETRIES: "0",
      NORWAY_MCP_CACHE: "0",
      NORWAY_MCP_DEBUG: "true",
    });

    expect(config).toMatchObject({
      applicationName: "my-app/2.0",
      contactEmail: "ola@example.com",
      timeoutMs: 20_000,
      retries: 0,
      cacheEnabled: false,
      debug: true,
    });
  });

  it.each([
    ["a malformed email", { NORWAY_MCP_CONTACT_EMAIL: "not-an-email" }, "NORWAY_MCP_CONTACT_EMAIL"],
    ["a non-numeric timeout", { NORWAY_MCP_TIMEOUT_MS: "soon" }, "NORWAY_MCP_TIMEOUT_MS"],
    ["an out-of-range timeout", { NORWAY_MCP_TIMEOUT_MS: "999999" }, "NORWAY_MCP_TIMEOUT_MS"],
    ["a negative retry count", { NORWAY_MCP_RETRIES: "-1" }, "NORWAY_MCP_RETRIES"],
    ["a nonsense boolean", { NORWAY_MCP_CACHE: "maybe" }, "NORWAY_MCP_CACHE"],
  ])("reports %s as a problem and falls back to the default", (_label, env, variable) => {
    const { config, problems } = resolveConfig(env);

    expect(problems.map((problem) => problem.variable)).toContain(variable);
    // Falling back keeps the server usable rather than killing the process.
    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(config.retries).toBeGreaterThanOrEqual(0);
  });

  it("does not carry an invalid email forward into the SDK", () => {
    // Passing it through would throw at SDK construction and disable every tool.
    expect(resolveConfig({ NORWAY_MCP_CONTACT_EMAIL: "bad" }).config.contactEmail).toBeUndefined();
  });

  it("treats whitespace-only values as unset", () => {
    const { config } = resolveConfig({
      NORWAY_MCP_CONTACT_EMAIL: "   ",
      NORWAY_MCP_APP_NAME: "  ",
    });
    expect(config.contactEmail).toBeUndefined();
    expect(config.applicationName).toBe(DEFAULT_APPLICATION_NAME);
  });

  it("rejects an over-long application name", () => {
    const { config, problems } = resolveConfig({ NORWAY_MCP_APP_NAME: "x".repeat(200) });
    expect(config.applicationName).toBe(DEFAULT_APPLICATION_NAME);
    expect(problems).toHaveLength(1);
  });

  it("masks secrets in the doctor view", () => {
    const { config } = resolveConfig({
      NORWAY_MCP_CONTACT_EMAIL: "ola.nordmann@example.com",
      NORWAY_MCP_NVE_API_KEY: "super-secret-key",
    });
    const described = JSON.stringify(describeConfig(config));

    expect(described).not.toContain("super-secret-key");
    expect(described).not.toContain("ola.nordmann@example.com");
    expect(described).toContain("o***n@example.com");
  });

  it("exposes exactly the secret values that need redacting", () => {
    const { config } = resolveConfig({
      NORWAY_MCP_CONTACT_EMAIL: "ola@example.com",
      NORWAY_MCP_NVE_API_KEY: "key-123456",
    });
    expect(secretsOf(config)).toEqual(["ola@example.com", "key-123456"]);
  });
});
