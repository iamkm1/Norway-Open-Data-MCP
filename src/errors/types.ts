/** Stable, client-facing error taxonomy. Independent of SDK class identity. */
export type ToolErrorCode =
  | "invalid_input"
  | "missing_configuration"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "upstream_invalid_response"
  | "provider_error"
  | "cancelled"
  | "result_too_large"
  | "internal_error";

/** One field-level validation problem. Never contains a value the caller sent. */
export type ToolErrorField = {
  path: string;
  message: string;
};

/**
 * The redacted error payload returned as `structuredContent` alongside
 * `isError: true`.
 */
export type ToolErrorPayload = {
  code: ToolErrorCode;
  message: string;
  /** Whether retrying the identical call later could plausibly succeed. */
  retryable: boolean;
  provider?: string;
  statusCode?: number;
  /** Seconds the provider asked the caller to wait, when it said so. */
  retryAfter?: number;
  fields?: ToolErrorField[];
  /** Environment variable the operator must set, for `missing_configuration`. */
  requiredConfiguration?: string[];
};
