import { z } from "zod";
import type { Company, CompanySearchParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  industryCodeSchema,
  limitSchema,
  municipalityCodeSchema,
  organizationForm,
  organizationNumberSchema,
  pageSchema,
  searchQuerySchema,
} from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const inputSchema = z
  .object({
    name: searchQuerySchema("Company name", 2, 200).optional(),
    organizationNumber: organizationNumberSchema.optional(),
    municipalityCode: municipalityCodeSchema.optional(),
    industryCode: industryCodeSchema.optional(),
    organizationForm: organizationForm.optional(),
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
    page: pageSchema(100),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.organizationNumber !== undefined ||
      value.municipalityCode !== undefined ||
      value.industryCode !== undefined ||
      value.organizationForm !== undefined,
    {
      message:
        "Provide at least one filter: name, organizationNumber, municipalityCode, industryCode or organizationForm. An unfiltered search of the whole register is not supported.",
    },
  );

const addressSchema = z.object({
  addressText: z.string().optional(),
  postalCode: z.string().optional(),
  postalPlace: z.string().optional(),
  municipalityName: z.string().optional(),
});

const companySchema = z.object({
  organizationNumber: z.string(),
  name: z.string(),
  organizationForm: z.string().optional(),
  industry: z.string().optional(),
  municipality: z.string().optional(),
  numberOfEmployees: z.number().optional(),
  registeredAt: z.string().optional(),
  bankruptcy: z.boolean().optional(),
  liquidation: z.boolean().optional(),
  homepage: z.string().optional(),
  businessAddress: addressSchema.optional(),
});

const dataSchema = z.object({
  companies: z.array(companySchema),
  pagination: z.object({
    page: z.number(),
    size: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
  }),
});

type Data = z.infer<typeof dataSchema>;

function summarizeAddress(company: Company): z.infer<typeof addressSchema> | undefined {
  const address = company.businessAddress ?? company.postalAddress;
  if (!address) return undefined;
  return {
    ...(address.addressText !== undefined ? { addressText: address.addressText } : {}),
    ...(address.postalCode !== undefined ? { postalCode: address.postalCode } : {}),
    ...(address.postalPlace !== undefined ? { postalPlace: address.postalPlace } : {}),
    ...(address.municipalityName !== undefined
      ? { municipalityName: address.municipalityName }
      : {}),
  };
}

/**
 * Projects the SDK's `Company` onto the flatter shape this tool returns.
 *
 * Nested code/description pairs are collapsed to a single readable string:
 * a model does not need the NACE code and its label as separate fields, and
 * the flatter shape roughly halves the serialized size of a 50-result page.
 */
function toCompany(company: Company): z.infer<typeof companySchema> {
  const address = summarizeAddress(company);
  return {
    organizationNumber: company.organizationNumber,
    name: company.name,
    ...(company.organizationForm
      ? {
          organizationForm: company.organizationForm.description
            ? `${company.organizationForm.code} — ${company.organizationForm.description}`
            : company.organizationForm.code,
        }
      : {}),
    ...(company.industry
      ? {
          industry: company.industry.description
            ? `${company.industry.code} — ${company.industry.description}`
            : company.industry.code,
        }
      : {}),
    ...(company.municipality?.name !== undefined
      ? { municipality: company.municipality.name }
      : {}),
    ...(company.numberOfEmployees !== undefined
      ? { numberOfEmployees: company.numberOfEmployees }
      : {}),
    ...(company.registeredAt !== undefined ? { registeredAt: company.registeredAt } : {}),
    ...(company.bankruptcy !== undefined ? { bankruptcy: company.bankruptcy } : {}),
    ...(company.liquidation !== undefined ? { liquidation: company.liquidation } : {}),
    ...(company.homepage !== undefined ? { homepage: company.homepage } : {}),
    ...(address !== undefined ? { businessAddress: address } : {}),
  };
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const parameters: CompanySearchParameters = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.organizationNumber !== undefined
      ? { organizationNumber: input.organizationNumber }
      : {}),
    ...(input.municipalityCode !== undefined ? { municipalityCode: input.municipalityCode } : {}),
    ...(input.industryCode !== undefined ? { industryCode: input.industryCode } : {}),
    ...(input.organizationForm !== undefined ? { organizationForm: input.organizationForm } : {}),
    page: input.page,
    size: input.limit,
  };

  const response = await context.getSdk().companies.search(parameters, { signal });
  const result = response.data;

  const limited = tracker.limitArray(
    "companies",
    result.items,
    input.limit,
    result.pagination.totalItems,
  );

  const warnings = tracker.warnings();
  const hasMore = result.pagination.page + 1 < result.pagination.totalPages;

  return buildEnvelope<Data>({
    data: {
      companies: limited.map(toCompany),
      pagination: result.pagination,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
    continuation: hasMore
      ? { hasMore: true, nextArguments: { ...input, page: input.page + 1 } }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.companies.length === 0) {
    return renderWithEnvelope(
      "No organizations matched those filters in Enhetsregisteret.",
      envelope,
    );
  }

  const body = data.companies
    .map((company) => {
      const lines = fields([
        ["Organization number", company.organizationNumber],
        ["Legal form", company.organizationForm],
        ["Industry", company.industry],
        ["Municipality", company.municipality],
        ["Employees", company.numberOfEmployees],
        ["Address", company.businessAddress?.addressText],
        ["Registered", company.registeredAt],
        ["Bankruptcy", company.bankruptcy ? "yes" : undefined],
        ["Under liquidation", company.liquidation ? "yes" : undefined],
      ]);
      return [`${company.name}`, ...lines].join("\n");
    })
    .join("\n\n");

  const header = `Found ${data.pagination.totalItems} matching organization(s); showing ${data.companies.length} (page ${data.pagination.page + 1} of ${Math.max(1, data.pagination.totalPages)}).`;
  return renderWithEnvelope(`${header}\n\n${body}`, envelope);
}

export const searchCompaniesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_norwegian_companies",
  title: "Search Norwegian companies",
  description:
    "Search Norway's official company register (Enhetsregisteret, from Brønnøysundregistrene) by " +
    "name or filters to find organizations and their nine-digit organization numbers. Returns a " +
    "list of matches with legal form, industry, municipality and registered address. " +
    "Use this when you know a company's name but not its organization number, or to list " +
    "organizations in a municipality, industry or legal form. " +
    "Do not use this when you already have an exact nine-digit organization number — " +
    "get_norwegian_company_profile returns much more detail for a single organization.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
