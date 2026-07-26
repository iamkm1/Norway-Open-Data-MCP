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
];

/** Guards the documented contract that this server exposes exactly twenty tools. */
export const EXPECTED_TOOL_COUNT = 20;
