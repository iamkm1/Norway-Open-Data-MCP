/**
 * The registered tool set.
 *
 * A small, curated set — deliberately not one tool per SDK method. Tool
 * descriptions are routing instructions for a model: adding near-duplicates
 * degrades selection accuracy for every other tool. See docs/tool-catalogue.md
 * for the full contract of each and docs/capability-matrix.md for what was
 * deferred and why.
 *
 * Order is stable and meaningful — it is the order `tools/list` advertises.
 */

import { searchCompaniesTool } from "./search-companies.js";
import { companyProfileTool } from "./company-profile.js";
import { searchAddressesTool } from "./search-addresses.js";
import { locationProfileTool } from "./location-profile.js";
import { municipalityProfileTool } from "./municipality-profile.js";
import { weatherForecastTool } from "./weather-forecast.js";
import { hazardsTool } from "./hazards.js";
import { electricityPricesTool } from "./electricity-prices.js";
import { transportDeparturesTool } from "./transport-departures.js";
import { statisticsTool } from "./statistics.js";
import { resolveAdministrativeCodeTool } from "./resolve-administrative-code.js";
import { searchClassificationCodesTool } from "./search-classification-codes.js";
import { vesselProfileTool } from "./vessel-profile.js";
import { vesselTrackTool } from "./vessel-track.js";
import { liveVesselPositionsTool } from "./live-vessel-positions.js";
import { searchFishingVesselsTool } from "./search-fishing-vessels.js";
import { fishingVesselTool } from "./fishing-vessel.js";
import { searchAquacultureLocationsTool } from "./search-aquaculture-locations.js";
import { aquacultureLocationTool } from "./aquaculture-location.js";
import { marineForecastTool } from "./marine-forecast.js";
import { searchGeonorgeDatasetsTool } from "./search-geonorge-datasets.js";
import { geonorgeMetadataTool } from "./geonorge-metadata.js";
import { protectedAreasAtTool } from "./protected-areas-at.js";
import { searchProtectedAreasTool } from "./search-protected-areas.js";
import { natureTypesAtTool } from "./nature-types-at.js";
import { interventionFreeNatureAtTool } from "./intervention-free-nature-at.js";
import { landResourcesAtTool } from "./land-resources-at.js";
import { natureProfileTool } from "./nature-profile.js";
import { weatherWarningsTool } from "./weather-warnings.js";
import { precipitationNowcastTool } from "./precipitation-nowcast.js";
import { sunTimesTool } from "./sun-times.js";
import { tidesTool } from "./tides.js";
import { weatherHistoryTool } from "./weather-history.js";
import { weatherConditionsProfileTool } from "./weather-conditions-profile.js";
import type { AnyToolDefinition } from "./types.js";

export const allTools: readonly AnyToolDefinition[] = [
  searchCompaniesTool,
  companyProfileTool,
  searchAddressesTool,
  locationProfileTool,
  municipalityProfileTool,
  weatherForecastTool,
  hazardsTool,
  electricityPricesTool,
  transportDeparturesTool,
  statisticsTool,
  resolveAdministrativeCodeTool,
  searchClassificationCodesTool,
  // Maritime. Appended rather than interleaved, so the order every existing
  // client already sees in `tools/list` is unchanged.
  vesselProfileTool,
  vesselTrackTool,
  liveVesselPositionsTool,
  searchFishingVesselsTool,
  fishingVesselTool,
  searchAquacultureLocationsTool,
  aquacultureLocationTool,
  marineForecastTool,
  // Geospatial. Appended for the same reason the maritime block was: the
  // twenty tools every existing client already sees keep their names and their
  // positions in `tools/list`.
  searchGeonorgeDatasetsTool,
  geonorgeMetadataTool,
  protectedAreasAtTool,
  searchProtectedAreasTool,
  natureTypesAtTool,
  interventionFreeNatureAtTool,
  landResourcesAtTool,
  natureProfileTool,
  // Weather, tides and climate. Appended for the same reason again: the
  // twenty-eight tools every existing client already sees keep their names and
  // their positions in `tools/list`.
  weatherWarningsTool,
  precipitationNowcastTool,
  sunTimesTool,
  tidesTool,
  weatherHistoryTool,
  weatherConditionsProfileTool,
];

/** Guards the documented contract that this server exposes exactly this many tools. */
export const EXPECTED_TOOL_COUNT = 34;

/**
 * The tools that shipped before the geospatial release, in their exact order.
 *
 * Existing clients depend on this prefix of `tools/list` being stable, so it is
 * asserted rather than assumed. See tests/unit/server-contract.test.ts.
 */
export const PRE_GEOSPATIAL_TOOL_ORDER: readonly string[] = [
  "search_norwegian_companies",
  "get_norwegian_company_profile",
  "search_norwegian_addresses",
  "get_norwegian_location_profile",
  "get_norwegian_municipality_profile",
  "get_norwegian_weather_forecast",
  "get_current_norwegian_hazards",
  "get_norwegian_electricity_prices",
  "get_norwegian_transport_departures",
  "query_norwegian_statistics",
  "resolve_norwegian_administrative_code",
  "search_norwegian_classification_codes",
  "get_vessel_profile",
  "get_vessel_track",
  "get_live_vessel_positions",
  "search_fishing_vessels",
  "get_fishing_vessel",
  "search_aquaculture_locations",
  "get_aquaculture_location",
  "get_marine_forecast",
];

/**
 * The tools that shipped before the weather release, in their exact order: the
 * twenty above plus the eight geospatial tools. The six weather, tide and
 * climate tools follow them. See tests/unit/server-contract.test.ts.
 */
export const PRE_WEATHER_TOOL_ORDER: readonly string[] = [
  ...PRE_GEOSPATIAL_TOOL_ORDER,
  "search_geonorge_datasets",
  "get_geonorge_metadata",
  "get_protected_areas_at",
  "search_protected_areas",
  "get_nature_types_at",
  "get_intervention_free_nature_at",
  "get_land_resources_at",
  "get_nature_profile",
];

/** The six tools added in 0.5.0, in their registered order. */
export const WEATHER_TOOL_NAMES: readonly string[] = [
  "get_norwegian_weather_warnings",
  "get_norwegian_precipitation_nowcast",
  "get_norwegian_sun_times",
  "get_norwegian_tides",
  "get_norwegian_weather_history",
  "get_weather_conditions_profile",
];
