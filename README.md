# Norway Open Data MCP

[![npm version](https://img.shields.io/npm/v/norway-open-data-mcp.svg)](https://www.npmjs.com/package/norway-open-data-mcp)
[![npm downloads](https://img.shields.io/npm/dm/norway-open-data-mcp.svg)](https://www.npmjs.com/package/norway-open-data-mcp)
[![CI](https://github.com/iamkm1/Norway-Open-Data-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/iamkm1/Norway-Open-Data-MCP/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/norway-open-data-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/npm/l/norway-open-data-mcp.svg)](LICENSE)

**Norway Open Data MCP lets AI assistants use Norwegian public data directly as
tools. It runs locally on your machine and needs no hosted backend.**

```bash
npx -y norway-open-data-mcp
```

That single command is the entire deployment story. Your MCP client starts this
package as a local subprocess, talks to it over stdin/stdout, and the package
calls Norwegian public APIs directly from your machine.

Built on top of
[Norway Open Data SDK](https://github.com/iamkm1/Norway-Open-Data), which
provides the underlying provider integrations, validation, retries, caching and
typed responses. This package adds a curated, AI-facing tool layer on top:

```
AI client → Norway Open Data MCP → Norway Open Data SDK → Norwegian public APIs
```

> **Run the command above in a plain terminal and it looks like it hangs.** That
> is expected. An MCP server has no interactive UI: it waits silently for a
> client to speak the Model Context Protocol over stdin/stdout. Press `Ctrl+C`
> to exit. In normal use you never launch it by hand — an MCP client starts it
> for you (see [Client configuration](#client-configuration)).

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
[`norway-open-data-sdk`](https://www.npmjs.com/package/norway-open-data-sdk) npm
package ([source](https://github.com/iamkm1/Norway-Open-Data)), exactly like any
other application. It does not vendor, fork or modify the SDK, and the two are
separate packages and separate repositories.

|                                        | Norway Open Data SDK       | Norway Open Data MCP (this package) |
| -------------------------------------- | -------------------------- | ----------------------------------- |
| What it is                             | A TypeScript library       | An MCP server                       |
| Used by                                | Your own code              | AI assistants, via MCP              |
| Surface                                | 21 namespaces, 80+ methods | 28 curated tools                    |
| Network, retries, caching, rate limits | Owned by the SDK           | Delegated to the SDK                |

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
                                                   ▼
   Brønnøysundregistrene · Kartverket · SSB · FHI · MET Norway · NVE (Varsom)
   Entur · Statens vegvesen · Hva koster strømmen? · BarentsWatch
   BarentsWatch AIS (Kystverket) · Fiskeridirektoratet
```

No hosted backend · no HTTP listener · no database · no accounts · no telemetry
· no cloud infrastructure · no domain · no persistent storage.

## Requirements

- **Node.js 22 or newer** (matching the SDK's own requirement). Node must be a
  full-ICU build so Europe/Oslo dates resolve correctly — official Node builds
  are. `norway-open-data-mcp --doctor` checks this for you.
- An MCP-compatible client.
- **No API key is required by any tool.** One tool needs a contact email,
  because MET Norway requires every caller to be identifiable. Four maritime
  tools need free BarentsWatch OAuth2 client credentials; the other fifteen
  tools need nothing at all.

## Installation

You do not need to install anything up front. `npx` fetches and runs the package
on demand, which is how the client configurations below are written.

To install it explicitly:

```bash
npm install -g norway-open-data-mcp    # global executable
npm install norway-open-data-mcp       # as a project dependency
```

## Client configuration

> The formats below were verified against each vendor's current documentation.
> Note that the top-level key differs: Claude Desktop and Cursor use
> `mcpServers`, while VS Code uses `servers`.

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

- `npx` must be on `PATH`. If a client cannot start the server, some Windows
  clients need the command routed through `cmd`:

  ```json
  {
    "command": "cmd",
    "args": ["/c", "npx", "-y", "norway-open-data-mcp"]
  }
  ```

- If the server fails to start with an `ENOENT` error mentioning `${APPDATA}`,
  add `"APPDATA": "C:\\Users\\<you>\\AppData\\Roaming\\"` to the `env` block — a
  known Claude Desktop issue — and make sure npm is installed globally
  (`npm install -g npm`).
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

Everything is optional. **Twenty-three of the twenty-eight tools work with no
configuration at all**, including both Fiskeridirektoratet registers and all
eight geospatial tools. The five that need something are
`get_norwegian_weather_forecast` (a contact email for MET Norway),
`get_marine_forecast`, and the three BarentsWatch AIS tools. The geospatial
release added **no new environment variable**: Geonorge, Naturbase and NIBIO are
all anonymous.

| Variable                   | Default                      | What it does                                                                                                                                                                    |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NORWAY_MCP_CONTACT_EMAIL` | _(unset)_                    | **Required by MET Norway.** Enables `get_norwegian_weather_forecast` and the weather section of `get_norwegian_location_profile`. MET requires every caller to be identifiable. |
| `NORWAY_MCP_APP_NAME`      | `norway-open-data-mcp/0.4.0` | Caller identity sent to Entur (`ET-Client-Name`) and Statens vegvesen (`X-Client`), and part of MET's User-Agent.                                                               |
| `NORWAY_MCP_NVE_API_KEY`   | _(unset)_                    | Free NVE HydAPI key. **No current tool needs it**; accepted for forward compatibility.                                                                                          |
| `NORWAY_MCP_TIMEOUT_MS`    | `10000`                      | Request timeout, 1000–60000.                                                                                                                                                    |
| `NORWAY_MCP_RETRIES`       | `2`                          | Retry attempts after the first, 0–5.                                                                                                                                            |
| `NORWAY_MCP_CACHE`         | `1`                          | In-process response cache. Never written to disk.                                                                                                                               |
| `NORWAY_MCP_DEBUG`         | `0`                          | Verbose diagnostics on **stderr only**, with credentials redacted.                                                                                                              |

### BarentsWatch credentials (maritime tools)

BarentsWatch issues **two separate registered clients** — one for AIS, one for
its other services — and a secret registered for one is never accepted by the
other. They are therefore two independent variable pairs, and the SDK keeps them
in separate credential scopes so a secret can never be sent to the wrong host.

| Variable                                    | Enables                                                               | Scope |
| ------------------------------------------- | --------------------------------------------------------------------- | ----- |
| `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID`     | `get_vessel_profile`, `get_vessel_track`, `get_live_vessel_positions` | `ais` |
| `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET` | _(same three tools; both halves are required)_                        | `ais` |
| `NORWAY_MCP_BARENTSWATCH_CLIENT_ID`         | `get_marine_forecast`                                                 | `api` |
| `NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET`     | _(same tool; both halves are required)_                               | `api` |

Register a free client at [BarentsWatch MyPage](https://www.barentswatch.no/minside/) —
an **AIS-client** for the AIS scope and an **API-client** for the other. Then:

```powershell
$env:NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID="your-ais-client-id"
$env:NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET="your-ais-client-secret"
```

The OAuth2 client-credentials exchange, token caching, refresh-before-expiry and
401 handling are all the SDK's. This server holds the two values, hands them to
the SDK once at construction and never sees a token.

**A half-configured pair is refused.** Setting only the id, or only the secret,
drops both and reports the missing variable through `--doctor` — a token
endpoint returning HTTP 400 names an HTTP status, not the variable you forgot.

Without these variables the four BarentsWatch tools return a clear configuration
error naming exactly the variables to set. **Tool discovery is unaffected and
every other tool keeps working**, including the two Fiskeridirektoratet
registers, which are served anonymously.

Set the contact email with a placeholder of your own, for example:

```powershell
$env:NORWAY_MCP_CONTACT_EMAIL="you@example.com"
```

**No contact email is defaulted.** A fake address would be sent to MET Norway as
your identity, which is exactly what their terms exist to prevent. Do not insert
a fake email. Without it, the weather tool returns a clear configuration error
naming the variable, tool discovery is unaffected, and every other tool keeps
working.

An invalid value never crashes the server: it falls back to the documented
default and is reported by `--doctor`.

**Secrets never leave this process.** Client ids, client secrets and OAuth2
tokens are redacted from every tool result, every error message and every stderr
diagnostic, matched both as literal configured values and as credential-shaped
patterns. `--doctor` prints `(set, masked)` and never the value.

## Tool catalogue

Twenty-eight curated read-only tools, grouped below by purpose. Tool **names** are
stable, language-neutral identifiers and are never translated. Full contracts —
input schemas, hard limits, warnings and error behaviour — are in
[docs/tool-catalogue.md](docs/tool-catalogue.md).

### Companies and profiles

| Tool                            | Purpose                                           | Source                             | Config | Default / max   |
| ------------------------------- | ------------------------------------------------- | ---------------------------------- | ------ | --------------- |
| `search_norwegian_companies`    | Find organizations and their organization numbers | Brønnøysundregistrene              | —      | 10 / 50 results |
| `get_norwegian_company_profile` | Full detail for one organization number           | Brønnøysundregistrene + Kartverket | —      | 1 organization  |

### Addresses and places

| Tool                                 | Purpose                                          | Source                                    | Config              | Default / max        |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------- | ------------------- | -------------------- |
| `search_norwegian_addresses`         | Find, verify or disambiguate an address          | Kartverket                                | —                   | 10 / 50 addresses    |
| `get_norwegian_location_profile`     | Conditions, warnings and roads at one address    | Kartverket + MET + NVE + Statens vegvesen | _email for weather_ | 20 hazards, 25 roads |
| `get_norwegian_municipality_profile` | Population, life expectancy, businesses, hazards | SSB + FHI + Brønnøysundregistrene + NVE   | —                   | 1 municipality       |

### Weather and hazards

| Tool                             | Purpose                                          | Source       | Config             | Default / max     |
| -------------------------------- | ------------------------------------------------ | ------------ | ------------------ | ----------------- |
| `get_norwegian_weather_forecast` | Hourly forecast for a coordinate                 | MET Norway   | **email required** | 24 / 96 hours     |
| `get_current_norwegian_hazards`  | Official flood, avalanche and landslide warnings | NVE (Varsom) | —                  | 25 / 100 warnings |

### Electricity and transport

| Tool                                 | Purpose                               | Source               | Config | Default / max         |
| ------------------------------------ | ------------------------------------- | -------------------- | ------ | --------------------- |
| `get_norwegian_electricity_prices`   | Hourly spot prices for a bidding zone | Hva koster strømmen? | —      | 23–25 hours (one day) |
| `get_norwegian_transport_departures` | Next departures from a stop           | Entur                | —      | 10 / 50 departures    |

### Official statistics

| Tool                         | Purpose                                     | Source | Config | Default / max  |
| ---------------------------- | ------------------------------------------- | ------ | ------ | -------------- |
| `query_norwegian_statistics` | Discover and query Statistics Norway tables | SSB    | —      | 100 / 500 rows |

### Classifications and administrative codes (SSB Klass)

| Tool                                    | Purpose                                                          | Source    | Config | Default / max        |
| --------------------------------------- | ---------------------------------------------------------------- | --------- | ------ | -------------------- |
| `resolve_norwegian_administrative_code` | Track a municipality or county code across renames/merges/splits | SSB Klass | —      | all official matches |
| `search_norwegian_classification_codes` | Look up codes in an official classification by code pattern      | SSB Klass | —      | 10 / 20 codes        |

SSB Klass is a **separate service** from the SSB statistics (PxWeb) API behind
`query_norwegian_statistics`: Klass publishes the official _code lists_
(municipalities, counties, industry, occupations, …) and their history, while
PxWeb publishes the _numbers_. Klass access is anonymous — no key, no new
environment variable.

### Vessels and AIS

| Tool                        | Purpose                                              | Source                                                    | Config              | Default / max                      |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------- | ------------------- | ---------------------------------- |
| `get_vessel_profile`        | One vessel by MMSI: AIS position, identity, register | BarentsWatch AIS + Fiskeridirektoratet + MET + Kartverket | **AIS credentials** | 1 vessel                           |
| `get_vessel_track`          | Recorded positions for one vessel over a past window | BarentsWatch AIS                                          | **AIS credentials** | 50 / 100 points, ≤ 14-day window   |
| `get_live_vessel_positions` | Bounded sample of the live feed for one sea area     | BarentsWatch AIS                                          | **AIS credentials** | box + limit ≤ 200 + timeout ≤ 15 s |

`get_live_vessel_positions` is the only tool backed by a **stream**. The SDK's
`streamPositions()` is an endless `AsyncIterable`, and MCP has no way to express
that — a tool call is one request and one result. So the tool takes a _sample_:
a bounding box, a result limit and a timeout in milliseconds are all **required
arguments with no defaults**, the sample stops at whichever bound is reached
first, and the connection is closed on every path — limit reached, timeout,
cancellation, or provider error. **No infinite stream is ever exposed through
MCP.** A result is explicitly a sample, not a census of the area.

> **The three bounds are limits of this MCP server, not of BarentsWatch.**
> BarentsWatch publishes no maximum bounding-box size, no result cap and no
> connection time limit for its AIS APIs — a caller using
> [norway-open-data-sdk](https://www.npmjs.com/package/norway-open-data-sdk)
> directly is subject to none of them. The bounding box is capped at **6° of
> latitude by 12° of longitude**, the result limit at **200** and the timeout at
> **15 s** because a tool call returns one bounded result into a model's context
> window: over a much larger area the sample is dominated by whichever few
> vessels transmitted first and stops representing the area at all, and a
> long-held connection turns a question into a subscription. These are product
> decisions, subject to revision, and the rejection message says so — a caller
> is never left believing the provider refused the request.

### Fisheries and aquaculture

| Tool                           | Purpose                                                     | Source              | Config | Default / max   |
| ------------------------------ | ----------------------------------------------------------- | ------------------- | ------ | --------------- |
| `search_fishing_vessels`       | Search the register of active Norwegian fishing vessels     | Fiskeridirektoratet | —      | 10 / 50 vessels |
| `get_fishing_vessel`           | One vessel by register id, registration mark or call sign   | Fiskeridirektoratet | —      | 1 vessel        |
| `search_aquaculture_locations` | Find fish-farming sites by area, holder, species or licence | Fiskeridirektoratet | —      | 10 / 100 sites  |
| `get_aquaculture_location`     | One aquaculture site by its site number                     | Fiskeridirektoratet | —      | 1 site          |

Both registers are **open and anonymous** — they need no credentials at all.

**Private vessel-owner details are never returned.** The register publishes
owners including natural persons; the SDK already withholds their name, postal
code and town, and this server additionally projects owners field by field, so
only registered legal entities are described. Private owners are reported as a
count and nothing more.

### Marine conditions

| Tool                  | Purpose                                        | Source       | Config              | Default / max          |
| --------------------- | ---------------------------------------------- | ------------ | ------------------- | ---------------------- |
| `get_marine_forecast` | Wave height, period, direction and sea current | BarentsWatch | **api credentials** | 1 coordinate, 2 models |

A coordinate no model covers returns `null` sections rather than failing, which
is how "no model covers this point" stays distinguishable from "the provider
failed". If one of the two models fails and the other succeeds, the working one
is still returned, with the failure recorded in `partial` and in the warnings.

### Geospatial catalogue (Geonorge)

| Tool                       | Purpose                                            | Source              | Config | Default / max      |
| -------------------------- | -------------------------------------------------- | ------------------- | ------ | ------------------ |
| `search_geonorge_datasets` | Discover which Norwegian geodata exists, and whose | Geonorge/Kartverket | —      | 10 / 50 records    |
| `get_geonorge_metadata`    | Licence, extent, CRS and endpoints for one record  | Geonorge/Kartverket | —      | 1 catalogue record |

These describe data; they never deliver it. A catalogue record lists the WFS,
WMS, ArcGIS and download endpoints its publisher advertises, and this server
reports them as metadata and never calls them. **No tool here accepts a URL** —
see [Why no generic map-service tool](#why-no-generic-map-service-tool).

### Nature and land resources

| Tool                              | Purpose                                                | Source                         | Config | Default / max        |
| --------------------------------- | ------------------------------------------------------ | ------------------------------ | ------ | -------------------- |
| `get_protected_areas_at`          | Which conservation areas legally cover one coordinate  | Naturbase                      | —      | 10 / 50 areas        |
| `search_protected_areas`          | Conservation areas intersecting a bounded rectangle    | Naturbase                      | —      | 20 / 100 areas       |
| `get_nature_types_at`             | Mapped NiN nature localities at one coordinate         | Naturbase                      | —      | 10 / 50 localities   |
| `get_intervention_free_nature_at` | January 2023 wilderness-distance zones at a coordinate | Naturbase                      | —      | 5 / 25 zones (min 2) |
| `get_land_resources_at`           | AR50 land type, forest, tree and vegetation classes    | NIBIO                          | —      | 5 / 25 polygons      |
| `get_nature_profile`              | All five datasets plus place and municipality, at once | Naturbase + NIBIO + Kartverket | —      | 10 / 50 per dataset  |

All six are anonymous — **no credential of any kind**. Every result is bounded,
reports `truncated` / `hasMore` from the SDK rather than inferring it, and
carries each provider's own licence and required attribution. Miljødirektoratet's
intervention-free layer publishes under different terms from the rest of
Naturbase, and both sets of terms are preserved separately rather than collapsed.

**Geometry is off by default.** Set `includeGeometry: true` to receive verbatim
GeoJSON polygons. Geometry is never simplified and never partially returned: a
polygon keeps every interior ring (hole) and a multipolygon keeps every part, or
the geometry is omitted whole and the omission is reported in `truncation` and in
`geometrySummary`. That summary — part count, hole count, vertex count — is
present either way, so a caller always knows an area has holes even when the
coordinates were too large to send. Real polygons routinely exceed the limit: the
AR50 polygon at Galdhøpiggen has 19,403 vertices across 63 rings.

**An empty result is never an environmental clearance.** These are four selected
Naturbase datasets and one generalized NIBIO map, not a register of everything of
environmental value, and coverage is uneven. Every result says so, in both the
structured warnings and the rendered text.

### Why no generic map-service tool

Norway publishes hundreds of WFS, WMS, OGC API Features and ArcGIS REST
endpoints, and it would be easy to expose one tool that takes a service URL and
a layer name. This server deliberately does not, and the SDK it is built on does
not either.

A URL-taking tool is a general-purpose HTTP fetcher wearing a map-shaped
costume. It would let a model reach any host the process can reach, make the
result's provenance unknowable — no licence, no attribution, no way to tell a
government service from anything else — and put unbounded, unvalidated payloads
of arbitrary size and CRS into a context window. None of the guarantees the rest
of this README makes could survive it.

So the curated datasets above are reachable and nothing else is. Every input is
a coordinate, a bounded rectangle, a search term or an opaque catalogue
identifier; the metadata tool rejects anything containing `://` or a path
separator. The catalogue tools still let a model _discover_ any published
Norwegian service and tell the user where it is — they just do not fetch it.

### Why twenty-eight tools and not one per SDK method

The SDK exposes 80+ public methods across 21 namespaces — including 14 in its
`klass` namespace alone, 9 in `ais`, and 15 across `geodata`, `environment` and
`land`. Tool descriptions are routing instructions for a model, and a model given
dozens of overlapping options routes worse than one given a curated set. So only
two Klass tools are exposed, not fourteen, three AIS tools, not nine, and six
nature tools, not fifteen. Every method that was considered and
deferred is recorded, with the reason, in
[docs/capability-matrix.md](docs/capability-matrix.md).

Several tools are **compositions** rather than method wrappers: departures
resolves a stop name before fetching the board, hazards merges three warning
feeds, the statistics tool serves both table discovery and data through one
schema, the marine forecast merges two independent models with per-section
failure handling, and the vessel and nature profiles are the SDK's own
cross-provider compositions surfaced whole. The classification-code search likewise routes an
exact code to a precise lookup and a pattern to a code search behind one
contract.

## Usage examples

You interact with these tools through your AI client in plain language — you do
not call them directly. Because the tool names are language-neutral, the
assistant routes correctly whether you write in English or Norwegian. A few
things you could ask:

- Find Norwegian companies named Equinor. _(“Finn bedrifter som heter Equinor”)_
- Verify an address in Oslo and show its coordinates.
- Build a full profile for organization number `923609016`.
- Show current flood, avalanche and landslide warnings for a location.
- Show the next departures from a transport stop. _(“Vis avganger fra Oslo S”)_
- Query a specific Statistics Norway table, such as population by municipality.
- What replaced the old municipality number 1142, and was it a merge or a split?
- Which STYRK occupation codes begin with 25? _(“Hvilke yrkeskoder starter på 25?”)_
- Tell me about the vessel with MMSI 257123456 and where it has sailed today.
- Which ships are moving in the Trondheimsfjord right now? _(a short live sample)_
- How high are the waves off Hitra? _(“Hvor høye er bølgene utenfor Hitra?”)_
- Which fishing vessels are registered in Stavanger, and which are over 30 m?
- Which aquaculture sites are in Heim, and what biomass is site 10318 permitted?
- Is 61.6365, 8.3126 inside a national park, and who manages it? _("Ligger dette
  punktet i en nasjonalpark?")_
- What kind of terrain is at that coordinate — forest, bog or bare ground?
  _("Hva slags arealtype er det her?")_
- Is this spot still intervention-free nature, and how far from infrastructure?
- Give me everything about the nature at this coordinate at once.
- Which Norwegian datasets describe protected areas, who publishes them, and
  under what licence may I reuse them?

The server only reads and returns public data. It never performs actions, writes
data, or makes changes on your behalf. And an empty hazard response is **not** an
authoritative all-clear — see [Limitations](#limitations).

## Every result carries its source

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

Attribution, timestamps and cache status come from the SDK; nothing is invented.
Truncation is **never silent** — any shortened list is reported both structurally
and in prose.

## Provider attribution

Data comes from independently operated Norwegian public APIs, each with its own
terms:

| Provider                                             | Licence (as declared by the provider)         |
| ---------------------------------------------------- | --------------------------------------------- |
| Brønnøysundregistrene                                | NLOD 2.0                                      |
| Kartverket                                           | Dataset-specific Geonorge terms               |
| Statistisk sentralbyrå (SSB)                         | CC BY 4.0                                     |
| Statistisk sentralbyrå (SSB) Klass                   | CC BY 4.0                                     |
| Folkehelseinstituttet (FHI)                          | Per statistics bank                           |
| MET Norway                                           | NLOD 2.0 / CC BY 4.0 unless stated otherwise  |
| Norges vassdrags- og energidirektorat (NVE / Varsom) | NLOD 2.0                                      |
| Entur                                                | NLOD                                          |
| Statens vegvesen                                     | NLOD 2.0                                      |
| Hva koster strømmen?                                 | Open and free; no standardised licence stated |
| BarentsWatch                                         | NLOD                                          |
| BarentsWatch AIS (data from Kystverket)              | NLOD                                          |
| Fiskeridirektoratet                                  | Fiskeridirektoratet data licence, NLOD terms  |
| Geonorge / Kartverket (catalogue)                    | CC BY 4.0 for Kartverket open products        |
| Miljødirektoratet / Naturbase                        | NLOD                                          |
| Miljødirektoratet — inngrepsfri natur 01.2023        | NLOD 1.0, with its own required wording       |
| NIBIO (AR50)                                         | NLOD 1.0, "Kilde: NIBIO."                     |

**AIS data is supplied by the Norwegian Coastal Administration (Kystverket)
through BarentsWatch, and both must be credited.** That attribution is carried
on every AIS result, in both the structured envelope and the rendered text, so a
text-only client cannot lose it. Wave forecasts additionally require crediting
the model provider BarentsWatch names.

**Two Naturbase layers, two sets of terms.** The intervention-free layer requires
the wording `Miljødirektoratet - inngrepsfri natur 01.2023` under NLOD 1.0, while
the other Naturbase layers use the general NLOD notice. The SDK returns both
under the same provider id, so this server keys attribution on the terms as well
as the id and returns two entries rather than silently keeping one. **Geonorge
attribution is not transitive**: crediting Kartverket for the catalogue does not
satisfy the licence of the resource a record describes, which carries its own
publisher terms and access constraints.

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
  ends with the process. No tool input, tool result or conversation content is
  ever written to disk.
- Credentials are redacted from every result and every log line. That includes
  OAuth2 client ids, client secrets and any bearer token echoed back by a
  provider; tokens are held in memory by the SDK and never written anywhere.
- **No private vessel-owner information is returned.** Fiskeridirektoratet
  publishes owners including natural persons; those records are reduced to a
  count with no name, postal code or town.
- **Vessel positions are public AIS broadcasts**, not tracking of people. A
  live sample is bounded in area, count and duration, holds no connection beyond
  15 seconds, and stores nothing.
- **Geonorge contact people are not relayed.** The catalogue publishes named
  individuals and their e-mail addresses; results carry only the responsible
  organization and its role.
- The server cannot read files, write files, execute commands or fetch
  caller-supplied URLs. All network access goes through the SDK.

See [docs/privacy.md](docs/privacy.md) for the full model and
[docs/architecture.md](docs/architecture.md) for the design.

## Rate limits

The SDK enforces a per-provider request budget on every call, and this package
does not override it. Budgets range from 10 requests/minute (Data.norge search)
to 100/minute (Stortinget). A request that would exceed its budget waits rather
than failing.

The three geospatial providers publish no numeric budget of their own, so the
SDK applies courtesy limits — 30 requests/minute for Geonorge and Naturbase, 20
for NIBIO — and every spatial call is a bounded page rather than a walk. This
server additionally caps provider requests per tool call, so one tool call can
never become a crawl.

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

## Norway Open Data ecosystem

- [Norway Open Data SDK](https://github.com/iamkm1/Norway-Open-Data) — a typed
  TypeScript SDK for Norwegian public APIs (provider integrations, validation,
  retries, caching and typed responses).
- **Norway Open Data MCP** (this package) — curated MCP tools built on top of
  the SDK, so AI clients can use Norwegian public data over stdio.

## Limitations

Stated plainly, because a tool that overstates its coverage is worse than one
that admits its edges:

- **Hazard results are never an all-clear.** They are a discovery summary. An
  empty list does not mean an area is safe. Use
  [varsom.no](https://varsom.no) for all safety decisions.
- **Not exposed as tools:** journey planning, open-dataset catalogue search
  (Data.norge), exchange rates and policy rates (Norges Bank), FHI health tables
  beyond the municipality profile, NVDB road querying, parliamentary data
  (Stortinget), power plants and reservoir levels, NVE HydAPI, the ten SSB
  Klass methods beyond the two curated ones (correspondence tables, code
  changes, and full classification/version/code-list browsing), and the six AIS
  methods beyond the three curated ones (`streamMessages`, `getLatestPositions`,
  `getMmsiInArea`, `getVesselSnapshot(s)`, `getCoverageArea`, `searchVessels`)
  plus the marine wave _series_ endpoint, the auto-paginating fisheries
  iterators, Geonorge service search and its catalogue iterators, and the
  Naturbase/NIBIO bounding-box and lazy-iterator variants beyond the two curated
  spatial searches. All are supported by the SDK; they were cut to keep the tool
  set routable. See [docs/capability-matrix.md](docs/capability-matrix.md).
- **AIS absence is never absence at sea.** BarentsWatch covers the Norwegian
  economic zone plus the Svalbard and Jan Mayen protection zones, excludes
  fishing vessels under 15 m and leisure or sailing vessels under 45 m, and
  retains 14 days. "No position" never means an MMSI is unassigned or a vessel
  does not exist, and every AIS result says so.
- **`get_live_vessel_positions` returns a sample, not a census.** It holds a
  live connection for at most 15 seconds and stops at the first bound reached.
  Vessels transmitting later, less often, or outside the box are absent, and the
  same call twice will not return the same set. Its bounding-box, result and
  timeout caps are **this server's limits, not BarentsWatch's** — the provider
  imposes none of them.
- **Private vessel-owner details are never returned.** Only registered legal
  entities are described; natural-person owners are counted and nothing more.
  Read them from Fiskeridirektoratet directly, under that agency's own terms.
- **Marine forecasts are model output on a grid.** The returned coordinate is
  the centre of the grid cell that answered, which may be some distance from the
  point you asked about, and BarentsWatch publishes no unit for sea-current
  speed, so none is asserted.
- **Aquaculture capacity is not comparable across sites** without checking
  `capacityUnitType`; the register mixes units across licence kinds.
- **The fishing-vessel and aquaculture registers report no total count.** Their
  `hasMore` is inferred from a full page, so requesting the next page can
  legitimately return nothing.
- **Classification-code search is code-pattern search**, not name or full-text
  search. You match by code (`0301`), wildcard (`25*`), range (`01-05`) or list,
  never by a place or category name.
- **Administrative-code resolution never combines statistics.** It returns every
  official candidate and preserves the SDK's status (unchanged, renamed,
  replaced, merged, split, ambiguous, not_found, context_required). A merge,
  split or ambiguous mapping needs application or human judgement, and
  administrative correspondence does **not** by itself prove that statistics for
  the areas are comparable. SSB Klass and SSB PxWeb statistics are separate
  services.
- **An empty nature result is never an environmental clearance.** The four
  Naturbase datasets exposed here are a selection, not a register of everything
  of environmental value: legacy DN-håndbok 13 localities, species observations,
  locally valuable nature and many other Naturbase layers are not queried, and
  survey coverage across Norway is uneven. "Nothing mapped here" and "nothing of
  value here" are different claims and only the first is supportable.
- **Naturbase nature types are the modern NiN localities of national
  importance** selected for SDK 0.8.0 — red-listed, threatened or centrally
  functional ecosystems — not every nature-type layer the agency publishes.
- **Intervention-free nature is the January 2023 status only**, not a live
  assessment, and confers no protection. Anything built since that date is not
  reflected. It measures distance from major infrastructure (zone 1: 1–3 km,
  zone 2: 3–5 km, zone v: ≥ 5 km) and nothing about ecological quality.
- **AR50 is generalized, not parcel-precision.** It targets scales of roughly
  1:20,000 to 1:100,000 and may merge areas below about 15 decares into a
  surrounding class, so an AR50 polygon is not a property boundary. The detailed
  AR5 map, agricultural-land records and soil or cultivation-suitability products
  are separate agreement-based datasets this server does not provide.
- **AR50 class codes are passed through, not decoded.** Only `landTypeCode` is
  given an English label, from the published SOSI code list. Forest-productivity,
  tree-type, agriculture and vegetation-cover codes are returned exactly as NIBIO
  published them, because restating a land classification this project cannot
  cite would be worse than returning the code. NIBIO publishes the code lists
  with the AR50 WFS.
- **Coordinates are WGS84 degrees and are never reprojected.** Naturbase
  publishes EPSG:25833 and NIBIO EPSG:4258; both convert server-side and the SDK
  retains the source declaration in `sourceCrs`. Neither the SDK nor this server
  contains a reprojection engine, and an unsupported CRS declaration is rejected
  rather than reinterpreted. Do not compute areas, distances or overlaps from
  these degrees without a proper projection.
- **Feature geometry is bounded, and the bound is this server's.** Geometry is
  omitted unless `includeGeometry` is set, and a geometry over 4,000 vertices —
  or one arriving after a result has spent its 4,000-vertex allowance — is
  dropped **whole** rather than simplified, with the omission reported. Neither
  provider imposes this; it exists because a single real polygon can exceed an
  entire MCP payload budget. Nothing is silently discarded: `geometrySummary`
  always reports part count, hole count and vertex count.
- **Bounding-box searches are capped at 2° × 4°**, again by this server and not
  by the provider. A bounded first page of a country-sized box is an arbitrary
  sample rather than a survey, so the request is refused instead.
- **`get_intervention_free_nature_at` requires a limit of at least 2.**
  Miljødirektoratet's intervention-free WFS answers a single-feature request with
  a page the SDK rejects as invalid — verified live on SDK 0.8.0 — so that one
  input is refused with a clear message rather than passed through to fail
  upstream. The composed nature profile carries the same floor for the same
  reason.
- **The nature profile's municipality is inferred from the nearest place name**
  within 5 km, not from an administrative boundary lookup, so near a border it
  can name the neighbouring municipality.
- **The Geonorge catalogue describes data, it does not deliver it.** A record
  lists the endpoints its publisher advertises; this server reports them as
  metadata and never calls them. Catalogued resources carry their own publisher
  licences and access constraints, which may be more restrictive than the
  catalogue's own, and a record with no declared licence is not permission.
- **No tool accepts a service URL.** Generic WFS, WMS, OGC API Features and
  ArcGIS REST proxying is deliberately absent; see
  [Why no generic map-service tool](#why-no-generic-map-service-tool).
- **Geonorge contacts are reduced to organizations.** The catalogue publishes
  named individuals with e-mail addresses; only the responsible organization and
  its role are relayed.
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

Released versions are listed in [CHANGELOG.md](CHANGELOG.md) and on the
[releases page](https://github.com/iamkm1/Norway-Open-Data-MCP/releases).

This project follows [Semantic Versioning](https://semver.org). While the major
version is `0`:

- **Patch** — fixes, validation corrections, documentation.
- **Minor** — new tools, new optional inputs, new envelope fields. **A breaking
  change is also released as a minor version while the major is 0**, so pin
  exactly (`norway-open-data-mcp@0.4.0`) if you depend on tool shapes.
- **Major** — reserved for 1.0 onwards.

Treated as breaking: removing or renaming a tool, removing an input or output
field, tightening an input schema, or changing a tool's meaning. Tool **names**
are stable identifiers and are never translated.

The `norway-open-data-sdk` dependency is pinned to `^0.8.0`. Because the SDK is
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
