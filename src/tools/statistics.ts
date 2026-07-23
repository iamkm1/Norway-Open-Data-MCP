import { z } from "zod";
import type { OpenDataResponse, StatisticsDimension } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { languageSchema, limitSchema, tableIdSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_ROWS = 100;
const MAX_ROWS = 500;
const MAX_DIMENSIONS = 20;
const MAX_DIMENSION_VALUES = 100;
const MAX_SELECTION_DIMENSIONS = 10;
const MAX_SELECTION_VALUES = 50;

const inputSchema = z
  .object({
    tableId: tableIdSchema,
    /**
     * Omitted on the discovery call. Present on the data call.
     *
     * Value codes are table-specific and must come from a prior discovery call —
     * they cannot be guessed, and SSB rejects invalid ones.
     */
    selections: z
      .record(
        z.string().trim().min(1).max(64),
        z
          .array(z.string().trim().min(1).max(32))
          .min(1, "Each dimension needs at least one value code.")
          .max(MAX_SELECTION_VALUES, `At most ${MAX_SELECTION_VALUES} value codes per dimension.`),
      )
      .refine(
        (value) => Object.keys(value).length <= MAX_SELECTION_DIMENSIONS,
        `At most ${MAX_SELECTION_DIMENSIONS} dimensions can be selected at once.`,
      )
      .optional(),
    language: languageSchema,
    limit: limitSchema(DEFAULT_ROWS, MAX_ROWS),
  })
  .strict();

const dimensionSchema = z.object({
  code: z.string(),
  label: z.string().optional(),
  valueCount: z.number(),
  values: z.array(z.object({ code: z.string(), label: z.string().optional() })),
});

const dataSchema = z.object({
  tableId: z.string(),
  title: z.string().optional(),
  updatedAt: z.string().optional(),
  mode: z.enum(["metadata", "data"]),
  dimensions: z.array(dimensionSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  rowCount: z.number(),
  dimensionCount: z.number(),
});

type Data = z.infer<typeof dataSchema>;

function projectDimensions(
  dimensions: readonly StatisticsDimension[],
  tracker: TruncationTracker,
): z.infer<typeof dimensionSchema>[] {
  const limited = tracker.limitArray("dimensions", dimensions, MAX_DIMENSIONS);
  return limited.map((dimension) => ({
    code: dimension.code,
    ...(dimension.label !== undefined ? { label: dimension.label } : {}),
    valueCount: dimension.values.length,
    // A dimension such as "region" has hundreds of codes. The full list is
    // rarely needed and would dominate the payload, so it is capped and the
    // true count is kept in `valueCount`.
    values: tracker
      .limitArray(`dimensions.${dimension.code}.values`, dimension.values, MAX_DIMENSION_VALUES)
      .map((value) => ({
        code: value.code,
        ...(value.label !== undefined ? { label: value.label } : {}),
      })),
  }));
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const responses: OpenDataResponse<unknown>[] = [];

  // Discovery call: no selections means the caller does not yet know the table's
  // value codes. One provider request, and the result tells the model exactly
  // how to make the follow-up data call.
  if (input.selections === undefined) {
    const response = await sdk.statistics.getTableMetadata(input.tableId, { signal });
    responses.push(response);
    const metadata = response.data;
    const dimensions = projectDimensions(metadata.dimensions, tracker);

    return buildEnvelope<Data>({
      data: {
        tableId: metadata.tableId,
        ...(metadata.title !== undefined ? { title: metadata.title } : {}),
        ...(metadata.updatedAt !== undefined ? { updatedAt: metadata.updatedAt } : {}),
        mode: "metadata",
        dimensions,
        rows: [],
        rowCount: 0,
        dimensionCount: metadata.dimensions.length,
      },
      responses,
      warnings: [
        "No data was requested. This response describes the table's dimensions and their valid " +
          "value codes. Call this tool again with `selections` — an object mapping each dimension " +
          "code to an array of value codes from the lists above — to retrieve the actual numbers.",
        ...tracker.warnings(),
      ],
      truncation: tracker.report(),
    });
  }

  const response = await sdk.statistics.query(
    {
      tableId: input.tableId,
      selections: input.selections,
      language: input.language,
    },
    { signal },
  );
  responses.push(response);

  const result = response.data;
  const rows = tracker.limitArray("rows", result.rows, input.limit);

  return buildEnvelope<Data>({
    data: {
      tableId: result.tableId,
      ...(result.title !== undefined ? { title: result.title } : {}),
      ...(result.updatedAt !== undefined ? { updatedAt: result.updatedAt } : {}),
      mode: "data",
      dimensions: projectDimensions(result.dimensions, tracker),
      rows,
      rowCount: rows.length,
      dimensionCount: result.dimensions.length,
    },
    responses,
    warnings: tracker.warnings(),
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const header = `SSB table ${data.tableId}${data.title ? `: ${data.title}` : ""}${
    data.updatedAt ? ` (updated ${data.updatedAt})` : ""
  }`;

  if (data.mode === "metadata") {
    const dimensions = data.dimensions
      .map((dimension) => {
        const sample = dimension.values
          .slice(0, 8)
          .map((value) => `${value.code}${value.label ? ` (${value.label})` : ""}`)
          .join(", ");
        const more =
          dimension.valueCount > dimension.values.length
            ? `, … ${dimension.valueCount - dimension.values.length} more`
            : "";
        return `- ${dimension.code}${dimension.label ? ` — ${dimension.label}` : ""}: ${dimension.valueCount} value(s). Examples: ${sample}${more}`;
      })
      .join("\n");

    return renderWithEnvelope(
      `${header}\n\nDimensions (${data.dimensionCount}):\n${dimensions}\n\nCall this tool again with \`selections\` to fetch data.`,
      envelope,
    );
  }

  if (data.rows.length === 0) {
    return renderWithEnvelope(`${header}\n\nThe selection returned no observations.`, envelope);
  }

  const columns = Object.keys(data.rows[0] ?? {});
  const preview = data.rows
    .slice(0, 25)
    .map((row) => `- ${columns.map((column) => `${column}=${String(row[column])}`).join(", ")}`)
    .join("\n");
  const more =
    data.rows.length > 25
      ? `\n… and ${data.rows.length - 25} more rows in the structured result.`
      : "";

  return renderWithEnvelope(`${header}\n\n${data.rowCount} row(s):\n${preview}${more}`, envelope);
}

export const statisticsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "query_norwegian_statistics",
  title: "Query Statistics Norway (SSB) tables",
  description:
    "Query a Statistics Norway (SSB) table by its table ID. Call it WITHOUT `selections` first to " +
    "discover the table's dimensions and the valid value codes for each one, then call it again " +
    "WITH `selections` to retrieve the actual numbers. Value codes are specific to each table and " +
    "must be discovered — they cannot be guessed. " +
    "Use this when the user wants specific Norwegian statistics such as population by age, " +
    "employment, prices or education, and you know or can ask for the SSB table ID. " +
    "Do not use this when a ready-made profile already answers the question: municipality " +
    "population and life expectancy come from get_norwegian_municipality_profile in a single " +
    "call. Do not use this for electricity spot prices " +
    "(get_norwegian_electricity_prices) or for company data (search_norwegian_companies).",
  inputSchema,
  dataSchema,
  handler,
  render,
};
