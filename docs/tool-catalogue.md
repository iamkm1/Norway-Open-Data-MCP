# Tool catalogue

Twelve curated read-only tools. Tool names are stable, language-neutral
identifiers and are never translated.

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
(`get_current_norwegian_hazards`).

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
first.

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

## Routing-ambiguity register

Pairs deliberately separated by wording, and the discriminator used:

| Pair     | Discriminator                                                     |
| -------- | ----------------------------------------------------------------- |
| 1 vs 2   | Do you have a 9-digit organization number?                        |
| 3 vs 4   | Choosing _which_ address vs. conditions _at_ an address           |
| 4 vs 6   | Street address vs. bare coordinate; single current vs. multi-hour |
| 6 vs 7   | Forecast (temperature/rain/wind) vs. official danger warning      |
| 5 vs 10  | Ready-made municipality answer vs. custom table breakdown         |
| 8 vs 10  | Hourly spot price vs. energy statistics                           |
| 9 vs 3   | Transit stop vs. street address                                   |
| 5 vs 11  | Municipality statistics vs. did this code change over time        |
| 11 vs 12 | Did a code change over time vs. look a code up in a list          |
| 10 vs 12 | Statistics numbers vs. official classification code list          |

These are exercised directly by the evaluation corpus in
`tests/eval/tool-routing.json`.
