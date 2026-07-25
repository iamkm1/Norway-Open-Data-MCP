/**
 * Full per-tool matrix for `resolve_norwegian_administrative_code`.
 *
 * The central invariant: a merge, split or ambiguous result keeps every
 * official branch and never returns an automatically selected code.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  abortable,
  createFakeSdk,
  respond,
  sampleCountySplitResolution,
  sampleMunicipalityMergeResolution,
  sampleUnchangedResolution,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import type { KlassCodeResolution } from "norway-open-data-sdk";

const TOOL = "resolve_norwegian_administrative_code";
const KLASS = SOURCES["ssb-klass"]!;

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

type Resolver = (...args: never[]) => Promise<unknown>;

function withResolvers(overrides: {
  municipality?: Resolver;
  county?: Resolver;
}): Promise<Harness> {
  return createHarness({
    sdk: createFakeSdk({
      klass: {
        ...(overrides.municipality
          ? { resolveMunicipalityCode: overrides.municipality as never }
          : {}),
        ...(overrides.county ? { resolveCountyCode: overrides.county as never } : {}),
      },
    }),
  });
}

function resolution(overrides: Partial<KlassCodeResolution>): KlassCodeResolution {
  return { ...sampleUnchangedResolution, ...overrides };
}

describe("resolve_norwegian_administrative_code — routing", () => {
  it("routes a municipality kind to resolveMunicipalityCode", async () => {
    const municipality = vi.fn(() =>
      Promise.resolve(respond(sampleMunicipalityMergeResolution, KLASS)),
    );
    const county = vi.fn(() => Promise.resolve(respond(sampleUnchangedResolution, KLASS)));
    harness = await withResolvers({ municipality, county });

    await harness.callOk(TOOL, { kind: "municipality", code: "1142", targetDate: "2024-01-01" });

    expect(municipality).toHaveBeenCalledWith(
      expect.objectContaining({ code: "1142", targetDate: "2024-01-01", language: "nb" }),
      expect.anything(),
    );
    expect(county).not.toHaveBeenCalled();
  });

  it("routes a county kind to resolveCountyCode", async () => {
    const municipality = vi.fn(() => Promise.resolve(respond(sampleUnchangedResolution, KLASS)));
    const county = vi.fn(() => Promise.resolve(respond(sampleCountySplitResolution, KLASS)));
    harness = await withResolvers({ municipality, county });

    await harness.callOk(TOOL, { kind: "county", code: "30", targetDate: "2024-01-01" });

    expect(county).toHaveBeenCalledWith(
      expect.objectContaining({ code: "30", targetDate: "2024-01-01" }),
      expect.anything(),
    );
    expect(municipality).not.toHaveBeenCalled();
  });

  it("passes sourceDate through only when supplied", async () => {
    const municipality = vi.fn(() =>
      Promise.resolve(respond(sampleMunicipalityMergeResolution, KLASS)),
    );
    harness = await withResolvers({ municipality });

    await harness.callOk(TOOL, {
      kind: "municipality",
      code: "1142",
      targetDate: "2024-01-01",
      sourceDate: "2019-01-01",
    });

    expect(municipality).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDate: "2019-01-01" }),
      expect.anything(),
    );
  });

  it("defaults language to nb and forwards nn/en when given", async () => {
    const municipality = vi.fn(() => Promise.resolve(respond(sampleUnchangedResolution, KLASS)));
    harness = await withResolvers({ municipality });

    await harness.callOk(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
      language: "en",
    });

    expect(municipality).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
      expect.anything(),
    );
  });
});

describe("resolve_norwegian_administrative_code — invalid input", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["invalid kind", { kind: "country", code: "0301", targetDate: "2024-01-01" }],
    ["empty code", { kind: "municipality", code: "", targetDate: "2024-01-01" }],
    ["whitespace code", { kind: "municipality", code: "   ", targetDate: "2024-01-01" }],
    ["malformed municipality code", { kind: "municipality", code: "30", targetDate: "2024-01-01" }],
    ["malformed county code", { kind: "county", code: "0301", targetDate: "2024-01-01" }],
    ["invalid target date", { kind: "municipality", code: "0301", targetDate: "2024-13-40" }],
    [
      "invalid source date",
      { kind: "municipality", code: "0301", targetDate: "2024-01-01", sourceDate: "not-a-date" },
    ],
    ["missing target date", { kind: "municipality", code: "0301" }],
    [
      "invalid language",
      { kind: "municipality", code: "0301", targetDate: "2024-01-01", language: "no" },
    ],
    ["unknown property", { kind: "municipality", code: "0301", targetDate: "2024-01-01", x: 1 }],
    ["wrong type for code", { kind: "municipality", code: 301, targetDate: "2024-01-01" }],
  ];

  for (const [label, args] of cases) {
    it(`rejects ${label}`, async () => {
      harness = await withResolvers({
        municipality: () => Promise.reject(new Error("must not be called")),
        county: () => Promise.reject(new Error("must not be called")),
      });

      const call = await harness.call(TOOL, args);

      expect(call.isError).toBe(true);
      expect(errorText(call).length).toBeGreaterThan(0);
    });
  }

  it("does not contact the provider when input is invalid", async () => {
    const municipality = vi.fn(() => Promise.resolve(respond(sampleUnchangedResolution, KLASS)));
    harness = await withResolvers({ municipality });

    await harness.call(TOOL, { kind: "municipality", code: "30", targetDate: "2024-01-01" });

    expect(municipality).not.toHaveBeenCalled();
  });
});

describe("resolve_norwegian_administrative_code — statuses and shape", () => {
  async function callWith(
    data: KlassCodeResolution,
    kind: "municipality" | "county" = "municipality",
  ) {
    const resolver = () => Promise.resolve(respond(data, KLASS));
    harness = await withResolvers(
      kind === "municipality" ? { municipality: resolver } : { county: resolver },
    );
    return harness.callOk(TOOL, {
      kind,
      code: kind === "municipality" ? "0301" : "30",
      targetDate: "2024-01-01",
    });
  }

  it("preserves an unchanged status with attribution and timestamp", async () => {
    const envelope = await callWith(resolution({ status: "unchanged" }));

    expect(envelope.data["status"]).toBe("unchanged");
    expect(envelope.sources).toEqual([expect.objectContaining({ id: "ssb-klass" })]);
    expect(envelope.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
  });

  for (const status of ["renamed", "replaced", "not_found", "context_required"] as const) {
    it(`preserves the "${status}" status verbatim`, async () => {
      const envelope = await callWith(resolution({ status, matches: [] }));
      expect(envelope.data["status"]).toBe(status);
    });
  }

  it("keeps every branch of a MERGE and never auto-selects", async () => {
    const envelope = await callWith(sampleMunicipalityMergeResolution);

    expect(envelope.data["status"]).toBe("merged");
    const predecessors = envelope.data["predecessors"] as unknown[];
    expect(predecessors).toHaveLength(3);
    expect(envelope.data["matchCount"]).toBe(1);
    // The ambiguity note must be present so the model does not treat it as final.
    expect(envelope.warnings.join(" ")).toContain("requires application or human judgement");
  });

  it("keeps every branch of a SPLIT and never auto-selects", async () => {
    const envelope = await callWith(sampleCountySplitResolution, "county");

    expect(envelope.data["status"]).toBe("split");
    const matches = envelope.data["matches"] as { code: string }[];
    expect(matches.map((m) => m.code)).toEqual(["31", "32", "33"]);
    expect(envelope.data["matchCount"]).toBe(3);
    const successors = envelope.data["successors"] as unknown[];
    expect(successors).toHaveLength(3);
  });

  it("keeps every branch of an AMBIGUOUS mapping", async () => {
    const ambiguous = resolution({
      status: "ambiguous",
      matches: [
        { code: "5056", name: "Hitra", validFrom: "2018-01-01" },
        { code: "5061", name: "Rindal", validFrom: "2020-01-01" },
      ],
      warnings: ["The code cannot be assigned to a single version without a source date."],
    });

    const envelope = await callWith(ambiguous);

    expect(envelope.data["status"]).toBe("ambiguous");
    expect((envelope.data["matches"] as unknown[]).length).toBe(2);
    expect(envelope.data["matchCount"]).toBe(2);
    // The SDK's own warning survives alongside the standing ambiguity note.
    expect(envelope.warnings.join(" ")).toContain("single version");
    expect(envelope.warnings.join(" ")).toContain("human judgement");
  });

  it("surfaces multiple predecessors and successors", async () => {
    const envelope = await callWith(sampleCountySplitResolution, "county");
    expect((envelope.data["predecessors"] as unknown[]).length).toBe(1);
    expect((envelope.data["successors"] as unknown[]).length).toBe(3);
  });

  it("includes chronological change evidence and source code", async () => {
    const envelope = await callWith(sampleMunicipalityMergeResolution);
    const changes = envelope.data["changes"] as { occurredAt: string; newCode?: string }[];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.occurredAt).toBe("2020-01-01");
    expect(envelope.data["sourceCode"]).toMatchObject({ code: "1142", name: "Rennesøy" });
  });

  it("passes through an SDK warning", async () => {
    const envelope = await callWith(
      resolution({ status: "renamed", warnings: ["Renamed in 2020."] }),
    );
    expect(envelope.warnings).toContain("Renamed in 2020.");
  });

  it("reports truncation and never collapses matches to one when a huge split is bounded", async () => {
    const matches = Array.from({ length: 60 }, (_unused, index) => ({
      code: String(4000 + index),
      name: `Part ${index}`,
      validFrom: "2024-01-01",
    }));
    const envelope = await callWith(resolution({ status: "split", matches }));

    const returned = envelope.data["matches"] as unknown[];
    expect(returned.length).toBe(50);
    expect(returned.length).toBeGreaterThan(1); // never auto-selected to one
    expect(envelope.data["matchCount"]).toBe(60);
    expect(envelope.truncation).not.toBeNull();
    expect(envelope.truncation!.fields[0]).toMatchObject({ field: "matches", returned: 50 });
  });
});

describe("resolve_norwegian_administrative_code — infrastructure", () => {
  it("maps an upstream 404 as not_found", async () => {
    harness = await withResolvers({
      municipality: () =>
        Promise.reject(sdkError("NotFoundError", "No such code.", { provider: "ssb-klass" })),
    });

    const error = await harness.callErr(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
    });

    expect(error.code).toBe("not_found");
  });

  it("maps an upstream 400 as a non-retryable provider error", async () => {
    harness = await withResolvers({
      municipality: () =>
        Promise.reject(
          sdkError("ProviderError", "Bad request.", { provider: "ssb-klass", statusCode: 400 }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "provider_error", statusCode: 400, retryable: false });
  });

  it("preserves retryAfter on a 429", async () => {
    harness = await withResolvers({
      municipality: () =>
        Promise.reject(
          sdkError("RateLimitError", "Slow down.", {
            provider: "ssb-klass",
            statusCode: 429,
            retryAfter: 12,
          }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "rate_limited", retryAfter: 12, retryable: true });
  });

  it("maps a 500 as retryable", async () => {
    harness = await withResolvers({
      municipality: () =>
        Promise.reject(
          sdkError("ProviderError", "Server error.", { provider: "ssb-klass", statusCode: 503 }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "provider_error", retryable: true });
  });

  it("maps a malformed provider response without leaking the body", async () => {
    harness = await withResolvers({
      municipality: () =>
        Promise.reject(
          sdkError("ResponseValidationError", "Unexpected JSON.", {
            provider: "ssb-klass",
            cause: { issues: [{ path: ["secret"], message: "bad" }] },
          }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      kind: "municipality",
      code: "0301",
      targetDate: "2024-01-01",
    });

    expect(error.code).toBe("upstream_invalid_response");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("propagates the caller's abort signal into the SDK call", async () => {
    harness = await withResolvers({ municipality: abortable() });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      { name: TOOL, arguments: { kind: "municipality", code: "0301", targetDate: "2024-01-01" } },
      undefined,
      { signal: controller.signal },
    );

    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
