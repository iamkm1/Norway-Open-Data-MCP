# Norway Open Data MCP

**Norway Open Data MCP lets AI assistants use Norwegian public data directly as
tools. It runs locally on your computer and requires no hosted backend.**

```bash
npx -y norway-open-data-mcp
```

That is the whole deployment story. Your MCP client starts this package as a
local subprocess, talks to it over stdin/stdout, and the package calls
Norwegian public APIs directly from your machine through
[`norway-open-data-sdk`](https://www.npmjs.com/package/norway-open-data-sdk).

---

## Kort forklaring på norsk

Norway Open Data MCP gjør norske offentlige data tilgjengelig som verktøy for
AI-assistenter som Claude, Cursor og VS Code.

Serveren kjører **lokalt på din egen maskin**. Det finnes ingen bakenforliggende
tjeneste, ingen database, ingen brukerkonto og ingen telemetri. Forespørslene
går rett fra maskinen din til den relevante norske offentlige API-en gjennom
Norway Open Data SDK.

Du får ti kuraterte, **kun-lesende** verktøy: søk i Enhetsregisteret, oppslag av
selskaper og adresser, kommuneprofiler, værvarsel fra MET, farevarsler fra NVE,
strømpriser, avganger fra Entur og spørringer mot SSBs statistikkbanker.

Verktøynavnene er bevisst **ikke oversatt**. Stabile identifikatorer skal være
språknøytrale, slik at samme navn virker uansett hvilket språk du skriver på —
du kan gjerne stille spørsmålene dine på norsk.

Alle data er underlagt hver enkelt leverandørs vilkår, lisenser og
trafikkgrenser. Hvert resultat inneholder kildehenvisning.

> **Farevarsler er aldri en «alt klart»-melding.** En tom liste betyr ikke at et
> område er trygt. Bruk de offisielle tjenestene på [varsom.no](https://varsom.no)
> for alle sikkerhetsvurderinger.

---

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) is an open
standard that lets AI applications connect to external tools and data. An MCP
_client_ (Claude Desktop, Cursor, VS Code, the MCP Inspector) launches an MCP
_server_ and can then call the tools that server advertises.

This package is an MCP server. It speaks MCP over **stdio** — the client spawns
it as a child process and communicates over standard input and output. Nothing
listens on a port.

## Relationship to Norway Open Data SDK

This package is a **consumer** of the published
`norway-open-data-sdk` npm package, exactly like any other application. It does
not vendor, fork or modify the SDK.

|                                        | Norway Open Data SDK      | Norway Open Data MCP (this package) |
| -------------------------------------- | ------------------------- | ----------------------------------- |
| What it is                             | A TypeScript library      | An MCP server                       |
| Used by                                | Your own code             | AI assistants, via MCP              |
| Surface                                | 15 namespaces, 55 methods | 10 curated tools                    |
| Network, retries, caching, rate limits | Owned by the SDK          | Delegated to the SDK                |

The SDK's retry, cache and rate-limit behaviour is used as-is and deliberately
not reimplemented here.

## Zero-hosting architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Your computer                                                │
│                                                              │
│  ┌────────────────┐   spawn + stdio    ┌───────────────────┐ │
│  │  MCP client    │◄──── JSON-RPC ────►│ norway-open-data- │ │
│  │  (Claude,      │      (stdout)      │ mcp  (this pkg)   │ │
│  │   Cursor, …)   │                    │                   │ │
│  └────────────────┘                    │  stderr → log file│ │
│                                        └─────────┬─────────┘ │
│                                                  │           │
│                                   norway-open-data-sdk       │
└──────────────────────────────────────────────────┼───────────┘
                                                   │ HTTPS (outbound only)
        ┌──────────┬──────────┬──────────┬─────────┴────┬──────────────┐
        ▼          ▼          ▼          ▼              ▼              ▼
   Brønnøysund  Kartverket  MET Norway  NVE/Varsom     SSB          Entur
   registrene                                                 Hva koster strømmen?
```

No hosted backend · no HTTP listener · no database · no accounts · no telemetry
· no cloud infrastructure · no domain · no persistent storage.

## Requirements

- **Node.js 22 or newer** (matching the SDK's own requirement). Node must be a
  full-ICU build so Europe/Oslo dates resolve correctly — official Node builds
  are. `norway-open-data-mcp --doctor` checks this for you.
- An MCP-compatible client.
- No API key is required for nine of the ten tools.

## Installation

You do not need to install anything. `npx` fetches and runs it on demand, which
is how the client configurations below are written.

To install it explicitly:

```bash
npm install -g norway-open-data-mcp    # global executable
npm install norway-open-data-mcp       # as a project dependency
```

## Client configuration

> Configuration formats were verified against each vendor's current
> documentation. Note that the top-level key differs: Claude Desktop and Cursor
> use `mcpServers`, VS Code uses `servers`.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "norway-open-data": {
      "command": "npx",
      "args": ["-y", "norway-open-data-mcp"],
      "env": {
        "NORWAY_MCP_CONTACT_EMAIL": "you@example.com"
      }
    }
  }
}
```

Restart Claude Desktop completely afterwards.

### Cursor

Create `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "norway-open-data": {
      "command": "npx",
      "args": ["-y", "norway-open-data-mcp"],
      "env": {
        "NORWAY_MCP_CONTACT_EMAIL": "you@example.com"
      }
    }
  }
}
```

### VS Code

Create `.vscode/mcp.json` in your workspace (or use **MCP: Open User
Configuration**). VS Code uses `servers`, not `mcpServers`:

```json
{
  "servers": {
    "norway-open-data": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "norway-open-data-mcp"],
      "env": {
        "NORWAY_MCP_CONTACT_EMAIL": "you@example.com"
      }
    }
  }
}
```

### Windows notes

- `npx` must be on `PATH`. If the server fails to start with an `ENOENT` error
  mentioning `${APPDATA}`, add `"APPDATA": "C:\\Users\\<you>\\AppData\\Roaming\\"`
  to the `env` block — a known Claude Desktop issue — and make sure npm is
  installed globally (`npm install -g npm`).
- Use double backslashes in any JSON path.
- If `npx` is blocked by execution policy, install globally and use
  `"command": "norway-open-data-mcp"` with `"args": []`.

### macOS / Linux notes

- A client launched from the GUI may not inherit your shell `PATH`. If `npx` is
  not found, use an absolute path such as `"command": "/usr/local/bin/npx"`.
- With `nvm`, the Node version in a GUI-launched client can differ from your
  terminal's. Point `command` at an absolute Node path if `--doctor` reports a
  Node version below 22.

## Environment variables

Everything is optional. Nine of the ten tools work with no configuration.

| Variable                   | Default                      | What it does                                                                                                                                                                    |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NORWAY_MCP_CONTACT_EMAIL` | _(unset)_                    | **Required by MET Norway.** Enables `get_norwegian_weather_forecast` and the weather section of `get_norwegian_location_profile`. MET requires every caller to be identifiable. |
| `NORWAY_MCP_APP_NAME`      | `norway-open-data-mcp/0.1.0` | Caller identity sent to Entur (`ET-Client-Name`) and Statens vegvesen (`X-Client`), and part of MET's User-Agent.                                                               |
| `NORWAY_MCP_NVE_API_KEY`   | _(unset)_                    | Free NVE HydAPI key. **No v0.1 tool needs it**; accepted for forward compatibility.                                                                                             |
| `NORWAY_MCP_TIMEOUT_MS`    | `10000`                      | Request timeout, 1000–60000.                                                                                                                                                    |
| `NORWAY_MCP_RETRIES`       | `2`                          | Retry attempts after the first, 0–5.                                                                                                                                            |
| `NORWAY_MCP_CACHE`         | `1`                          | In-process response cache. Never written to disk.                                                                                                                               |
| `NORWAY_MCP_DEBUG`         | `0`                          | Verbose diagnostics on **stderr only**, with credentials redacted.                                                                                                              |

**No contact email is defaulted.** A fake address would be sent to MET Norway as
your identity, which is exactly what their terms exist to prevent. Without it,
the weather tool returns a clear configuration error naming the variable, and
every other tool keeps working.

An invalid value never crashes the server: it falls back to the documented
default and is reported by `--doctor`.

## Tool catalogue

Ten curated read-only tools. Names are stable, language-neutral identifiers.

| Tool                                 | Answers                                           | Providers                          | Config              | Default / max output  |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------- | ------------------- | --------------------- |
| `search_norwegian_companies`         | Find organizations and their organization numbers | Brønnøysundregistrene              | —                   | 10 / 50 results       |
| `get_norwegian_company_profile`      | Full detail for one organization number           | Brønnøysundregistrene + Kartverket | —                   | 1 organization        |
| `search_norwegian_addresses`         | Find, verify or disambiguate an address           | Kartverket                         | —                   | 10 / 50 addresses     |
| `get_norwegian_location_profile`     | Conditions, warnings and roads at one address     | Kartverket + MET + NVE + Vegvesen  | _email for weather_ | 20 hazards, 25 roads  |
| `get_norwegian_municipality_profile` | Population, life expectancy, businesses, hazards  | SSB + FHI + Brreg + NVE            | —                   | 1 municipality        |
| `get_norwegian_weather_forecast`     | Hourly forecast for a coordinate                  | MET Norway                         | **email required**  | 24 / 96 hours         |
| `get_current_norwegian_hazards`      | Official flood, avalanche and landslide warnings  | NVE (Varsom)                       | —                   | 25 / 100 warnings     |
| `get_norwegian_electricity_prices`   | Hourly spot prices for a bidding zone             | Hva koster strømmen?               | —                   | 23–25 hours (one day) |
| `get_norwegian_transport_departures` | Next departures from a stop                       | Entur                              | —                   | 10 / 50 departures    |
| `query_norwegian_statistics`         | Statistics Norway tables                          | SSB                                | —                   | 100 / 500 rows        |

Full contracts — input schemas, hard limits, warnings, error behaviour and
worked routing examples — are in
[docs/tool-catalogue.md](docs/tool-catalogue.md).

### Why ten tools and not fifty-five

The SDK exposes 55 public methods. Tool descriptions are routing instructions
for a model, and a model given 55 overlapping options routes worse than one
given 10 distinct ones. Every method that was considered and deferred is
recorded, with the reason, in
[docs/capability-matrix.md](docs/capability-matrix.md).

Three tools are **compositions** rather than method wrappers: departures
resolves a stop name before fetching the board, hazards merges three warning
feeds, and the statistics tool serves both table discovery and data through one
schema.

### Every result carries its source

```jsonc
{
  "data": {/* … */},
  "sources": [
    {
      "id": "ssb",
      "name": "Statistics Norway (SSB)",
      "homepage": "https://www.ssb.no/en/",
      "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      "attribution": "Attribute Statistics Norway when redistributing data.",
    },
  ],
  "retrievedAt": "2026-07-23T18:20:31.482Z",
  "cached": false,
  "warnings": ["…"],
  "truncation": null,
  "partial": null,
  "continuation": null,
}
```

Attribution, timestamps and cache status come from the SDK; nothing is
invented. Truncation is **never silent** — any shortened list is reported both
structurally and in prose.

## Provider attribution

Data comes from independently operated Norwegian public APIs, each with its own
terms:

| Provider                    | Licence (as declared by the provider)         |
| --------------------------- | --------------------------------------------- |
| Brønnøysundregistrene       | NLOD 2.0                                      |
| Kartverket                  | Dataset-specific Geonorge terms               |
| Statistics Norway (SSB)     | CC BY 4.0                                     |
| Folkehelseinstituttet (FHI) | Per statistics bank                           |
| MET Norway                  | NLOD 2.0 / CC BY 4.0 unless stated otherwise  |
| NVE / Varsom                | NLOD 2.0                                      |
| Entur                       | NLOD                                          |
| Statens vegvesen            | NLOD 2.0                                      |
| Hva koster strømmen?        | Open and free; no standardised licence stated |

This project is an independent open-source effort and is **not affiliated with,
sponsored by or endorsed by** any Norwegian public authority or by Hva koster
strømmen?. The MIT licence covers this source code only, never the data. See
`PROVIDERS.md` in `norway-open-data-sdk` for each provider's full terms.

## Privacy

- Runs entirely as a local process on your machine.
- **No project-owned backend.** There is no server operated by this project.
- **No telemetry, no analytics, no usage reporting** of any kind.
- Requests go directly from your machine to the relevant public-data provider.
  Those providers see your IP address and the caller identity you configure.
- **Nothing is persisted.** The optional response cache is in-process only and
  dies with the process. No tool input, tool result or conversation content is
  ever written to disk.
- Credentials are redacted from every result and every log line.
- The server cannot read files, write files, execute commands or fetch
  caller-supplied URLs. All network access goes through the SDK.

See [docs/privacy.md](docs/privacy.md) for the full model.

## Rate limits

The SDK enforces a per-provider request budget on every call, and this package
does not override it. Budgets range from 10 requests/minute (Data.norge search)
to 100/minute (Stortinget). A request that would exceed its budget waits rather
than failing.

Budgets bound this process's own traffic only — a provider may still return HTTP
429 if you share an IP. When that happens the tool returns a `rate_limited`
error carrying `retryAfter`, so the assistant can wait rather than hammer.

Providers may throttle or block clients that misidentify themselves. Set
`NORWAY_MCP_APP_NAME` to something meaningful if you use this heavily.

## Troubleshooting

Run the built-in diagnostic first. It makes **no network requests**, so it
cannot trip a rate limit:

```bash
npx -y norway-open-data-mcp --doctor
```

It reports your Node version, ICU availability, resolved configuration with
secrets masked, whether the SDK constructs, and which tools are ready or gated.

| Symptom                                                 | Likely cause                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Server does not appear in the client                    | Config file syntax error, or the client was not fully restarted.            |
| `ENOENT` / `npx` not found                              | `npx` is not on the `PATH` the client sees. Use an absolute path.           |
| Weather tool returns a configuration error              | `NORWAY_MCP_CONTACT_EMAIL` is unset or malformed. This is by design.        |
| `--doctor` reports Node too old                         | The client is launching a different Node than your terminal.                |
| Every tool fails with `rate_limited`                    | Another client shares your IP, or the same provider is being hit in a loop. |
| Tool returns `not_found` for today's electricity prices | Next-day prices publish in the early afternoon.                             |

### Debugging through stderr

All diagnostics go to **stderr**; stdout carries only MCP protocol frames. MCP
clients capture stderr to a log file:

- **Claude Desktop, macOS:** `~/Library/Logs/Claude/mcp-server-norway-open-data.log`
- **Claude Desktop, Windows:** `%APPDATA%\Claude\logs\mcp-server-norway-open-data.log`

Enable verbose output with `"NORWAY_MCP_DEBUG": "1"` in the `env` block. Debug
logs pass through the same credential redaction as tool results.

To watch it live:

```bash
# macOS / Linux
tail -f ~/Library/Logs/Claude/mcp*.log

# Windows PowerShell
Get-Content "$env:APPDATA\Claude\logs\mcp-server-norway-open-data.log" -Wait
```

## MCP Inspector

The [official Inspector](https://github.com/modelcontextprotocol/inspector)
gives you a UI for every tool:

```bash
pnpm inspector
# equivalent to:
npx -y @modelcontextprotocol/inspector node dist/cli.js
```

A manual verification checklist is in
[docs/inspector-checklist.md](docs/inspector-checklist.md). The Inspector writes
session tokens to disk — they are gitignored and must never be committed.

## Development

```bash
pnpm install
pnpm build              # tsup → dist/index.js, dist/cli.js, dist/index.d.ts
pnpm dev                # rebuild on change
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint
pnpm format             # prettier --write
pnpm test               # unit + routing-corpus tests (no network)
pnpm test:coverage      # with coverage thresholds enforced
pnpm test:integration   # spawns the built binary and speaks MCP to it
pnpm test:package       # npm pack → install outside the repo → run it
pnpm audit:stdout       # static stdout/safety audit
pnpm inspector          # MCP Inspector against the built server
pnpm verify             # the full release-quality pipeline
```

`pnpm verify` runs format check → lint → typecheck → stdout audit → unit tests
with coverage → build → integration tests → package test. It is what CI runs
and what must pass before a release.

No test in the default pipeline touches a live public API. The server factory
takes an injected SDK:

```ts
import { createNorwayOpenDataMcpServer } from "norway-open-data-mcp";

const { server, close } = createNorwayOpenDataMcpServer({
  sdk: myFakeSdk, // any object satisfying NorwayOpenDataLike
});
```

Live provider tests are opt-in and bounded:

```bash
pnpm test:live   # requires RUN_LIVE_TESTS=true; low-volume by design
```

## Limitations

Stated plainly, because a tool that overstates its coverage is worse than one
that admits its edges:

- **Hazard results are never an all-clear.** They are a discovery summary. An
  empty list does not mean an area is safe. Use varsom.no for safety decisions.
- **Not exposed in v0.1:** journey planning, open-dataset catalogue search
  (Data.norge), exchange rates and policy rates (Norges Bank), FHI health tables
  beyond the municipality profile, NVDB road querying, parliamentary data
  (Stortinget), power plants and reservoir levels, and NVE HydAPI. All are
  supported by the SDK; they were cut to keep the tool set routable. See
  [docs/capability-matrix.md](docs/capability-matrix.md).
- **`includeRaw` is not exposed.** The SDK documents raw provider payloads as
  structurally unstable.
- **Electricity prices come from a third party**, not an official government
  endpoint, and exclude grid rent, taxes and surcharges.
- **Weather needs a contact email.** There is no way around this that respects
  MET Norway's terms.
- **Location-profile roads** are first-page bounding-box candidates, not a
  distance-ranked radius query.
- **Statistics value codes must be discovered**, never guessed — hence the
  two-step call.
- **Address county filtering** is applied locally by the SDK over one provider
  page, because Kartverket exposes no county parameter.
- **Upstream contracts can change** independently of this package. A changed
  provider response surfaces as `upstream_invalid_response` rather than as
  unvalidated data.
- **Restricted and personal data are out of scope**, deliberately: no national
  identity numbers, no role-holder personal data, no Maskinporten-protected
  endpoints.
- The optional cache is in-process only and is not shared between restarts.

## Versioning policy

This project follows [Semantic Versioning](https://semver.org). While the major
version is `0`:

- **Patch** — fixes, validation corrections, documentation.
- **Minor** — new tools, new optional inputs, new envelope fields. **A breaking
  change is also released as a minor version while the major is 0**, so pin
  exactly (`norway-open-data-mcp@0.1.0`) if you depend on tool shapes.
- **Major** — reserved for 1.0 onwards.

Treated as breaking: removing or renaming a tool, removing an input or output
field, tightening an input schema, or changing a tool's meaning. Tool **names**
are stable identifiers and are never translated.

The `norway-open-data-sdk` dependency is pinned to `^0.5.2`. Because the SDK is
also pre-1.0, its own breaking changes ship as minor versions and are therefore
**not** picked up by that caret range automatically — SDK upgrades are
deliberate, reviewed changes here.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `pnpm verify`.

New tools need a strong case: the bar is a distinct user intention that no
existing tool answers, a bounded output, and a description a model can route on
without ambiguity. Please read
[docs/tool-catalogue.md](docs/tool-catalogue.md) first.

## Licence

MIT — see [LICENSE](LICENSE). The licence covers this source code only, not the
data returned by providers.
