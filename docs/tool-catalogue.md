# Tool catalogue

Thirty-four curated read-only tools. Tool names are stable, language-neutral
identifiers and are never translated. Tools 29–34 were appended in 0.5.0; the
first twenty-eight keep their names and their order.

Conventions used below:

- **Config** — what must be set beyond the built-in defaults.
  `none` means the tool works immediately after `npx -y norway-open-data-mcp`.
- **Budget** — default and hard-maximum item counts. Every list is truncated
  deterministically (leading slice, original provider order) and any truncation
  is reported in `truncation` and repeated as a human-readable warning.
- All tools are annotated `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: true`.

---

## 1. `search_norwegian_companies`

**Title:** Search Norwegian companies
**SDK:** `companies.search()` · **Provider:** Brønnøysundregistrene · **Config:** none

**Description.** Search Norway's official company register (Enhetsregisteret) by
name or filters to find organizations and their organization numbers. Returns a
ranked list of matches with organization number, name, legal form, industry and
registered address.

**Use this when** the user names a company but you do not have its nine-digit
organization number, or wants to list companies by municipality, industry code
or legal form.

**Do not use this when** you already have an exact nine-digit organization
number — use `get_norwegian_company_profile`, which returns far more detail for
one organization.

**Input**

| Field                | Type    | Default | Limit                 |
| -------------------- | ------- | ------- | --------------------- |
| `name`               | string  | —       | 2–200 chars, trimmed  |
| `organizationNumber` | string  | —       | exactly 9 digits      |
| `municipalityCode`   | string  | —       | exactly 4 digits      |
| `industryCode`       | string  | —       | NACE-like, ≤8 chars   |
| `organizationForm`   | string  | —       | ≤10 chars, uppercased |
| `limit`              | integer | 10      | 1–50                  |
| `page`               | integer | 0       | 0–100                 |

At least one of `name`, `organizationNumber`, `municipalityCode`,
`industryCode`, `organizationForm` is required — an empty search is rejected
rather than dumping the register.

**Output** `{ companies[], pagination{page,size,totalItems,totalPages} }`
**Budget** 10 default / 50 max · typical 2–20 KB
**Warnings** truncation; `totalItems` far exceeding the page.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Finn organisasjonsnummeret til Equinor" →
`{ name: "Equinor" }`.
**Routes elsewhere.** "Tell me about the company with org number 923609016" →
`get_norwegian_company_profile`.

---

## 2. `get_norwegian_company_profile`

**Title:** Get Norwegian company profile
**SDK:** `profiles.company()` · **Providers:** Brønnøysundregistrene + Kartverket · **Config:** none

**Description.** Get a full profile for one Norwegian organization by its
nine-digit organization number, combining the official company register with
Kartverket's official address match for precise coordinates. Includes legal
form, industry, employees, registration dates, bankruptcy and liquidation
status, and both business and postal addresses.

**Use this when** you have an exact nine-digit organization number and want
detail about that one organization.

**Do not use this when** you only have a company name — call
`search_norwegian_companies` first to resolve the number. Do not use it to look
up a municipality's statistics; that is `get_norwegian_municipality_profile`.

**Input** `organizationNumber` — required, exactly 9 digits after stripping
spaces. Rejects whitespace-only and non-numeric input.

**Output** `{ company{…}, coordinate{latitude,longitude}|null, components[] }`
**Budget** single object; `components[]` capped at 20 · typical 1–3 KB
**Warnings** `components[]` entries with `omitted` reasons are surfaced verbatim
(`not-configured`, `missing-coordinate`, `not-applicable`, `provider-error`).
**Errors** `not_found` when the number is not registered — distinguished from a
provider outage.

**Positive example.** "Hva slags selskap er 923609016?"
**Routes elsewhere.** "Which companies are registered in Bergen?" →
`search_norwegian_companies` with `municipalityCode`.

---

## 3. `search_norwegian_addresses`

**Title:** Search Norwegian addresses
**SDK:** `addresses.search()` · **Provider:** Kartverket · **Config:** none

**Description.** Search Norway's official address register to find, verify or
disambiguate street addresses and get their coordinates, postal codes and
municipality. Returns a list of candidate addresses.

**Use this when** the user wants to check whether an address exists, find its
postal code or coordinates, or choose between several similar addresses.

**Do not use this when** the user asks about conditions _at_ a known address —
weather, warnings, nearby roads. That is `get_norwegian_location_profile`. Do
not use it to find a company's address; that comes with
`get_norwegian_company_profile`.

**Input**

| Field              | Type             | Default | Limit                                            |
| ------------------ | ---------------- | ------- | ------------------------------------------------ |
| `query`            | string, required | —       | 2–200 chars, non-blank                           |
| `municipalityCode` | string           | —       | 4 digits                                         |
| `countyCode`       | string           | —       | 2 digits                                         |
| `postalCode`       | string           | —       | 4 digits                                         |
| `limit`            | integer          | 10      | 1–50 (provider allows 1000; deliberately capped) |

**Output** `{ addresses[], totalAvailable? }`
**Budget** 10 default / 50 max · typical 1–8 KB
**Warnings** truncation; county filtering is applied locally by the SDK over one
provider page, which is surfaced when `countyCode` is used.

**Positive example.** "Hva er postnummeret til Karl Johans gate 1 i Oslo?"
**Routes elsewhere.** "What's the weather at Karl Johans gate 1?" →
`get_norwegian_location_profile`.

---

## 4. `get_norwegian_location_profile`

**Title:** Get Norwegian location profile
**SDK:** `profiles.address()` · **Providers:** Kartverket + MET Norway + NVE + Statens vegvesen · **Config:** optional `NORWAY_MCP_CONTACT_EMAIL` for the weather section

**Description.** Answer one specific Norwegian address from several agencies at
once: the official Kartverket address match, current weather conditions at that
coordinate, official NVE hazard warnings whose administrative area matches, and
nearby road segments. Sections whose provider is unconfigured are omitted with
a stated reason rather than failing the call.

**Use this when** the user asks what things are like at one known address or
place — combining location, conditions and warnings in a single answer.

**Do not use this when** the user is choosing between addresses or only needs a
postal code (`search_norwegian_addresses`), wants a multi-day forecast for a
coordinate (`get_norwegian_weather_forecast`), or wants nationwide warnings
(`get_current_norwegian_hazards`). A bare coordinate's weather, sea and daylight
picture, with no address to resolve, is `get_weather_conditions_profile`.

**Input** `query` — required, 2–200 non-blank chars.

**Output** `{ address{}, weather{}|null, hazards[], hazardMatches[], roads[], roadSearch{}|null, components[] }`
**Budget** hazards ≤ 20, roads ≤ 25, components ≤ 20 · typical 3–15 KB
**Warnings** always includes the standing hazard notice: _an empty warning list
is not an all-clear; use official Varsom/NVE services for safety decisions._
Plus a note when the weather section was omitted for missing configuration.
**Errors** `not_found` when Kartverket matches no address.

**Positive example.** "Er det noen farevarsler for Storgata 1, Lillehammer?"
**Routes elsewhere.** "Give me a 3-day forecast for 60.79, 10.69" →
`get_norwegian_weather_forecast`.

---

## 5. `get_norwegian_municipality_profile`

**Title:** Get Norwegian municipality profile
**SDK:** `profiles.municipality()` · **Providers:** SSB + FHI + Brønnøysundregistrene + NVE · **Config:** none

**Description.** Get a cross-agency profile for one Norwegian municipality by
its four-digit code or exact name: population totals and year-over-year change
from Statistics Norway, life expectancy at birth from FHI, the number of
registered organizations, and current NVE hazard warnings matching the
municipality.

**Use this when** the user asks about a municipality as a place — how many
people live there, how it is changing, its health or business profile.

**Do not use this when** the user wants a specific statistics table or a custom
breakdown by age, sex or year — that is `query_norwegian_statistics`. Do not use
it for an address inside the municipality (`get_norwegian_location_profile`).

**Input** `query` — required. Either exactly 4 digits (municipality code) or an
exact municipality name, 2–100 non-blank chars.

**Output** `{ municipality{code,name,countyCode}, population{}|null, lifeExpectancy{}|null, companies{}|null, hazards[], hazardMatches[], components[] }`
**Budget** hazards ≤ 20, components ≤ 20 · typical 2–8 KB
**Warnings** standing hazard notice; FHI suppression flag preserved and
explained when `lifeExpectancy.years` is null; per-section `provider-error`
components surfaced rather than silently dropped.

**Positive example.** "Hvor mange bor i Tromsø kommune?"
**Routes elsewhere.** "Population of Norway by age group 2015–2024" →
`query_norwegian_statistics`.

---

## 6. `get_norwegian_weather_forecast`

**Title:** Get Norwegian weather forecast
**SDK:** `weather.forecast()` · **Provider:** MET Norway · **Config:** **required** — `NORWAY_MCP_CONTACT_EMAIL`

**Description.** Get an hourly weather forecast for any coordinate in or near
Norway from MET Norway, including temperature, wind, humidity, cloud cover and
precipitation. Requires a contact email because MET Norway requires every caller
to identify itself.

**Use this when** the user wants a forecast for a coordinate or over a period —
today, tonight, the next few days.

**Do not use this when** the user asks about official danger warnings for flood,
avalanche or landslide — that is `get_current_norwegian_hazards`, a different
provider answering a different question. For weather at a _street address_
rather than a coordinate, `get_norwegian_location_profile` resolves the address
first. MET Norway's own weather warnings are `get_norwegian_weather_warnings`,
rain in the next two hours is `get_norwegian_precipitation_nowcast`, and what the
weather _was_ is `get_norwegian_weather_history`.

**Input**

| Field       | Type             | Default | Limit                                         |
| ----------- | ---------------- | ------- | --------------------------------------------- |
| `latitude`  | number, required | —       | −90…90, finite, ≤4 decimals enforced upstream |
| `longitude` | number, required | —       | −180…180, finite                              |
| `altitude`  | integer          | —       | −500…9000 metres                              |
| `hours`     | integer          | 24      | 1–96                                          |

Rejects `NaN`, `Infinity` and out-of-range coordinates before any request.

**Output** `{ coordinates{}, updatedAt?, timeseries[], hoursReturned, hoursAvailable }`
**Budget** 24 default / 96 max entries out of ~100 available · typical 3–20 KB
**Warnings** truncation when `hoursAvailable > hours`; MET's no-SLA
model-forecast caveat.
**Errors** **`missing_configuration`** naming `NORWAY_MCP_CONTACT_EMAIL` exactly,
when unset. The server stays running and every other tool keeps working.

**Positive example.** "Hvordan blir været i Bergen i morgen?" (after resolving
Bergen's coordinate).
**Routes elsewhere.** "Er det skredfare i Tromsø?" →
`get_current_norwegian_hazards`.

---

## 7. `get_current_norwegian_hazards`

**Title:** Get current Norwegian hazard warnings
**SDK:** `hazards.getFloodWarnings()`, `getAvalancheWarnings()`, `getLandslideWarnings()` · **Provider:** NVE (Varsom) · **Config:** none

**Description.** Get official NVE natural-hazard warnings for Norway — flood,
avalanche and landslide — for a date or short date range. These are safety
warnings issued by authorities, not a weather forecast.

**Use this when** the user asks about danger, warnings, risk levels, flood,
avalanche (`snøskred`), landslide (`jordskred`/`skredfare`) or Varsom.

**Do not use this when** the user wants temperature, rain or wind — that is
`get_norwegian_weather_forecast`. For warnings tied to one specific address, the
administrative-area match in `get_norwegian_location_profile` is more precise.
MET Norway's weather warnings — wind, gale, rain, snow, storm surge — are
`get_norwegian_weather_warnings`, a different provider.

**Input**

| Field       | Type                                       | Default             | Limit                         |
| ----------- | ------------------------------------------ | ------------------- | ----------------------------- |
| `types`     | array of `flood`\|`avalanche`\|`landslide` | all three           | 1–3 unique                    |
| `startDate` | `YYYY-MM-DD`                               | today (Europe/Oslo) | real calendar date            |
| `endDate`   | `YYYY-MM-DD`                               | = `startDate`       | ≥ `startDate`, span ≤ 14 days |
| `language`  | `no`\|`en`                                 | `no`                | —                             |
| `limit`     | integer                                    | 25                  | 1–100                         |

Reversed ranges and spans over 14 days are rejected with a field-level message.

**Output** `{ warnings[], countsByType{}, requestedTypes[], failedTypes[] }`
**Budget** 25 default / 100 max; each `description` clamped to 1000 chars ·
typical 2–25 KB
**Warnings** the standing not-an-all-clear notice; per-type provider failures
are reported in `failedTypes` as a **partial result** rather than failing the
whole call; description clamping is stated.
**Errors** all three feeds failing yields a provider error.

**Positive example.** "Er det snøskredvarsel i Norge i dag?"
**Routes elsewhere.** "Hvor mye regn kommer det i Bergen i morgen?" →
`get_norwegian_weather_forecast`.

---

## 8. `get_norwegian_electricity_prices`

**Title:** Get Norwegian electricity spot prices
**SDK:** `electricity.getPrices()`, `electricity.getCurrentPrice()` · **Provider:** Hva koster strømmen? · **Config:** none

**Description.** Get hourly electricity spot prices in NOK and EUR per kWh for
one Norwegian bidding zone and day. Prices exclude grid rent, taxes and
surcharges.

**Use this when** the user asks what electricity costs today or on a given date,
when the cheapest hours are, or about strømpris in NO1–NO5.

**Do not use this when** the user asks about national energy production,
reservoir levels or power plants — not exposed in v0.1 — or about general energy
statistics, which would be `query_norwegian_statistics`.

**Input**

| Field            | Type                  | Default             | Limit                                     |
| ---------------- | --------------------- | ------------------- | ----------------------------------------- |
| `area`           | `NO1`…`NO5`, required | —                   | enum; rejects `NO6`, lowercase normalised |
| `date`           | `YYYY-MM-DD`          | today (Europe/Oslo) | real date; not more than 1 day ahead      |
| `includeCurrent` | boolean               | `true`              | —                                         |

Zone hints are in the description: NO1 Oslo, NO2 Kristiansand, NO3 Trondheim,
NO4 Tromsø, NO5 Bergen.

**Output** `{ area, date, prices[], currentPrice{}|null, summary{min,max,average,cheapestHour,mostExpensiveHour} }`
**Budget** naturally 23–25 rows (DST); hard cap 25 · typical 3–5 KB
**Warnings** third-party derived API, not an official government endpoint;
excludes grid rent/taxes; next-day prices publish in the early afternoon.
**Errors** `not_found` when the requested day is not yet published — reported as
"not published yet", not as an empty result.

**Positive example.** "Hva koster strømmen i Oslo i dag?"
**Routes elsewhere.** "How much electricity did Norway produce in 2023?" →
`query_norwegian_statistics`.

---

## 9. `get_norwegian_transport_departures`

**Title:** Get Norwegian public transport departures
**SDK:** `transport.autocomplete()` → `transport.departures()` · **Provider:** Entur · **Config:** none

**Description.** Get upcoming public-transport departures from a Norwegian stop
place — bus, tram, metro, train, ferry — with real-time expected times where
available. Accepts either a stop name to look up or a known Entur stop-place ID.

**Use this when** the user asks when the next bus/train/tram leaves from a named
stop, or wants a departure board.

**Do not use this when** the user wants a route between two places — journey
planning is not exposed in v0.1 — or wants a street address rather than a
transit stop (`search_norwegian_addresses`).

**Input**

| Field         | Type              | Default | Limit                            |
| ------------- | ----------------- | ------- | -------------------------------- |
| `stopName`    | string            | —       | 2–100 non-blank chars            |
| `stopPlaceId` | string            | —       | `NSR:StopPlace:<digits>` pattern |
| `dateTime`    | ISO-8601 datetime | now     | valid date; ±30 days             |
| `limit`       | integer           | 10      | 1–50                             |

Exactly one of `stopName` / `stopPlaceId` must be supplied. Supplying both, or
neither, is rejected. When `stopName` is used the tool resolves it via
autocomplete and reports the resolved stop and any alternatives it did not pick,
so an assistant can ask a clarifying question instead of guessing.

**Output** `{ resolvedStop{id,name}, alternatives[], departures[], usedStopNameResolution }`
**Budget** departures 10 default / 50 max; alternatives ≤ 5 · typical 2–12 KB
**Warnings** ambiguous stop-name resolution lists alternatives; realtime absence
is stated per departure via `realtime: false`.
**Errors** `not_found` when no stop matches the name — distinct from a stop that
exists but has no departures (empty list, not an error).

**Positive example.** "Når går neste buss fra Majorstuen?"
**Routes elsewhere.** "How do I get from Oslo S to Bergen?" — no tool; the
assistant should say journey planning is not available in this server.

---

## 10. `query_norwegian_statistics`

**Title:** Query Statistics Norway (SSB) tables
**SDK:** `statistics.getTableMetadata()` / `statistics.query()` · **Provider:** SSB · **Config:** none

**Description.** Query a Statistics Norway (SSB) table by its table ID. Call it
**without** `selections` to discover the table's dimensions and the valid value
codes for each; then call it **again with** `selections` to retrieve the actual
numbers. Value codes are table-specific and must be discovered, never guessed.

**Use this when** the user wants specific Norwegian statistics — population by
age, employment, prices, education — and you know or can be told the SSB table
ID.

**Do not use this when** a ready-made profile already answers it:
municipality population and life expectancy come from
`get_norwegian_municipality_profile` in one call. Do not use it for electricity
spot prices (`get_norwegian_electricity_prices`) or for company data
(`search_norwegian_companies`).

**Input**

| Field        | Type                          | Default | Limit                                           |
| ------------ | ----------------------------- | ------- | ----------------------------------------------- |
| `tableId`    | string, required              | —       | 4–10 chars, alphanumeric, non-blank             |
| `selections` | object of `string → string[]` | —       | ≤10 dimensions, ≤50 codes each, codes ≤32 chars |
| `language`   | `no`\|`en`                    | `no`    | —                                               |
| `limit`      | integer                       | 100     | 1–500 rows                                      |

Omitting `selections` is the documented discovery call — it is not an error.

**Output** `{ tableId, title?, updatedAt?, mode: "metadata"|"data", dimensions[], rows[], rowCount, dimensionCount }`
**Budget** rows 100 default / 500 max; dimensions ≤ 20 with ≤ 100 values each ·
typical 2–40 KB. SSB permits 800 000 cells upstream — this tool never returns
anything near that.
**Warnings** in `metadata` mode, an explicit instruction that no data was
requested and how to request it; truncation of rows, dimensions or value lists.
**Errors** `not_found` for an unknown table ID; `invalid_input` with field
detail when a dimension code is not valid for the table (the SDK raises
`InputValidationError`, which maps to a retryable-by-correction error).

**Positive example.** "Show me SSB table 07459 broken down by age" → first call
`{ tableId: "07459" }`, then a second call with the discovered codes.
**Routes elsewhere.** "How many people live in Bergen?" →
`get_norwegian_municipality_profile` (one call, no table ID needed).

---

## 11. `resolve_norwegian_administrative_code`

**Title:** Resolve a Norwegian municipality or county code across reforms
**SDK:** `klass.resolveMunicipalityCode()` / `klass.resolveCountyCode()` · **Provider:** SSB Klass · **Config:** none

**Description.** Resolve a Norwegian municipality (kommune) or county (fylke)
_number_ across official SSB Klass boundary changes — renames, replacements,
merges and splits — as of a target date. Returns the official status and **every**
candidate, never a single auto-chosen one.

**Use this when** a code may be historical or reorganised: "what replaced
municipality 1142?", "is county code 12 still current?", "which of today's
municipalities cover an old code, and was it a merge or a split?".

**Do not use this when** the user wants a code's name from a code list
(`search_norwegian_classification_codes`) or municipality statistics
(`get_norwegian_municipality_profile`). This tool never combines statistics.

**Input**

| Field        | Type                       | Default | Limit                                              |
| ------------ | -------------------------- | ------- | -------------------------------------------------- |
| `kind`       | `municipality` \| `county` | —       | required                                           |
| `code`       | string, required           | —       | 4 digits (municipality) or 2 digits (county)       |
| `targetDate` | `YYYY-MM-DD`, required     | —       | real date; resolves the code "as of" this date     |
| `sourceDate` | `YYYY-MM-DD`               | —       | real date; only when the code is ambiguous in time |
| `language`   | `nb` \| `nn` \| `en`       | `nb`    | Klass language codes, not the `no`/`en` of PxWeb   |

Code format is validated against `kind` before any request: a two-digit code
with `kind: "municipality"` is rejected.

**Output** `{ kind, input{code,sourceDate?,targetDate}, status, sourceCode?, matches[], matchCount, predecessors[], successors[], changes[] }`.
`status` is one of `unchanged`, `renamed`, `replaced`, `merged`, `split`,
`ambiguous`, `not_found`, `context_required`, preserved verbatim from the SDK.
**Budget** matches / predecessors / successors / changes each capped at 50
(backstops real data never reaches) · typical 1–4 KB.
**Ambiguity.** A merge, split or ambiguous result keeps every branch and is
accompanied by a standing warning that it needs human/application judgement and
that administrative correspondence does not prove statistical comparability. The
tool never selects one code from several.
**Warnings** the SDK's own resolution warnings pass through unchanged; truncation
if a collection is bounded.
**Errors** provider failure, rate limit, timeout, cancellation, and
`upstream_invalid_response` on a changed provider contract.

**Positive example.** "What replaced municipality 1142?" →
`{ kind: "municipality", code: "1142", targetDate: "2024-01-01" }`.
**Routes elsewhere.** "What's Oslo's population?" →
`get_norwegian_municipality_profile`.

---

## 12. `search_norwegian_classification_codes`

**Title:** Search codes in an official SSB Klass classification
**SDK:** `klass.searchCodes()`, or `klass.getCode()` for an exact code · **Provider:** SSB Klass · **Config:** none

**Description.** Look up codes in an official SSB Klass classification by **code
pattern** — an exact code, a `*` wildcard, a `-` range or a `,` list. This is
code-pattern search (the provider's `selectCodes` syntax), **not** name or
full-text search. Returns each code with its official name, hierarchy level and
validity dates.

**Use this when** the user wants codes from an official classification:
"municipality code 0301 in the code list", "occupation codes starting with 25",
"industry codes 01–05". Common classification IDs: 131 municipalities, 104
counties, 6 industry (SN/NACE), 7 occupations (STYRK), 36 education.

**Do not use this when** the user wants to know whether a municipality or county
code changed over time (`resolve_norwegian_administrative_code`) or wants a
statistics table (`query_norwegian_statistics`). You cannot search by place or
category _name_ here.

**Input**

| Field              | Type                 | Default             | Limit                                        |
| ------------------ | -------------------- | ------------------- | -------------------------------------------- |
| `classificationId` | integer, required    | —                   | positive integer (a stable Klass id)         |
| `codePattern`      | string, required     | —                   | 1–64 chars: digits, letters, `.` `,` `-` `*` |
| `date`             | `YYYY-MM-DD`         | today (Europe/Oslo) | codes valid on this date                     |
| `level`            | string               | —                   | 1–2 digit hierarchy level filter             |
| `language`         | `nb` \| `nn` \| `en` | `nb`                | Klass language codes                         |
| `limit`            | integer              | 10                  | 1–20                                         |

An exact code with no `level` filter is looked up with the precise `getCode`
endpoint; a wildcard, range, list or a `level` filter uses `searchCodes`. A
not-found exact code returns a clean, attributed empty result, not an error.

**Output** `{ classificationId, date, language, codePattern, level?, mode: "exact"|"pattern", codes[], returnedCount, matchedCount, upstreamPaged? }`.
Each code is `{ code, name, level?, parentCode?, shortName?, validFrom?, validTo? }`.
**Budget** 10 default / 20 max codes; output bounded independently of the upstream
response size · typical 1–4 KB.
**Warnings** truncation when `matchedCount` exceeds the returned page.
**Errors** `not_found` for an unknown classification; provider failure, rate
limit, timeout, cancellation.

**Positive example.** "Which occupation codes start with 25?" →
`{ classificationId: 7, codePattern: "25*" }`.
**Routes elsewhere.** "What replaced municipality 1142?" →
`resolve_norwegian_administrative_code`.

---

## 13. `get_vessel_profile`

**Title:** Get vessel profile
**SDK:** `profiles.vessel()` · **Provider:** BarentsWatch AIS + Fiskeridirektoratet + MET Norway + Kartverket · **Config:** `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID` + `_SECRET`

**Description.** Identify one vessel by its MMSI and answer it from several
providers at once: latest AIS position and identity, the Norwegian
fishing-vessel register entry when there is one, conditions at the position and
the nearest official place name.

**Use this when** the user asks about a specific vessel and an MMSI is available.

**Do not use this when** the question is about movement over time — that is
`get_vessel_track` — or about which vessels are in an area, which is
`get_live_vessel_positions`.

**Input**

| Field  | Type             | Default | Limit                                      |
| ------ | ---------------- | ------- | ------------------------------------------ |
| `mmsi` | string, required | —       | 1–9 digits; a string, so `0` prefixes hold |

**Output** `{ mmsi, ais: { status, latestPosition?, trackPointCount?, trackFrom?, trackTo?, identity? }, registration?, weather?, nearestPlace?, components[] }`.
**Budget** one vessel; the track is summarised by count and window rather than
copied · typical 1–3 KB.
**Warnings** AIS coverage caveat (always); owner-privacy note when a register
entry is present; one line per omitted component explaining why.
**Partial** non-null when a section was omitted as `provider-error` or
`not-configured`. `not-applicable`, `not-found` and `not-covered` are ordinary
absences and are explained in warnings without being called partial.
**Errors** `missing_configuration` naming both AIS variables; `not_found`;
provider failure, rate limit, timeout, cancellation.

**Positive example.** "What is MMSI 257123456?" → `{ mmsi: "257123456" }`.
**Routes elsewhere.** "Where has it sailed today?" → `get_vessel_track`.

---

## 14. `get_vessel_track`

**Title:** Get vessel track
**SDK:** `ais.getTrackLast24Hours()` / `ais.getTrack()` · **Provider:** BarentsWatch AIS · **Config:** `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID` + `_SECRET`

**Description.** Recorded AIS positions for one vessel over a bounded past
window — where it went, when, at what speed and on what course.

**Use this when** the user asks where a vessel has been, its route, or its
movement over time.

**Do not use this when** a single current position with identity is wanted
(`get_vessel_profile`), or for live area traffic
(`get_live_vessel_positions`).

**Input**

| Field   | Type             | Default | Limit                             |
| ------- | ---------------- | ------- | --------------------------------- |
| `mmsi`  | string, required | —       | 1–9 digits                        |
| `from`  | ISO-8601         | —       | with `to`; window ≤ 14 days       |
| `to`    | ISO-8601         | —       | with `from`; must be after `from` |
| `limit` | integer          | 50      | 1–100 points                      |

Omitting both `from` and `to` uses the provider's own last-24-hours endpoint
rather than a ranged query with defaulted dates. Supplying exactly one of them
is refused.

**Output** `{ mmsi, window: { mode, requestedFrom?, requestedTo? }, from?, to?, pointsRecorded, pointsReturned, points[] }`.
**Budget** 50 default / 100 max points · typical 2–12 KB.
**Warnings** AIS coverage caveat (always); truncation; an explicit note that an
empty track is not evidence the vessel did not sail.
**Errors** `missing_configuration`; `invalid_input` for a reversed, half-given or
over-long window; provider failure, rate limit, timeout, cancellation.

**Positive example.** "Where has MMSI 257123456 been today?" → `{ mmsi: "257123456" }`.
**Routes elsewhere.** "What ships are out there now?" → `get_live_vessel_positions`.

---

## 15. `get_live_vessel_positions`

**Title:** Sample live vessel positions
**SDK:** `ais.streamPositions()` · **Provider:** BarentsWatch AIS · **Config:** `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID` + `_SECRET`

**Description.** A short, bounded sample of the live AIS feed for one sea area.

**This is the only tool backed by a stream, and the bounds are the contract.**
`streamPositions()` is an endless `AsyncIterable`; MCP has no way to express one,
because a tool call is one request and one result. So three bounds are
**required arguments with no defaults**, since each alone is insufficient: the
box limits how much sea is subscribed to, the limit stops a busy area filling
the result budget, and the timeout stops a quiet area — which emits nothing at
all — from hanging the call. The sample ends at whichever is reached first, and
the connection is released on **every** path: limit reached (via the iterator's
`return()`), timeout, caller cancellation, and provider error.

**Use this when** the user asks what vessels are in an area right now.

**Do not use this when** one vessel is already identified, or to build a census
of an area — the result is explicitly a sample.

**Input**

| Field         | Type              | Default | Limit                                                                     |
| ------------- | ----------------- | ------- | ------------------------------------------------------------------------- |
| `boundingBox` | object, required  | —       | `{south,west,north,east}`; north>south, east>west, ≤ 6° × 12° (see below) |
| `limit`       | integer, required | —       | 1–200 position reports                                                    |
| `timeoutMs`   | integer, required | —       | 500–15000 ms                                                              |
| `mmsi`        | string[]          | —       | 1–50 MMSIs                                                                |
| `downsample`  | boolean           | `true`  | asks the provider for ≤ 1 message/minute/vessel                           |

An antimeridian-crossing box is refused with an explicit message rather than
silently returning nothing; no provider here publishes data there.

**The 6° × 12° cap is a limit of this MCP server, not of BarentsWatch.**
BarentsWatch publishes no maximum box size, and the SDK enforces only coordinate
ranges, edge ordering and the antimeridian refusal — a caller using the SDK
directly may request any box the provider will serve. The cap exists because a
tool call returns one bounded result into a model's context window: across an
area much larger than this, the sample is dominated by whichever few vessels
transmitted first and stops being representative of the area at all. Refusing is
more honest than returning that. It is a product decision, subject to revision,
and the rejection message says so explicitly so a caller is never left believing
the provider refused the request.

**Output** `{ boundingBox, stoppedBecause: "limit-reached"|"timeout"|"stream-ended", sampledForMs, positionCount, vesselCount, positions[] }`.
**Budget** ≤ 200 positions and ≤ 15 s of wall-clock connection · typical 1–20 KB.
**Warnings** AIS coverage caveat; an explicit "this is a sample, not a complete
picture" note naming the bound that ended it; a note when nothing was received;
a note when the limit was hit before the timeout.
**Errors** `missing_configuration`; `invalid_input` for any missing or malformed
bound; `cancelled` when the caller aborts; provider failure, rate limit.

**Positive example.** "What is moving in the Trondheimsfjord?" →
`{ boundingBox: { south: 63.3, west: 10.2, north: 63.6, east: 10.7 }, limit: 25, timeoutMs: 5000 }`.
**Routes elsewhere.** "Where has that ship been?" → `get_vessel_track`.

---

## 16. `search_fishing_vessels`

**Title:** Search Norwegian fishing vessels
**SDK:** `fisheries.searchVessels()` · **Provider:** Fiskeridirektoratet · **Config:** none

**Description.** Search the register of active Norwegian fishing vessels by name,
registration mark, call sign, home municipality or hull length.

**Use this when** the user is looking for fishing vessels matching a description.

**Do not use this when** one exact identifier is already held
(`get_fishing_vessel`), or for a vessel's position (`get_vessel_profile`).

**Input**

| Field              | Type    | Default | Limit                             |
| ------------------ | ------- | ------- | --------------------------------- |
| `query`            | string  | —       | 2–100 chars, free text            |
| `name`             | string  | —       | 2–100 chars                       |
| `registrationMark` | string  | —       | `R 0062H`, `R-62-H` or `R-0062-H` |
| `radioCallSign`    | string  | —       | 3–10 letters or digits            |
| `municipalityCode` | string  | —       | exactly 4 digits                  |
| `minLength`        | number  | —       | 0–500 m, ≤ `maxLength`            |
| `maxLength`        | number  | —       | 0–500 m                           |
| `limit`            | integer | 10      | 1–50 vessels                      |
| `page`             | integer | 1       | 1–100 (the register is one-based) |

At least one filter is required; an unfiltered walk of the register is refused.

**Output** `{ vessels[], pagination: { page, pageSize, hasMore } }`.
**Budget** 10 default / 50 max vessels · typical 1–8 KB.
**Warnings** owner-privacy note when ownership is published; a note that
`hasMore` is inferred from a full page because the register reports no total.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Fishing vessels in Stavanger?" → `{ municipalityCode: "1103" }`.
**Routes elsewhere.** "The one with call sign LDMV" → `get_fishing_vessel`.

---

## 17. `get_fishing_vessel`

**Title:** Get a Norwegian fishing vessel
**SDK:** `fisheries.getVessel()` · **Provider:** Fiskeridirektoratet · **Config:** none

**Description.** Resolve exactly one register entry from a register id, a
registration mark or a radio call sign.

**Use this when** one exact identifier is in hand.

**Do not use this when** searching by name, area or size.

**Input**

| Field              | Type   | Default | Limit                     |
| ------------------ | ------ | ------- | ------------------------- |
| `id`               | string | —       | 1–10 digits               |
| `registrationMark` | string | —       | `R 0062H` / `R-62-H` form |
| `radioCallSign`    | string | —       | 3–10 letters or digits    |

**Exactly one** must be given. Combining two is refused rather than silently
privileging whichever the code checks first.

**Output** `{ vessel, matchedBy: "id"|"registrationMark"|"radioCallSign" }`.
**Budget** one vessel · typical <2 KB.
**Warnings** owner-privacy note when ownership is published.
**Errors** `not_found` both when nothing matches **and when more than one does** —
an ambiguous mark is never resolved arbitrarily.

**Positive example.** "Look up call sign LDMV." → `{ radioCallSign: "LDMV" }`.

---

## 18. `search_aquaculture_locations`

**Title:** Search Norwegian aquaculture locations
**SDK:** `fisheries.searchAquacultureSites()` · **Provider:** Fiskeridirektoratet · **Config:** none

**Description.** Find fish-farming sites by name, licence holder, licence number,
municipality, county, production area, placement, water type or species.

**Use this when** the user asks which fish farms exist somewhere, or which sites
a company holds.

**Do not use this when** a site number is already known.

**Input**

| Field                | Type    | Default | Limit                                  |
| -------------------- | ------- | ------- | -------------------------------------- |
| `name`               | string  | —       | 2–100 chars                            |
| `organizationNumber` | string  | —       | exactly 9 digits                       |
| `licenceNumber`      | string  | —       | `H-KM-0018` form                       |
| `municipalityCode`   | string  | —       | exactly 4 digits                       |
| `countyCode`         | string  | —       | exactly 2 digits                       |
| `productionAreaCode` | string  | —       | 1–13                                   |
| `placementType`      | string  | —       | ≤ 40 chars, e.g. `Offshore`            |
| `waterType`          | enum    | —       | `Salt` \| `Fresh` \| `Brackish`        |
| `speciesType`        | string  | —       | ≤ 40 chars, e.g. `Salmon`              |
| `limit`              | integer | 10      | 1–100 (the register's own ceiling)     |
| `offset`             | integer | 0       | 0–10000 (the register pages by offset) |

At least one filter is required.

**Output** `{ sites[], pagination: { offset, limit, hasMore } }`.
**Budget** 10 default / 100 max sites · typical 1–15 KB.
**Warnings** capacity-unit note when any site publishes a capacity; the inferred
`hasMore` note.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Fish farms in Heim?" → `{ municipalityCode: "5055" }`.

---

## 19. `get_aquaculture_location`

**Title:** Get a Norwegian aquaculture location
**SDK:** `fisheries.getAquacultureSite()` · **Provider:** Fiskeridirektoratet · **Config:** none

**Description.** One site by its public site number (lokalitetsnummer),
including coordinate, capacity with its unit, species, licences and the
production area with its traffic-light status.

**Use this when** a site number is known.

**Do not use this when** discovering sites by area or company, and do not confuse
a site number with a licence number such as `H-KM-0018`.

**Input**

| Field        | Type             | Default | Limit      |
| ------------ | ---------------- | ------- | ---------- |
| `siteNumber` | string, required | —       | 1–7 digits |

**Output** `{ site }`, with placement and licences flattened onto the site.
**Budget** one site · typical <2 KB.
**Warnings** capacity-unit note: `capacity` is meaningless without
`capacityUnitType`, and the register mixes units across licence kinds.
**Errors** `not_found`; provider failure, rate limit, timeout, cancellation.

**Positive example.** "What is site 10318?" → `{ siteNumber: "10318" }`.

---

## 20. `get_marine_forecast`

**Title:** Get Norwegian marine forecast
**SDK:** `marine.getWaveForecast()` + `marine.getSeaCurrent()` · **Provider:** BarentsWatch · **Config:** `NORWAY_MCP_BARENTSWATCH_CLIENT_ID` + `_SECRET`

**Description.** Wave and sea-current forecasts valid now for a coordinate along
the Norwegian coast.

**Use this when** the user asks about sea state, wave height, swell or currents —
conditions on the water rather than in the air.

**Do not use this when** the question is about wind, air temperature or
precipitation (`get_norwegian_weather_forecast`) or official danger warnings
(`get_current_norwegian_hazards`). Tides and water levels are
`get_norwegian_tides`.

**Input**

| Field       | Type             | Default               | Limit                     |
| ----------- | ---------------- | --------------------- | ------------------------- |
| `latitude`  | number, required | —                     | −90 to 90, finite         |
| `longitude` | number, required | —                     | −180 to 180, finite       |
| `include`   | enum[]           | `["waves","current"]` | 1–2 of `waves`, `current` |

The two requests are issued sequentially, not concurrently: both hit the same
provider and its request budget is a courtesy limit worth staying inside.

**Output** `{ requested, waves | null, current | null, failedSections[] }`.
**Budget** two model reads · typical <1 KB.
**Warnings** model-grid note (the returned coordinate is the grid cell centre, not
the requested point); "no model covers this coordinate" per absent section; a
per-section failure note when a request failed.
**Partial** non-null only when a request **failed**. An uncovered coordinate is a
normal outcome and is not reported as partial — that distinction is the point.
**Errors** `missing_configuration`; `provider_error` only when **every**
requested section failed; rate limit, timeout, cancellation.

**Positive example.** "How high are the waves off Hitra?" →
`{ latitude: 63.74, longitude: 9.22 }`.
**Routes elsewhere.** "Will it rain there?" → `get_norwegian_weather_forecast`.

---

## 21. `search_geonorge_datasets`

**Title:** Search the Geonorge dataset catalogue
**SDK:** `geodata.searchDatasets()` · **Provider:** Geonorge / Kartverket · **Config:** none

**Description.** Search Norway's national catalogue of geospatial metadata for
datasets by free text, publishing organization or theme. Returns each record's
opaque identifier, title, abstract, publisher, themes, access flags and update
date.

**Use this when** the user asks what Norwegian map or geodata exists about a
subject, or who publishes it.

**Do not use this when** the user wants the data rather than a description of it.
This returns catalogue metadata only; this server never downloads a catalogued
resource and no tool accepts a service URL.

**Input**

| Field       | Type    | Default | Limit                    |
| ----------- | ------- | ------- | ------------------------ |
| `query`     | string  | —       | 2–200 chars, trimmed     |
| `publisher` | string  | —       | 2–200 chars, exact facet |
| `theme`     | string  | —       | 2–100 chars, exact facet |
| `limit`     | integer | 10      | 1–50                     |
| `offset`    | integer | 0       | 0–1000                   |

At least one of `query`, `publisher`, `theme` is required: listing the whole
national catalogue is not supported. Geonorge's own per-request ceiling is 100;
50 is this server's.

**Output** `{ datasets[], pagination{offset,limit,returned,totalItems,hasMore} }`
**Budget** 10 default / 50 max · typical 2–15 KB
**Warnings** catalogue-scope note (metadata, not data; endpoints never fetched;
per-resource licences); a restricted/protected match; truncation.
**Continuation** `{ hasMore, nextArguments: { …input, offset } }` when Geonorge
reports more matches than this page returned.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Which datasets describe avalanche hazard zones?" →
`{ query: "skredfare" }`.
**Routes elsewhere.** "What's the licence on record dd9d…?" →
`get_geonorge_metadata`.

---

## 22. `get_geonorge_metadata`

**Title:** Get one Geonorge catalogue record
**SDK:** `geodata.getMetadata()` · **Provider:** Geonorge / Kartverket · **Config:** none

**Description.** Retrieve the full catalogue record for one Geonorge identifier:
abstract, keywords, geographic extent, coordinate reference systems, licence
terms, use limitations, update regime, advertised distributions and related
services.

**Use this when** the user asks who owns a dataset, how current it is, under what
licence it may be reused, or in which projection it is published.

**Do not use this** to obtain the data itself, and never pass it a web address.

**Input**

| Field | Type             | Default | Limit                                    |
| ----- | ---------------- | ------- | ---------------------------------------- |
| `id`  | string, required | —       | 8–128 chars, `[A-Za-z0-9._:-]`, no `://` |

The pattern accepts Geonorge's UUID-shaped identifiers and rejects anything that
could be a location: no scheme, no slash, no whitespace, no control character,
and never `.` or `..`. That is what keeps a curated catalogue tool from becoming
an arbitrary-URL proxy.

**Output** `{ id, title, type, description?, publisher?, themes[], keywords[],
spatialScope?, geographicExtent|null, referenceSystems[], contacts[],
license|null, attribution?, useLimitations?, access{}, updates{},
distributions[], services[], operatesOn[], serviceType? }`
**Budget** 30 keywords, 20 distributions, 20 services, 10 contacts, 10 reference
systems; description clamped to 2,000 chars · typical 2–20 KB
**Privacy** `contacts` carries the responsible **organization and role only**.
Geonorge publishes named individuals with e-mail addresses; those are dropped.
**Warnings** catalogue-scope note; "no declared licence is not permission" when
`license` is null; a restricted/protected resource; "the listed endpoints are
metadata and this server does not call them"; the contact-reduction note.
**Errors** `not_found` for an unknown identifier; `upstream_invalid_response` if
Geonorge answers for a different record; provider failure, rate limit, timeout,
cancellation.

**Positive example.** "Under what licence may I reuse this dataset?" →
`{ id: "dd9d5e94-5b3d-4e46-9b3c-000000000001" }`.
**Routes elsewhere.** "Which datasets exist about protected areas?" →
`search_geonorge_datasets`.

---

## 23. `get_protected_areas_at`

**Title:** Get protected areas at a coordinate
**SDK:** `environment.getProtectedAreasAt()`, optionally
`environment.getProposedProtectedAreasAt()` · **Provider:** Miljødirektoratet /
Naturbase · **Config:** none

**Description.** Report which Norwegian nature-conservation areas legally cover
one WGS84 coordinate — protection form, IUCN category, managing authority,
protection date, the Lovdata regulation and the Naturbase fact sheet —
optionally including areas only _proposed_ for protection.

**Use this when** the user asks whether a specific point or site lies inside a
national park, nature reserve, landscape-protection area or similar.

**Do not use this** to survey a region (`search_protected_areas` takes a bounding
box), and never read an empty result as proof that nothing of environmental value
is present.

**Input**

| Field             | Type             | Default | Limit               |
| ----------------- | ---------------- | ------- | ------------------- |
| `latitude`        | number, required | —       | −90 to 90, finite   |
| `longitude`       | number, required | —       | −180 to 180, finite |
| `includeProposed` | boolean          | `false` | —                   |
| `includeGeometry` | boolean          | `false` | —                   |
| `limit`           | integer          | 10      | 1–50                |

**Output** `{ location, protectedAreas[], protectedAreaPagination,
proposedProtectedAreas[]|null, proposedPagination|null }`
**Budget** 10 default / 50 max per dataset; geometry bounded per feature and per
result (see §Geometry) · typical 2–10 KB without geometry
**Partial** non-null only when `includeProposed` was set and _that_ lookup
failed. The two datasets are queried independently, so a proposal-layer outage
never destroys the legal-protection answer, which is the part that matters. A
failure of the current-protection lookup **is** an error: it is the reason the
tool exists.
**Warnings** Naturbase-scope note; CRS note; "a proposal carries no legal effect";
geometry omissions; truncation; the proposal-lookup failure when it happened.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Ligger punktet 61.1, 8.1 i et verneområde?" →
`{ latitude: 61.1, longitude: 8.1 }`.
**Routes elsewhere.** "Which reserves are in this valley?" →
`search_protected_areas`.

---

## 24. `search_protected_areas`

**Title:** Search protected areas in an area
**SDK:** `environment.searchProtectedAreas()` · **Provider:** Miljødirektoratet /
Naturbase · **Config:** none

**Description.** List every conservation area intersecting a bounded WGS84
rectangle, with the same attributes as the point lookup.

**Use this when** the user asks which reserves or parks lie within a region,
valley, fjord or municipality-sized window.

**Do not use this** for a single site (`get_protected_areas_at`), and do not treat
one page as a complete inventory of the region.

**Input**

| Field             | Type             | Default | Limit     |
| ----------------- | ---------------- | ------- | --------- |
| `boundingBox`     | object, required | —       | see below |
| `includeGeometry` | boolean          | `false` | —         |
| `limit`           | integer          | 20      | 1–100     |
| `offset`          | integer          | 0       | 0–10000   |

`boundingBox` is `{ south, west, north, east }` in WGS84 degrees. `north` must
exceed `south` and `east` must exceed `west`; a box crossing the antimeridian is
refused because the SDK does not support one. The span is capped at **2° of
latitude by 4° of longitude — a limit of this MCP server, not of
Miljødirektoratet**, which publishes no maximum extent. A bounded first page of a
country-sized box is an arbitrary sample rather than a survey, so the request is
refused instead of answered misleadingly.

**Output** `{ boundingBox, protectedAreas[], pagination }`
**Budget** 20 default / 100 max; at most 3 provider requests per call
**Continuation** `{ hasMore, nextArguments: { …input, offset } }` when the SDK
reports the walk was truncated.
**Warnings** Naturbase-scope note; CRS note; "this page is not a complete
inventory of the area"; geometry omissions; truncation.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "List the nature reserves between 61.0N 8.0E and 61.2N
8.4E" → `{ boundingBox: { south: 61.0, west: 8.0, north: 61.2, east: 8.4 } }`.
**Routes elsewhere.** "Is this exact spot protected?" →
`get_protected_areas_at`.

---

## 25. `get_nature_types_at`

**Title:** Get mapped nature localities at a coordinate
**SDK:** `environment.getNatureTypesAt()` · **Provider:** Miljødirektoratet /
Naturbase · **Config:** none

**Description.** Identify mapped NiN nature localities of national importance at
one coordinate — habitat type and NiN code, locality quality, condition,
biodiversity value, major ecosystem, red-list and near-threatened flags, survey
year, stated uncertainty and the fact sheet.

**Use this when** the user asks what habitat or ecosystem has been recorded at a
place, or whether a threatened nature type is registered there.

**Do not use this** for legal protection status (`get_protected_areas_at`), and do
not conclude from an empty result that the habitat is unremarkable: most of the
country has never been surveyed for these localities.

**Input**

| Field             | Type             | Default | Limit               |
| ----------------- | ---------------- | ------- | ------------------- |
| `latitude`        | number, required | —       | −90 to 90, finite   |
| `longitude`       | number, required | —       | −180 to 180, finite |
| `includeGeometry` | boolean          | `false` | —                   |
| `limit`           | integer          | 10      | 1–50                |

**Output** `{ location, natureTypes[], pagination }`
**Budget** 10 default / 50 max · typical 2–8 KB without geometry
**Dataset scope** the modern NiN important/red-listed/central-ecosystem
localities selected for SDK 0.8.0. Legacy DN-håndbok 13 localities, species
observations and locally valuable nature are separate layers this server does not
query.
**Warnings** Naturbase-scope note; CRS note; the NiN selection note; a
surveyor-flagged poorly-delimited locality; geometry omissions; truncation.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Er det registrert truede naturtyper her?" →
`{ latitude: 63.74, longitude: 9.22 }`.
**Routes elsewhere.** "Is it forest or bog?" → `get_land_resources_at`.

---

## 26. `get_intervention_free_nature_at`

**Title:** Get intervention-free nature status at a coordinate
**SDK:** `environment.getInterventionFreeAreasAt()` · **Provider:**
Miljødirektoratet / Naturbase · **Config:** none

**Description.** Tell whether a coordinate lay inside Norway's January 2023
intervention-free nature (INON) zones, the standard national indicator of
remaining wilderness-like land. Zone `1` is 1–3 km from major infrastructure,
zone `2` is 3–5 km, and zone `v` is at least 5 km.

**Use this when** the user asks how untouched or roadless somewhere is, or how a
development would affect wilderness-like land.

**Do not use this** as a conservation status — it confers no protection whatever —
and do not present it as current.

**Input**

| Field             | Type             | Default | Limit               |
| ----------------- | ---------------- | ------- | ------------------- |
| `latitude`        | number, required | —       | −90 to 90, finite   |
| `longitude`       | number, required | —       | −180 to 180, finite |
| `includeGeometry` | boolean          | `false` | —                   |
| `limit`           | integer          | 5       | **2**–25            |

**The minimum limit is 2, not 1.** The SDK derives its upstream page size from
the remaining limit, so a limit of 1 asks Miljødirektoratet's WFS for `COUNT=1`,
and whenever that request would match a zone the service answers with a page the
SDK rejects as invalid (`upstream_invalid_response`). Verified live against SDK
0.8.0 and deterministic; the ArcGIS-backed Naturbase layers answer a limit of 1
without trouble. Refusing the one input known to break is a schema decision and
belongs here; rewriting the caller's limit silently would answer a different
question from the one asked.

**Output** `{ location, interventionFreeAreas[], pagination }`
**Budget** 5 default / 25 max · typical 1–4 KB without geometry
**Dataset scope** the January 2023 status only, with official zones `1`, `2` and
`v`. Infrastructure built since that date is not reflected.
**Warnings** vintage note; Naturbase-scope note; CRS note; on an empty result, an
explicit statement that the point lay within roughly a kilometre of major
infrastructure at that date and that this says nothing about ecological value;
geometry omissions; truncation.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Er området inngrepsfri natur?" →
`{ latitude: 61.1, longitude: 8.1 }`.
**Routes elsewhere.** "Is it legally protected?" → `get_protected_areas_at`.

---

## 27. `get_land_resources_at`

**Title:** Get AR50 land-resource classification at a coordinate
**SDK:** `land.getLandResourcesAt()` · **Provider:** NIBIO · **Config:** none

**Description.** Classify the ground at one coordinate using NIBIO's generalized
AR50 land-resource map: land type, forest productivity, tree type, agricultural
potential and vegetation cover.

**Use this when** the user asks what kind of terrain, forest, farmland, bog or
glacier is at a place.

**Do not use this** at property precision, and not for conservation status
(`get_protected_areas_at`).

**Input**

| Field             | Type             | Default | Limit               |
| ----------------- | ---------------- | ------- | ------------------- |
| `latitude`        | number, required | —       | −90 to 90, finite   |
| `longitude`       | number, required | —       | −180 to 180, finite |
| `includeGeometry` | boolean          | `false` | —                   |
| `limit`           | integer          | 5       | 1–25                |

**Output** `{ location, landResources[], pagination }`
**Budget** 5 default / 25 max · typical 1–4 KB without geometry
**Dataset scope** AR50 targets scales of roughly 1:20,000 to 1:100,000 and may
merge areas below about 15 decares into a surrounding class, so a polygon is not
a property boundary. The detailed AR5 map, agricultural-land records and soil or
cultivation-suitability products are separate agreement-based datasets this
server does not provide.
**Class codes** only `landTypeCode` is given an English label, from the published
SOSI `ARTYPE` list (10 built-up, 20 agricultural, 30 forest, 50 open firm ground,
60 mire, 70 snow/glacier, 81 freshwater, 82 sea, 99 not mapped).
`forestProductivityCode`, `treeTypeCode`, `agricultureCode` and
`vegetationCoverCode` are returned **exactly as NIBIO published them**, because
restating a land classification this project cannot cite would be worse than
returning the code. NIBIO publishes those code lists with the AR50 WFS.
**Warnings** AR50-scope note; the class-code note; CRS note; a land-type code
outside the labelled list; geometry omissions; truncation.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "Hva slags arealtype er det her?" →
`{ latitude: 61.1, longitude: 8.1 }`.
**Routes elsewhere.** "Which habitat is registered here?" →
`get_nature_types_at`.

---

## 28. `get_nature_profile`

**Title:** Get nature profile for a coordinate
**SDK:** `profiles.natureAtLocation()` · **Providers:** Miljødirektoratet /
Naturbase + NIBIO + Kartverket · **Config:** none

**Description.** Answer one Norwegian coordinate from three agencies at once,
composing protected areas, proposed protected areas, mapped nature localities,
intervention-free status, AR50 land-resource classes, and the nearest official
Kartverket place name with its municipality and county.

**Use this when** the user asks broadly what the nature at a place is like, or
wants several of these answers together.

**Do not use this** when only one dataset is wanted — the single-purpose tools
return more detail per feature and cost one provider request — and do not read an
empty section as proof that nothing of environmental value exists there.

**Input**

| Field             | Type             | Default | Limit               |
| ----------------- | ---------------- | ------- | ------------------- |
| `latitude`        | number, required | —       | −90 to 90, finite   |
| `longitude`       | number, required | —       | −180 to 180, finite |
| `includeGeometry` | boolean          | `false` | —                   |
| `limit`           | integer          | 10      | **2**–50            |

`limit` applies to each dataset independently. Its floor is 2 for the reason
documented under §26: the same limit reaches the intervention-free WFS, and a
limit of 1 costs that section on every call.

**Output** `{ location, municipality|null, nearestPlace|null,
protectedAreas[]|null, proposedProtectedAreas[]|null, natureTypes[]|null,
interventionFreeAreas[]|null, landResources[]|null, pagination{…per section},
compositeSource, components[] }`

**`null` versus `[]` is load-bearing.** A `null` section means its provider
failed; an empty array means the provider answered and holds nothing at that
point. Collapsing the two would let a model report an outage as an absence of
nature.

**Partial results.** Each of the six lookups runs independently inside the SDK.
One provider failing costs only its own section: the rest are returned, the
failure appears in `components` with `reason: "provider-error"`, the SDK's own
message is preserved verbatim in the warnings, and `partial.missing` names the
section. Caller cancellation still rejects the whole call.

**Attribution.** The profile's top-level `source` is a **synthetic composite**
(`naturbase+nibio+kartverket`) that the SDK builds for the composition itself; it
carries no licence and no attribution. It is preserved in the payload as
`compositeSource` — it is real information about what was composed — but it is
never used as attribution. The envelope's `sources` is built from the available
`components` plus the SDK 0.8.0 `sources` array, so every provider that actually
answered is credited with its own licence, required wording and retrieval time.
Because the intervention-free layer shares the `naturbase` id but publishes
different terms, provenance is keyed on the terms as well as the id and **two**
Naturbase entries are returned rather than one.

**Budget** 10 default / 50 max per dataset; 20 components; 20 provider warnings;
geometry bounded per feature and per result · typical 5–25 KB without geometry
**Warnings** all four dataset-scope notes (Naturbase selection, AR50
generalization, AR50 class codes, INON vintage); CRS note; the SDK's own
per-provider failure and truncation notices; component omissions; the
municipality-inference caveat; geometry omissions; truncation.
**Errors** `provider_error` only when the SDK reports every provider failed;
rate limit, timeout, cancellation.

**Positive example.** "Tell me about the nature at 61.1, 8.1" →
`{ latitude: 61.1, longitude: 8.1 }`.
**Routes elsewhere.** "Just tell me if it's protected" →
`get_protected_areas_at`.

---

## 29. `get_norwegian_weather_warnings`

**Title:** Get MET Norway weather warnings
**SDK:** `weather.getWarnings()` · **Provider:** MET Norway (MetAlerts 2.0) · **Config:** **required** — `NORWAY_MCP_CONTACT_EMAIL`

**Description.** MET Norway's current official weather warnings (farevarsler) —
wind, gale, rain, snow, ice, icing, storm surge, forest-fire danger, lightning and
polar lows — for a coordinate, a county or all of Norway, each with its awareness
level and colour, validity window and message type.

**Use this when** the user asks whether a weather warning applies somewhere: a
yellow, orange or red warning, gale or storm (kuling, storm, ekstremvær), heavy
rain or snow, or storm surge.

**Do not use this when** the question is about flood, landslide or avalanche
warnings — NVE issues those, through `get_current_norwegian_hazards`. MET's
`rainFlood` and `stormSurge` warnings describe the rain and the water level and
sound like NVE products, so both descriptions point at the other tool and both
tools should be checked when flooding is the question. Do not use it for the
forecast itself (`get_norwegian_weather_forecast`).

**Input**

| Field              | Type               | Default | Limit                                       |
| ------------------ | ------------------ | ------- | ------------------------------------------- |
| `latitude`         | number             | —       | −90…90, finite; only with `longitude`       |
| `longitude`        | number             | —       | −180…180, finite; only with `latitude`      |
| `countyCode`       | string             | —       | exactly 2 digits; not combined with a point |
| `event`            | enum               | —       | the 12 MetAlerts event types                |
| `geographicDomain` | `land` \| `marine` | —       | —                                           |
| `language`         | `no` \| `en`       | `no`    | —                                           |
| `includeGeometry`  | boolean            | `false` | —                                           |

A point, a county, or neither — neither returns every current warning in Norway.
A point and a county together are refused: MetAlerts already selects the
warnings whose area contains the point. `riskMatrixColor` is not exposed.

**Output** `{ query{scope,…}, lastChange?, language, warnings[], totalWarnings, cancelledCount }`.
Each warning carries `id`, `event`, `eventName?`, `title`, `area`, `description`,
`instruction?`, `consequences?`, `awarenessLevel{level,color,severity}`,
`riskMatrixColor?`, `severity`, `certainty`, `messageType` (`Alert`, `Update` or
`Cancel`), `status`, `response?`, `seriousness?`, `triggerLevel?`,
`geographicDomain?`, `countyCodes[]`, `municipalityCodes[]`, `incidentName?`,
`onset?`, `expires?`, `eventEndingTime?`, `web?`, `geometry|null` and
`geometrySummary`.
**Budget** at most 50 warnings, in MetAlerts' order; text fields clamped to 1,000
chars; geometry whole or not at all under the shared 4,000-vertex budget (see
§Geometry) · typical 3–40 KB without geometry.
**Warnings** the standing not-an-all-clear notice naming NVE's tool; a specific
"MET Norway returned no current warnings" note on an empty list; a cancellation
note whenever a `Cancel` message is present; the NVE pointer whenever `rainFlood`
or `stormSurge` appears; geometry omissions; the 50-warning cut with how to
narrow it.
**Errors** `missing_configuration` naming `NORWAY_MCP_CONTACT_EMAIL`; provider
failure, rate limit, timeout, cancellation.

**Positive example.** "Er det farevarsel for vind i Vestland i dag?" →
`{ countyCode: "46", event: "wind" }`.
**Routes elsewhere.** "Er det flomvarsel for Gudbrandsdalen?" →
`get_current_norwegian_hazards`.

---

## 30. `get_norwegian_precipitation_nowcast`

**Title:** Get MET Norway precipitation nowcast
**SDK:** `weather.getNowcast()` · **Provider:** MET Norway · **Config:** **required** — `NORWAY_MCP_CONTACT_EMAIL`

**Description.** Radar-based precipitation for roughly the next two hours in
five-minute steps, with current temperature and wind and the radar status.

**Use this when** the user asks whether it will rain in the next hour or two,
when rain will start or stop, or whether it is raining now.

**Do not use this when** the horizon is longer than about two hours or a
multi-day outlook is wanted (`get_norwegian_weather_forecast`), or for warnings
(`get_norwegian_weather_warnings`).

**Input** `latitude`, `longitude` — required, finite, in range.

**Output** `{ requested, coverage: "covered"|"outside-radar-area", nowcast{updatedAt?, coordinates, radarCoverage?, entries[]}|null }`.
**Budget** at most 30 steps (MET publishes about 25) · typical 2–5 KB.
**Coverage** a point outside the Nordic radar area — which excludes Svalbard — is
`nowcast: null` with `coverage: "outside-radar-area"` and a plain reason. It is
not an error, and the reason names the hourly forecast as the alternative.
**Warnings** the two-hour scope note; a radar note when `radarCoverage` is not
`ok`, because precipitation is then unreliable.
**Errors** `missing_configuration`; provider failure, rate limit, timeout,
cancellation.

**Positive example.** "Will it start raining in the next half hour at 59.91, 10.75?"
**Routes elsewhere.** "What's the weather tomorrow?" →
`get_norwegian_weather_forecast`.

---

## 31. `get_norwegian_sun_times`

**Title:** Get sunrise and sunset times
**SDK:** `weather.getSunTimes()` · **Provider:** MET Norway · **Config:** **required** — `NORWAY_MCP_CONTACT_EMAIL`

**Description.** Sunrise, sunset, solar noon and solar midnight for a coordinate
and date, in the Europe/Oslo offset for that date, including midnight sun and
polar night.

**Use this when** the user asks when the sun rises or sets, how long the day is,
or about midnight sun or polar night (midnattssol, mørketid).

**Do not use this when** the question is about the weather (cloud cover, rain) —
`get_norwegian_weather_forecast`.

**Input**

| Field       | Type             | Default             | Limit              |
| ----------- | ---------------- | ------------------- | ------------------ |
| `latitude`  | number, required | —                   | −90…90, finite     |
| `longitude` | number, required | —                   | −180…180, finite   |
| `date`      | `YYYY-MM-DD`     | today (Europe/Oslo) | real calendar date |

The date default is resolved by this server from its clock, so a call is
reproducible.

**Output** `{ date, coordinates, sunrise{time,azimuth?}|null, sunset|null, solarNoon{time,elevation?,visible?}|null, solarMidnight|null, polarCondition: "midnight-sun"|"polar-night"|null }`.
**Budget** one date · typical <1 KB.
**Polar days.** A day with neither sunrise nor sunset carries `polarCondition`,
and the result says that this is the answer, not missing data. A day missing only
one of the two without a polar condition is explained too.
**Warnings** the Oslo-offset note; the polar note when it applies.
**Errors** `missing_configuration`; provider failure, rate limit, timeout,
cancellation.

**Positive example.** "Når går sola ned i Bodø i dag?" →
`{ latitude: 67.28, longitude: 14.4 }`.

---

## 32. `get_norwegian_tides`

**Title:** Get Norwegian tides and water levels
**SDK:** `tides.getTideTable()`, optionally `tides.getWaterLevels()` · **Provider:** Kartverket Hydrographic Service · **Config:** none

**Description.** Predicted high and low tides for a point on the Norwegian coast
over the next hours or days, optionally with hourly observed, predicted,
weather-effect and forecast water levels.

**Use this when** the user asks about high or low tide (flo, fjære, tidevann),
the water level or storm-surge levels at a harbour or shore.

**Do not use this when** the question is about waves, swell or sea currents
(`get_marine_forecast`) or about weather.

**Input**

| Field                | Type                                          | Default       | Limit                |
| -------------------- | --------------------------------------------- | ------------- | -------------------- |
| `latitude`           | number, required                              | —             | −90…90, finite       |
| `longitude`          | number, required                              | —             | −180…180, finite     |
| `hours`              | integer                                       | 48            | 1–168                |
| `referenceLevel`     | `chart-datum` \| `mean-sea-level` \| `nn2000` | `chart-datum` | —                    |
| `includeWaterLevels` | boolean                                       | `false`       | hourly, first ≤ 48 h |

The window is built by this server from its clock — `from` is now and `to` is
`hours` later, both ISO-8601 in UTC — so no caller-supplied window is accepted.
Water levels cover the first `min(hours, 48)` hours and say so when shortened.
They are requested only when the tide table shows the point is covered.

**Output** `{ requested, window{from,to,hours}, referenceLevel, covered, tideTable{location, referenceLevel, unit, serviceMessages[], events[]}|null, waterLevels{window, location, referenceLevel, serviceMessages[], series[]}|null }`.
`location` is the reference station the values were modelled from — `name`,
`code`, `factor?`, `delayMinutes?` and the surge gauge — and each water-level
series keeps its own `type` (`observation`, `prediction`, `weathereffect`,
`forecast`); forecast values carry the uncertainty band.
**Budget** 60 events (a week is about 28); 6 series of at most 60 values;
10 service messages · typical 1–10 KB.
**Coverage** an inland or far-offshore point is `covered: false` with a null
table — not an error.
**Partial** non-null only when the water-level request **failed**; the tide table
is still returned.
**Warnings** times are UTC; the reference-level note (chart datum is not mean sea
level); the modelled-values note; the 48-hour water-level window when shortened;
the forecast uncertainty note.
**Attribution** the SDK's Hydrographic Service credit (CC BY 4.0), in the envelope
and the rendered text.
**Errors** provider failure, rate limit, timeout, cancellation.

**Positive example.** "When is high tide in Bergen harbour tomorrow?" →
`{ latitude: 60.398, longitude: 5.32, hours: 48 }`.
**Routes elsewhere.** "How big are the waves off Stad?" → `get_marine_forecast`.

---

## 33. `get_norwegian_weather_history`

**Title:** Get Norwegian weather history (Frost)
**SDK:** `climate.searchStations()` → `climate.getObservations()`, optionally `climate.getClimateNormals()` · **Provider:** MET Norway Frost · **Config:** **required** — `NORWAY_MCP_MET_FROST_CLIENT_ID` · **Experimental**

**Description.** Past observations at the nearest weather station to a coordinate,
or at a given Frost station, optionally beside the station's 1991–2020 monthly
normals.

**Use this when** the user asks what the weather was — how cold it got, how much
rain fell, how a period compared with normal.

**Do not use this when** the question is about what will happen
(`get_norwegian_weather_forecast`) or conditions right now
(`get_weather_conditions_profile`).

**Input**

| Field            | Type                   | Default                | Limit                                               |
| ---------------- | ---------------------- | ---------------------- | --------------------------------------------------- |
| `latitude`       | number                 | —                      | with `longitude`; instead of `stationId`            |
| `longitude`      | number                 | —                      | with `latitude`                                     |
| `stationId`      | string                 | —                      | `SN` + digits, no sensor suffix; instead of a point |
| `resolution`     | `hourly` \| `daily`    | `daily`                | —                                                   |
| `startDate`      | `YYYY-MM-DD`, required | —                      | real date; not after today (Europe/Oslo)            |
| `endDate`        | `YYYY-MM-DD`           | = `startDate`          | ≥ `startDate`; hourly ≤ 4 days, daily ≤ 100 days    |
| `elements`       | enum[]                 | all for the resolution | 1–5 unique, valid for the resolution                |
| `includeNormals` | boolean                | `false`                | —                                                   |

Exactly one of a point or `stationId`. Dates are whole UTC days: Frost is asked
from `startDate`T00:00Z up to, but not including, the day after `endDate`. The
element list is fixed and mapped to Frost element IDs:

| Resolution | Element                | Frost element ID                 |
| ---------- | ---------------------- | -------------------------------- |
| hourly     | `air_temperature`      | `air_temperature`                |
| hourly     | `wind_speed`           | `wind_speed`                     |
| hourly     | `relative_humidity`    | `relative_humidity`              |
| hourly     | `precipitation`        | `sum(precipitation_amount PT1H)` |
| daily      | `mean_air_temperature` | `mean(air_temperature P1D)`      |
| daily      | `min_air_temperature`  | `min(air_temperature P1D)`       |
| daily      | `max_air_temperature`  | `max(air_temperature P1D)`       |
| daily      | `precipitation`        | `sum(precipitation_amount P1D)`  |
| daily      | `max_wind_gust`        | `max(wind_speed_of_gust P1D)`    |
| normals    | `mean_air_temperature` | `mean(air_temperature P1M)`      |
| normals    | `precipitation`        | `sum(precipitation_amount P1M)`  |

The IDs follow Frost's documentation; no Frost client ID was available when this
release was built, so they are confirmed by the opt-in live suite on its first
credentialed run.

**Output** `{ station{id,name,distanceKm?,elevationMetres?,latitude?,longitude?,municipality?,county?,validFrom?,validTo?}, selectedBy, window{startDate,endDate,from,to,resolution,timeResolution}, elements[{element,elementId}], records[{referenceTime, observations[{element?,elementId,value,unit?,timeOffset?,timeResolution?,qualityCode?}]}], recordCount, normals{period,months[],values[]}|null }`.
**Budget** at most 100 records (4 hourly days is 96; 100 daily days is 100) and 20
values per record · typical 5–40 KB.
**No gap filling.** Values are exactly as Frost published them. A missing hour or
day is a gap, never a zero, and is never filled or interpolated. `[]` means no
data for that station and window, not an error. Normals are labelled with their
period.
**Partial** non-null only when the normals request **failed**; the observations
are still returned.
**Privacy** station fields are whitelisted; Frost's station-holder names, which
the SDK already withholds, can never be added back.
**Warnings** the experimental note; the no-gap-filling note; the UTC window; for a
point, that the station is the nearest one reporting every element, plus a
distance note beyond 25 km (the SDK's own threshold); the empty-window note; the
normals note.
**Errors** `missing_configuration` naming `NORWAY_MCP_MET_FROST_CLIENT_ID` —
including when the SDK rejects the ID, never the SDK's
`credentials["met-frost"]` wording; `invalid_input` for a future `startDate`;
`not_found` for an unknown station or a point with no qualifying station;
provider failure, rate limit, timeout, cancellation.

**Positive example.** "How cold did it get at Blindern in the first week of
January 2026?" → `{ stationId: "SN18700", startDate: "2026-01-01", endDate: "2026-01-07", elements: ["min_air_temperature"] }`.
**Routes elsewhere.** "Will it be cold tomorrow?" → `get_norwegian_weather_forecast`.

---

## 34. `get_weather_conditions_profile`

**Title:** Get weather and sea conditions for a coordinate
**SDK:** `profiles.conditionsAtLocation()` · **Providers:** Kartverket + MET Norway + NVE + Kartverket Hydrographic Service + MET Norway Frost · **Config:** none (optional `NORWAY_MCP_CONTACT_EMAIL`, `NORWAY_MCP_MET_FROST_CLIENT_ID`) · **Experimental**

**Description.** One coordinate's weather, sea and daylight conditions from
several agencies at once: the containing municipality, MET Norway's forecast,
nowcast, weather warnings, sun times, ocean forecast and air quality, NVE flood,
avalanche and landslide warnings for the municipality, the tide table and the
latest observations at the nearest Frost station.

**Use this when** the user asks broadly what conditions are like at a place now or
over the next hours.

**Do not use this when** the subject is a street address
(`get_norwegian_location_profile` resolves it and adds roads), one product in full
detail such as an hourly forecast (`get_norwegian_weather_forecast`), or a past
period (`get_norwegian_weather_history`).

**Input** `latitude`, `longitude` — required; `hours` — integer 1–48, default 12,
for the forecast, ocean and air-quality sections. The tide table always covers at
least 24 hours.

**Output** `{ location, municipality|null, forecast[]|null, nowcast|null, weatherWarnings[]|null, hazards[]|null, hazardMatchEvidence[], sun|null, ocean|null, tides|null, airQuality|null, observations{station, latest[], monthlyTemperatureNormal|null}|null, compositeSource, components[] }`.
A `null` section was not asked for, is not covered at this point, or failed —
`components` says which, per operation (`not-configured`, `not-covered`,
`not-applicable`, `not-found`, `provider-error`).
**Budget** forecast, ocean and air quality ≤ 48 entries; 20 MET warnings (without
their areas; tool 29 returns those); 20 NVE warnings; 30 nowcast steps; 60 tide
events; 10 latest records; 14 components; 20 SDK notices · typical 10–40 KB.
**Partial** `partial.missing` lists each section omitted as `not-configured` or
`provider-error`, as `"section: reason"`. `not-covered`, `not-found` and
`not-applicable` are answers — no tide table inland, no nowcast on Svalbard — so
they are explained in the warnings and `components`, and do not make a result
partial. With no configuration the MET and Frost sections are listed here, and
the municipality, NVE warnings and tides still answer.
**Warnings** the SDK's own `warnings` (its notices: provider failures, radar
status, a distant station) merged verbatim; the experimental note; both
never-an-all-clear notices; the warning-area note; the ocean-cell, tide and
air-quality notes; one line per omitted component, naming the variable to set.
`weatherWarnings` are data, never merged into the envelope's warnings.
**Attribution** never the SDK's synthetic composite (kept as `compositeSource`):
`sources` is the union of the available components and the SDK's `sources`, so
`met` and `met-frost` are separate entries and NVE's three feeds keep their own
required wording.
**Errors** `provider_error` when the SDK reports every provider failed; rate limit,
timeout, cancellation.

**Positive example.** "What are conditions like right now at 68.23, 14.56?" →
`{ latitude: 68.23, longitude: 14.56 }`.
**Routes elsewhere.** "Hvordan er det ved Storgata 1 i Tromsø?" →
`get_norwegian_location_profile`.

---

## Geometry

Feature geometry is the largest payload this server can produce, so it is
governed by one rule stated once and applied by every geospatial tool: **geometry
is either returned exactly as the provider published it, or not returned at
all.**

- Off by default. `includeGeometry: true` opts in.
- A polygon keeps **every** ring: the exterior ring and every interior ring
  (hole). A multipolygon keeps **every** part. Nothing is simplified, thinned,
  re-ordered or reduced to a representative shape.
- A geometry over **4,000 vertices**, or one arriving after a result has spent
  its **4,000-vertex** allowance, is dropped **whole** and recorded in
  `truncation` with reason `limit` or `budget` respectively. Both ceilings are
  this server's, derived from the 120,000-character payload budget — a WGS84
  position serializes to about 21 characters. Neither provider imposes them.
- `geometrySummary` is present either way and always reports `type`,
  `polygonCount`, `holeCount`, `vertexCount`, `included` and, when coordinates
  are absent, `omittedReason` (`not-requested`, `not-published`, `too-large`,
  `result-budget`). A caller can therefore always tell that an area has holes or
  several parts, even when the coordinates were too large to send.
- `geometry: null` with `omittedReason: "not-published"` is the provider's own
  null geometry, not a failure. The attributes are still complete.
- Real geometry routinely exceeds the ceiling: the AR50 polygon at Galdhøpiggen
  carries 19,403 vertices across 63 rings. No setting of these constants could
  fit that into one MCP payload, which is why the guard is explicit and reported
  rather than hidden.
- `get_norwegian_weather_warnings` applies the same rule and the same budgets to
  MET Norway's warning areas. MetAlerts may publish any GeoJSON type — Point,
  MultiPoint, LineString, Polygon or MultiPolygon — so its summary reports
  `partCount` for whichever type arrives, and the polygon-only schema of the
  Naturbase and NIBIO tools is left unchanged.

## Coordinate reference systems

Every coordinate crossing this boundary, in or out, is WGS84 decimal degrees.
GeoJSON coordinates are longitude-first, as RFC 7946 requires.

Naturbase publishes EPSG:25833 and NIBIO EPSG:4258; both convert server-side at
the provider's request, and the SDK retains the original declaration in
`sourceCrs`. **Neither the SDK nor this server contains a reprojection engine.**
An unsupported or inconsistent CRS declaration is rejected as
`upstream_invalid_response` rather than reinterpreted, because silently treating
projected coordinates as degrees returns plausible-looking data in the wrong
place. Areas, distances and overlaps must not be computed from these degrees
without a proper projection.

## Why no generic map-service tool

No tool here accepts a URL, a host, a service endpoint, a WFS type name or a
layer name — a property named for any of those would fail
`tests/unit/server-contract.test.ts`. Generic WFS, WMS, OGC API Features and
ArcGIS REST proxying is deliberately out of scope, for the same reasons the SDK
declines it:

- **Provenance.** A caller-supplied endpoint has no licence, no required
  attribution and no way to distinguish a government service from anything else.
  Every guarantee in this document depends on knowing which provider answered.
- **Bounds.** An arbitrary service can return any volume, any geometry
  complexity and any CRS. The budgets above are only enforceable against known
  datasets.
- **Reach.** A URL parameter makes the tool a general-purpose HTTP fetcher that a
  model can point at any host this process can reach.

The catalogue tools still let a model _discover_ any published Norwegian service
and tell the user where it is. They just do not fetch it.

## Routing-ambiguity register

Pairs deliberately separated by wording, and the discriminator used:

| Pair     | Discriminator                                                       |
| -------- | ------------------------------------------------------------------- |
| 1 vs 2   | Do you have a 9-digit organization number?                          |
| 3 vs 4   | Choosing _which_ address vs. conditions _at_ an address             |
| 4 vs 6   | Street address vs. bare coordinate; single current vs. multi-hour   |
| 6 vs 7   | Forecast (temperature/rain/wind) vs. official danger warning        |
| 5 vs 10  | Ready-made municipality answer vs. custom table breakdown           |
| 8 vs 10  | Hourly spot price vs. energy statistics                             |
| 9 vs 3   | Transit stop vs. street address                                     |
| 5 vs 11  | Municipality statistics vs. did this code change over time          |
| 11 vs 12 | Did a code change over time vs. look a code up in a list            |
| 10 vs 12 | Statistics numbers vs. official classification code list            |
| 13 vs 14 | One vessel now (identity + position) vs. its movement over time     |
| 14 vs 15 | A known vessel's history vs. unknown vessels in an area right now   |
| 15 vs 13 | Area sweep with no vessel named vs. one MMSI already in hand        |
| 16 vs 17 | Several candidates by description vs. one exact identifier          |
| 18 vs 19 | Discover sites by area or holder vs. one known site number          |
| 20 vs 6  | Conditions on the water (waves, current) vs. in the air (wind)      |
| 21 vs 22 | Which datasets exist vs. the terms of one known record              |
| 21 vs 7  | Catalogue metadata about hazards vs. a live hazard warning          |
| 23 vs 24 | One coordinate vs. a bounded rectangle                              |
| 23 vs 25 | Legal protection vs. surveyed habitat                               |
| 25 vs 27 | Mapped nature locality vs. generalized land cover                   |
| 26 vs 23 | Distance from infrastructure vs. legal protection                   |
| 28 vs 23 | Several datasets at once vs. one dataset in full detail             |
| 28 vs 27 | Combined nature overview vs. land classification alone              |
| 29 vs 7  | MET weather warning vs. NVE flood, landslide or avalanche warning   |
| 29 vs 6  | A warning vs. a forecast                                            |
| 30 vs 6  | The next two hours in five-minute steps vs. a multi-hour forecast   |
| 33 vs 6  | What happened vs. what will happen                                  |
| 32 vs 20 | Tide and water level vs. waves and currents                         |
| 34 vs 4  | A coordinate's weather, sea and sun vs. a street address with roads |
| 34 vs 6  | An overview vs. a single forecast                                   |
| 33 vs 34 | A past period vs. conditions now                                    |

29 vs 7 is the main risk of the weather release: MetAlerts' `rainFlood` and
`stormSurge` sound like NVE products, so each description names the other tool,
and the corpus asks both directions in both languages.

These are exercised directly by the evaluation corpus in
`tests/eval/tool-routing.json`.
