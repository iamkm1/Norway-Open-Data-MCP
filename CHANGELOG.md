# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); see the versioning
policy in the README for what "breaking" means before 1.0.

## 0.4.0 — 2026-07-26

Adds a curated geospatial toolset built on the new `geodata`, `environment` and
`land` namespaces and `profiles.natureAtLocation()` in
`norway-open-data-sdk@0.8.0`. The curated tool set grows from 20 to 28. **No
existing tool changes its name, input schema or data payload, and the first
twenty entries of `tools/list` keep their names and their order** — the eight new
tools are appended, and a test now pins that prefix rather than assuming it.

The geospatial release adds **no new environment variable and no credential of
any kind**: Geonorge, Naturbase and NIBIO are all anonymous. Twenty-three of the
twenty-eight tools now work with no configuration at all.

**One existing behaviour changes**, and it is a fix rather than a feature:
provenance is now keyed on a provider's licence terms as well as its id, so one
provider publishing two sets of terms no longer loses one of them. See _Fixed_.

### Added

- Two Geonorge catalogue tools, both anonymous:
  - `search_geonorge_datasets` — discover which Norwegian geodata exists, and
    whose, by free text, publishing organization or theme. Bounded and paged; an
    unfiltered walk of the national catalogue is refused.
  - `get_geonorge_metadata` — the full record for one catalogue identifier:
    licence, use limitations, geographic extent, coordinate reference systems,
    update regime and the endpoints its publisher advertises. Contacts are
    reduced to the responsible organization and role; the named individuals and
    e-mail addresses Geonorge publishes are not relayed.
- Five Naturbase and NIBIO tools, all anonymous:
  - `get_protected_areas_at` — which conservation areas legally cover one WGS84
    coordinate, with protection form, IUCN category, managing authority and the
    Lovdata regulation. `includeProposed` adds areas only proposed for
    protection, queried independently so a proposal-layer outage cannot destroy
    the legal-protection answer.
  - `search_protected_areas` — conservation areas intersecting a bounded
    rectangle.
  - `get_nature_types_at` — mapped NiN nature localities of national importance,
    with condition, biodiversity value and red-list status.
  - `get_intervention_free_nature_at` — the January 2023 intervention-free
    (INON) wilderness-distance zones.
  - `get_land_resources_at` — NIBIO's generalized AR50 land-resource
    classification.
- `get_nature_profile` — the headline tool. Answers one coordinate from
  Miljødirektoratet, NIBIO and Kartverket at once by delegating the whole
  composition to the SDK's `profiles.natureAtLocation()`: protected and proposed
  conservation areas, nature localities, intervention-free status, AR50 land
  classes, and the nearest official place name with its municipality. Every
  section reports its own provider, licence, retrieval time and why it is present
  or absent, and **one provider failing costs only its own section** — the rest
  are returned, with the failure in `components`, the SDK's own message preserved
  verbatim in the warnings, and the section named in `partial.missing`.
- **Geometry, returned whole or not at all.** Every geospatial tool takes
  `includeGeometry` (default `false`). When set, GeoJSON arrives exactly as the
  provider published it: every interior ring of a polygon and every part of a
  multipolygon survives. When a geometry does not fit, it is dropped **whole**
  and recorded in `truncation` — never simplified, never stripped of its holes,
  never reduced to its largest part. `geometrySummary` is present either way and
  always reports part count, hole count and vertex count, so a caller can tell
  that an area has holes even when the coordinates were too large to send.
- **Bounded by construction.** Every search takes a limit and reports
  `truncated` / `hasMore` from the SDK rather than inferring it; bounding boxes
  are capped at 2° × 4°; provider requests per tool call are capped; and a
  `nextOffset` continuation is offered when the provider held more. No tool can
  download a national dataset.
- Two new caveats carried on every relevant result, in both the structured
  warnings and the rendered text: **an empty nature result is never an
  environmental clearance** (these are four selected Naturbase datasets, not a
  register of everything of environmental value, and survey coverage is uneven),
  and **coordinates are WGS84 degrees that neither the SDK nor this server
  reprojects**.
- `PRE_GEOSPATIAL_TOOL_ORDER` in `src/tools/registry.ts`, so the twenty-tool
  prefix of `tools/list` is asserted rather than assumed.
- Fake-SDK fixtures for the new surface in `src/testing/fake-sdk.ts`: the
  `geodata`, `environment` and `land` namespaces, `profiles.natureAtLocation`,
  feature-result builders, a polygon **with a hole**, a multipolygon whose second
  part also has a hole, a null-geometry feature, an oversized geometry, and
  complete and degraded nature profiles. The intervention-free source fixture
  deliberately carries the layer's own licence and wording under the shared
  `naturbase` id, so an attribution regression cannot pass the offline suite.

### Changed

- `norway-open-data-sdk` requirement raised to `^0.8.0`, with the version floor
  test updated to match. The floor rises because the geospatial tools call
  namespaces that do not exist on 0.7.0.
- `EXPECTED_TOOL_COUNT` is 28. `--doctor` reports `Tools (28)`, all eight new
  tools `ready`.
- Documentation: README tool catalogue, capability matrix, tool catalogue, test
  plan, architecture, privacy notes and Inspector checklist all cover the new
  surface, its dataset scope, its limits and why a generic map-service tool is
  deliberately absent.
- **Added a root `.gitattributes` declaring `* text=auto eol=lf`.** Without it, a
  clone on a machine with `core.autocrlf=true` checked out CRLF working files
  while Prettier is configured for LF, so `pnpm format:check` — and therefore
  `pnpm verify` — failed on a completely untouched checkout until `pnpm format`
  was run. Committed blobs were already LF, so tracked content is unchanged; only
  what git writes to disk on checkout is now consistent for every contributor.

### Fixed

- **Provenance no longer collapses two sets of terms into one.** `mergeProvenance`
  de-duplicated sources by provider id. `norway-open-data-sdk@0.8.0` returns the
  Naturbase intervention-free layer under the same `naturbase` id as the other
  Naturbase layers but with its own licence version (NLOD 1.0) and its own
  required wording (`Miljødirektoratet - inngrepsfri natur 01.2023`), so keying on
  the id kept whichever arrived first and silently dropped the other's terms.
  De-duplication is now keyed on the licence and attribution as well as the id.
  For every provider whose id maps to one set of terms — every other provider —
  behaviour is unchanged.
- **Profile provenance now unions the SDK's `sources` array.** 0.8.0 added
  `OpenDataResponse.sources`, the SDK's own list of every real provider that
  contributed to a composition. Provenance is still built from `components` first,
  because only those carry a per-operation `retrievedAt` and `cached`, but any
  entry in `sources` that no available component accounts for is now added too, so
  a provider the SDK credits cannot be dropped by this layer. The four existing
  profile tools are unaffected in output: their `sources` is derived from the same
  components.

### Notes on provider behaviour

- **`get_intervention_free_nature_at` and `get_nature_profile` require a limit of
  at least 2.** The SDK derives its upstream page size from the remaining limit,
  so a limit of 1 asks Miljødirektoratet's intervention-free WFS for `COUNT=1` —
  and whenever that request would match a zone, the service answers with a page
  the SDK rejects as invalid. Verified live against SDK 0.8.0, deterministic, and
  specific to that layer; the ArcGIS-backed Naturbase layers answer a limit of 1
  without trouble. Refusing the one input known to break is a schema decision;
  rewriting the caller's limit silently would answer a different question from the
  one asked.
- **`pageSize` is deliberately not forwarded to the SDK.** An earlier draft passed
  the caller's limit as the provider page size, which made the same WFS return a
  page the SDK rejected. The MCP layer bounds what it returns, not how the SDK
  talks to a provider. A test pins this.

### Verification

Full chain green: format check, ESLint, `tsc --noEmit`, stdout audit, 464 unit
and evaluation tests with coverage thresholds enforced, build, 29 protocol
integration tests over real stdio, package smoke test (`npm pack` → install
outside the repository → drive the installed binary), `--doctor`, and 29 opt-in
live tests against the real Geonorge, Naturbase, NIBIO and existing providers.
No threshold was lowered and no test was removed or skipped.

## 0.3.0 — 2026-07-26

Adds a curated maritime toolset built on the new `ais`, `marine` and `fisheries`
namespaces in `norway-open-data-sdk@0.7.0`. The curated tool set grows from 12 to 20. No existing tool changes its name, input schema or data payload, and the
first twelve entries of `tools/list` keep their names and their order.

**One existing behaviour does change**, and it is a fix rather than a feature:
the four profile-backed tools now credit the providers that actually answered
instead of the SDK's synthetic composite source. See _Fixed_ below.

### Added

- Three BarentsWatch AIS tools, all gated on the `ais` credential scope:
  - `get_vessel_profile` — one vessel by MMSI, answered from BarentsWatch AIS,
    the Norwegian fishing-vessel register, MET Norway and Kartverket at once.
    Delegates the whole composition to the SDK's `profiles.vessel()`, and
    surfaces its per-section provenance: every section reports why it is present
    or absent, distinguishing "not configured", "not applicable", "not found",
    "not covered" and "provider error".
  - `get_vessel_track` — recorded positions for one vessel. Defaults to the
    provider's own last-24-hours endpoint; an explicit window of up to 14 days
    (the provider's retention) routes to the ranged endpoint instead.
  - `get_live_vessel_positions` — a **bounded sample** of the live AIS feed. A
    bounding box, a result limit (≤ 200) and a timeout (≤ 15 s) are required
    arguments with no defaults; the sample stops at whichever bound is reached
    first, and the connection is closed on every path including caller
    cancellation and provider error. No infinite stream is exposed through MCP.
- Four Fiskeridirektoratet tools, all **anonymous — no credential of any kind**:
  `search_fishing_vessels`, `get_fishing_vessel`, `search_aquaculture_locations`
  and `get_aquaculture_location`.
- `get_marine_forecast` — BarentsWatch wave and sea-current forecasts for a
  coordinate, gated on the `api` credential scope. The two models are
  independent: if one fails the other is still returned, with the failure
  recorded in `partial` and in the warnings, and an uncovered coordinate returns
  `null` sections rather than failing, so "no model covers this point" stays
  distinguishable from "the provider failed".
- Four environment variables, in two independent pairs, because BarentsWatch
  issues separate registered clients for AIS and for its other services and the
  SDK keeps them in separate credential scopes:
  `NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID` / `_SECRET` (scope `ais`) and
  `NORWAY_MCP_BARENTSWATCH_CLIENT_ID` / `_SECRET` (scope `api`). A
  half-configured pair is refused outright and reported by `--doctor`, rather
  than being passed through to fail at the token endpoint.
- Reusable strict input schemas for MMSI (string, so a leading zero survives),
  registration marks, radio call signs, aquaculture site numbers, production-area
  codes and WGS84 bounding boxes. Boxes reject inverted edges, antimeridian
  crossings and spans large enough to make a sample meaningless.
- Test doubles for the three new namespaces, including a finite, abort-aware AIS
  stream fake that records whether the consumer released the iterator.

### Changed

- Require `norway-open-data-sdk@^0.7.0` (previously `^0.6.0`) for its `ais`,
  `marine` and `fisheries` namespaces, `profiles.vessel()` and OAuth2
  client-credentials support. `^0.6.x` does not accept `0.7.0`, so the floor is
  raised deliberately and is enforced by a release guard over both the manifest
  range and the resolved lockfile version.
- OAuth2 client ids and client secrets are added to the redactor's literal secret
  set, alongside the contact email and the NVE key. Tokens were already caught by
  the credential-shaped patterns.
- `--doctor` reports the four new variables as `(set, masked)` or `(not set)`,
  and reports the readiness of all twenty tools.

### Fixed

- **Composed profiles credited a source that carries no licence and no
  attribution.** A profile's top-level `source` is a synthetic composite the SDK
  builds for the composition itself — `profiles.vessel()` returns
  `barentswatch-ais+kartverket` with a homepage pointing at the SDK's own
  repository and no `license` or `attribution` field at all, and the other three
  profiles do the same (`brreg+kartverket`, `kartverket+nve+vegvesen`,
  `ssb+fhi+brreg+nve`). Crediting it silently dropped every licence term the
  providers require, including the BarentsWatch AIS condition that **Kystverket**
  be credited.

  Provenance for `get_vessel_profile`, `get_norwegian_company_profile`,
  `get_norwegian_location_profile` and `get_norwegian_municipality_profile` is
  now built from the profile's components, each of which carries the real
  provider descriptor. Only components that actually returned data are credited;
  the composite is used solely as a fallback when none did, so an envelope always
  carries a timestamp.

  This changes the `sources[]` array of those four tools — the envelope schema is
  unchanged, but a result now lists one entry per contributing provider, each
  with its licence and attribution, instead of a single composite entry with
  neither. Found by calling the live API: the offline fixtures had been written
  with the real per-provider source, so the suite could not have caught it. The
  fixtures now carry the composite verbatim and a regression test asserts the
  composite never reaches an envelope.

- **Sea-current speed rendered at full float precision** in the text form
  (`0.21719335266844905`). The text block is a human-readable summary, so wave
  and current values are now rounded there; the structured payload keeps the
  provider's exact value unchanged.

### Documentation

- The `get_live_vessel_positions` bounds are documented as **limits of this MCP
  server, not of BarentsWatch**, in the README, the tool catalogue, the tool's
  own input description and the rejection message itself. BarentsWatch publishes
  no maximum bounding-box size, result cap or connection time limit, and a caller
  using the SDK directly is subject to none of them. The 6° × 12° box, the
  200-result cap and the 15-second timeout exist because a tool call returns one
  bounded result into a model's context window, and because a long-held
  connection turns a question into a subscription. They are product decisions,
  subject to revision, and a caller is never left believing the provider refused
  the request.

### Security and privacy

- **Private vessel-owner information is never returned.** The SDK already
  withholds name, postal code and town for natural-person owners; this server
  additionally projects owners field by field rather than by spread, so only
  registered legal entities are described and private owners are reduced to a
  count.
- OAuth2 is delegated entirely to the SDK: this server holds the configured
  values, hands them over once at construction, and never sees, stores or logs a
  token. Nothing is written to disk.
- AIS results carry the Kystverket **and** BarentsWatch attribution the licence
  requires, in both the structured envelope and the rendered text.
- Every AIS result states that absence of a position is not evidence of absence
  at sea, because the feed excludes small vessels, covers only Norwegian waters
  and retains 14 days.

### Verified against the live providers

All four BarentsWatch-gated tools were exercised against the real API with
registered credentials, in addition to the offline suite. The opt-in live suite
(`pnpm test:live`) now covers, and passes:

- the live stream ending on its **timeout** in a quiet sea area, and on its
  **limit** in a busy one;
- **cancellation** mid-stream rejecting in ~1.2 s against a 15-second budget;
- **no connection accumulation** across repeated cancelled samples, which is the
  guarantee that matters for a long-running server;
- **no credential** — client id, client secret or bearer token — in a live
  result, a live error, or stderr, including on the token-rejection path with a
  deliberately wrong secret;
- a live vessel profile crediting the real providers with their licences.

The BarentsWatch tests are gated a second time on credentials being present and
return early without them, so the suite still runs for contributors who have
none.

## 0.2.0 — 2026-07-25

Adds curated SSB Klass support. The curated tool set grows from 10 to 12; no
existing tool changes, and no new credential is introduced.

### Added

- Two curated SSB Klass tools:
  - `resolve_norwegian_administrative_code` — resolve a municipality (kommune) or
    county (fylke) code across official boundary changes (rename, replacement,
    merge, split) as of a target date. Preserves every official status and
    returns all candidates; a merge, split or ambiguous result is never reduced
    to a single code.
  - `search_norwegian_classification_codes` — look up codes in an official Klass
    classification by code pattern (exact code, `*` wildcard, `-` range or `,`
    list), bounded to at most 20 codes. Code-pattern search, not name search.
- Klass responses attribute the new `ssb-klass` provider (Statistics Norway
  Klass, CC BY 4.0). SSB Klass is anonymous — no new credential or environment
  variable is introduced.

### Changed

- Require `norway-open-data-sdk@^0.6.0` (previously `^0.5.3`) for its
  `sdk.klass` namespace. `^0.5.x` does not accept `0.6.0`, so the floor is raised
  deliberately; the release guard now requires an SDK of at least 0.6.0.
- The curated tool set grows from 10 to 12. Existing tool names, input schemas
  and behaviour are unchanged.

## 0.1.1 — 2026-07-24

Maintenance release. No new tools, no schema changes, no runtime behaviour
changes.

### Changed

- Require `norway-open-data-sdk@^0.5.3` (previously `^0.5.2`). SDK 0.5.3
  corrects a population-aggregation bug in which incomplete SSB population cells
  could be summed and reported as a complete municipality total. Because the SDK
  is pre-1.0 and its breaking changes ship as minor versions, the caret floor is
  raised deliberately so `get_norwegian_municipality_profile` can no longer
  resolve against the affected SDK. A release guard fails the build if the
  manifest or lockfile permits an SDK below 0.5.3.

## 0.1.0 — 2026-07-24

Initial release.

### Added

- Local stdio MCP server exposing ten curated read-only tools for Norwegian
  public data, built on `norway-open-data-sdk@0.5.2`.
- Tools: `search_norwegian_companies`, `get_norwegian_company_profile`,
  `search_norwegian_addresses`, `get_norwegian_location_profile`,
  `get_norwegian_municipality_profile`, `get_norwegian_weather_forecast`,
  `get_current_norwegian_hazards`, `get_norwegian_electricity_prices`,
  `get_norwegian_transport_departures`, `query_norwegian_statistics`.
- `norway-open-data-mcp` executable with `--help`, `--version` and `--doctor`.
- Programmatic `createNorwayOpenDataMcpServer()` factory with SDK injection.
- Shared result envelope carrying provider attribution, retrieval timestamp,
  cache status, warnings, truncation and partial-result state.
- Bounded output with deterministic truncation that is always reported.
- Stable error taxonomy mapped from SDK errors, with credential redaction.
- stdout guard, stderr-only logging, and a static stdout/safety audit.
