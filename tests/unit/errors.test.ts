import { describe, expect, it } from "vitest";

import {
  ConfigurationRequiredError,
  ResultTooLargeError,
  UpstreamNotFoundError,
  describeToolError,
  mapToolError,
} from "../../src/errors/map.js";
import { Redactor } from "../../src/errors/redact.js";
import { sdkError } from "../../src/testing/fake-sdk.js";

const redactor = new Redactor(["s3cr3t-api-key", "ola.nordmann@example.com"]);

function map(error: unknown, signal?: AbortSignal) {
  return mapToolError(error, { redactor, ...(signal ? { signal } : {}) });
}

describe("SDK error mapping", () => {
  it.each([
    ["InputValidationError", "invalid_input", false],
    ["ConfigurationError", "missing_configuration", false],
    ["NotFoundError", "not_found", false],
    ["RateLimitError", "rate_limited", true],
    ["RequestTimeoutError", "timeout", true],
    ["ResponseValidationError", "upstream_invalid_response", true],
  ])("maps %s to %s", (name, code, retryable) => {
    const payload = map(sdkError(name, "boom", { provider: "brreg" }));
    expect(payload.code).toBe(code);
    expect(payload.retryable).toBe(retryable);
    expect(payload.provider).toBe("brreg");
  });

  it("treats a ProviderError as retryable only for 5xx or an explicit Retry-After", () => {
    expect(map(sdkError("ProviderError", "x", { statusCode: 503 })).retryable).toBe(true);
    expect(map(sdkError("ProviderError", "x", { statusCode: 400 })).retryable).toBe(false);
    // The SDK documents retryAfter as the stable signal, set on 5xx as well as 429.
    expect(
      map(sdkError("ProviderError", "x", { statusCode: 503, retryAfter: 90 })).retryAfter,
    ).toBe(90);
  });

  it("maps an unrecognised error opaquely, exposing only its class name", () => {
    const payload = map(new TypeError("Cannot read property 'x' of undefined at /home/me/app.js"));
    expect(payload.code).toBe("internal_error");
    expect(payload.message).not.toContain("Cannot read property");
    expect(payload.message).not.toContain("/home/me");
  });

  it("maps the package's own error classes", () => {
    expect(
      map(new ConfigurationRequiredError("need it", ["NORWAY_MCP_CONTACT_EMAIL"])),
    ).toMatchObject({
      code: "missing_configuration",
      requiredConfiguration: ["NORWAY_MCP_CONTACT_EMAIL"],
    });
    expect(map(new ResultTooLargeError("too big")).code).toBe("result_too_large");
    expect(map(new UpstreamNotFoundError("no stop", "entur"))).toMatchObject({
      code: "not_found",
      provider: "entur",
    });
  });
});

describe("cancellation is never reported as a provider failure", () => {
  it("classifies by the caller's signal, not the error class", () => {
    const controller = new AbortController();
    controller.abort();

    // The SDK surfaces an aborted request as a ProviderError; the signal is
    // what makes it a cancellation.
    const payload = map(
      sdkError("ProviderError", "Request aborted.", { provider: "met" }),
      controller.signal,
    );

    expect(payload.code).toBe("cancelled");
    expect(payload.retryable).toBe(false);
  });

  it("still reports a genuine provider failure when the signal is not aborted", () => {
    const controller = new AbortController();
    const payload = map(
      sdkError("ProviderError", "503", { provider: "met", statusCode: 503 }),
      controller.signal,
    );
    expect(payload.code).toBe("provider_error");
  });

  it("recognises a bare AbortError", () => {
    expect(map(sdkError("AbortError", "aborted")).code).toBe("cancelled");
  });
});

describe("field extraction", () => {
  it("reduces a zod cause to path and message only", () => {
    const payload = map(
      sdkError("InputValidationError", "bad", {
        cause: {
          issues: [
            { path: ["selections", "Region"], message: "Unknown code", input: "s3cr3t-api-key" },
          ],
        },
      }),
    );

    expect(payload.fields).toEqual([{ path: "selections.Region", message: "Unknown code" }]);
    // `input` echoes the caller's value and is deliberately dropped.
    expect(JSON.stringify(payload)).not.toContain("s3cr3t-api-key");
  });

  it("caps the number of reported field problems", () => {
    const issues = Array.from({ length: 40 }, (_unused, index) => ({
      path: [`field${index}`],
      message: "bad",
    }));
    const payload = map(sdkError("InputValidationError", "bad", { cause: { issues } }));
    expect(payload.fields).toHaveLength(10);
  });
});

describe("redaction", () => {
  it("removes configured secrets wherever they appear", () => {
    const payload = map(
      sdkError(
        "ProviderError",
        "Request with key s3cr3t-api-key for ola.nordmann@example.com failed",
      ),
    );
    expect(payload.message).not.toContain("s3cr3t-api-key");
    expect(payload.message).not.toContain("ola.nordmann@example.com");
    expect(payload.message).toContain("[redacted]");
  });

  it.each([
    ["an Authorization header", "authorization: Bearer abcdef1234567890"],
    ["an api-key header", "x-api-key: abcdef1234567890"],
    ["a cookie", "cookie: session=abcdef1234567890"],
  ])("removes %s even when it was never configured", (_label, text) => {
    expect(redactor.text(text)).toContain("[redacted]");
    expect(redactor.text(text)).not.toContain("abcdef1234567890");
  });

  it.each([
    ["a POSIX path", "failed at /home/ola/project/src/index.ts"],
    ["a Windows path", "failed at C:\\Users\\ola\\project\\src\\index.ts"],
    ["a file URL", "see file:///C:/Users/ola/secret.json"],
  ])("removes %s", (_label, text) => {
    const output = redactor.text(text);
    expect(output).toContain("[path]");
    expect(output).not.toContain("ola");
  });

  it("preserves provider URLs, which are required attribution", () => {
    const text =
      "Source: Brønnøysundregistrene (https://www.brreg.no/) documentation https://data.brreg.no/x";
    expect(redactor.text(text)).toBe(text);
  });

  it("preserves shared references instead of treating them as cycles", () => {
    const shared = ["avalanche"];
    const output = redactor.value({ a: shared, b: shared });
    expect(output).toEqual({ a: ["avalanche"], b: ["avalanche"] });
  });

  it("breaks genuine cycles without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic["self"] = cyclic;
    expect(() => redactor.value(cyclic)).not.toThrow();
    expect(redactor.value(cyclic)).toMatchObject({ name: "x", self: "[circular]" });
  });

  it("ignores secrets too short to match safely", () => {
    const shortSecret = new Redactor(["ab"]);
    expect(shortSecret.text("a table about abstraction")).toBe("a table about abstraction");
  });
});

describe("error prose", () => {
  it("states retryability, provider, status and required configuration", () => {
    const text = describeToolError({
      code: "rate_limited",
      message: "Too many requests.",
      retryable: true,
      provider: "ssb",
      statusCode: 429,
      retryAfter: 30,
    });

    expect(text).toContain("[rate_limited]");
    expect(text).toContain("ssb");
    expect(text).toContain("429");
    expect(text).toContain("30 seconds");
    expect(text).toContain("Retrying later may succeed.");
  });

  it("tells the operator exactly what to set for a configuration error", () => {
    const text = describeToolError({
      code: "missing_configuration",
      message: "needs configuration",
      retryable: false,
      requiredConfiguration: ["NORWAY_MCP_CONTACT_EMAIL"],
    });

    expect(text).toContain("Set NORWAY_MCP_CONTACT_EMAIL and restart");
    expect(text).toContain("Retrying will not help.");
  });
});
