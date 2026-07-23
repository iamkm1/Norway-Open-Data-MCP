/**
 * Maps errors raised by `norway-open-data-sdk` onto this server's stable error
 * taxonomy.
 *
 * Two properties of the SDK drive the implementation, and both are documented
 * in its README rather than guessed:
 *
 * 1. Class identity is per-bundle. A process that loads both the ESM and the
 *    CommonJS build will fail `instanceof` for errors that crossed the
 *    boundary. Discrimination is therefore by `error.name`, with `instanceof`
 *    only as a fallback signal.
 * 2. **Caller cancellation surfaces as `ProviderError`**, with the abort reason
 *    as `cause`. The only reliable way to tell a deliberate abort from a real
 *    provider failure is to inspect the caller's own signal — which is why
 *    `mapToolError` takes it. Without this, every cancelled request would be
 *    reported to the model as an upstream outage.
 */

import type { Redactor } from "./redact.js";
import type { ToolErrorCode, ToolErrorField, ToolErrorPayload } from "./types.js";

/** Structural view of an SDK error; avoids depending on class identity. */
type SdkErrorShape = {
  name?: unknown;
  message?: unknown;
  provider?: unknown;
  statusCode?: unknown;
  retryAfter?: unknown;
  cause?: unknown;
};

export class ConfigurationRequiredError extends Error {
  readonly variables: readonly string[];
  readonly provider: string | undefined;

  constructor(message: string, variables: readonly string[], provider?: string) {
    super(message);
    this.name = "ConfigurationRequiredError";
    this.variables = variables;
    this.provider = provider;
  }
}

export class ResultTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultTooLargeError";
  }
}

/**
 * Raised by a composed tool when a resolution step finds nothing — for example
 * a stop name that matches no stop place.
 *
 * `name` is deliberately `NotFoundError` so it maps through the same table as
 * the SDK's own not-found error: a caller should not be able to tell whether
 * the miss happened upstream or during composition.
 */
export class UpstreamNotFoundError extends Error {
  readonly provider: string | undefined;

  constructor(message: string, provider?: string) {
    super(message);
    this.name = "NotFoundError";
    this.provider = provider;
  }
}

const CODE_BY_SDK_ERROR_NAME: Record<string, ToolErrorCode> = {
  InputValidationError: "invalid_input",
  ConfigurationError: "missing_configuration",
  NotFoundError: "not_found",
  RateLimitError: "rate_limited",
  RequestTimeoutError: "timeout",
  ResponseValidationError: "upstream_invalid_response",
  ProviderError: "provider_error",
  OpenDataError: "provider_error",
};

function asShape(error: unknown): SdkErrorShape {
  return typeof error === "object" && error !== null ? error : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Reduces a zod `cause` to path/message pairs.
 *
 * The full zod error is never serialized: its `input` field echoes back the
 * offending value, which for a credential-bearing configuration object would
 * leak the credential into the tool result.
 */
function extractFields(cause: unknown): ToolErrorField[] | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const issues = (cause as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;

  const fields: ToolErrorField[] = [];
  for (const issue of issues.slice(0, 10)) {
    if (typeof issue !== "object" || issue === null) continue;
    const record = issue as { path?: unknown; message?: unknown };
    const path = Array.isArray(record.path) ? record.path.join(".") : "";
    const message = readString(record.message);
    if (message) fields.push({ path: path || "(root)", message });
  }
  return fields.length > 0 ? fields : undefined;
}

/** A 5xx is worth retrying; a 4xx other than 429 is the caller's problem. */
function isRetryableStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 500 && statusCode < 600;
}

export type MapToolErrorOptions = {
  /** The caller's signal. Its `aborted` state is authoritative for cancellation. */
  signal?: AbortSignal;
  redactor: Redactor;
};

/**
 * Converts any thrown value into a redacted, client-safe payload.
 *
 * Never throws, and never emits a stack trace, an absolute path, an
 * environment variable listing or an upstream response body.
 */
export function mapToolError(error: unknown, options: MapToolErrorOptions): ToolErrorPayload {
  const { signal, redactor } = options;

  // Cancellation is checked first and by signal, not by error class: the SDK
  // reports an aborted request as a ProviderError, so class-based detection
  // would misreport the user's own cancellation as a provider outage.
  if (signal?.aborted === true) {
    return {
      code: "cancelled",
      message: "The request was cancelled by the client before it completed.",
      retryable: false,
    };
  }

  if (error instanceof ConfigurationRequiredError) {
    return {
      code: "missing_configuration",
      message: redactor.text(error.message),
      retryable: false,
      ...(error.provider !== undefined ? { provider: error.provider } : {}),
      requiredConfiguration: [...error.variables],
    };
  }

  if (error instanceof ResultTooLargeError) {
    return {
      code: "result_too_large",
      message: redactor.text(error.message),
      retryable: false,
    };
  }

  const shape = asShape(error);
  const name = readString(shape.name);
  const provider = readString(shape.provider);
  const statusCode = readFiniteNumber(shape.statusCode);
  const retryAfter = readFiniteNumber(shape.retryAfter);

  // An AbortError can also arrive without the caller's signal being the one
  // that fired (for example a timeout controller inside the SDK).
  if (name === "AbortError") {
    return {
      code: "cancelled",
      message: "The request was aborted before it completed.",
      retryable: false,
    };
  }

  const code: ToolErrorCode = (name && CODE_BY_SDK_ERROR_NAME[name]) || "internal_error";

  if (code === "internal_error") {
    // Deliberately opaque: an unrecognised error is the most likely carrier of
    // an unredacted internal detail, so only its class name is surfaced.
    return {
      code: "internal_error",
      message: `The server failed to complete the request${name ? ` (${redactor.text(name)})` : ""}.`,
      retryable: false,
    };
  }

  const rawMessage = readString(shape.message) ?? "The provider request failed.";
  const message = redactor.text(rawMessage);

  const retryable =
    code === "rate_limited" ||
    code === "timeout" ||
    code === "upstream_invalid_response" ||
    (code === "provider_error" && (retryAfter !== undefined || isRetryableStatus(statusCode)));

  const payload: ToolErrorPayload = { code, message, retryable };
  if (provider !== undefined) payload.provider = provider;
  if (statusCode !== undefined) payload.statusCode = statusCode;
  // retryAfter is the SDK's stable "the provider told me how long to wait"
  // signal and is set on both 429 and retryable 5xx, so it is preserved
  // regardless of which class carried it.
  if (retryAfter !== undefined) payload.retryAfter = retryAfter;

  if (code === "invalid_input" || code === "missing_configuration") {
    const fields = extractFields(shape.cause);
    if (fields) payload.fields = fields;
  }

  return payload;
}

/** Human-readable one-liner used for the text block of an error result. */
export function describeToolError(payload: ToolErrorPayload): string {
  const parts = [`Error [${payload.code}]: ${payload.message}`];
  if (payload.provider) parts.push(`Provider: ${payload.provider}.`);
  if (payload.statusCode !== undefined) parts.push(`HTTP status: ${payload.statusCode}.`);
  if (payload.retryAfter !== undefined) {
    parts.push(`The provider asked callers to wait ${payload.retryAfter} seconds.`);
  }
  if (payload.requiredConfiguration?.length) {
    parts.push(`Set ${payload.requiredConfiguration.join(", ")} and restart the MCP server.`);
  }
  if (payload.fields?.length) {
    parts.push(
      `Field problems: ${payload.fields.map((field) => `${field.path}: ${field.message}`).join("; ")}.`,
    );
  }
  parts.push(payload.retryable ? "Retrying later may succeed." : "Retrying will not help.");
  return parts.join(" ");
}
