/**
 * Full per-tool matrix for `search_norwegian_companies`, used as the reference
 * shape for the other nine tool suites.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  createFakeSdk,
  respond,
  sampleCompanySearch,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import type { CompanySearchResult } from "norway-open-data-sdk";

const TOOL = "search_norwegian_companies";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function withSearch(implementation: (...args: never[]) => Promise<unknown>): Promise<Harness> {
  return createHarness({
    sdk: createFakeSdk({
      companies: { search: implementation as never },
    }),
  });
}

function result(
  items: CompanySearchResult["items"],
  totalItems = items.length,
): CompanySearchResult {
  return {
    items,
    pagination: { page: 0, size: 10, totalItems, totalPages: Math.ceil(totalItems / 10) || 1 },
  };
}

describe("search_norwegian_companies — valid requests", () => {
  it("returns companies with attribution, timestamp and cache status", async () => {
    harness = await withSearch(() =>
      Promise.resolve(respond(sampleCompanySearch, SOURCES["brreg"]!)),
    );

    const envelope = await harness.callOk(TOOL, { name: "Equinor" });

    expect(envelope.data["companies"]).toHaveLength(1);
    expect(envelope.sources).toEqual([
      expect.objectContaining({
        id: "brreg",
        name: "Brønnøysundregistrene",
        license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
      }),
    ]);
    expect(envelope.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
    expect(envelope.cached).toBe(false);
    expect(envelope.truncation).toBeNull();
  });

  it("accepts the minimum input (a single filter) and applies defaults", async () => {
    const search = vi.fn(() => Promise.resolve(respond(sampleCompanySearch, SOURCES["brreg"]!)));
    harness = await withSearch(search);

    await harness.callOk(TOOL, { name: "Equinor" });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Equinor", page: 0, size: 10 }),
      expect.anything(),
    );
  });

  it("accepts the maximum input with every field at its limit", async () => {
    const search = vi.fn(() => Promise.resolve(respond(result([]), SOURCES["brreg"]!)));
    harness = await withSearch(search);

    await harness.callOk(TOOL, {
      name: "a".repeat(200),
      organizationNumber: "923609016",
      municipalityCode: "0301",
      industryCode: "62.010",
      organizationForm: "AS",
      limit: 50,
      page: 100,
    });

    // `limit` is the tool's input name; the SDK parameter is `size`.
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 50,
        page: 100,
        organizationNumber: "923609016",
        municipalityCode: "0301",
        industryCode: "62.010",
        organizationForm: "AS",
      }),
      expect.anything(),
    );
  });

  it("normalises a spaced organization number and an lowercase legal form", async () => {
    const search = vi.fn(() => Promise.resolve(respond(result([]), SOURCES["brreg"]!)));
    harness = await withSearch(search);

    await harness.callOk(TOOL, { organizationNumber: "923 609 016", organizationForm: "as" });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ organizationNumber: "923609016", organizationForm: "AS" }),
      expect.anything(),
    );
  });
});

describe("search_norwegian_companies — result shapes", () => {
  it("handles an empty result without warnings or truncation", async () => {
    harness = await withSearch(() => Promise.resolve(respond(result([], 0), SOURCES["brreg"]!)));

    const envelope = await harness.callOk(TOOL, { name: "nonexistent" });

    expect(envelope.data["companies"]).toEqual([]);
    expect(envelope.truncation).toBeNull();
    expect(envelope.text).toContain("No organizations matched");
  });

  it("handles exactly one result", async () => {
    harness = await withSearch(() =>
      Promise.resolve(respond(sampleCompanySearch, SOURCES["brreg"]!)),
    );

    const envelope = await harness.callOk(TOOL, { name: "Equinor" });

    expect(envelope.data["companies"]).toHaveLength(1);
    expect(envelope.text).toContain("EQUINOR ASA");
  });

  it("handles multiple results", async () => {
    const many = result(
      Array.from({ length: 5 }, (_unused, index) => ({
        ...sampleCompanySearch.items[0]!,
        organizationNumber: String(900000000 + index),
        name: `COMPANY ${index}`,
      })),
    );
    harness = await withSearch(() => Promise.resolve(respond(many, SOURCES["brreg"]!)));

    const envelope = await harness.callOk(TOOL, { municipalityCode: "0301" });

    expect(envelope.data["companies"]).toHaveLength(5);
  });

  it("truncates deterministically and reports it structurally and in prose", async () => {
    const many = result(
      Array.from({ length: 30 }, (_unused, index) => ({
        ...sampleCompanySearch.items[0]!,
        organizationNumber: String(900000000 + index),
        name: `COMPANY ${index}`,
      })),
      214,
    );
    harness = await withSearch(() => Promise.resolve(respond(many, SOURCES["brreg"]!)));

    const envelope = await harness.callOk(TOOL, { municipalityCode: "0301", limit: 10 });

    const companies = envelope.data["companies"] as { name: string }[];
    expect(companies).toHaveLength(10);
    // Leading slice, provider order preserved.
    expect(companies[0]!.name).toBe("COMPANY 0");
    expect(companies[9]!.name).toBe("COMPANY 9");

    expect(envelope.truncation).toEqual({
      truncated: true,
      fields: [
        expect.objectContaining({ field: "companies", returned: 10, availableUpstream: 214 }),
      ],
    });
    expect(envelope.warnings.join(" ")).toContain("Showing 10");
    expect(envelope.text).toContain("Showing 10");
  });

  it("offers safe continuation arguments when more pages exist", async () => {
    const paged: CompanySearchResult = {
      items: sampleCompanySearch.items,
      pagination: { page: 0, size: 10, totalItems: 45, totalPages: 5 },
    };
    harness = await withSearch(() => Promise.resolve(respond(paged, SOURCES["brreg"]!)));

    const envelope = await harness.callOk(TOOL, { name: "Equinor" });

    expect(envelope.continuation).toEqual({
      hasMore: true,
      nextArguments: expect.objectContaining({ page: 1, name: "Equinor" }),
    });
  });
});

describe("search_norwegian_companies — invalid input", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["no filter at all", {}],
    ["blank name", { name: "   " }],
    ["name too long", { name: "a".repeat(201) }],
    ["organization number too short", { organizationNumber: "12345" }],
    ["organization number non-numeric", { organizationNumber: "abcdefghi" }],
    ["municipality code wrong length", { municipalityCode: "301" }],
    ["negative limit", { name: "x", limit: -1 }],
    ["zero limit", { name: "x", limit: 0 }],
    ["limit above maximum", { name: "x", limit: 5000 }],
    ["fractional limit", { name: "x", limit: 2.5 }],
    ["NaN limit", { name: "x", limit: Number.NaN }],
    ["negative page", { name: "x", page: -1 }],
    ["unknown property", { name: "x", bogus: true }],
    ["wrong type for name", { name: 42 }],
  ];

  for (const [label, args] of cases) {
    it(`rejects ${label}`, async () => {
      harness = await withSearch(() => Promise.reject(new Error("must not be called")));

      const call = await harness.call(TOOL, args);

      expect(call.isError).toBe(true);
      expect(errorText(call).length).toBeGreaterThan(0);
    });
  }

  it("does not contact the provider when input is invalid", async () => {
    const search = vi.fn(() => Promise.resolve(respond(result([]), SOURCES["brreg"]!)));
    harness = await withSearch(search);

    await harness.call(TOOL, { limit: -5 });

    expect(search).not.toHaveBeenCalled();
  });
});

describe("search_norwegian_companies — provider failures", () => {
  it("maps a provider error and marks it non-retryable for a 4xx", async () => {
    harness = await withSearch(() =>
      Promise.reject(
        sdkError("ProviderError", "Upstream failed.", { provider: "brreg", statusCode: 400 }),
      ),
    );

    const error = await harness.callErr(TOOL, { name: "Equinor" });

    expect(error.code).toBe("provider_error");
    expect(error.provider).toBe("brreg");
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it("preserves retryAfter on a rate limit", async () => {
    harness = await withSearch(() =>
      Promise.reject(
        sdkError("RateLimitError", "Too many requests.", {
          provider: "brreg",
          statusCode: 429,
          retryAfter: 30,
        }),
      ),
    );

    const error = await harness.callErr(TOOL, { name: "Equinor" });

    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfter: 30,
      retryable: true,
      statusCode: 429,
    });
  });

  it("maps a timeout as retryable", async () => {
    harness = await withSearch(() =>
      Promise.reject(sdkError("RequestTimeoutError", "Timed out.", { provider: "brreg" })),
    );

    const error = await harness.callErr(TOOL, { name: "Equinor" });

    expect(error).toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps an upstream schema failure without leaking the body", async () => {
    harness = await withSearch(() =>
      Promise.reject(
        sdkError("ResponseValidationError", "Provider returned unexpected JSON.", {
          provider: "brreg",
          cause: { issues: [{ path: ["secret"], message: "bad" }] },
        }),
      ),
    );

    const error = await harness.callErr(TOOL, { name: "Equinor" });

    expect(error.code).toBe("upstream_invalid_response");
    expect(JSON.stringify(error)).not.toContain("secret");
  });
});

describe("search_norwegian_companies — cancellation", () => {
  it("propagates the caller's abort signal into the SDK call", async () => {
    let receivedSignal: AbortSignal | undefined;
    harness = await withSearch((_parameters: unknown, options: { signal?: AbortSignal }) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      { name: TOOL, arguments: { name: "Equinor" } },
      undefined,
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    expect(receivedSignal!.aborted).toBe(false);

    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(receivedSignal!.aborted).toBe(true);
  });
});
