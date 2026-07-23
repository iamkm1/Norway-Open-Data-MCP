# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); see the versioning
policy in the README for what "breaking" means before 1.0.

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
