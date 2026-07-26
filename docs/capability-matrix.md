# SDK capability matrix

Source of truth: the installed declarations of `norway-open-data-sdk@0.8.0`
(`dist/index.d.ts`), its `PROVIDERS.md`, and the runtime `providerDescriptors`
registry. Nothing in this document is inferred from the project brief.

The SDK exposes **21 facade namespaces**. This matrix records every public
method on them and whether it is appropriate as an MCP tool.

## Provider registry (runtime-verified)

Read from `providerDescriptors` at runtime on 2026-07-23.

| Provider id          | Name                    | Access                  | `auth.requires`                   | Budget                    |
| -------------------- | ----------------------- | ----------------------- | --------------------------------- | ------------------------- |
| `barentswatch`       | BarentsWatch            | registration-required   | `clientId`, `clientSecret` (api)  | 60/min (courtesy)         |
| `barentswatch-ais`   | BarentsWatch AIS        | registration-required   | `clientId`, `clientSecret` (ais)  | 60/min; 5/min for streams |
| `brreg`              | Brønnøysundregistrene   | open                    | —                                 | 60/min (courtesy)         |
| `data-norge`         | Data.norge.no           | open                    | —                                 | 10/min search, 5/s lookup |
| `entur`              | Entur                   | identification-required | `applicationName`                 | 60/min (courtesy)         |
| `fhi`                | FHI                     | open                    | —                                 | 30/min (courtesy)         |
| `fiskeridir-aqua`    | Fiskeridir. aquaculture | open                    | —                                 | 60/min (courtesy)         |
| `fiskeridir-vessels` | Fiskeridir. vessels     | open                    | —                                 | 60/min (courtesy)         |
| `geonorge`           | Geonorge / Kartverket   | open                    | —                                 | 30/min (courtesy)         |
| `hvakosterstrommen`  | Hva koster strømmen?    | open                    | —                                 | 30/min (courtesy)         |
| `kartverket`         | Kartverket              | open                    | —                                 | 60/min (courtesy)         |
| `met`                | MET Norway              | identification-required | `applicationName`, `contactEmail` | 60/min (courtesy)         |
| `naturbase`          | Miljødirektoratet       | open                    | —                                 | 30/min (courtesy)         |
| `nibio`              | NIBIO                   | open                    | —                                 | 20/min (courtesy)         |
| `norges-bank`        | Norges Bank             | open                    | —                                 | 60/min (courtesy)         |
| `nve`                | NVE                     | registration-required   | `apiKey` (HydAPI methods only)    | 30/min (courtesy)         |
| `ssb`                | Statistics Norway       | open                    | —                                 | 30/min (documented)       |
| `ssb-klass`          | Statistics Norway Klass | open                    | —                                 | 30/min (courtesy)         |
| `stortinget`         | Stortinget              | open                    | —                                 | 100/min (documented)      |
| `vegvesen`           | Statens vegvesen        | identification-required | `applicationName`                 | 60/min (courtesy)         |

Two consequences drive the configuration design:

- `applicationName` is satisfiable by this package itself (`norway-open-data-mcp/0.4.0`),
  so Entur and Statens vegvesen work with **zero user setup**.
- `contactEmail` cannot be invented. MET Norway is therefore the one provider that
  is genuinely user-configured, and it is the reference case for the
  "missing configuration" error path.
- NVE's `apiKey` gates **only** HydAPI (`getHydrologyStations`, `getHydrologyObservations`).
  The Varsom warning feeds on the same provider are anonymous.
- **BarentsWatch is two credential scopes, not one.** `barentswatch` and
  `barentswatch-ais` are separate descriptors with separate OAuth2 grants,
  because BarentsWatch issues a separate registered client for AIS. The SDK
  never sends one scope's secret to the other's host, and this server mirrors
  that with two independent environment-variable pairs. They are the only
  OAuth2 client-credentials providers in the SDK.
- **Fiskeridirektoratet is two open descriptors**, one per register, and needs no
  credentials at all — which is why four of the eight maritime tools work with
  zero configuration.

## Geospatial namespaces (0.8.0)

All three are **open and anonymous**: the geospatial release added no environment
variable and no credential of any kind.

### `geodata` — `GeonorgeClient` (geonorge)

| Method                      | Purpose                                         | Cred | Tool?                                                                                                                                   |
| --------------------------- | ----------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `searchDatasets(params)`    | Bounded dataset-metadata search                 | no   | **yes** — `search_geonorge_datasets`                                                                                                    |
| `getMetadata(id)`           | Normalized record for any catalogue id          | no   | **yes** — `get_geonorge_metadata`                                                                                                       |
| `getDataset(id)`            | `getMetadata` asserting the record is a dataset | no   | no — the metadata tool already reports `type`; a second tool that differs only by an assertion misroutes                                |
| `getService(id)`            | `getMetadata` asserting the record is a service | no   | no — same reason                                                                                                                        |
| `searchServices(params)`    | Bounded service-metadata search                 | no   | no — routing overlap with dataset search; a model asking "what data exists" wants datasets, and a service's metadata is reachable by id |
| `searchDatasetsAll(params)` | Auto-paginating dataset iterator                | no   | no — unbounded iteration is the opposite of an output budget                                                                            |
| `searchServicesAll(params)` | Auto-paginating service iterator                | no   | no — same reason                                                                                                                        |

### `environment` — `NaturbaseClient` (naturbase)

| Method                                 | Purpose                                   | Cred | Tool?                                                                                                             |
| -------------------------------------- | ----------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `getProtectedAreasAt(query)`           | Current protected areas at a point        | no   | **yes** — `get_protected_areas_at`                                                                                |
| `searchProtectedAreas(query)`          | Current protected areas in a bounding box | no   | **yes** — `search_protected_areas`                                                                                |
| `getProposedProtectedAreasAt(query)`   | Proposed protected areas at a point       | no   | **yes** — `get_protected_areas_at` (`includeProposed`) and `get_nature_profile`                                   |
| `getNatureTypesAt(query)`              | NiN nature localities at a point          | no   | **yes** — `get_nature_types_at`                                                                                   |
| `getInterventionFreeAreasAt(query)`    | January 2023 INON zones at a point        | no   | **yes** — `get_intervention_free_nature_at`                                                                       |
| `searchProposedProtectedAreas(query)`  | Proposed areas in a bounding box          | no   | no — proposals are a follow-up question about a place, not a regional survey; the point path covers it            |
| `searchNatureTypes(query)`             | NiN localities in a bounding box          | no   | no — a locality-level regional sweep multiplies polygon output for little routing gain                            |
| `searchInterventionFreeAreas(query)`   | INON zones in a bounding box              | no   | no — INON polygons are among the largest Naturbase publishes; a box query is the worst case for the output budget |
| `iterateProtectedAreas(query)`         | Lazy bounded page walk                    | no   | no — unbounded by construction; every tool here returns one bounded page                                          |
| `iterateProposedProtectedAreas(query)` | Lazy bounded page walk                    | no   | no — same reason                                                                                                  |
| `iterateNatureTypes(query)`            | Lazy bounded page walk                    | no   | no — same reason                                                                                                  |
| `iterateInterventionFreeAreas(query)`  | Lazy bounded page walk                    | no   | no — same reason                                                                                                  |

Only one bounding-box search is exposed, and it is the protected-area one. That
is the question people actually ask about a region ("which reserves are in this
valley?"), and conservation-area polygons are the best-behaved of the four
layers. The other three answer a _place_, so their point lookups are what a model
needs.

### `land` — `NibioClient` (nibio)

| Method                        | Purpose                         | Cred | Tool?                                                                                                                                                               |
| ----------------------------- | ------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLandResourcesAt(query)`   | AR50 classes at a point         | no   | **yes** — `get_land_resources_at`                                                                                                                                   |
| `searchLandResources(query)`  | AR50 polygons in a bounding box | no   | no — AR50 covers the whole country, so a box always matches; live polygons run to 19,403 vertices, making a regional page an arbitrary slice of an enormous surface |
| `iterateLandResources(query)` | Lazy bounded page walk          | no   | no — unbounded by construction                                                                                                                                      |

### `profiles.natureAtLocation()` — `ProfileClient` (cross-provider)

Exposed whole as `get_nature_profile`. It composes all five Naturbase/NIBIO
datasets with the nearest Kartverket place name, runs the six lookups
independently, and reports per-operation provenance and per-provider failure —
the same shape this server's envelope already carries. Reimplementing that fan-out
here would duplicate the SDK's failure handling and lose its omission reasons.

## Maritime namespaces (0.7.0)

### `ais` — `AisClient` (barentswatch-ais)

| Method                      | Purpose                                  | Cred | Tool?                                                                                      |
| --------------------------- | ---------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `getTrackLast24Hours(mmsi)` | Recorded 24-hour track for one vessel    | yes  | **yes** — `get_vessel_track` (default path)                                                |
| `getTrack(params)`          | Recorded track over an explicit window   | yes  | **yes** — `get_vessel_track` (explicit window)                                             |
| `streamPositions(params)`   | Live position feed, `AsyncIterable`      | yes  | **yes** — `get_live_vessel_positions`, bounded                                             |
| `getVesselSnapshot(mmsi)`   | Latest position + static data, merged    | yes  | via `profiles.vessel()`                                                                    |
| `getVesselSnapshots(f)`     | Snapshots for a filter                   | yes  | no — area sweep already served by the stream                                               |
| `getLatestPositions(f)`     | Point-in-time snapshot for a filter      | yes  | no — routing overlap with the live sample                                                  |
| `getMmsiInArea(params)`     | MMSIs seen in a space/time window        | yes  | no — returns bare identifiers, low model value                                             |
| `searchVessels(params)`     | Name search over recent static data      | yes  | no — routing overlap with the register search                                              |
| `getCoverageArea()`         | Published sea area, GeoJSON MultiPolygon | yes  | no — a large geometry, not an answer; its meaning is carried as a standing warning instead |
| `streamMessages(params)`    | Live feed of all message kinds           | yes  | no — a six-way union is not routable as one tool                                           |

### `marine` — `MarineClient` (barentswatch)

| Method                          | Purpose                              | Cred | Tool?                                                                                     |
| ------------------------------- | ------------------------------------ | ---- | ----------------------------------------------------------------------------------------- |
| `getWaveForecast(coords)`       | Wave forecast valid now              | yes  | **yes** — `get_marine_forecast`                                                           |
| `getSeaCurrent(coords)`         | Sea-current forecast valid now       | yes  | **yes** — `get_marine_forecast`                                                           |
| `getWaveForecastSeries(coords)` | Every model time at the nearest cell | yes  | no — a multi-hour series duplicates the point forecast's routing while multiplying output |

### `fisheries` — `FisheriesClient` (fiskeridir-vessels, fiskeridir-aqua)

| Method                           | Purpose                         | Cred | Tool?                                                                                                       |
| -------------------------------- | ------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `searchVessels(params)`          | Fishing-vessel register search  | no   | **yes** — `search_fishing_vessels`                                                                          |
| `getVessel(lookup)`              | One vessel by id/mark/call sign | no   | **yes** — `get_fishing_vessel`                                                                              |
| `searchAquacultureSites(params)` | Aquaculture register search     | no   | **yes** — `search_aquaculture_locations`                                                                    |
| `getAquacultureSite(number)`     | One site by site number         | no   | **yes** — `get_aquaculture_location`                                                                        |
| `searchVesselsAll(...)`          | Auto-paginating vessel iterator | no   | no — unbounded iteration is the opposite of an output budget; the paged search already exposes continuation |
| `searchAquacultureSitesAll(...)` | Auto-paginating site iterator   | no   | no — same reason                                                                                            |

### `profiles.vessel()` — `ProfileClient` (cross-provider)

Exposed whole as `get_vessel_profile`. It composes AIS, the fishing-vessel
register, MET Norway and Kartverket and reports per-section provenance, which is
exactly the shape this server's envelope already carries — reimplementing that
composition here would duplicate the SDK's join and lose its omission reasons.

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
| `natureAtLocation(p)` | Five nature/land datasets + nearest place          | coords   | no      | naturbase + nibio + kartverket    | medium   | **yes** — `get_nature_profile`                 |

`ProfileClient` degrades per section rather than failing: missing configuration
yields a `not-configured` component, a failing provider yields `provider-error`.
`components[]` carries that provenance and is preserved verbatim in tool output.

### `addresses` / `places` — Kartverket

| Method                     | Purpose                          | Input                                      | Cred | Size       | Tool?                                       |
| -------------------------- | -------------------------------- | ------------------------------------------ | ---- | ---------- | ------------------------------------------- |
| `addresses.search(params)` | Official address register search | query/municipality/county/postalCode/limit | no   | ≤1000/page | **yes** — `search_norwegian_addresses`      |
| `places.search(params)`    | Official place-name search       | query/municipality/county/limit            | no   | ≤500/page  | no — overlaps address search for AI routing |
| `places.nearby(params)`    | Place names near a coordinate    | lat/lon/radius≤5000/limit                  | no   | ≤500       | via `profiles.natureAtLocation()`           |

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
| `places` (kartverket)     | 2       | Routing overlap with address search. `places.nearby` is reached indirectly through the nature profile.                        |

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
- **AIS absence is not absence at sea.** BarentsWatch excludes fishing vessels
  under 15 m and leisure or sailing vessels under 45 m, covers only Norwegian
  waters, and retains 14 days. Every AIS-bearing tool result carries a standing
  warning saying so, and `ais.status: "no-recent-data"` never means an MMSI is
  unassigned.
- **A live AIS sample is not a census.** `streamPositions()` is endless, so the
  only thing an MCP tool can return is a sample bounded in area, count and time.
  Every result names the bound that ended it.
- **Natural-person vessel owners are never identified.** The SDK withholds their
  name, postal code and town; this server additionally whitelists the fields it
  copies, so only registered legal entities are described.
- **Aquaculture capacity is not comparable without its unit.** `capacity` is
  expressed in `capacityUnitType`, which varies by licence kind; the note is
  attached wherever a capacity is returned.
- **The fisheries registers publish no total count.** The SDK derives `hasMore`
  from a full page, so it is surfaced as an inference, never as an exact count.
- **Marine forecasts are grid-cell output.** The returned coordinate is the model
  cell centre, not the requested point, and BarentsWatch publishes no unit for
  sea-current speed, so none is asserted.
- **An empty nature result is not an environmental clearance.** The four Naturbase
  layers the SDK exposes are a selection, not a register of everything of
  environmental value, and survey coverage is uneven. Every Naturbase-bearing tool
  result carries a standing warning saying so, and the text rendering repeats it.
- **Naturbase nature types are the modern NiN localities of national
  importance** selected for 0.8.0 — not legacy DN-håndbok 13 localities, species
  observations or locally valuable nature.
- **Intervention-free nature is one fixed vintage** (January 2023), measures
  distance from major infrastructure, and confers no protection.
- **AR50 is generalized, not parcel-precision**, and may merge areas below about
  15 decares. It is not AR5, and restricted Geovekst/AR5, soil and cultivation
  products are outside the SDK's scope entirely.
- **AR50 class codes are passed through.** The SDK deliberately preserves the
  provider's codes rather than decoding them; this server labels only
  `landTypeCode`, from the published SOSI `ARTYPE` list, and leaves the other four
  code lists as codes rather than restating a classification it cannot cite.
- **No client-side reprojection exists.** Naturbase (EPSG:25833) and NIBIO
  (EPSG:4258) convert server-side; `sourceCrs` retains the original declaration
  and an unsupported CRS is rejected rather than reinterpreted.
- **Geometry is returned whole or not at all.** Holes and multipolygon parts are
  never silently dropped; an oversized geometry is omitted entirely and reported,
  with its part, hole and vertex counts still present.
- **The Geonorge catalogue is metadata, not data, and inclusion is not a reuse
  licence.** Each catalogued resource carries its own publisher licence and access
  constraints, and a record with no declared licence is not permission.
- **No generic service proxy is exposed.** The SDK classifies discovered WFS, WMS,
  OGC API Features and ArcGIS endpoints but never follows one, and this server
  accepts no URL, host, endpoint, type name or layer name as tool input.
- **Miljødirektoratet's intervention-free WFS answers `COUNT=1` invalidly.**
  Verified live on 0.8.0: because the SDK derives its page size from the remaining
  limit, a limit of 1 produces `upstream_invalid_response` whenever a zone would
  match. The two affected tools set a minimum limit of 2 rather than passing a
  known-broken request through.
