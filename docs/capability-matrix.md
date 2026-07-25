# SDK capability matrix

Source of truth: the installed declarations of `norway-open-data-sdk@0.6.0`
(`dist/index.d.ts`), its `PROVIDERS.md`, and the runtime `providerDescriptors`
registry. Nothing in this document is inferred from the project brief.

The SDK exposes **15 facade namespaces**. This matrix records every public
method on them and whether it is appropriate as an MCP tool.

## Provider registry (runtime-verified)

Read from `providerDescriptors` at runtime on 2026-07-23.

| Provider id         | Name                    | Access                  | `auth.requires`                   | Budget                    |
| ------------------- | ----------------------- | ----------------------- | --------------------------------- | ------------------------- |
| `brreg`             | Brønnøysundregistrene   | open                    | —                                 | 60/min (courtesy)         |
| `data-norge`        | Data.norge.no           | open                    | —                                 | 10/min search, 5/s lookup |
| `entur`             | Entur                   | identification-required | `applicationName`                 | 60/min (courtesy)         |
| `fhi`               | FHI                     | open                    | —                                 | 30/min (courtesy)         |
| `hvakosterstrommen` | Hva koster strømmen?    | open                    | —                                 | 30/min (courtesy)         |
| `kartverket`        | Kartverket              | open                    | —                                 | 60/min (courtesy)         |
| `met`               | MET Norway              | identification-required | `applicationName`, `contactEmail` | 60/min (courtesy)         |
| `norges-bank`       | Norges Bank             | open                    | —                                 | 60/min (courtesy)         |
| `nve`               | NVE                     | registration-required   | `apiKey` (HydAPI methods only)    | 30/min (courtesy)         |
| `ssb`               | Statistics Norway       | open                    | —                                 | 30/min (documented)       |
| `ssb-klass`         | Statistics Norway Klass | open                    | —                                 | 30/min (courtesy)         |
| `stortinget`        | Stortinget              | open                    | —                                 | 100/min (documented)      |
| `vegvesen`          | Statens vegvesen        | identification-required | `applicationName`                 | 60/min (courtesy)         |

Two consequences drive the configuration design:

- `applicationName` is satisfiable by this package itself (`norway-open-data-mcp/0.1.1`),
  so Entur and Statens vegvesen work with **zero user setup**.
- `contactEmail` cannot be invented. MET Norway is therefore the one provider that
  is genuinely user-configured, and it is the reference case for the
  "missing configuration" error path.
- NVE's `apiKey` gates **only** HydAPI (`getHydrologyStations`, `getHydrologyObservations`).
  The Varsom warning feeds on the same provider are anonymous.

## Method matrix

Columns: **Tool?** = exposed as / used by an MCP tool.
**Cred** = requires configuration beyond the built-in `applicationName`.

### `companies` — `BrregClient` (brreg)

| Method                | Purpose                            | Input                                           | Cred | Pagination                | Size     | Tool?                                      |
| --------------------- | ---------------------------------- | ----------------------------------------------- | ---- | ------------------------- | -------- | ------------------------------------------ |
| `get(orgNr)`          | One organization by 9-digit number | `string`                                        | no   | none                      | 1 object | via profile                                |
| `search(params)`      | Filtered organization search       | name/orgNr/municipality/industry/form/page/size | no   | provider pages, ≤100/page | list     | **yes** — `search_norwegian_companies`     |
| `searchAll(params)`   | Async iterator over all matches    | + `maxItems`/`maxPages`                         | no   | unbounded-ish             | large    | no — unbounded iteration is a poor MCP fit |
| `getSubEntity(orgNr)` | Sub-entity (bedrift) lookup        | `string`                                        | no   | none                      | 1 object | no — narrow; overlaps `get`                |

### `profiles` — `ProfileClient` (cross-provider)

| Method                | Purpose                                            | Input    | Cred    | Providers                         | Size     | Tool?                                          |
| --------------------- | -------------------------------------------------- | -------- | ------- | --------------------------------- | -------- | ---------------------------------------------- |
| `company(orgNr)`      | Company + official Kartverket coordinate match     | `string` | no      | brreg + kartverket                | 1 object | **yes** — `get_norwegian_company_profile`      |
| `address(query)`      | Address + weather + hazards + roads                | `string` | partial | kartverket + met + nve + vegvesen | medium   | **yes** — `get_norwegian_location_profile`     |
| `municipality(query)` | Population + life expectancy + companies + hazards | `string` | no      | ssb + fhi + brreg + nve           | medium   | **yes** — `get_norwegian_municipality_profile` |

`ProfileClient` degrades per section rather than failing: missing configuration
yields a `not-configured` component, a failing provider yields `provider-error`.
`components[]` carries that provenance and is preserved verbatim in tool output.

### `addresses` / `places` — Kartverket

| Method                     | Purpose                          | Input                                      | Cred | Size       | Tool?                                       |
| -------------------------- | -------------------------------- | ------------------------------------------ | ---- | ---------- | ------------------------------------------- |
| `addresses.search(params)` | Official address register search | query/municipality/county/postalCode/limit | no   | ≤1000/page | **yes** — `search_norwegian_addresses`      |
| `places.search(params)`    | Official place-name search       | query/municipality/county/limit            | no   | ≤500/page  | no — overlaps address search for AI routing |
| `places.nearby(params)`    | Place names near a coordinate    | lat/lon/radius≤5000/limit                  | no   | ≤500       | no — niche in v0.1                          |

### `weather` — `MetClient` (met)

| Method             | Purpose                            | Input            | Cred    | Size                   | Tool?                                                     |
| ------------------ | ---------------------------------- | ---------------- | ------- | ---------------------- | --------------------------------------------------------- |
| `forecast(params)` | Compact point forecast time series | lat/lon/altitude | **yes** | ~100 entries / 10 days | **yes** — `get_norwegian_weather_forecast` (hour-bounded) |
| `current(params)`  | First relevant time-series entry   | lat/lon/altitude | **yes** | 1 entry                | used inside `hours=1`; not a separate tool                |

### `hazards` — `NveHazardsClient` (nve)

| Method                        | Purpose                         | Input                          | Cred       | Size         | Tool?                             |
| ----------------------------- | ------------------------------- | ------------------------------ | ---------- | ------------ | --------------------------------- |
| `getFloodWarnings(p)`         | Flood warnings for a date range | start/end/language             | no         | list         | **yes** — composed                |
| `getAvalancheWarnings(p)`     | Avalanche warnings              | start/end/language             | no         | list         | **yes** — composed                |
| `getLandslideWarnings(p)`     | Landslide warnings              | start/end/language             | no         | list         | **yes** — composed                |
| `getHydrologyStations(p)`     | HydAPI station search           | filters                        | **apiKey** | list         | no — deferred; niche + credential |
| `getHydrologyObservations(p)` | HydAPI observation series       | station/param/resolution/dates | **apiKey** | large series | no — deferred; unbounded series   |

The three warning feeds are composed into one `get_current_norwegian_hazards`
tool with a `types` filter. Exposing them as three near-identical tools would
create exactly the routing ambiguity the brief forbids.

### `electricity` — `ElectricityClient` (hvakosterstrommen)

| Method               | Purpose                             | Input              | Cred | Size          | Tool?                                        |
| -------------------- | ----------------------------------- | ------------------ | ---- | ------------- | -------------------------------------------- |
| `getPrices(p)`       | Hourly spot prices for one zone/day | area NO1–NO5, date | no   | 23/24/25 rows | **yes** — `get_norwegian_electricity_prices` |
| `getCurrentPrice(p)` | Price covering the current hour     | area               | no   | 1 row         | folded in as `includeCurrent`                |

Naturally bounded: a Norwegian local day is exactly 23, 24 or 25 hours.

### `transport` — `EnturClient` (entur)

| Method            | Purpose                          | Input                           | Cred          | Size          | Tool?                                          |
| ----------------- | -------------------------------- | ------------------------------- | ------------- | ------------- | ---------------------------------------------- |
| `autocomplete(p)` | Resolve stop/place text to IDs   | text/lang/lat/lon/limit         | app name only | ≤100          | **yes** — composed as the resolver step        |
| `departures(p)`   | Departure board for a stop place | stopPlaceId/dateTime/limit      | app name only | limit-bounded | **yes** — `get_norwegian_transport_departures` |
| `journeys(p)`     | Point-to-point journey planning  | from/to/dateTime/arriveBy/limit | app name only | medium        | no — deferred to v0.2 (see limitations)        |

Departures alone would be unusable: no human knows an NSR stop-place ID. The
tool accepts **either** `stopPlaceId` **or** `stopName`, resolving the latter via
`autocomplete` first. This is the curated-composition pattern the brief asks for.

### `statistics` — `SsbClient` (ssb)

| Method                   | Purpose                        | Input                       | Cred | Size                      | Tool?                                       |
| ------------------------ | ------------------------------ | --------------------------- | ---- | ------------------------- | ------------------------------------------- |
| `getTableMetadata(id)`   | Dimensions + valid value codes | tableId                     | no   | medium                    | **yes** — discovery half                    |
| `query(q)`               | Flattened JSON-stat2 rows      | tableId/selections/language | no   | up to 800k cells upstream | **yes** — data half                         |
| `queryRaw(q)`            | Provider JSON-stat2 dataset    | same                        | no   | large                     | no — raw payloads are out of scope for v0.1 |
| `queryWithMetadata(...)` | `@internal`                    | —                           | —    | —                         | no — not public API                         |

Both halves are served by **one** tool, `query_norwegian_statistics`, because
`StatisticsResult` already carries `dimensions`. Omitting `selections` returns
the table's dimensions and valid codes; supplying them returns dimensions **and**
rows. One output schema, one provider call per invocation, no mode ambiguity.

### `klass` — `KlassClient` (ssb-klass)

The Klass namespace has **14** methods. Two curated tools use **four** of them;
the other ten are deferred. Klass is a separate service from SSB PxWeb
(`statistics`): it publishes official code lists and their history, not numbers.

| Method                        | Purpose                                  | Input                               | Cred | Size    | Tool?                                                   |
| ----------------------------- | ---------------------------------------- | ----------------------------------- | ---- | ------- | ------------------------------------------------------- |
| `resolveMunicipalityCode(p)`  | Municipality code across reforms         | code/targetDate/sourceDate/language | no   | small   | **yes** — `resolve_norwegian_administrative_code`       |
| `resolveCountyCode(p)`        | County code across reforms               | code/targetDate/sourceDate/language | no   | small   | **yes** — `resolve_norwegian_administrative_code`       |
| `searchCodes(p)`              | Code-pattern (`selectCodes`) search      | classificationId/codePattern/date   | no   | bounded | **yes** — `search_norwegian_classification_codes`       |
| `getCode(p)`                  | Exact dated code lookup                  | classificationId/code/date          | no   | 1 code  | **yes** — exact path of the code-search tool            |
| `listClassifications(p)`      | Browse classifications/codelists         | paging                              | no   | list    | no — discovery browsing; a poor MCP routing fit         |
| `searchClassifications(p)`    | Full-text classification metadata search | query                               | no   | list    | no — returns classifications, not codes                 |
| `getClassification(p)`        | One classification + its versions        | classificationId                    | no   | medium  | no — internal to resolution; not a user question        |
| `listVersions(p)`             | Version summaries of a classification    | classificationId                    | no   | list    | no — expert browsing                                    |
| `getVersion(p)`               | One version's metadata                   | versionId                           | no   | medium  | no — expert browsing                                    |
| `listCodes(p)`                | Full code list for a version/date/range  | classificationId + date/version     | no   | large   | no — unbounded browse; `searchCodes` is the bounded fit |
| `listCorrespondenceTables(p)` | Correspondence tables on a version       | versionId                           | no   | list    | no — expert mapping                                     |
| `getCorrespondenceTable(p)`   | One fixed correspondence table           | correspondenceTableId               | no   | medium  | no — expert mapping                                     |
| `getCorrespondence(p)`        | Fixed/dated/ranged correspondence        | source/target/date or table         | no   | medium  | no — correspondence needs human judgement               |
| `listCodeChanges(p)`          | Code-change graph edges between dates    | classificationId/from/to            | no   | list    | no — surfaced inside resolution as `changes[]`          |

The two tools deliberately do **not** expose raw correspondence tables or
arbitrary code-list browsing. Merge/split/ambiguous resolutions keep every
official branch and never auto-select; administrative correspondence is not
evidence of statistical comparability.

### Namespaces deferred entirely

| Namespace                 | Methods | Why deferred                                                                                                                  |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `health` (fhi)            | 6       | Suppression-flag semantics need careful presentation; life expectancy is already surfaced by the municipality profile.        |
| `catalog` (data-norge)    | 5       | Provider documents its search API as an internal, changeable interface. Deferred rather than shipped on an unstable contract. |
| `currency` (norges-bank)  | 4       | Valuable but outside the "Norwegian public data" core intent; would add a 4th finance-shaped tool for little routing gain.    |
| `energy` (nve)            | 4       | `getPowerPlants` returns the full national fleet — a poor output-budget fit without filters the SDK does not offer.           |
| `parliament` (stortinget) | 9       | Strong candidate for a later release; cut to keep the tool set routable.                                                      |
| `roads` (vegvesen)        | 7       | Surfaced indirectly through the location profile; standalone NVDB querying is expert-level.                                   |
| `places` (kartverket)     | 2       | Routing overlap with address search.                                                                                          |

## Interpretation and safety limitations carried into tool docs

- **Hazards are never an all-clear.** The SDK states this for both profiles and
  the hazards namespace. Every hazard-bearing tool result carries a standing
  warning to that effect, and the text rendering repeats it.
- **FHI suppression flags must stay suppressed.** Surfaced via the municipality
  profile's `lifeExpectancy.flag` / `flagMeaning`; never reconstructed.
- **Electricity is a third-party derived API**, not an official government
  endpoint, and excludes grid rent, taxes and surcharges.
- **Norges Bank rates are indicative** — not exposed.
- **Location-profile roads** are first-page bounding-box candidates, not a radius
  query; `roadSearch` bounds are preserved.
- **Data.norge catalogue inclusion is not a reuse licence.**
- **`includeRaw` is never exposed**, per the brief and because the SDK
  documents raw shapes as structurally unstable.
- **Klass administrative correspondence is not statistical comparability.** A
  merge, split or ambiguous mapping keeps every official branch and is never
  reduced to one code; the tool never combines populations or other figures.
- **Klass code search is code-pattern search**, not name/full-text search; the
  official API exposes no code-name search endpoint.
