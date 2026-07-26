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
Norway, NVE, SSB, SSB Klass, FHI, Entur, Statens vegvesen, Hva koster strømmen?,
BarentsWatch, BarentsWatch AIS and Fiskeridirektoratet — receive a direct HTTPS
request from your machine, exactly as if you had opened their website. They can
see:

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

This server accepts credentials from **environment variables only**. There is no
credential file, no keychain integration, no prompt and no other input path — a
tool argument can never supply one.

| Variable                                    | What it is                                     |
| ------------------------------------------- | ---------------------------------------------- |
| `NORWAY_MCP_CONTACT_EMAIL`                  | An identity MET Norway requires, not a secret  |
| `NORWAY_MCP_NVE_API_KEY`                    | A free key that no shipped tool currently uses |
| `NORWAY_MCP_BARENTSWATCH_CLIENT_ID`         | OAuth2 client id, BarentsWatch `api` scope     |
| `NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET`     | OAuth2 client secret, BarentsWatch `api` scope |
| `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID`     | OAuth2 client id, BarentsWatch `ais` scope     |
| `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET` | OAuth2 client secret, BarentsWatch `ais` scope |

The SSB Klass tools and both Fiskeridirektoratet registers add **no** credential
at all: they are anonymous.

Every one of them is:

- read once at startup from the environment;
- passed to the SDK, which sends each only to the provider that requires it —
  the two BarentsWatch scopes are separate, so an `ais` secret is never sent to
  the `api` host or the reverse;
- **redacted by value** from every tool result, every error message and every
  log line, so they cannot leak through an error path.

Client ids are redacted alongside secrets. A client id is not a password, but it
identifies a registered client and has no place in a tool result.

### OAuth2 tokens

The client-credentials exchange is **entirely the SDK's**. This server hands the
configured values over once at construction and never sees a token. The SDK
holds tokens in memory per instance, refreshes them before expiry, discards one
the provider rejects with HTTP 401, and — per its own documentation — never
writes them to the response cache or any persistent store. There is no hosted
proxy. Nothing token-related is written to disk by anything in this stack.

Credential-shaped patterns (`Authorization: Bearer …`, `x-api-key`, cookies) are
stripped even when this process never held the value, which is what catches a
token echoed back inside a provider error message. Local filesystem paths are
removed from all output, and stack traces are never returned to a client.

`--doctor` masks the configured email (`o***n@example.com`) and prints every key,
id and secret as `(set, masked)` — never the value.

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

## Maritime data specifically

- **No private vessel-owner information is returned.** Fiskeridirektoratet's
  vessel register publishes owners including natural persons. The SDK already
  withholds their name, postal code and town; this server additionally projects
  owners field by field rather than copying the record, so a future provider or
  SDK change could not leak a person's details through a spread. Private owners
  are reported as a count and nothing more. Anyone who genuinely needs those
  fields should read them from Fiskeridirektoratet directly, under that agency's
  own terms.
- **Vessel positions are public AIS safety broadcasts**, transmitted by the
  vessel itself and published by Kystverket through BarentsWatch. They are not
  tracking of people, and no tool here associates a position with an individual.
- **The live feed is bounded, not subscribed to.** `get_live_vessel_positions`
  holds a connection for at most 15 seconds, requires an explicit bounding box
  and result limit, closes on every exit path, and stores nothing. There is no
  background polling and no long-lived connection anywhere in this server.
- **Nothing maritime is retained.** Like every other tool, results exist only in
  the response and in the optional in-memory cache, which dies with the process.

## Verifying these claims

These are testable properties, not promises:

- `tests/unit/dependency-surface.test.ts` asserts no HTTP-server module is
  loaded, no server handle is opened, and only three runtime dependencies exist.
- `tests/unit/errors.test.ts` feeds configured secrets through every output path
  and asserts they never appear.
- `tests/unit/maritime-tools.test.ts` asserts that a client secret echoed back
  inside a provider error is redacted, that a bearer token is stripped, and that
  no natural-person owner field ever reaches a result.
- `tests/unit/live-vessel-positions.test.ts` asserts the AIS stream is released
  on every exit path — limit, timeout, cancellation and provider error — so no
  connection outlives a tool call.
- `tests/integration/protocol.test.ts` asserts every byte on stdout is a
  JSON-RPC frame.
- `scripts/check-stdout.ts` statically rejects `console.*`, direct `fetch`, HTTP
  server construction, filesystem writes, shell execution and telemetry SDKs
  anywhere in `src/`.

Run them yourself with `pnpm verify`.
