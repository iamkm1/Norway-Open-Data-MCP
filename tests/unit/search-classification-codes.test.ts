/**
 * Full per-tool matrix for `search_norwegian_classification_codes`.
 *
 * Covers the two routing paths (exact code via getCode, pattern via searchCodes),
 * the not-found fallback, bounding, and the standard error/cancellation matrix.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  abortable,
  createFakeSdk,
  respond,
  sampleClassificationCodes,
  sampleKlassCode,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import type { KlassCode, KlassSearchCodesResult } from "norway-open-data-sdk";

const TOOL = "search_norwegian_classification_codes";
const KLASS = SOURCES["ssb-klass"]!;

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

type Resolver = (...args: never[]) => Promise<unknown>;

function withKlass(overrides: { getCode?: Resolver; searchCodes?: Resolver }): Promise<Harness> {
  return createHarness({
    sdk: createFakeSdk({
      klass: {
        ...(overrides.getCode ? { getCode: overrides.getCode as never } : {}),
        ...(overrides.searchCodes ? { searchCodes: overrides.searchCodes as never } : {}),
      },
    }),
  });
}

function searchResult(
  items: KlassCode[],
  totalItems = items.length,
  upstreamPaged = false,
): KlassSearchCodesResult {
  return {
    items,
    pagination: {
      page: 0,
      pageSize: 10,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / 10)),
      upstreamPaged,
    },
  };
}

describe("search_norwegian_classification_codes — routing", () => {
  it("routes an exact code to getCode, not searchCodes", async () => {
    const getCode = vi.fn(() => Promise.resolve(respond(sampleKlassCode, KLASS)));
    const searchCodes = vi.fn(() => Promise.resolve(respond(searchResult([]), KLASS)));
    harness = await withKlass({ getCode, searchCodes });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 131,
      codePattern: "0301",
      date: "2024-01-01",
    });

    expect(getCode).toHaveBeenCalledWith(
      expect.objectContaining({ classificationId: 131, code: "0301", date: "2024-01-01" }),
      expect.anything(),
    );
    expect(searchCodes).not.toHaveBeenCalled();
    expect(envelope.data["mode"]).toBe("exact");
    expect(envelope.data["codes"]).toHaveLength(1);
    expect(envelope.data["matchedCount"]).toBe(1);
  });

  it("routes a wildcard pattern to searchCodes, not getCode", async () => {
    const getCode = vi.fn(() => Promise.resolve(respond(sampleKlassCode, KLASS)));
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ getCode, searchCodes });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ classificationId: 7, codePattern: "25*", pageSize: 10 }),
      expect.anything(),
    );
    expect(getCode).not.toHaveBeenCalled();
    expect(envelope.data["mode"]).toBe("pattern");
    expect(envelope.data["codes"]).toHaveLength(2);
  });

  it("routes a range pattern to searchCodes", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ searchCodes });

    await harness.callOk(TOOL, { classificationId: 6, codePattern: "01-05", date: "2024-01-01" });

    expect(searchCodes).toHaveBeenCalled();
  });

  it("routes an exact code WITH a level filter to searchCodes (getCode has no level)", async () => {
    const getCode = vi.fn(() => Promise.resolve(respond(sampleKlassCode, KLASS)));
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ getCode, searchCodes });

    await harness.callOk(TOOL, {
      classificationId: 131,
      codePattern: "0301",
      level: "1",
      date: "2024-01-01",
    });

    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ level: "1" }),
      expect.anything(),
    );
    expect(getCode).not.toHaveBeenCalled();
  });

  it("falls back from a not-found exact code to an attributed empty search result", async () => {
    const getCode = vi.fn(() =>
      Promise.reject(sdkError("NotFoundError", "No such code.", { provider: "ssb-klass" })),
    );
    const searchCodes = vi.fn(() => Promise.resolve(respond(searchResult([], 0), KLASS)));
    harness = await withKlass({ getCode, searchCodes });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 131,
      codePattern: "9999",
      date: "2024-01-01",
    });

    expect(getCode).toHaveBeenCalled();
    expect(searchCodes).toHaveBeenCalled();
    expect(envelope.data["codes"]).toEqual([]);
    expect(envelope.data["matchedCount"]).toBe(0);
    expect(envelope.sources).toEqual([expect.objectContaining({ id: "ssb-klass" })]);
    expect(envelope.text).toContain("No matching codes");
  });

  it("defaults the date to today (Europe/Oslo) when omitted", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ searchCodes });

    await harness.callOk(TOOL, { classificationId: 7, codePattern: "25*" });

    // FIXED_NOW is 2026-07-23T10:00:00Z → 2026-07-23 in Europe/Oslo.
    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-07-23" }),
      expect.anything(),
    );
  });
});

describe("search_norwegian_classification_codes — language and limit", () => {
  it("defaults language to nb", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ searchCodes });

    await harness.callOk(TOOL, { classificationId: 7, codePattern: "25*" });

    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ language: "nb" }),
      expect.anything(),
    );
  });

  for (const language of ["nb", "nn", "en"] as const) {
    it(`forwards language ${language}`, async () => {
      const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
      harness = await withKlass({ searchCodes });

      await harness.callOk(TOOL, { classificationId: 7, codePattern: "25*", language });

      expect(searchCodes).toHaveBeenCalledWith(
        expect.objectContaining({ language }),
        expect.anything(),
      );
    });
  }

  it("applies the default limit of 10 as the page size", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ searchCodes });

    await harness.callOk(TOOL, { classificationId: 7, codePattern: "25*" });

    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 10 }),
      expect.anything(),
    );
  });

  it("accepts the maximum limit of 20", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    harness = await withKlass({ searchCodes });

    await harness.callOk(TOOL, { classificationId: 7, codePattern: "25*", limit: 20 });

    expect(searchCodes).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 20 }),
      expect.anything(),
    );
  });
});

describe("search_norwegian_classification_codes — invalid input", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["invalid classification id (zero)", { classificationId: 0, codePattern: "25*" }],
    ["invalid classification id (negative)", { classificationId: -3, codePattern: "25*" }],
    ["invalid classification id (fractional)", { classificationId: 2.5, codePattern: "25*" }],
    ["invalid classification id (NaN)", { classificationId: Number.NaN, codePattern: "25*" }],
    ["wrong type for classification id", { classificationId: "131", codePattern: "0301" }],
    ["empty pattern", { classificationId: 131, codePattern: "" }],
    ["whitespace pattern", { classificationId: 131, codePattern: "   " }],
    ["pattern with illegal characters", { classificationId: 131, codePattern: "os lo!" }],
    ["invalid date", { classificationId: 131, codePattern: "0301", date: "2024-99-99" }],
    ["invalid level", { classificationId: 131, codePattern: "0*", level: "abc" }],
    ["limit below minimum", { classificationId: 7, codePattern: "25*", limit: 0 }],
    ["limit above maximum", { classificationId: 7, codePattern: "25*", limit: 21 }],
    ["fractional limit", { classificationId: 7, codePattern: "25*", limit: 3.5 }],
    ["unknown property", { classificationId: 7, codePattern: "25*", bogus: true }],
    ["invalid language", { classificationId: 7, codePattern: "25*", language: "no" }],
  ];

  for (const [label, args] of cases) {
    it(`rejects ${label}`, async () => {
      harness = await withKlass({
        getCode: () => Promise.reject(new Error("must not be called")),
        searchCodes: () => Promise.reject(new Error("must not be called")),
      });

      const call = await harness.call(TOOL, args);

      expect(call.isError).toBe(true);
      expect(errorText(call).length).toBeGreaterThan(0);
    });
  }

  it("does not contact the provider when input is invalid", async () => {
    const searchCodes = vi.fn(() => Promise.resolve(respond(sampleClassificationCodes, KLASS)));
    const getCode = vi.fn(() => Promise.resolve(respond(sampleKlassCode, KLASS)));
    harness = await withKlass({ getCode, searchCodes });

    await harness.call(TOOL, { classificationId: 0, codePattern: "" });

    expect(searchCodes).not.toHaveBeenCalled();
    expect(getCode).not.toHaveBeenCalled();
  });
});

describe("search_norwegian_classification_codes — result shapes", () => {
  it("returns an exact match with hierarchy and validity fields", async () => {
    harness = await withKlass({ getCode: () => Promise.resolve(respond(sampleKlassCode, KLASS)) });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 131,
      codePattern: "0301",
      date: "2024-01-01",
    });

    const codes = envelope.data["codes"] as Record<string, unknown>[];
    expect(codes[0]).toMatchObject({ code: "0301", name: "Oslo", level: "1" });
  });

  it("returns multiple pattern matches with counts and paging metadata", async () => {
    harness = await withKlass({
      searchCodes: () => Promise.resolve(respond(sampleClassificationCodes, KLASS)),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(envelope.data["codes"]).toHaveLength(2);
    expect(envelope.data["returnedCount"]).toBe(2);
    expect(envelope.data["matchedCount"]).toBe(2);
    expect(envelope.data["upstreamPaged"]).toBe(false);
  });

  it("handles no matches as a clean empty result", async () => {
    harness = await withKlass({
      searchCodes: () => Promise.resolve(respond(searchResult([], 0), KLASS)),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "99*",
      date: "2024-01-01",
    });

    expect(envelope.data["codes"]).toEqual([]);
    expect(envelope.truncation).toBeNull();
    expect(envelope.text).toContain("No matching codes");
  });

  it("tolerates codes with nullable/absent optional fields", async () => {
    const minimal: KlassCode = { code: "1", name: "Section", level: "1" };
    harness = await withKlass({
      searchCodes: () => Promise.resolve(respond(searchResult([minimal]), KLASS)),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 6,
      codePattern: "1*",
      date: "2024-01-01",
    });

    const codes = envelope.data["codes"] as Record<string, unknown>[];
    expect(codes[0]).toEqual({ code: "1", name: "Section", level: "1" });
    expect(codes[0]).not.toHaveProperty("validFrom");
  });

  it("bounds output independently of upstream size and reports truncation", async () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({
      code: String(2500 + index),
      name: `Occupation ${index}`,
      level: "4",
    }));
    harness = await withKlass({
      searchCodes: () => Promise.resolve(respond(searchResult(many, 213), KLASS)),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
      limit: 15,
    });

    expect((envelope.data["codes"] as unknown[]).length).toBe(15);
    expect(envelope.data["matchedCount"]).toBe(213);
    expect(envelope.truncation).not.toBeNull();
    expect(envelope.truncation!.fields[0]).toMatchObject({ field: "codes", returned: 15 });
    expect(envelope.warnings.join(" ")).toContain("Showing 15");
  });

  it("surfaces upstream paging metadata when Klass paged the response", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.resolve(respond(searchResult(sampleClassificationCodes.items, 2, true), KLASS)),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(envelope.data["upstreamPaged"]).toBe(true);
  });

  it("reports cache status from the SDK response", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.resolve(respond(sampleClassificationCodes, KLASS, { cached: true })),
    });

    const envelope = await harness.callOk(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(envelope.cached).toBe(true);
  });
});

describe("search_norwegian_classification_codes — infrastructure", () => {
  it("maps an upstream 400 as a non-retryable provider error", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.reject(
          sdkError("ProviderError", "Bad request.", { provider: "ssb-klass", statusCode: 400 }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "provider_error", statusCode: 400, retryable: false });
  });

  it("maps a not-found classification (404 from searchCodes) as not_found", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.reject(
          sdkError("NotFoundError", "No such classification.", { provider: "ssb-klass" }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      classificationId: 999999,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(error.code).toBe("not_found");
  });

  it("preserves retryAfter on a 429", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.reject(
          sdkError("RateLimitError", "Slow down.", {
            provider: "ssb-klass",
            statusCode: 429,
            retryAfter: 20,
          }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "rate_limited", retryAfter: 20, retryable: true });
  });

  it("maps a timeout as retryable", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.reject(sdkError("RequestTimeoutError", "Timed out.", { provider: "ssb-klass" })),
    });

    const error = await harness.callErr(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(error).toMatchObject({ code: "timeout", retryable: true });
  });

  it("maps a malformed provider response without leaking the body", async () => {
    harness = await withKlass({
      searchCodes: () =>
        Promise.reject(
          sdkError("ResponseValidationError", "Unexpected JSON.", {
            provider: "ssb-klass",
            cause: { issues: [{ path: ["secret"], message: "bad" }] },
          }),
        ),
    });

    const error = await harness.callErr(TOOL, {
      classificationId: 7,
      codePattern: "25*",
      date: "2024-01-01",
    });

    expect(error.code).toBe("upstream_invalid_response");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("propagates the caller's abort signal into the SDK call", async () => {
    harness = await withKlass({ searchCodes: abortable() });

    const controller = new AbortController();
    const pending = harness.client.callTool(
      { name: TOOL, arguments: { classificationId: 7, codePattern: "25*", date: "2024-01-01" } },
      undefined,
      { signal: controller.signal },
    );

    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
