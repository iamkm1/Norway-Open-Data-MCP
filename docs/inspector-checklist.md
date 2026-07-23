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

- [ ] Exactly **10** tools are listed.
- [ ] Every tool shows a human-readable **title** (e.g. "Search Norwegian
      companies"), not just the identifier.
- [ ] Every description states both when to use the tool **and when not to**.
- [ ] No two descriptions read as interchangeable. Spot-check the known
      ambiguity pairs:
  - [ ] `search_norwegian_companies` vs `get_norwegian_company_profile`
  - [ ] `search_norwegian_addresses` vs `get_norwegian_location_profile`
  - [ ] `get_norwegian_weather_forecast` vs `get_current_norwegian_hazards`
  - [ ] `get_norwegian_municipality_profile` vs `query_norwegian_statistics`

### Input forms

- [ ] Each form renders the fields from the tool's schema, with correct types
      (number inputs for coordinates, enum dropdowns for `area` and `types`).
- [ ] Optional fields are marked optional; required ones are marked required.
- [ ] Defaults are visible (`limit` 10, `hours` 24, `language` "no").
- [ ] Enum fields offer only valid values (`NO1`–`NO5`; `flood`, `avalanche`,
      `landslide`).

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

For each result:

- [ ] **Structured content** validates — the Inspector shows no output-schema
      error.
- [ ] The **text** tab is readable on its own, not raw JSON.
- [ ] `sources` names the correct provider with its licence.
- [ ] `retrievedAt` is a plausible ISO timestamp; `cached` is `false` on the
      first call and `true` on an immediate repeat.
- [ ] Any truncation is reflected in both `truncation` and `warnings`.
- [ ] Every hazard-bearing result carries the "never an all-clear" warning.

### Error paths

- [ ] Unset `NORWAY_MCP_CONTACT_EMAIL` and call
      `get_norwegian_weather_forecast` → an error naming
      `NORWAY_MCP_CONTACT_EMAIL` exactly. The server stays connected.
- [ ] Call `search_norwegian_companies` with `{ "limit": -1 }` → a validation
      error; no provider request is made.
- [ ] Call `get_norwegian_company_profile` with `{ "organizationNumber": "000000000" }`
      → a `not_found` error, distinguishable from an outage.
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
