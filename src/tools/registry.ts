/**
 * The registered tool set.
 *
 * Ten curated tools, deliberately not fifty-five. Tool descriptions are routing
 * instructions for a model: adding near-duplicates degrades selection accuracy
 * for every other tool. See docs/tool-catalogue.md for the full contract of
 * each and docs/capability-matrix.md for what was deferred and why.
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
];

/** Guards the documented contract that this server exposes exactly ten tools. */
export const EXPECTED_TOOL_COUNT = 10;
