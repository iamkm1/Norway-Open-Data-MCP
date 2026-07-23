import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, formatNumber, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  HAZARD_DISCLAIMER,
  componentSchema,
  componentWarnings,
  describeHazardMatches,
  hazardSchema,
  missingSections,
  projectComponents,
  projectHazard,
  renderHazardLines,
} from "./shared/profile.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const MAX_HAZARDS = 20;
const MAX_COMPONENTS = 20;

const inputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2, "Provide a four-digit municipality code or an exact municipality name.")
      .max(100, "Municipality query must be at most 100 characters.")
      .refine(
        (value) => /^\d{4}$/.test(value) || /^[^\d]+$/.test(value),
        "Provide either a four-digit municipality code (for example 0301) or a municipality name without digits (for example Tromsø).",
      ),
  })
  .strict();

const dataSchema = z.object({
  municipality: z.object({
    code: z.string(),
    name: z.string(),
    countyCode: z.string(),
  }),
  population: z
    .object({
      total: z.number(),
      year: z.string(),
      previousTotal: z.number().optional(),
      previousYear: z.string().optional(),
      change: z.number().optional(),
    })
    .nullable(),
  lifeExpectancy: z
    .object({
      years: z.number().nullable(),
      period: z.string(),
      measure: z.string(),
      flag: z.string().optional(),
      flagMeaning: z.string().optional(),
    })
    .nullable(),
  registeredCompanies: z.number().nullable(),
  hazards: z.array(hazardSchema),
  hazardMatchEvidence: z.array(z.string()),
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const response = await context.getSdk().profiles.municipality(input.query, { signal });
  const profile = response.data;

  const components = tracker.limitArray(
    "components",
    projectComponents(profile.components),
    MAX_COMPONENTS,
  );
  const hazards = tracker
    .limitArray("hazards", profile.hazards, MAX_HAZARDS)
    .map((warning, index) => projectHazard(warning, tracker, index));

  const data: Data = {
    municipality: profile.municipality,
    population: profile.population
      ? {
          total: profile.population.total,
          year: profile.population.year,
          ...(profile.population.previousTotal !== undefined
            ? { previousTotal: profile.population.previousTotal }
            : {}),
          ...(profile.population.previousYear !== undefined
            ? { previousYear: profile.population.previousYear }
            : {}),
          ...(profile.population.change !== undefined ? { change: profile.population.change } : {}),
        }
      : null,
    lifeExpectancy: profile.lifeExpectancy
      ? {
          years: profile.lifeExpectancy.years,
          period: profile.lifeExpectancy.period,
          measure: profile.lifeExpectancy.measure,
          ...(profile.lifeExpectancy.flag !== undefined
            ? { flag: profile.lifeExpectancy.flag }
            : {}),
          ...(profile.lifeExpectancy.flagMeaning !== undefined
            ? { flagMeaning: profile.lifeExpectancy.flagMeaning }
            : {}),
        }
      : null,
    registeredCompanies: profile.companies?.registered ?? null,
    hazards,
    hazardMatchEvidence: describeHazardMatches(profile.hazardMatches),
    components,
  };

  const warnings = [HAZARD_DISCLAIMER, ...componentWarnings(components), ...tracker.warnings()];

  // FHI suppresses small-count health cells. The SDK preserves the flag and
  // never reconstructs the number; neither do we, and the reason is stated
  // rather than presented as missing data.
  if (data.lifeExpectancy && data.lifeExpectancy.years === null) {
    warnings.push(
      `Life expectancy is not published for this municipality. FHI flagged the value as "${
        data.lifeExpectancy.flag ?? "suppressed"
      }"${
        data.lifeExpectancy.flagMeaning ? ` (${data.lifeExpectancy.flagMeaning})` : ""
      }. Suppressed health values must not be estimated or reconstructed.`,
    );
  }

  const missing = missingSections(components);

  return buildEnvelope<Data>({
    data,
    responses: [response],
    warnings,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason: "One or more agency sections could not be retrieved.",
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [];

  sections.push(
    [
      `${data.municipality.name} (municipality ${data.municipality.code}, county ${data.municipality.countyCode})`,
      ...fields([
        [
          "Population",
          data.population
            ? `${formatNumber(data.population.total)} (${data.population.year})`
            : undefined,
        ],
        [
          "Change since previous year",
          data.population?.change !== undefined
            ? `${data.population.change > 0 ? "+" : ""}${formatNumber(data.population.change)}`
            : undefined,
        ],
        [
          "Life expectancy at birth",
          data.lifeExpectancy
            ? data.lifeExpectancy.years === null
              ? `not published (${data.lifeExpectancy.flag ?? "suppressed"})`
              : `${data.lifeExpectancy.years} years (${data.lifeExpectancy.period})`
            : undefined,
        ],
        [
          "Registered organizations",
          data.registeredCompanies !== null ? formatNumber(data.registeredCompanies) : undefined,
        ],
      ]),
    ].join("\n"),
  );

  sections.push(`Hazard warnings matching this municipality:\n${renderHazardLines(data.hazards)}`);

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const municipalityProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_municipality_profile",
  title: "Get Norwegian municipality profile",
  description:
    "Get a cross-agency profile for ONE Norwegian municipality (kommune) by its four-digit code " +
    "or exact name: population totals and year-over-year change from Statistics Norway (SSB), " +
    "life expectancy at birth from the Institute of Public Health (FHI), the number of registered " +
    "organizations, and current NVE hazard warnings matching the municipality. " +
    "Use this when the user asks about a municipality as a place — how many people live there, " +
    "how it is changing, or its health and business profile. " +
    "Do not use this when the user wants a specific statistics table or a custom breakdown by " +
    "age, sex or year — that is query_norwegian_statistics. Do not use this for a street address " +
    "inside the municipality; that is get_norwegian_location_profile.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
