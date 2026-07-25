# Privacy model

## Summary

Norway Open Data MCP runs as a local process on your computer. This project
operates no server, collects no data, and has no way to observe your usage.

## Where your data goes

```
Your MCP client  →  this process (local)  →  norway-open-data-sdk  →  a Norwegian public API
```

Nothing else is contacted. There is no intermediate service, no proxy and no
analytics endpoint owned by this project.

The public-data providers you query — Brønnøysundregistrene, Kartverket, MET
Norway, NVE, SSB, SSB Klass, FHI, Entur, Statens vegvesen, Hva koster strømmen?
— receive a direct HTTPS request from your machine, exactly as if you had opened
their website. They can see:

- your IP address;
- the caller identity you configured (`NORWAY_MCP_APP_NAME`, and
  `NORWAY_MCP_CONTACT_EMAIL` where MET Norway requires it);
- the query itself, for example the address or organization number you asked
  about.

Each provider has its own privacy policy and terms; this project cannot change
them.

## What this server does not do

|                                       |                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hosted backend                        | **None.** No component of this project runs anywhere but your machine.                        |
| HTTP listener                         | **None.** The server communicates over stdin/stdout only. Nothing binds a port.               |
| Database                              | **None.**                                                                                     |
| User accounts                         | **None.**                                                                                     |
| Telemetry, analytics, crash reporting | **None**, and no dependency that provides them.                                               |
| Persistent storage                    | **None.** Nothing is written to disk at any point.                                            |
| Conversation content                  | Never stored, never forwarded anywhere except as the query text you asked about.              |
| Filesystem access                     | Not exposed. There is no tool that reads or writes files.                                     |
| Shell access                          | Not exposed.                                                                                  |
| Arbitrary URL fetching                | Not exposed. A caller cannot make this server request a URL of its choosing.                  |
| Arbitrary GraphQL or SQL              | Not exposed. Statistics queries are constrained to a table ID plus validated dimension codes. |

## Caching

The optional response cache (`NORWAY_MCP_CACHE`, on by default) is provided by
the SDK and is **in-process only**:

- it lives in memory, capped at 200 entries;
- it is never written to disk;
- it is not shared between processes;
- it is destroyed when the process exits.

Restarting the server discards it entirely. Set `NORWAY_MCP_CACHE=0` to disable
it, at the cost of more provider requests.

## Credentials

The only credentials this server accepts are `NORWAY_MCP_CONTACT_EMAIL` (an
identity MET Norway requires, not a secret) and `NORWAY_MCP_NVE_API_KEY` (a free
key that no shipped tool currently uses). The SSB Klass tools add **no** new
credential or environment variable: Klass is anonymous.

Both are:

- read once at startup from the environment;
- passed to the SDK, which sends them only to the provider that requires them;
- **redacted by value** from every tool result, every error message and every
  log line, so they cannot leak through an error path.

Credential-shaped patterns (`Authorization`, `x-api-key`, cookies) are stripped
even when this process never held the value, and local filesystem paths are
removed from all output. Stack traces are never returned to a client.

`--doctor` masks the configured email (`o***n@example.com`) and never prints the
API key at all.

## Logging

All diagnostics go to **stderr**. Your MCP client typically captures stderr to a
local log file — for Claude Desktop, `mcp-server-<name>.log` in its logs
directory. That file stays on your machine.

Debug logging (`NORWAY_MCP_DEBUG=1`) increases verbosity but passes through the
same redaction. Log records contain the tool name, an error code, a provider id
and a duration — not tool arguments or results.

## Read-only by design

Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`. The
SDK exposes no write operations for the endpoints used here, and this server
exposes no method that could modify provider data.

Restricted and personal data are deliberately out of scope: no national identity
numbers, no role-holder personal data, no Maskinporten-protected endpoints, and
no suppressed health values — FHI suppression flags are preserved and never
reconstructed.

## Verifying these claims

These are testable properties, not promises:

- `tests/unit/dependency-surface.test.ts` asserts no HTTP-server module is
  loaded, no server handle is opened, and only three runtime dependencies exist.
- `tests/unit/errors.test.ts` feeds configured secrets through every output path
  and asserts they never appear.
- `tests/integration/protocol.test.ts` asserts every byte on stdout is a
  JSON-RPC frame.
- `scripts/check-stdout.ts` statically rejects `console.*`, direct `fetch`, HTTP
  server construction, filesystem writes, shell execution and telemetry SDKs
  anywhere in `src/`.

Run them yourself with `pnpm verify`.
