# Output envelope, error mapping, configuration

## Output envelope

Every successful tool returns the same envelope shape as `structuredContent`,
plus a deterministic plain-text rendering as `content[0].text`. The MCP SDK
validates `structuredContent` against the declared `outputSchema`, so the
envelope is a real contract, not a convention.

```jsonc
{
  "data": {/* tool-specific, described per tool */},
  "sources": [
    {
      "id": "brreg",
      "name": "Brønnøysundregistrene",
      "homepage": "https://www.brreg.no/",
      "documentation": "https://data.brreg.no/…",
      "license": "Norwegian Licence for Open Government Data (NLOD) 2.0",
      "attribution": "…", // omitted when the provider declares none
    },
  ],
  "retrievedAt": "2026-07-23T18:20:31.482Z", // SDK's own value, never fabricated
  "cached": false, // SDK's own value
  "warnings": ["…"], // [] when there are none
  "truncation": {
    // null when nothing was truncated
    "truncated": true,
    "fields": [
      { "field": "companies", "returned": 10, "availableUpstream": 214, "reason": "limit" },
    ],
  },
  "partial": {
    // null when complete
    "complete": false,
    "missing": ["avalanche"],
    "reason": "One or more provider sections failed and were omitted.",
  },
  "continuation": {
    // null when not applicable
    "hasMore": true,
    "nextArguments": { "page": 1 }, // safe, ready-to-send tool arguments
  },
}
```

Rules:

- `sources`, `retrievedAt` and `cached` are copied from
  `OpenDataResponse.source` / `.retrievedAt` / `.cached`. **No metadata is
  invented.** For composed tools that call several SDK methods, `sources` is the
  de-duplicated union and `retrievedAt` is the newest value, `cached` is true
  only if every underlying response was cached.
- `warnings` never carries data — only interpretation, truncation and safety
  notices.
- `continuation.nextArguments` is a complete, validated argument object for the
  same tool. It is only emitted where the SDK genuinely supports paging
  (companies search, statistics rows are not paged upstream and therefore emit
  no continuation).
- Truncation is always **leading-slice, provider order preserved**, so results
  are deterministic and reproducible. Meaning is never silently changed: any
  removal is reported both structurally and in prose.

### Output budget

| Bound                          | Value         | Rationale                                                                                                  |
| ------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
| Serialized `structuredContent` | 120 000 chars | ≈30k tokens worst case; well under a typical context budget while allowing a full 500-row statistics page. |
| Rendered text block            | 16 000 chars  | The text form is a summary for text-only clients, not a second copy of the data.                           |
| Any single string field        | 1 000 chars   | Hazard descriptions and dataset abstracts are the only realistic offenders.                                |
| Any array not otherwise capped | 100 items     | Backstop for provider shape changes.                                                                       |

The serialized-size ceiling is enforced **after** per-tool limits as a final
guard. If it is still exceeded, list fields are progressively halved (largest
first) until the payload fits, and each reduction is appended to
`truncation.fields`. A tool can therefore never emit an oversized result, and
never emits one without saying so.

## Error mapping

SDK errors are mapped to a stable, redacted MCP tool error. Tool errors are
returned as `isError: true` with a text block — the MCP v1 convention for
"the tool ran and failed" — rather than thrown as protocol errors, so the model
can read and react to them. Schema-level rejections (bad argument types) are
raised by the MCP SDK itself before the handler runs.

| SDK error                     | `code`                      | `retryable`                  | Preserved detail                       |
| ----------------------------- | --------------------------- | ---------------------------- | -------------------------------------- |
| `InputValidationError`        | `invalid_input`             | no                           | `provider`, field message              |
| `ConfigurationError`          | `missing_configuration`     | no                           | exact env var name, provider           |
| `NotFoundError`               | `not_found`                 | no                           | `provider`, `statusCode`               |
| `RateLimitError`              | `rate_limited`              | yes                          | `provider`, `statusCode`, `retryAfter` |
| `RequestTimeoutError`         | `timeout`                   | yes                          | `provider`                             |
| `ResponseValidationError`     | `upstream_invalid_response` | yes                          | `provider` only — never the body       |
| `ProviderError`               | `provider_error`            | when `retryAfter` set or 5xx | `provider`, `statusCode`, `retryAfter` |
| `AbortError` / signal aborted | `cancelled`                 | no                           | none                                   |
| own budget guard              | `result_too_large`          | no                           | which field, what limit                |
| anything else                 | `internal_error`            | no                           | error name only                        |

Emitted shape (also returned as `structuredContent` so clients can branch):

```jsonc
{
  "error": {
    "code": "rate_limited",
    "message": "Brønnøysundregistrene is rate limiting requests. Retry after 30 seconds.",
    "provider": "brreg",
    "statusCode": 429,
    "retryAfter": 30,
    "retryable": true,
    "fields": [{ "path": "tableId", "message": "…" }], // only for invalid_input
  },
}
```

`retryAfter` is read from the SDK error regardless of class, because the SDK
documents it as the stable signal — a 503 with `Retry-After` is a
`ProviderError`, not a `RateLimitError`, and both carry it.

### Redaction

A single `redact()` pass runs over every outgoing message and every log line:

- Values of the configured `contactEmail` and any provider `apiKey` are replaced
  with `[redacted]` — matched by value, so they are caught wherever they appear.
- `Authorization`, `api-key`, `x-api-key`, `cookie`, `set-cookie` token patterns
  are stripped.
- Absolute local paths (`/…`, `C:\…`, `file://…`) are removed.
- Stack traces are never included. `cause` chains are never serialized;
  a zod `cause` is reduced to `{path, message}` pairs only.
- Environment variables are never enumerated into output.

Debug logging (stderr only, `NORWAY_MCP_DEBUG=1`) passes through the same
redaction.

## Configuration

All configuration is environment variables, because that is what every MCP
client config format supports (`env` in Claude Desktop, Cursor and VS Code).

| Variable                                            | Default                              | Effect                                                                                                                     |
| --------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `NORWAY_MCP_APP_NAME`                               | `norway-open-data-mcp/<pkg version>` | Sent as Entur `ET-Client-Name` and Statens vegvesen `X-Client`; part of MET's User-Agent.                                  |
| `NORWAY_MCP_CONTACT_EMAIL`                          | _(unset)_                            | **Required by MET Norway only.** Enables `get_norwegian_weather_forecast` and the weather section of the location profile. |
| `NORWAY_MCP_NVE_API_KEY`                            | _(unset)_                            | Free NVE HydAPI key. No current tool requires it; accepted so the SDK is configured consistently.                          |
| `NORWAY_MCP_BARENTSWATCH_CLIENT_ID` / `_SECRET`     | _(unset)_                            | BarentsWatch OAuth2 client credentials, `api` scope. Enables `get_marine_forecast`. Both halves required together.         |
| `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID` / `_SECRET` | _(unset)_                            | BarentsWatch OAuth2 client credentials, `ais` scope — a **separate** registered client. Enables the three AIS tools.       |
| `NORWAY_MCP_TIMEOUT_MS`                             | `10000`                              | SDK request timeout. 1 000–60 000.                                                                                         |
| `NORWAY_MCP_RETRIES`                                | `2`                                  | SDK retry attempts after the first. 0–5.                                                                                   |
| `NORWAY_MCP_CACHE`                                  | `1`                                  | In-process response cache. `0` disables. Never persisted.                                                                  |
| `NORWAY_MCP_DEBUG`                                  | `0`                                  | Verbose stderr diagnostics. Never stdout. Redacted.                                                                        |

Only variables that map to a real `NorwayOpenDataConfig` field exist. No
credential is invented: the SDK declares exactly five auth fields
(`applicationName`, `contactEmail`, `apiKey`, `clientId`, `clientSecret`) and
that is exactly what is exposed.

`clientId` and `clientSecret` are **per provider id**, and BarentsWatch has two
descriptors — `barentswatch` and `barentswatch-ais` — because it issues a
separate registered client for AIS. They are therefore two independent variable
pairs rather than one, and `buildCredentials` writes each into its own scope so
a secret can never be sent to the wrong host.

A **half-configured pair is dropped**, both halves, and reported as a config
problem naming the missing variable. Passing one half through would let the SDK
build a token request that can only fail, and a token endpoint's HTTP 400 names
a status code rather than the variable the user forgot to set.

The OAuth2 exchange itself — token acquisition, in-memory caching, refresh
before expiry, discarding a token rejected with 401, and sharing one in-flight
request between concurrent callers — is entirely the SDK's. This server holds
the configured values, hands them over once at construction, and never sees a
token.

The default application name identifies this package and its version, as
required. **No contact email is defaulted** — a fake address would be sent to
MET Norway as the caller's identity, which is precisely what the provider's
terms forbid.

Invalid values do not crash the server. They are collected during lazy SDK
construction and returned as `missing_configuration` errors from the tools that
need them, with the offending variable named.

## CLI modes

| Invocation         | Behaviour                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| _(none)_           | Start the MCP server on stdio. Nothing is ever written to stdout except protocol frames.        |
| `--help` / `-h`    | Usage to stdout, exit 0, **before** the transport starts.                                       |
| `--version` / `-v` | Version to stdout, exit 0.                                                                      |
| `--doctor`         | Configuration and runtime readiness report to stdout, exit 0 (or 1 if a hard problem is found). |

`--doctor` performs **no network calls**: it reports Node version, resolved
configuration with secrets masked, which tools are enabled or gated, and whether
the SDK constructs successfully. It cannot provoke a rate limit because it never
contacts a provider.

## Lifecycle

- `SIGINT` / `SIGTERM` → close transport, close server, flush stderr, exit 0.
- stdin `end`/`close` (client disconnect) → same graceful path.
- Transport `onclose` → resolve the CLI's run promise.
- Startup failure (invalid CLI args, transport start failure) → message to
  stderr, non-zero exit, no partial protocol output.
- `unhandledRejection` / `uncaughtException` → redacted stderr log, exit 1.
- Shutdown is idempotent and guarded by a flag, so a double signal cannot
  double-close.
- No `setInterval`, no keep-alive timers, no open handles: when the client
  disconnects the process exits on its own.
