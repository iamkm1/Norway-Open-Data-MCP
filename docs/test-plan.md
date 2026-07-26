# Test plan

No test in the default suite touches a live public API. Every layer is
dependency-injected: the server factory accepts a `NorwayOpenDataLike` object,
so tools are exercised against fakes that return exactly the shapes the real SDK
declares.

## Layers

| Suite                | Location                                         | Runs in CI            | Network                     |
| -------------------- | ------------------------------------------------ | --------------------- | --------------------------- |
| Unit                 | `tests/unit/**`                                  | yes                   | none                        |
| Protocol integration | `tests/integration/**`                           | yes                   | none (spawns built binary)  |
| Package              | `tests/package/**` via `scripts/test-package.ts` | yes                   | npm pack only, no providers |
| Routing evaluation   | `tests/eval/**`                                  | structural check only | none                        |
| Live                 | `tests/live/**`                                  | **opt-in only**       | yes, bounded                |

## Unit tests — per tool

Each of the twenty tools is tested for the full matrix required by the brief:

1. valid request
2. minimum input (only required fields)
3. maximum input (every field at its hard limit)
4. invalid input (each rejection rule: blank, NaN, Infinity, negative, oversized,
   bad enum, reversed date range, unknown property)
5. empty result
6. one result
7. multiple results
8. truncated result — asserts both the structural `truncation` entry and the
   prose warning
9. provider error
10. rate limit — asserts `retryAfter` survives
11. timeout
12. cancellation — asserts the abort signal reached the SDK call
13. missing configuration — asserts the exact env-var name appears
14. attribution — asserts `sources[]` matches the provider registry exactly
15. structured output — asserts it validates against the declared `outputSchema`
16. text fallback — asserts deterministic, non-empty, budget-respecting text

Items 12 and 13 are **registry-driven**: `tests/unit/cancellation.test.ts`
iterates `allTools`, so a tool added later that forgets to forward `{ signal }`
fails automatically rather than being silently uncovered.

## Maritime tests

The maritime tools add failure modes the earlier tools do not have, so they get
two dedicated files.

`tests/unit/maritime-tools.test.ts` covers registration (all eight present
exactly once, the original twelve unchanged in name **and order**), SDK
delegation (each tool calls the method the SDK declares, with the parameters it
declares), credential gating (both variables named, only the missing half named
when one is set, and the anonymous registers working with an empty config),
input validation, partial-profile provenance, and redaction of a client secret
and bearer token echoed back inside a provider error.

`tests/unit/live-vessel-positions.test.ts` covers the bounded stream. Its fake
feed is finite or abort-driven and records whether the consumer released the
iterator, so every test asserts **both** that the tool returned and that the
connection was closed:

- stops at the limit and releases the iterator while the timeout is still 10 s
  away — proving the release is caused by the limit, not by the timeout;
- returns a partial sample on timeout rather than hanging, and an empty sample
  for a quiet area, which is a success and not an error;
- closes on caller cancellation and reports `cancelled`, not a provider failure;
- surfaces a genuine provider error rather than swallowing it as a timeout;
- refuses every request missing any of the three mandatory bounds, and refuses
  inverted, antimeridian-crossing, non-finite and oversized boxes — asserting in
  each case that **no stream was opened**.

Timeouts in these tests are hundreds of milliseconds, so the suite stays fast and
fully deterministic offline.

## Shared-behaviour tests

- **Envelope**: source de-duplication, newest `retrievedAt`, `cached` only when
  every underlying response was cached.
- **Limits**: leading-slice determinism, string clamping, array backstop,
  serialized-size guard with progressive halving, and the invariant that
  truncation is always reported.
- **Error mapping**: every SDK error class → expected code/retryable, and that
  no mapped error contains a stack trace, absolute path, api key or email.
- **Redaction**: property-style test feeding a configured secret through each
  output path and asserting it never appears.
- **Config**: defaults, overrides, invalid values, and that a bad value produces
  a tool-level `missing_configuration` rather than a process exit.
- **Lifecycle**: SIGINT/SIGTERM/stdin-close each trigger exactly one graceful
  shutdown; double signals are idempotent.
- **stdout guard**: a `console.log` inside a handler is diverted to stderr and
  does not reach stdout.

## Protocol integration

Spawns the **built** `dist/cli.js` as a real subprocess and drives it with the
official MCP `Client` over `StdioClientTransport`:

- initialization handshake and server identity (name, version)
- advertised capabilities
- `tools/list` — asserts the **exact tool count is 10** and that names, titles,
  descriptions and input schemas are present and non-empty
- no two tool descriptions are near-duplicates (token-overlap check)
- `tools/call` success path
- `tools/call` error path returns `isError: true`, not a transport error
- cancellation mid-request
- clean shutdown on close
- **every byte of stdout parses as JSON-RPC** — the corruption test
- stderr output during a call does not desynchronise the protocol

## Package tests

`scripts/test-package.ts`:

1. `npm pack` in a clean tree
2. assert the tarball contains no tests, fixtures, `.env`, coverage, source maps
   of sources, or repository config
3. install the tarball into a fresh temp directory **outside** the repository
4. run the installed binary's `--version` and `--doctor`
5. spawn the installed binary as an MCP server and list tools
6. import the package entry point and assert `createNorwayOpenDataMcpServer` and
   the type declarations resolve
7. assert nothing resolves back into the repository

## Routing evaluation corpus

`tests/eval/tool-routing.json` — at least 40 realistic questions in Norwegian
and English. Each case records: `question`, `expectedTool`, `mustNotSelect[]`,
`reason`, `requiredArguments`, and `expectedClarification` when information is
missing.

CI runs a **structural** test only: every `expectedTool` and `mustNotSelect`
entry names a tool that actually exists, required arguments validate against
that tool's input schema, and every documented ambiguity pair is covered. Actual
model-based evaluation is opt-in and needs no API key to be present in CI.

## Live tests

`pnpm test:live` only, never in the default pipeline. Bounded to a handful of
requests against open, credential-free providers, with assertions on shape
rather than on values that change. Designed never to approach a provider budget;
skipped automatically when identification is not configured.

## Coverage thresholds

Enforced globally at 85% lines / 85% functions / 80% branches, with the
release-critical modules held higher:

| Path                | Lines |
| ------------------- | ----- |
| `src/tools/**`      | 90%   |
| `src/errors/**`     | 95%   |
| `src/limits/**`     | 95%   |
| `src/config/**`     | 90%   |
| `src/formatting/**` | 90%   |

`src/cli/**` and `src/server/transport.ts` are covered by the subprocess
integration suite rather than by unit tests; they are excluded from the unit
coverage denominator and asserted behaviourally instead.
