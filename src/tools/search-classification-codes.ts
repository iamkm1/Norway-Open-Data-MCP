import { z } from "zod";
import type { KlassCode, OpenDataResponse } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  classificationIdSchema,
  isoDateSchema,
  klassLanguageSchema,
  limitSchema,
  osloToday,
} from "./shared/schemas.js";
import type { NorwayOpenDataLike, ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/**
 * Klass `selectCodes` syntax: an exact code, a `*` wildcard, a `-` range, or a
 * `,` list. A pattern containing none of `* - ,` is a single exact code, which
 * is looked up with the precise, efficient `getCode` endpoint instead of a
 * pattern search.
 */
function isExactCode(pattern: string): boolean {
  return !/[*\-,]/.test(pattern);
}

const inputSchema = z
  .object({
    classificationId: classificationIdSchema,
    /**
     * Klass code-pattern (`selectCodes`) syntax — an exact code (`0301`), a
     * wildcard (`25*`), a range (`01-05`) or a list (`01,03`). This is
     * code-pattern matching, NOT name or full-text search.
     */
    codePattern: z
      .string()
      .trim()
      .min(1, "codePattern must not be empty.")
      .max(64, "codePattern is too long.")
      .regex(
        /^[0-9A-Za-z.,*-]+$/,
        "codePattern may contain digits, letters, dots, commas, hyphens (ranges) and * (wildcard).",
      ),
    /** Codes valid on this date. Defaults to today (Europe/Oslo) when omitted. */
    date: isoDateSchema.optional(),
    /** Restrict to one hierarchy level, e.g. "1" for top-level codes. */
    level: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/, "level must be a small whole number such as 1 or 2.")
      .optional(),
    language: klassLanguageSchema,
    limit: limitSchema(DEFAULT_LIMIT, MAX_LIMIT),
  })
  .strict();

const codeSchema = z.object({
  code: z.string(),
  name: z.string(),
  level: z.string().optional(),
  parentCode: z.string().optional(),
  shortName: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});

const dataSchema = z.object({
  classificationId: z.number(),
  date: z.string(),
  language: z.enum(["nb", "nn", "en"]),
  codePattern: z.string(),
  level: z.string().optional(),
  /** How the lookup was performed: an exact code, or a pattern search. */
  mode: z.enum(["exact", "pattern"]),
  codes: z.array(codeSchema),
  /** Codes returned after this tool's own bound. */
  returnedCount: z.number(),
  /** Codes Klass reported as matching in total; may exceed `returnedCount`. */
  matchedCount: z.number(),
  /** True when Klass itself paged the upstream response, false when the SDK bounded it. */
  upstreamPaged: z.boolean().optional(),
});

type Data = z.infer<typeof dataSchema>;

function projectCode(code: KlassCode): z.infer<typeof codeSchema> {
  return {
    code: code.code,
    name: code.name,
    ...(code.level !== undefined ? { level: code.level } : {}),
    ...(code.parentCode !== undefined ? { parentCode: code.parentCode } : {}),
    ...(code.shortName !== undefined ? { shortName: code.shortName } : {}),
    ...(code.validFrom !== undefined ? { validFrom: code.validFrom } : {}),
    ...(code.validTo !== undefined ? { validTo: code.validTo } : {}),
  };
}

/** The SDK's not-found error is identified by name, since class identity is per-bundle. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

type LookupResult = {
  response: OpenDataResponse<unknown>;
  items: KlassCode[];
  matchedCount: number;
  upstreamPaged?: boolean;
};

/**
 * Exact single-code lookup via `getCode` — one precise, dated request. A
 * not-found code is not an error for a search: it falls back to a pattern
 * search for the same code purely to obtain an honestly attributed empty
 * result, since a not-found `getCode` yields no response envelope to cite.
 */
async function lookupExact(
  sdk: NorwayOpenDataLike,
  input: z.output<typeof inputSchema>,
  date: string,
  signal: AbortSignal,
): Promise<LookupResult> {
  try {
    const response = await sdk.klass.getCode(
      {
        classificationId: input.classificationId,
        code: input.codePattern,
        date,
        language: input.language,
      },
      { signal },
    );
    return { response, items: [response.data], matchedCount: 1 };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return searchPattern(sdk, input, date, signal);
  }
}

/** Code-pattern search via `searchCodes` with the official `selectCodes` syntax. */
async function searchPattern(
  sdk: NorwayOpenDataLike,
  input: z.output<typeof inputSchema>,
  date: string,
  signal: AbortSignal,
): Promise<LookupResult> {
  const response = await sdk.klass.searchCodes(
    {
      classificationId: input.classificationId,
      codePattern: input.codePattern,
      date,
      ...(input.level !== undefined ? { level: input.level } : {}),
      language: input.language,
      pageSize: input.limit,
    },
    { signal },
  );
  return {
    response,
    items: response.data.items,
    matchedCount: response.data.pagination.totalItems,
    upstreamPaged: response.data.pagination.upstreamPaged,
  };
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const date = input.date ?? osloToday(context.now());

  // An exact code with no level filter takes the precise getCode path; anything
  // with a wildcard, range, list or level goes through code-pattern search.
  const exact = isExactCode(input.codePattern) && input.level === undefined;
  const result = exact
    ? await lookupExact(sdk, input, date, signal)
    : await searchPattern(sdk, input, date, signal);

  const bounded = tracker.limitArray("codes", result.items, input.limit, result.matchedCount);
  const codes = bounded.map(projectCode);

  return buildEnvelope<Data>({
    data: {
      classificationId: input.classificationId,
      date,
      language: input.language,
      codePattern: input.codePattern,
      ...(input.level !== undefined ? { level: input.level } : {}),
      mode: exact ? "exact" : "pattern",
      codes,
      returnedCount: codes.length,
      matchedCount: result.matchedCount,
      ...(result.upstreamPaged !== undefined ? { upstreamPaged: result.upstreamPaged } : {}),
    },
    responses: [result.response],
    warnings: tracker.warnings(),
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const header =
    `Classification ${data.classificationId}, codes matching "${data.codePattern}"` +
    `${data.level ? ` at level ${data.level}` : ""} as of ${data.date} (${data.language})`;

  if (data.codes.length === 0) {
    return renderWithEnvelope(`${header}\n\nNo matching codes.`, envelope);
  }

  const lines = data.codes
    .map((code) => {
      const validity = code.validFrom
        ? ` [${code.validFrom}${code.validTo ? ` → ${code.validTo}` : " →"}]`
        : "";
      return `- ${code.code} — ${code.name}${code.level ? ` (level ${code.level})` : ""}${validity}`;
    })
    .join("\n");

  const countLine =
    data.matchedCount > data.returnedCount
      ? `Showing ${data.returnedCount} of ${data.matchedCount} matching code(s):`
      : `${data.returnedCount} matching code(s):`;

  return renderWithEnvelope(`${header}\n\n${countLine}\n${lines}`, envelope);
}

export const searchClassificationCodesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_norwegian_classification_codes",
  title: "Search codes in an official SSB Klass classification",
  description:
    "Look up codes in an official Statistics Norway (SSB) Klass classification by CODE PATTERN — an " +
    "exact code, a `*` wildcard, a `-` range or a `,` list. This is code-pattern search, NOT " +
    "name or full-text search: you cannot search by a place or category name here. " +
    "Give a numeric `classificationId` and a `codePattern`. Common classifications: 131 " +
    "municipalities, 104 counties, 6 industry (NACE/SN), 7 occupations (STYRK), 36 education. " +
    "Examples: municipality code 0301 in classification 131; occupation codes starting with 25 " +
    "via pattern 25* in classification 7; industry codes 01-05 in classification 6. " +
    "Results are the official code, name, hierarchy level and validity dates, bounded to a small " +
    "number (default 10, at most 20). " +
    "Do not use this to resolve whether a municipality or county code changed over time — that is " +
    "resolve_norwegian_administrative_code — or to query statistics tables, which is " +
    "query_norwegian_statistics.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
