import { z } from "zod";
import type { FisheriesVesselLookup } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import {
  OWNER_PRIVACY_NOTE,
  fishingVesselSchema,
  hasOwnerData,
  projectFishingVessel,
  renderFishingVessel,
} from "./shared/maritime.js";
import { callSignSchema, registrationMarkSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const registerIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}$/, "Register id must be 1-10 digits, as returned by search_fishing_vessels.");

/**
 * Exactly one identifier, never a mixture.
 *
 * The SDK's lookup is a union of three single-key shapes, so accepting two at
 * once would silently privilege whichever this code happened to check first.
 */
const inputSchema = z
  .object({
    id: registerIdSchema.optional().describe("The register's own identifier."),
    registrationMark: registrationMarkSchema
      .optional()
      .describe("Accepts R-62-H, R-0062-H or the register's own R 0062H."),
    radioCallSign: callSignSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.id, value.registrationMark, value.radioCallSign].filter(
        (candidate) => candidate !== undefined,
      ).length === 1,
    {
      message:
        "Provide exactly one of id, registrationMark or radioCallSign. Combining them is ambiguous; use search_fishing_vessels to narrow down first.",
    },
  );

const dataSchema = z.object({
  vessel: fishingVesselSchema,
  /** Which identifier resolved the vessel. */
  matchedBy: z.enum(["id", "registrationMark", "radioCallSign"]),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const { lookup, matchedBy } =
    input.id !== undefined
      ? { lookup: { id: input.id } satisfies FisheriesVesselLookup, matchedBy: "id" as const }
      : input.registrationMark !== undefined
        ? {
            lookup: {
              registrationMark: input.registrationMark,
            } satisfies FisheriesVesselLookup,
            matchedBy: "registrationMark" as const,
          }
        : {
            lookup: { radioCallSign: input.radioCallSign! } satisfies FisheriesVesselLookup,
            matchedBy: "radioCallSign" as const,
          };

  // A mark or call sign matching more than one vessel raises NotFoundError
  // upstream rather than resolving to whichever record came first. That is the
  // SDK's contract and is deliberately not softened here.
  const response = await context.getSdk().fisheries.getVessel(lookup, { signal });
  const vessel = projectFishingVessel(response.data);

  return buildEnvelope<Data>({
    data: { vessel, matchedBy },
    responses: [response],
    warnings: hasOwnerData([vessel]) ? [OWNER_PRIVACY_NOTE] : [],
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const body = [
    data.vessel.name ?? `(unnamed, id ${data.vessel.id})`,
    ...renderFishingVessel(data.vessel),
    `  Matched by: ${data.matchedBy}`,
  ].join("\n");

  return renderWithEnvelope(body, envelope);
}

export const fishingVesselTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_fishing_vessel",
  title: "Get a Norwegian fishing vessel",
  description:
    "Resolve exactly one vessel in Fiskeridirektoratet's fishing-vessel register from its " +
    "register id, its registration mark or its radio call sign, returning dimensions, tonnage, " +
    "engine power, build year and registered legal-entity owners. Needs no credentials. " +
    "Use this when you already hold one exact identifier for a fishing vessel. " +
    "Do not use this when searching by name, municipality or size — that is " +
    "search_fishing_vessels — and note that an identifier matching several vessels is reported " +
    "as not found rather than resolved arbitrarily. Owner details for private individuals are " +
    "never returned.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
