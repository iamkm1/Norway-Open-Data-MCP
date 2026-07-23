# Architecture

## Zero-hosting model

Norway Open Data MCP is a **local subprocess**. An MCP client (Claude Desktop,
Cursor, VS Code, MCP Inspector) spawns it, speaks JSON-RPC over stdin/stdout,
and kills it when the session ends. There is no component of this project that
runs anywhere else.

```
┌──────────────────────────────────────────────────────────────┐
│ User's computer                                              │
│                                                              │
│  ┌────────────────┐   spawn + stdio    ┌───────────────────┐ │
│  │  MCP client    │◄──── JSON-RPC ────►│ norway-open-data- │ │
│  │  (Claude,      │      (stdout)      │ mcp  (this pkg)   │ │
│  │   Cursor, …)   │                    │                   │ │
│  └────────────────┘                    │  stderr → client  │ │
│                                        │         log file  │ │
│                                        └─────────┬─────────┘ │
│                                                  │           │
│                                   norway-open-data-sdk@0.5.2 │
│                                                  │           │
└──────────────────────────────────────────────────┼───────────┘
                                                   │ HTTPS (outbound only)
                        ┌──────────────────────────┴────────────────────┐
                        ▼                ▼               ▼              ▼
                  Brønnøysund-      Kartverket       MET Norway       SSB
                  registrene         Entur            NVE       Hva koster strømmen?
```

What is deliberately absent: no hosted backend, no HTTP listener, no database,
no user accounts, no telemetry, no cloud infrastructure, no domain, no
persistent storage. The only outbound traffic is the SDK calling Norwegian
public APIs directly from the user's machine.

## Layering

Strict one-directional dependency flow. A layer may only import from layers
below it.

```
        MCP transport            src/server/transport.ts   (stdio only)
              ↓
        tool registration        src/server/factory.ts + src/tools/registry.ts
              ↓
        tool handlers            src/tools/*.ts
              ↓
        Norway Open Data SDK     norway-open-data-sdk@0.5.2
              ↓
        public Norwegian APIs
```

Cross-cutting layers that handlers consume but never the reverse:

| Directory         | Responsibility                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| `src/cli/`        | Argument parsing, `--help` / `--version` / `--doctor`, process wiring. |
| `src/config/`     | Environment → validated `ServerConfig`. Never reads env elsewhere.     |
| `src/server/`     | Server factory, stdio transport, lifecycle/signals, stdout guard.      |
| `src/tools/`      | One module per tool: schema, handler, text renderer.                   |
| `src/formatting/` | Response envelope, deterministic text rendering.                       |
| `src/errors/`     | SDK error → MCP tool-error mapping and redaction.                      |
| `src/limits/`     | Output budgets, truncation, string clamping.                           |
| `src/logging/`    | stderr-only logger with credential redaction.                          |
| `src/testing/`    | Fake SDK builders exported for consumer tests.                         |

`src/server/factory.ts` never touches `process`, signals or stdio. `src/cli/`
owns the process lifecycle. That separation is what makes the factory testable
in-process with an injected SDK.

## Programmatic entry point

```ts
import { createNorwayOpenDataMcpServer } from "norway-open-data-mcp";

const { server, close } = createNorwayOpenDataMcpServer({
  sdk: myFakeSdk, // dependency injection
  config: { applicationName: "my-app/1.0" },
});
```

Dependency injection exists for four reasons the brief names: mocked SDK tests,
consumer testing, future transport support, and keeping the factory free of
process-global state.

The `sdk` option accepts a **structural subset** (`NorwayOpenDataLike`) of the
real facade — only the namespaces and methods the tools actually call. Tests
supply a small object; production supplies the real `NorwayOpenData`.

## Lazy SDK construction

`new NorwayOpenData(config)` **throws** `ConfigurationError` on invalid input —
verified against the installed SDK: a malformed `contactEmail` or a negative
`timeoutMs` rejects at construction with a zod `cause`.

If the server constructed the SDK eagerly, one bad environment variable would
kill the process at startup and the MCP client would show only "server exited".
Instead the SDK is constructed **lazily on first tool call** and the result
memoised. A construction failure becomes a normal, well-formed tool error naming
the exact variable to fix, and `tools/list` keeps working. This directly serves
the requirement "keep the MCP server running; return a clear configuration error
for that tool".

## stdout ownership

The stdio transport owns stdout. Three independent defences:

1. **A stdout guard** (`src/server/stdout-guard.ts`) installed before
   `transport.start()`. It captures the real `process.stdout.write`, hands it to
   the transport, and replaces the public `process.stdout.write` with a function
   that diverts any other write to stderr with a `stdout-write-blocked` warning.
   Accidental `console.log` in any dependency cannot corrupt the protocol.
2. **A lint rule** — `no-console` as an error across `src/`, with a single
   audited exception in the CLI's pre-transport help/version path.
3. **A protocol test** that spawns the built binary, exercises every tool, and
   asserts every stdout byte parses as JSON-RPC.

`--help`, `--version` and `--doctor` print and exit **before** the transport is
started, so they are free to use stdout.

## Cancellation

`RequestHandlerExtra.signal` is an `AbortSignal` (verified in the MCP SDK
declarations) and `RequestOptions.signal` is an `AbortSignal` (verified in the
Norway SDK declarations). The handler passes the former straight into the
latter, per call. No signal is shared between requests, and no
`AbortController` is created at server scope.

Because the SDK aborts a waiting retry immediately on signal abort, client
cancellation reaches even a request that is parked in provider-directed backoff.
Cancellation is reported as a cancellation, never as a provider failure.

## Retries, caching, rate limits

None are reimplemented here. The SDK owns all three, and the MCP layer must not
second-guess a provider budget it does not see. The MCP server only chooses
configuration: caching is **enabled in-process** with a modest entry cap, which
is not persistence — it dies with the process, matching "no persistent storage".

## MCP SDK decision

**Selected: `@modelcontextprotocol/sdk@^1.29.0`.**

Verified on 2026-07-23 with `npm view`:

| Package                        | Latest                      | dist-tags                        | Verdict                                                                                  |
| ------------------------------ | --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk`    | `1.29.0` (2026-03-30)       | `latest` only                    | **Stable.** Continuous 1.25→1.29 release cadence through 2026.                           |
| `@modelcontextprotocol/server` | `2.0.0-beta.5` (2026-07-21) | `latest`, `beta` — both the beta | Prerelease. Alpha line opened 2026-04-01; **no stable release has ever been published**. |
| `@modelcontextprotocol/client` | `2.0.0-beta.5`              | same                             | Prerelease.                                                                              |

The v2 packages publish their beta to the `latest` dist-tag, so "latest" is not
"stable" here — a plain `npm install @modelcontextprotocol/server` would install
a beta. Policy rules 2 and 3 exclude alpha/beta/RC for v0.1, so v2 is out, and
v1 is not merely the incumbent but the only production-supported option. This
was not chosen for novelty in either direction: v2 was evaluated and rejected
on release risk.

Pinned as `^1.29.0` — a caret range inside a stable major, not a floating
prerelease.

### Transitive dependency note

`@modelcontextprotocol/sdk` v1 depends on `hono`, `cors`, `express` and
`@hono/node-server` to support its HTTP transports. This package imports **only**
`server/mcp.js` and `server/stdio.js`, so no HTTP server code is ever
instantiated.

`npm audit` reports one moderate advisory in that subtree:
GHSA-frvp-7c67-39w9, a path traversal in `@hono/node-server`'s `serve-static`
on Windows via an encoded backslash, affecting `< 2.0.5`. The situation was
investigated rather than waved through:

- The MCP SDK declares `@hono/node-server: ^1.19.9`. The newest 1.x is
  `1.19.14`, so **no patched 1.x exists** — the only upgrade is cross-major.
- `npm audit fix --force` resolves it by _downgrading_ the MCP SDK to `1.24.3`,
  which is a regression, not a fix.
- A `pnpm.overrides` entry forcing `@hono/node-server@^2.0.11` was tried and
  then **deliberately removed**. Overrides in this package's manifest apply only
  to this repository's own install; a user running `npx -y norway-open-data-mcp`
  resolves the MCP SDK's own dependency tree and would not receive it. Shipping
  it would have produced a clean local audit while protecting nobody.

The real mitigation is reachability: `serve-static` is only reachable through an
HTTP transport this package never constructs. `tests/unit/dependency-surface.test.ts`
asserts empirically that importing the server factory and the stdio transport
loads neither `@hono/node-server` nor `express` into the module graph, so the
vulnerable code is not merely unused but never loaded. That assertion fails
loudly if a future change introduces an HTTP path.

## Toolchain decisions

| Choice          | Version  | Rationale                                                                                                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node            | `>=22`   | Matches `norway-open-data-sdk` engines exactly. Developed on 24.13.                                                                                                         |
| TypeScript      | `~6.0.3` | `typescript-eslint@8.65` peers `typescript >=4.8.4 <6.1.0`. **TS 7.0.2 is latest but would break linting.** Lowest-risk supported version; also what the upstream SDK uses. |
| Module format   | ESM only | The SDK is ESM-first; the CLI is a binary, not a library consumed by CJS.                                                                                                   |
| Build           | `tsup`   | Two entries (`index`, `cli`), shebang banner, `.d.ts`, tree-shaken, zero config sprawl. Justified over `tsc` by the shebang + bundling of internal modules.                 |
| Test            | Vitest 4 | Native ESM + TS, v8 coverage, no transform config.                                                                                                                          |
| Package manager | pnpm 11  | Strict node_modules layout catches undeclared-dependency bugs before publish.                                                                                               |

## Why the tool count is 10, not 55

The SDK exposes 55 public methods. A 55-tool server is unusable: tool
descriptions are routing instructions, and an AI model given 55 overlapping
options routes worse than one given 10 distinct ones. Selection criteria, in
priority order:

1. Answers a question a person actually asks about Norway.
2. Distinct enough that a model can choose it without ambiguity.
3. Bounded output.
4. Works without credentials where possible.
5. Demonstrates cross-provider composition.

Three tools are **compositions**, not method wrappers:
`get_norwegian_transport_departures` (autocomplete → departures),
`get_current_norwegian_hazards` (three warning feeds → one filtered list), and
`query_norwegian_statistics` (metadata or data through one schema).

See [tool-catalogue.md](tool-catalogue.md) for the full per-tool contract and
[capability-matrix.md](capability-matrix.md) for every method that was
considered and why it was deferred.
