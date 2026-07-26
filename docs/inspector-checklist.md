# MCP Inspector checklist

The [official MCP Inspector](https://github.com/modelcontextprotocol/inspector)
gives a UI for browsing and calling this server's tools. It is the fastest way
to confirm a change did not break the surface an AI client sees.

```bash
pnpm inspector
# equivalent to:
pnpm build && npx -y @modelcontextprotocol/inspector node dist/cli.js
```

Inspector version verified against: **`@modelcontextprotocol/inspector@1.0.0`**.

To exercise the credential-gated tool, launch it with the variable set:

```bash
# macOS / Linux
NORWAY_MCP_CONTACT_EMAIL=you@example.com npx -y @modelcontextprotocol/inspector node dist/cli.js

# Windows PowerShell
$env:NORWAY_MCP_CONTACT_EMAIL="you@example.com"; npx -y @modelcontextprotocol/inspector node dist/cli.js
```

> **Never commit Inspector output.** It writes session tokens and proxy
> addresses to disk. `.gitignore` already excludes `.mcp-inspector/` and
> `mcp-inspector-*.json`; do not add exceptions, and do not paste a session
> token into an issue or a screenshot.

---

## Checklist

Record the date and the commit you tested.

### Connection

- [ ] The server connects without an error banner.
- [ ] **Server name** reads `norway-open-data-mcp` and the version matches
      `package.json`.
- [ ] Server instructions appear and mention the hazard caveat.
- [ ] The **Tools** capability is listed.

### Tool listing

- [ ] Exactly **28** tools are listed.
- [ ] Every tool shows a human-readable **title** (e.g. "Search Norwegian
      companies"), not just the identifier.
- [ ] Every description states both when to use the tool **and when not to**.
- [ ] No two descriptions read as interchangeable. Spot-check the known
      ambiguity pairs:
  - [ ] `search_norwegian_companies` vs `get_norwegian_company_profile`
  - [ ] `search_norwegian_addresses` vs `get_norwegian_location_profile`
  - [ ] `get_norwegian_weather_forecast` vs `get_current_norwegian_hazards`
  - [ ] `get_norwegian_municipality_profile` vs `query_norwegian_statistics`
  - [ ] `get_protected_areas_at` vs `search_protected_areas`
  - [ ] `get_nature_types_at` vs `get_land_resources_at`
  - [ ] `get_nature_profile` vs the five single-dataset nature tools
  - [ ] `search_geonorge_datasets` vs `get_geonorge_metadata`
- [ ] **No tool's input form contains a URL, endpoint, host, service, layer or
      type-name field.** That absence is the structural guarantee that this
      server is not a map-service proxy.

### Input forms

- [ ] Each form renders the fields from the tool's schema, with correct types
      (number inputs for coordinates, enum dropdowns for `area` and `types`).
- [ ] Optional fields are marked optional; required ones are marked required.
- [ ] Defaults are visible (`limit` 10, `hours` 24, `language` "no").
- [ ] Enum fields offer only valid values (`NO1`–`NO5`; `flood`, `avalanche`,
      `landslide`).
- [ ] `includeGeometry` defaults to **false** on every geospatial tool.
- [ ] `get_intervention_free_nature_at` and `get_nature_profile` show a minimum
      `limit` of **2**, and their validation message explains why.

### Successful calls

Each of these reaches a live provider. Call each **once** — do not loop, and do
not re-run rapidly, to stay well inside provider budgets.

- [ ] `search_norwegian_companies` with `{ "name": "Equinor" }` → results with
      organization numbers.
- [ ] `get_norwegian_company_profile` with `{ "organizationNumber": "923609016" }`
      → one organization with a coordinate.
- [ ] `search_norwegian_addresses` with `{ "query": "Karl Johans gate 1" }` →
      addresses with postal codes.
- [ ] `get_norwegian_municipality_profile` with `{ "query": "0301" }` →
      population and business counts.
- [ ] `get_norwegian_electricity_prices` with `{ "area": "NO1" }` → 23–25 hourly
      prices plus a summary.
- [ ] `get_current_norwegian_hazards` with `{}` → warnings or an empty list.
- [ ] `get_norwegian_transport_departures` with `{ "stopName": "Majorstuen" }` →
      a resolved stop and departures.
- [ ] `query_norwegian_statistics` with `{ "tableId": "07459" }` → dimensions and
      an instruction to call again with `selections`.
- [ ] `get_norwegian_location_profile` with `{ "query": "Karl Johans gate 1, Oslo" }`
      → address plus hazard section.
- [ ] `get_norwegian_weather_forecast` with `{ "latitude": 59.91, "longitude": 10.75 }`
      → 24 hourly entries _(requires the contact email)_.
- [ ] `search_geonorge_datasets` with `{ "query": "verneområder" }` → catalogue
      records with identifiers, publishers and access flags.
- [ ] `get_geonorge_metadata` with an identifier from that search → licence, CRS,
      extent and advertised endpoints; **no contact e-mail address anywhere**.
- [ ] `get_protected_areas_at` with `{ "latitude": 61.6365, "longitude": 8.3126 }`
      → Jotunheimen nasjonalpark, with `geometry: null` and a `geometrySummary`
      reporting its vertex count.
- [ ] The same call with `"includeGeometry": true` → a GeoJSON polygon whose
      `coordinates` length equals `1 + holeCount`.
- [ ] `search_protected_areas` with
      `{ "boundingBox": { "south": 61.5, "west": 8.2, "north": 61.7, "east": 8.5 } }`
      → a bounded page whose `hasMore` equals `truncated`.
- [ ] `get_nature_types_at` with `{ "latitude": 63.43, "longitude": 10.4 }` →
      localities or a **clearly caveated empty result**.
- [ ] `get_intervention_free_nature_at` with
      `{ "latitude": 61.6365, "longitude": 8.3126 }` → a zone of `1`, `2` or `v`
      with `statusDate` `2023-01`, credited with the layer's **own** attribution
      wording (`Miljødirektoratet - inngrepsfri natur 01.2023`).
- [ ] `get_land_resources_at` with `{ "latitude": 61.6365, "longitude": 8.3126 }`
      → an AR50 class with `landType` labelled and the other codes raw.
- [ ] `get_nature_profile` with `{ "latitude": 61.6365, "longitude": 8.3126 }` →
      every section, `compositeSource` present in `data`, and `sources` listing
      the real providers **without** the composite id.

For each result:

- [ ] **Structured content** validates — the Inspector shows no output-schema
      error.
- [ ] The **text** tab is readable on its own, not raw JSON.
- [ ] `sources` names the correct provider with its licence.
- [ ] `retrievedAt` is a plausible ISO timestamp; `cached` is `false` on the
      first call and `true` on an immediate repeat.
- [ ] Any truncation is reflected in both `truncation` and `warnings`.
- [ ] Every hazard-bearing result carries the "never an all-clear" warning.
- [ ] Every Naturbase-bearing result carries the "not evidence that no species,
      habitat, environmental interest…" warning, and an empty one says "not an
      environmental clearance" in the text tab too.
- [ ] `sources` on the nature profile lists **two** Naturbase entries when the
      intervention-free section answered, because its licence terms differ.

### Error paths

- [ ] Unset `NORWAY_MCP_CONTACT_EMAIL` and call
      `get_norwegian_weather_forecast` → an error naming
      `NORWAY_MCP_CONTACT_EMAIL` exactly. The server stays connected.
- [ ] Call `search_norwegian_companies` with `{ "limit": -1 }` → a validation
      error; no provider request is made.
- [ ] Call `get_norwegian_company_profile` with `{ "organizationNumber": "000000000" }`
      → a `not_found` error, distinguishable from an outage.
- [ ] Call `search_protected_areas` with
      `{ "boundingBox": { "south": 58, "west": 4, "north": 71, "east": 31 } }` →
      refused, with a message saying the span cap is **this server's** limit and
      not the provider's. It returns instantly: no request was made.
- [ ] Call `get_geonorge_metadata` with
      `{ "id": "https://kart.miljodirektoratet.no/geoserver/wfs" }` → refused as
      not a catalogue identifier. This is the no-service-proxy guarantee.
- [ ] Call `get_intervention_free_nature_at` with `"limit": 1` → refused with an
      explanation, rather than an upstream `upstream_invalid_response`.
- [ ] Call `get_current_norwegian_hazards` with `startDate` after `endDate` → a
      field-level validation error.
- [ ] Errors are understandable prose, not a stack trace, and contain **no**
      absolute paths, API keys or email addresses.
- [ ] After every error, the server still responds to a new call.

### Protocol hygiene

- [ ] No JSON parse errors appear in the Inspector console.
- [ ] The connection survives all of the above without a reconnect.
- [ ] With `NORWAY_MCP_DEBUG=1`, diagnostics appear in the **stderr** pane and
      the session still works — proving stderr does not corrupt the protocol.
- [ ] No credential value appears anywhere in the stderr pane.

### Shutdown

- [ ] Disconnecting from the Inspector terminates the process; no orphaned
      `node` process remains.

---

## Result log

| Date       | Version | Inspector | Outcome                    | Notes                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------- | --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-23 | 0.1.0   | 1.0.0     | Automated equivalents pass | Full protocol surface (initialize, tools/list with 10 tools, schemas, success, error, cancellation, stdout purity, clean shutdown) is covered by `tests/integration/protocol.test.ts`, which drives the same built binary the Inspector launches. The interactive UI pass above requires a human at a browser and live provider access; it is not part of CI. |
