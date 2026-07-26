import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { organizationNumberSchema } from "./shared/schemas.js";
import {
  addressSchema,
  componentSchema,
  componentWarnings,
  missingSections,
  projectAddress,
  componentProvenance,
  projectComponents,
} from "./shared/profile.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const MAX_COMPONENTS = 20;

const inputSchema = z
  .object({
    organizationNumber: organizationNumberSchema,
  })
  .strict();

const dataSchema = z.object({
  company: z.object({
    organizationNumber: z.string(),
    name: z.string(),
    organizationForm: z.string().optional(),
    industry: z.string().optional(),
    secondaryIndustries: z.array(z.string()).optional(),
    municipality: z.string().optional(),
    numberOfEmployees: z.number().optional(),
    registeredAt: z.string().optional(),
    foundedAt: z.string().optional(),
    vatRegistered: z.boolean().optional(),
    employerRegistered: z.boolean().optional(),
    bankruptcy: z.boolean().optional(),
    liquidation: z.boolean().optional(),
    homepage: z.string().optional(),
    businessAddress: addressSchema.optional(),
    postalAddress: addressSchema.optional(),
  }),
  location: z
    .object({
      address: addressSchema,
      matchConfidence: z.enum(["exact", "high", "possible"]),
    })
    .nullable(),
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const response = await context.getSdk().profiles.company(input.organizationNumber, { signal });

  const profile = response.data;
  const company = profile.company;
  const components = tracker.limitArray(
    "components",
    projectComponents(profile.components),
    MAX_COMPONENTS,
  );

  const data: Data = {
    company: {
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
      ...(company.secondaryIndustries?.length
        ? {
            secondaryIndustries: company.secondaryIndustries.map((entry) =>
              entry.description ? `${entry.code} — ${entry.description}` : entry.code,
            ),
          }
        : {}),
      ...(company.municipality?.name !== undefined
        ? { municipality: company.municipality.name }
        : {}),
      ...(company.numberOfEmployees !== undefined
        ? { numberOfEmployees: company.numberOfEmployees }
        : {}),
      ...(company.registeredAt !== undefined ? { registeredAt: company.registeredAt } : {}),
      ...(company.foundedAt !== undefined ? { foundedAt: company.foundedAt } : {}),
      ...(company.vatRegistered !== undefined ? { vatRegistered: company.vatRegistered } : {}),
      ...(company.employerRegistered !== undefined
        ? { employerRegistered: company.employerRegistered }
        : {}),
      ...(company.bankruptcy !== undefined ? { bankruptcy: company.bankruptcy } : {}),
      ...(company.liquidation !== undefined ? { liquidation: company.liquidation } : {}),
      ...(company.homepage !== undefined ? { homepage: company.homepage } : {}),
      ...(company.businessAddress
        ? { businessAddress: projectAddress(company.businessAddress) }
        : {}),
      ...(company.postalAddress ? { postalAddress: projectAddress(company.postalAddress) } : {}),
    },
    location: profile.location
      ? {
          address: projectAddress(profile.location.address),
          matchConfidence: profile.location.matchConfidence,
        }
      : null,
    components,
  };

  const warnings = [...componentWarnings(components), ...tracker.warnings()];
  if (data.location && data.location.matchConfidence !== "exact") {
    warnings.push(
      `The coordinate match is "${data.location.matchConfidence}", not exact. Treat the position as approximate.`,
    );
  }

  const missing = missingSections(components);

  return buildEnvelope<Data>({
    data,
    responses: componentProvenance(response),
    warnings,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason: "One or more enrichment sections could not be retrieved.",
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const company = data.company;
  const lines = fields([
    ["Organization number", company.organizationNumber],
    ["Legal form", company.organizationForm],
    ["Industry", company.industry],
    ["Municipality", company.municipality],
    ["Employees", company.numberOfEmployees],
    ["Registered", company.registeredAt],
    ["Founded", company.foundedAt],
    ["VAT registered", company.vatRegistered === undefined ? undefined : company.vatRegistered],
    ["Bankruptcy", company.bankruptcy ? "yes" : undefined],
    ["Under liquidation", company.liquidation ? "yes" : undefined],
    ["Business address", company.businessAddress?.addressText],
    ["Homepage", company.homepage],
  ]);

  if (data.location) {
    const { latitude, longitude } = data.location.address;
    if (latitude !== undefined && longitude !== undefined) {
      lines.push(
        `  Coordinate: ${latitude}, ${longitude} (match: ${data.location.matchConfidence})`,
      );
    }
  }

  return renderWithEnvelope([company.name, ...lines].join("\n"), envelope);
}

export const companyProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_company_profile",
  title: "Get Norwegian company profile",
  description:
    "Get a detailed profile for ONE Norwegian organization using its exact nine-digit " +
    "organization number, combining the official company register (Brønnøysundregistrene) with " +
    "Kartverket's official address match for precise coordinates. Includes legal form, industry, " +
    "employee count, registration and founding dates, VAT status, and bankruptcy or liquidation " +
    "status. " +
    "Use this when you have a nine-digit organization number. " +
    "Do not use this when you only have a company name — call search_norwegian_companies first " +
    "to find the number. Do not use this for statistics about a municipality; that is " +
    "get_norwegian_municipality_profile.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
