import { z } from "zod";
import type {
  KlassCodeChange,
  KlassCodeResolution,
  KlassCodeResolutionMatch,
  KlassResolveAdministrativeCodeParameters,
} from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { isoDateSchema, klassLanguageSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

/**
 * Administrative reorganisations are small: a municipal merge joins a handful of
 * old codes, a split produces a few. These caps are backstops that real data
 * never reaches, and any reduction is still reported — a multi-branch result is
 * never silently collapsed to a single code.
 */
const MAX_MATCHES = 50;
const MAX_RELATED = 50;
const MAX_CHANGES = 50;

/** The eight official Klass resolution statuses, preserved verbatim. */
const STATUS_VALUES = [
  "unchanged",
  "renamed",
  "replaced",
  "merged",
  "split",
  "ambiguous",
  "not_found",
  "context_required",
] as const;

/**
 * Statuses where more than one official code participates, or where the caller
 * must supply more context. The model must not treat these as a single answer.
 */
const NON_DETERMINISTIC_STATUSES = new Set(["merged", "split", "ambiguous", "context_required"]);

const inputSchema = z
  .object({
    kind: z.enum(["municipality", "county"], {
      message: 'kind must be either "municipality" or "county".',
    }),
    code: z
      .string()
      .trim()
      .min(1, "code must not be empty.")
      .max(8, "code is too long to be an administrative code."),
    /** Klass requires the target date; the resolution is always "as of" a date. */
    targetDate: isoDateSchema,
    /**
     * Optional. Klass needs it only when the input code cannot be assigned to a
     * single historical version unambiguously; supplying it otherwise is
     * harmless. Never required merely to match a fixed shape.
     */
    sourceDate: isoDateSchema.optional(),
    language: klassLanguageSchema,
  })
  .strict()
  // Code format depends on kind. Both are validated here, before any request,
  // so an impossible kind/code combination never reaches the provider.
  .refine((value) => value.kind !== "municipality" || /^\d{4}$/.test(value.code), {
    message: "A municipality code must be exactly four digits, for example 1142.",
    path: ["code"],
  })
  .refine((value) => value.kind !== "county" || /^\d{2}$/.test(value.code), {
    message: "A county code must be exactly two digits, for example 11.",
    path: ["code"],
  });

const matchSchema = z.object({
  code: z.string(),
  name: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});

const changeSchema = z.object({
  oldCode: z.string().optional(),
  oldName: z.string().optional(),
  newCode: z.string().optional(),
  newName: z.string().optional(),
  occurredAt: z.string(),
});

const dataSchema = z.object({
  kind: z.enum(["municipality", "county"]),
  input: z.object({
    code: z.string(),
    sourceDate: z.string().optional(),
    targetDate: z.string(),
  }),
  status: z.enum(STATUS_VALUES),
  /** The input code as it stood on the source side, when Klass could identify it. */
  sourceCode: matchSchema.optional(),
  /** Every candidate valid on the target date. Never reduced to one automatically. */
  matches: z.array(matchSchema),
  /** How many candidates there are in total, even if the list above was bounded. */
  matchCount: z.number(),
  /** Other codes on the older side of the mapping (e.g. the parts of a merge). */
  predecessors: z.array(matchSchema),
  /** Other codes on the newer side of the mapping (e.g. the parts of a split). */
  successors: z.array(matchSchema),
  /** Chronological official change edges supporting the result. */
  changes: z.array(changeSchema),
});

type Data = z.infer<typeof dataSchema>;

function projectMatch(match: KlassCodeResolutionMatch): z.infer<typeof matchSchema> {
  return {
    code: match.code,
    name: match.name,
    ...(match.validFrom !== undefined ? { validFrom: match.validFrom } : {}),
    ...(match.validTo !== undefined ? { validTo: match.validTo } : {}),
  };
}

function projectChange(change: KlassCodeChange): z.infer<typeof changeSchema> {
  return {
    ...(change.oldCode !== undefined ? { oldCode: change.oldCode } : {}),
    ...(change.oldName !== undefined ? { oldName: change.oldName } : {}),
    ...(change.newCode !== undefined ? { newCode: change.newCode } : {}),
    ...(change.newName !== undefined ? { newName: change.newName } : {}),
    occurredAt: change.occurredAt,
  };
}

/** Standing caution attached to any non-deterministic status. */
function ambiguityNote(status: KlassCodeResolution["status"]): string | undefined {
  if (!NON_DETERMINISTIC_STATUSES.has(status)) return undefined;
  return (
    `This resolution is "${status}": more than one official outcome is possible, or Klass needs ` +
    "more context. Every official candidate is listed and none was chosen for you. Administrative " +
    "correspondence does not prove that statistics for these areas are comparable — a merge, split " +
    "or ambiguous mapping requires application or human judgement before figures are combined."
  );
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();

  const parameters: KlassResolveAdministrativeCodeParameters = {
    code: input.code,
    targetDate: input.targetDate,
    ...(input.sourceDate !== undefined ? { sourceDate: input.sourceDate } : {}),
    language: input.language,
  };

  const response =
    input.kind === "municipality"
      ? await sdk.klass.resolveMunicipalityCode(parameters, { signal })
      : await sdk.klass.resolveCountyCode(parameters, { signal });

  const resolution = response.data;

  const matches = tracker.limitArray("matches", resolution.matches, MAX_MATCHES).map(projectMatch);
  const predecessors = tracker
    .limitArray("predecessors", resolution.predecessors, MAX_RELATED)
    .map(projectMatch);
  const successors = tracker
    .limitArray("successors", resolution.successors, MAX_RELATED)
    .map(projectMatch);
  const changes = tracker.limitArray("changes", resolution.changes, MAX_CHANGES).map(projectChange);

  const warnings = [...resolution.warnings, ...tracker.warnings()];
  const note = ambiguityNote(resolution.status);
  if (note) warnings.push(note);

  return buildEnvelope<Data>({
    data: {
      kind: resolution.kind,
      input: {
        code: resolution.input.code,
        ...(resolution.input.sourceDate !== undefined
          ? { sourceDate: resolution.input.sourceDate }
          : {}),
        targetDate: resolution.input.targetDate,
      },
      status: resolution.status,
      ...(resolution.sourceCode !== undefined
        ? { sourceCode: projectMatch(resolution.sourceCode) }
        : {}),
      matches,
      matchCount: resolution.matches.length,
      predecessors,
      successors,
      changes,
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function renderMatches(label: string, matches: readonly z.infer<typeof matchSchema>[]): string {
  if (matches.length === 0) return "";
  const lines = matches
    .map((match) => {
      const validity = match.validFrom
        ? ` [${match.validFrom}${match.validTo ? ` → ${match.validTo}` : " →"}]`
        : "";
      return `  - ${match.code} — ${match.name}${validity}`;
    })
    .join("\n");
  return `${label}:\n${lines}`;
}

function render(data: Data, envelope: Envelope<Data>): string {
  const kindLabel = data.kind === "municipality" ? "Municipality" : "County";
  const sourceLine = data.sourceCode
    ? `${data.sourceCode.code} — ${data.sourceCode.name}`
    : data.input.code;

  const sections = [
    `${kindLabel} code ${data.input.code} as of ${data.input.targetDate}` +
      `${data.input.sourceDate ? ` (from ${data.input.sourceDate})` : ""}`,
    `Status: ${data.status}. Source: ${sourceLine}.`,
    `Candidates on the target date (${data.matchCount}):`,
  ];

  if (data.matches.length > 0) {
    sections.push(
      data.matches
        .map((match) => {
          const validity = match.validFrom
            ? ` [${match.validFrom}${match.validTo ? ` → ${match.validTo}` : " →"}]`
            : "";
          return `- ${match.code} — ${match.name}${validity}`;
        })
        .join("\n"),
    );
  } else {
    sections.push("- (none)");
  }

  const related = [
    renderMatches("Predecessors", data.predecessors),
    renderMatches("Successors", data.successors),
  ].filter((section) => section.length > 0);

  return renderWithEnvelope([...sections, ...related].join("\n\n"), envelope);
}

export const resolveAdministrativeCodeTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "resolve_norwegian_administrative_code",
  title: "Resolve a Norwegian municipality or county code across reforms",
  description:
    "Resolve a Norwegian municipality (kommune) or county (fylke) NUMBER across official SSB Klass " +
    "boundary changes: renames, replacements, merges and splits. " +
    "Use this when a code may be historical or reorganised — for example: what replaced " +
    "municipality 1142? Is county code 12 still current? Which of today's municipalities cover an " +
    "old code, and was the change a rename, a merge or a split? " +
    "You give a `kind` (municipality or county), the `code`, and a `targetDate` to resolve it as of; " +
    "add `sourceDate` only if asked to, when the code is ambiguous across history. " +
    "The result keeps the official status verbatim (unchanged, renamed, replaced, merged, split, " +
    "ambiguous, not_found, context_required) and lists EVERY candidate — for a merge or split it " +
    "returns all participating codes and never picks one for you. Administrative correspondence is " +
    "not proof of statistical comparability, and this tool never combines populations or other " +
    "figures. " +
    "Do not use this to look up a code's name from a code list (that is " +
    "search_norwegian_classification_codes) or to fetch municipality statistics (that is " +
    "get_norwegian_municipality_profile).",
  inputSchema,
  dataSchema,
  handler,
  render,
};
