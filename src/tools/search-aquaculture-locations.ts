import { z } from "zod";
import type { AquacultureSiteSearchParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  CAPACITY_UNIT_NOTE,
  aquacultureSiteSchema,
  projectAquacultureSite,
} from "./shared/maritime.js";
import {
  countyCodeSchema,
  municipalityCodeSchema,
  organizationNumberSchema,
  productionAreaCodeSchema,
  searchQuerySchema,
} from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
// The register's own per-request ceiling.
const MAX_LIMIT = 100;

const inputSchema = z
  .object({
    name: searchQuerySchema("Site name", 2, 100).optional(),
    organizationNumber: organizationNumberSchema
      .optional()
      .describe("Nine-digit organization number of a registered licence holder."),
    licenceNumber: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(
        z
          .string()
          .regex(
            /^[A-ZÆØÅ]{1,3}-[A-ZÆØÅ]{1,3}-\d{1,6}$/,
            "Licence number must look like H-KM-0018.",
          ),
      )
      .optional(),
    municipalityCode: municipalityCodeSchema.optional(),
    countyCode: countyCodeSchema.optional(),
    productionAreaCode: productionAreaCodeSchema.optional(),
    placementType: z
      .string()
      .trim()
      .max(40, "Placement type must be at most 40 characters.")
      .optional()
      .describe("Register value such as Offshore."),
    waterType: z
      .enum(["Salt", "Fresh", "Brackish"])
      .optional()
      .describe("Water classification, as the register publishes it."),
    speciesType: z
      .string()
      .trim()
      .max(40, "Species type must be at most 40 characters.")
      .optional()
      .describe("Species group such as Salmon."),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .default(DEFAULT_LIMIT),
    offset: z
      .number()
      .int("Offset must be a whole number.")
      .min(0, "Offset is zero-based and cannot be negative.")
      .max(10_000, "Offset must be at most 10000.")
      .default(0),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.organizationNumber !== undefined ||
      value.licenceNumber !== undefined ||
      value.municipalityCode !== undefined ||
      value.countyCode !== undefined ||
      value.productionAreaCode !== undefined ||
      value.placementType !== undefined ||
      value.waterType !== undefined ||
      value.speciesType !== undefined,
    {
      message:
        "Provide at least one filter: name, organizationNumber, licenceNumber, municipalityCode, countyCode, productionAreaCode, placementType, waterType or speciesType. An unfiltered walk of the whole register is not supported.",
    },
  );

const dataSchema = z.object({
  sites: z.array(aquacultureSiteSchema),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    /** Derived from a full page; the register publishes no total. */
    hasMore: z.boolean(),
  }),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const parameters: AquacultureSiteSearchParameters = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.organizationNumber !== undefined
      ? { organizationNumber: input.organizationNumber }
      : {}),
    ...(input.licenceNumber !== undefined ? { licenceNumber: input.licenceNumber } : {}),
    ...(input.municipalityCode !== undefined ? { municipalityCode: input.municipalityCode } : {}),
    ...(input.countyCode !== undefined ? { countyCode: input.countyCode } : {}),
    ...(input.productionAreaCode !== undefined
      ? { productionAreaCode: input.productionAreaCode }
      : {}),
    ...(input.placementType !== undefined ? { placementType: input.placementType } : {}),
    ...(input.waterType !== undefined ? { waterType: input.waterType } : {}),
    ...(input.speciesType !== undefined ? { speciesType: input.speciesType } : {}),
    offset: input.offset,
    limit: input.limit,
  };

  const response = await context.getSdk().fisheries.searchAquacultureSites(parameters, { signal });
  const result = response.data;

  const limited = tracker.limitArray("sites", result.items, input.limit);
  const sites = limited.map(projectAquacultureSite);

  const warnings = [...tracker.warnings()];
  if (sites.some((site) => site.capacity !== undefined)) warnings.push(CAPACITY_UNIT_NOTE);
  if (result.pagination.hasMore) {
    warnings.push(
      "The register reports no total count, so 'more pages may exist' is inferred from this page " +
        "being full. Requesting the next offset can legitimately return nothing.",
    );
  }

  return buildEnvelope<Data>({
    data: { sites, pagination: result.pagination },
    responses: [response],
    warnings,
    truncation: tracker.report(),
    continuation: result.pagination.hasMore
      ? {
          hasMore: true,
          nextArguments: { ...input, offset: input.offset + result.pagination.limit },
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.sites.length === 0) {
    return renderWithEnvelope(
      "No sites matched those filters in the public Norwegian aquaculture register.",
      envelope,
    );
  }

  const body = data.sites
    .map((site) =>
      [
        `${site.name ?? "(unnamed)"} — site ${site.siteNumber}`,
        ...fields([
          ["Municipality", site.municipalityName],
          ["County", site.countyName],
          [
            "Production area",
            site.productionAreaCode !== undefined
              ? `${site.productionAreaCode}${site.productionAreaStatus ? ` (${site.productionAreaStatus})` : ""}`
              : undefined,
          ],
          ["Water type", site.waterType],
          ["Placement", site.placementType],
          [
            "Capacity",
            site.capacity !== undefined
              ? `${site.capacity} ${site.capacityUnitType ?? "(unit not stated)"}`
              : undefined,
          ],
          ["Species", site.speciesTypes?.join(", ")],
          [
            "Coordinate",
            site.latitude !== undefined ? `${site.latitude}, ${site.longitude ?? "?"}` : undefined,
          ],
        ]),
      ].join("\n"),
    )
    .join("\n\n");

  const header = `Showing ${data.sites.length} aquaculture site(s) from offset ${data.pagination.offset}.`;
  return renderWithEnvelope(`${header}\n\n${body}`, envelope);
}

export const searchAquacultureLocationsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_aquaculture_locations",
  title: "Search Norwegian aquaculture locations",
  description:
    "Search Fiskeridirektoratet's public aquaculture register for fish-farming sites by name, " +
    "licence holder, licence number, municipality, county, production area, water type or " +
    "species, returning each site's coordinate, permitted capacity and production-area " +
    "traffic-light status. Needs no credentials. " +
    "Use this when the user asks which fish farms or aquaculture sites exist somewhere, or which " +
    "sites a company holds. " +
    "Do not use this when a single site number is already known — get_aquaculture_location " +
    "returns one site in full — and do not use it for vessels of any kind.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
