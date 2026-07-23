import { z } from "zod";
import type {
  HazardWarning,
  HazardWarningParameters,
  OpenDataResponse,
} from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  daysBetween,
  isoDateSchema,
  languageSchema,
  limitSchema,
  osloToday,
} from "./shared/schemas.js";
import {
  HAZARD_DISCLAIMER,
  hazardSchema,
  projectHazard,
  renderHazardLines,
} from "./shared/profile.js";
import type { NorwayOpenDataLike, ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_RANGE_DAYS = 14;

const hazardTypeSchema = z.enum(["flood", "avalanche", "landslide"]);
type HazardType = z.infer<typeof hazardTypeSchema>;

const inputSchema = z
  .object({
    types: z
      .array(hazardTypeSchema)
      .min(1, "Request at least one hazard type.")
      .max(3, "There are only three hazard types.")
      .refine((value) => new Set(value).size === value.length, "Hazard types must be unique.")
      .default(["flood", "avalanche", "landslide"]),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    language: languageSchema,
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
  })
  .strict()
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      daysBetween(value.startDate, value.endDate) >= 0,
    { message: "endDate must be on or after startDate.", path: ["endDate"] },
  )
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      daysBetween(value.startDate, value.endDate) <= MAX_RANGE_DAYS,
    {
      message: `The date range must not exceed ${MAX_RANGE_DAYS} days.`,
      path: ["endDate"],
    },
  );

const dataSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  warnings: z.array(hazardSchema),
  countsByType: z.record(z.string(), z.number()),
  requestedTypes: z.array(z.string()),
  failedTypes: z.array(z.string()),
});

type Data = z.infer<typeof dataSchema>;

const FETCHERS: Record<
  HazardType,
  (
    sdk: NorwayOpenDataLike,
    parameters: HazardWarningParameters,
    signal: AbortSignal,
  ) => Promise<OpenDataResponse<HazardWarning[]>>
> = {
  flood: (sdk, parameters, signal) => sdk.hazards.getFloodWarnings(parameters, { signal }),
  avalanche: (sdk, parameters, signal) => sdk.hazards.getAvalancheWarnings(parameters, { signal }),
  landslide: (sdk, parameters, signal) => sdk.hazards.getLandslideWarnings(parameters, { signal }),
};

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();

  const startDate = input.startDate ?? osloToday(context.now());
  const endDate = input.endDate ?? startDate;

  const parameters: HazardWarningParameters = {
    startDate,
    endDate,
    language: input.language,
  };

  // The three feeds are independent. One failing must not discard the other
  // two: for a safety-adjacent tool, "flood warnings unavailable" alongside
  // real avalanche warnings is far more useful than a single generic failure.
  const settled = await Promise.allSettled(
    input.types.map((type) => FETCHERS[type](sdk, parameters, signal)),
  );

  const responses: OpenDataResponse<HazardWarning[]>[] = [];
  const collected: HazardWarning[] = [];
  const failedTypes: string[] = [];
  const countsByType: Record<string, number> = {};

  for (const [index, outcome] of settled.entries()) {
    const type = input.types[index] as HazardType;
    if (outcome.status === "fulfilled") {
      responses.push(outcome.value);
      collected.push(...outcome.value.data);
      countsByType[type] = outcome.value.data.length;
    } else {
      failedTypes.push(type);
      countsByType[type] = 0;
      context.logger.warn("A hazard feed failed; continuing with the remaining feeds.", {
        type,
      });
    }
  }

  // Every feed failed: there is nothing to report, so surface the real error
  // rather than an empty list that would read as "no warnings".
  if (responses.length === 0) {
    const firstRejection = settled.find((outcome) => outcome.status === "rejected");
    throw firstRejection && firstRejection.status === "rejected"
      ? firstRejection.reason
      : new Error("No hazard feed returned a response.");
  }

  const limited = tracker.limitArray("warnings", collected, input.limit);

  const warnings = [HAZARD_DISCLAIMER, ...tracker.warnings()];
  if (failedTypes.length > 0) {
    warnings.push(
      `These hazard types could not be retrieved and are missing from the result: ${failedTypes.join(", ")}. This is a partial result, not an all-clear for those types.`,
    );
  }

  return buildEnvelope<Data>({
    data: {
      startDate,
      endDate,
      warnings: limited.map((warning, index) => projectHazard(warning, tracker, index)),
      countsByType,
      requestedTypes: [...input.types],
      failedTypes,
    },
    responses,
    warnings,
    truncation: tracker.report(),
    partial:
      failedTypes.length > 0
        ? {
            complete: false,
            missing: failedTypes,
            reason: "One or more NVE warning feeds failed.",
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const header =
    data.startDate === data.endDate
      ? `NVE hazard warnings for ${data.startDate}`
      : `NVE hazard warnings for ${data.startDate} to ${data.endDate}`;
  const counts = Object.entries(data.countsByType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  return renderWithEnvelope(
    `${header} (${counts}).\n\n${renderHazardLines(data.warnings)}`,
    envelope,
  );
}

export const hazardsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_current_norwegian_hazards",
  title: "Get current Norwegian hazard warnings",
  description:
    "Get official NVE (Varsom) natural-hazard warnings for Norway — flood, avalanche and " +
    "landslide — for a date or a short date range. These are safety warnings issued by " +
    "authorities, not a weather forecast. " +
    "Use this when the user asks about danger, risk levels, warnings, flood (flom), avalanche " +
    "(snøskred), landslide (jordskred) or Varsom. " +
    "Do not use this when the user wants temperature, rain or wind — that is " +
    "get_norwegian_weather_forecast. For warnings tied to one specific street address, " +
    "get_norwegian_location_profile matches warnings to that address's administrative area. " +
    "Results are never an all-clear: direct users to varsom.no for safety decisions.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
