import { z } from "zod";
import type { AddressSearchParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  countyCodeSchema,
  limitSchema,
  municipalityCodeSchema,
  postalCodeSchema,
  searchQuerySchema,
} from "./shared/schemas.js";
import { addressSchema, projectAddress } from "./shared/profile.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
// Kartverket permits 1000 per page. Capped far lower: an address list is a
// disambiguation aid, and a model has no use for hundreds of near-identical rows.
const MAX_LIMIT = 50;

const inputSchema = z
  .object({
    query: searchQuerySchema("Address query", 2, 200),
    municipalityCode: municipalityCodeSchema.optional(),
    countyCode: countyCodeSchema.optional(),
    postalCode: postalCodeSchema.optional(),
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
  })
  .strict();

const dataSchema = z.object({
  addresses: z.array(addressSchema),
  totalAvailable: z.number().optional(),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const parameters: AddressSearchParameters = {
    query: input.query,
    ...(input.municipalityCode !== undefined ? { municipalityCode: input.municipalityCode } : {}),
    ...(input.countyCode !== undefined ? { countyCode: input.countyCode } : {}),
    ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
    limit: input.limit,
  };

  const response = await context.getSdk().addresses.search(parameters, { signal });
  const result = response.data;

  const limited = tracker.limitArray("addresses", result.items, input.limit, result.total);

  const warnings = tracker.warnings();
  if (input.countyCode !== undefined) {
    // Documented SDK behaviour: Kartverket has no county parameter, so the SDK
    // filters one provider page locally. Silently returning a short list would
    // read as "few matches exist" rather than "few matches on this page".
    warnings.push(
      "Kartverket's address API has no county filter, so countyCode is applied locally to a single " +
        "provider page. Some matching addresses outside that page may be missing. Use municipalityCode " +
        "or postalCode for an exact provider-side filter.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      addresses: limited.map(projectAddress),
      ...(result.total !== undefined ? { totalAvailable: result.total } : {}),
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.addresses.length === 0) {
    return renderWithEnvelope(
      "No addresses matched that query in Kartverket's register.",
      envelope,
    );
  }

  const body = data.addresses
    .map((address) => {
      const place = [address.postalCode, address.postalPlace].filter(Boolean).join(" ");
      const municipality = address.municipalityName ? ` — ${address.municipalityName}` : "";
      const coordinate =
        address.latitude !== undefined && address.longitude !== undefined
          ? ` [${address.latitude}, ${address.longitude}]`
          : "";
      return `- ${address.addressText ?? "(no address text)"}, ${place}${municipality}${coordinate}`;
    })
    .join("\n");

  const total = data.totalAvailable !== undefined ? ` of ${data.totalAvailable} match(es)` : "";
  return renderWithEnvelope(`Showing ${data.addresses.length}${total}:\n\n${body}`, envelope);
}

export const searchAddressesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_norwegian_addresses",
  title: "Search Norwegian addresses",
  description:
    "Search Norway's official address register (Kartverket) to find, verify or disambiguate a " +
    "street address and get its coordinates, postal code and municipality. Returns a list of " +
    "candidate addresses. " +
    "Use this when the user wants to check whether an address exists, find a postal code or " +
    "coordinate, or pick between several similar addresses. " +
    "Do not use this when the user asks about conditions AT a known address such as weather, " +
    "hazard warnings or nearby roads — that is get_norwegian_location_profile. Do not use this " +
    "to find a public transport stop; that is get_norwegian_transport_departures.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
