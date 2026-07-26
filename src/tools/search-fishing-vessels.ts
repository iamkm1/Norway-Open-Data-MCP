import { z } from "zod";
import type { FisheriesVesselSearchParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  OWNER_PRIVACY_NOTE,
  fishingVesselSchema,
  hasOwnerData,
  projectFishingVessel,
  renderFishingVessel,
} from "./shared/maritime.js";
import {
  callSignSchema,
  limitSchema,
  municipalityCodeSchema,
  registrationMarkSchema,
  searchQuerySchema,
} from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const lengthSchema = z
  .number()
  .min(0, "Length must not be negative.")
  .max(500, "Length must be at most 500 metres.");

const inputSchema = z
  .object({
    query: searchQuerySchema("Query", 2, 100)
      .optional()
      .describe("Free-text search across several register fields."),
    name: searchQuerySchema("Vessel name", 2, 100).optional(),
    registrationMark: registrationMarkSchema
      .optional()
      .describe("Exact-match filter. Accepts R-62-H, R-0062-H or the register's own R 0062H."),
    radioCallSign: callSignSchema.optional().describe("Exact-match filter."),
    municipalityCode: municipalityCodeSchema.optional(),
    minLength: lengthSchema.optional().describe("Minimum hull length in metres, inclusive."),
    maxLength: lengthSchema.optional().describe("Maximum hull length in metres, inclusive."),
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
    page: z
      .number()
      .int("Page must be a whole number.")
      .min(1, "Page is one-based and starts at 1.")
      .max(100, "Page must be at most 100.")
      .default(1),
  })
  .strict()
  .refine(
    (value) =>
      value.query !== undefined ||
      value.name !== undefined ||
      value.registrationMark !== undefined ||
      value.radioCallSign !== undefined ||
      value.municipalityCode !== undefined ||
      value.minLength !== undefined ||
      value.maxLength !== undefined,
    {
      message:
        "Provide at least one filter: query, name, registrationMark, radioCallSign, municipalityCode, minLength or maxLength. An unfiltered walk of the whole register is not supported.",
    },
  )
  .refine(
    (value) =>
      value.minLength === undefined ||
      value.maxLength === undefined ||
      value.maxLength >= value.minLength,
    { message: "maxLength must be greater than or equal to minLength." },
  );

const dataSchema = z.object({
  vessels: z.array(fishingVesselSchema),
  pagination: z.object({
    page: z.number(),
    pageSize: z.number(),
    /**
     * Derived from whether the page came back full. The register publishes its
     * total only in a response header the SDK does not read, so no exact count
     * is available and this can be true on an exactly-full final page.
     */
    hasMore: z.boolean(),
  }),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const parameters: FisheriesVesselSearchParameters = {
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.registrationMark !== undefined ? { registrationMark: input.registrationMark } : {}),
    ...(input.radioCallSign !== undefined ? { radioCallSign: input.radioCallSign } : {}),
    ...(input.municipalityCode !== undefined ? { municipalityCode: input.municipalityCode } : {}),
    ...(input.minLength !== undefined ? { minLength: input.minLength } : {}),
    ...(input.maxLength !== undefined ? { maxLength: input.maxLength } : {}),
    page: input.page,
    pageSize: input.limit,
  };

  const response = await context.getSdk().fisheries.searchVessels(parameters, { signal });
  const result = response.data;

  const limited = tracker.limitArray("vessels", result.items, input.limit);
  const vessels = limited.map(projectFishingVessel);

  const warnings = [...tracker.warnings()];
  if (hasOwnerData(vessels)) warnings.push(OWNER_PRIVACY_NOTE);
  if (result.pagination.hasMore) {
    warnings.push(
      "The register reports no total count, so 'more pages may exist' is inferred from this page " +
        "being full. Requesting the next page can legitimately return nothing.",
    );
  }

  return buildEnvelope<Data>({
    data: { vessels, pagination: result.pagination },
    responses: [response],
    warnings,
    truncation: tracker.report(),
    continuation: result.pagination.hasMore
      ? { hasMore: true, nextArguments: { ...input, page: input.page + 1 } }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.vessels.length === 0) {
    return renderWithEnvelope(
      "No vessels matched those filters in the Norwegian fishing-vessel register.",
      envelope,
    );
  }

  const body = data.vessels
    .map((vessel) =>
      [vessel.name ?? `(unnamed, id ${vessel.id})`, ...renderFishingVessel(vessel)].join("\n"),
    )
    .join("\n\n");

  const header = `Showing ${data.vessels.length} registered fishing vessel(s) (page ${data.pagination.page}).`;
  return renderWithEnvelope(`${header}\n\n${body}`, envelope);
}

export const searchFishingVesselsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_fishing_vessels",
  title: "Search Norwegian fishing vessels",
  description:
    "Search Fiskeridirektoratet's register of active Norwegian fishing vessels by name, " +
    "registration mark, radio call sign, home municipality or hull length, and return matching " +
    "vessels with their dimensions, tonnage, engine power and build year. Needs no credentials. " +
    "Use this when the user is looking for fishing vessels matching a description and does not " +
    "have one exact identifier. " +
    "Do not use this when you already have a single vessel's register id, registration mark or " +
    "call sign — get_fishing_vessel resolves exactly one — and do not use it for a vessel's " +
    "position, which comes from AIS via get_vessel_profile. Owner details for private " +
    "individuals are never returned.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
