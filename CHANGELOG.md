# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); see the versioning
policy in the README for what "breaking" means before 1.0.

## [Unreleased] — 0.2.0

Not yet published. Adds curated SSB Klass support.

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
