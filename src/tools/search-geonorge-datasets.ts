import { z } from "zod";
import type { GeonorgeSearchParameters } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { GEONORGE_CATALOGUE_NOTE } from "./shared/geo.js";
import { searchQuerySchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const DEFAULT_LIMIT = 10;
/** Geonorge's own per-request ceiling is 100; this is the MCP-side cap. */
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000;

const inputSchema = z
  .object({
    query: searchQuerySchema("Search text", 2, 200)
      .optional()
      .describe("Free text matched against catalogue titles and abstracts."),
    publisher: z
      .string()
      .trim()
      .min(2, "Publisher must be at least 2 characters.")
      .max(200, "Publisher must be at most 200 characters.")
      .optional()
      .describe("Exact publishing-organization facet value, for example Kartverket."),
    theme: z
      .string()
      .trim()
      .min(2, "Theme must be at least 2 characters.")
      .max(100, "Theme must be at most 100 characters.")
      .optional()
      .describe("Exact Geonorge theme facet value, for example Miljø."),
    limit: z
      .number()
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
      .default(DEFAULT_LIMIT),
    offset: z
      .number()
      .int("Offset must be a whole number.")
      .min(0, "Offset is zero-based and cannot be negative.")
      .max(MAX_OFFSET, `Offset must be at most ${MAX_OFFSET}.`)
      .default(0),
  })
  .strict()
  .refine(
    (value) =>
      value.query !== undefined || value.publisher !== undefined || value.theme !== undefined,
    {
      message:
        "Provide at least one of query, publisher or theme. Listing the whole national catalogue is not supported.",
    },
  );

const accessSchema = z.object({
  isOpenData: z.boolean().optional(),
  isRestricted: z.boolean(),
  isProtected: z.boolean(),
  label: z.string().optional(),
});

const dataSchema = z.object({
  datasets: z.array(
    z.object({
      id: z.string().describe("Opaque catalogue identifier; pass to get_geonorge_metadata."),
      title: z.string(),
      description: z.string().optional(),
      publisher: z.string().optional(),
      themes: z.array(z.string()),
      /** Access flags, not the licence itself. Fetch the record for licence terms. */
      access: accessSchema,
      updatedAt: z.string().optional(),
      spatialScope: z.string().optional(),
    }),
  ),
  pagination: z.object({
    offset: z.number(),
    limit: z.number(),
    returned: z.number(),
    totalItems: z.number(),
    hasMore: z.boolean(),
  }),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const parameters: GeonorgeSearchParameters = {
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.publisher !== undefined ? { publisher: input.publisher } : {}),
    ...(input.theme !== undefined ? { theme: input.theme } : {}),
    offset: input.offset,
    limit: input.limit,
  };

  const response = await context.getSdk().geodata.searchDatasets(parameters, { signal });
  const result = response.data;

  const datasets = tracker
    .limitArray("datasets", result.items, input.limit, result.pagination.totalItems)
    .map((item, index) => ({
      id: item.id,
      title: item.title,
      ...(item.description !== undefined
        ? {
            description: tracker.clampString(
              `datasets[${index}].description`,
              item.description,
              400,
            ),
          }
        : {}),
      ...(item.publisher !== undefined ? { publisher: item.publisher } : {}),
      themes: [...item.themes],
      access: {
        ...(item.access.isOpenData !== undefined ? { isOpenData: item.access.isOpenData } : {}),
        isRestricted: item.access.isRestricted,
        isProtected: item.access.isProtected,
        ...(item.access.label !== undefined ? { label: item.access.label } : {}),
      },
      ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
      ...(item.spatialScope !== undefined ? { spatialScope: item.spatialScope } : {}),
    }));

  const warnings = [GEONORGE_CATALOGUE_NOTE, ...tracker.warnings()];
  if (datasets.some((dataset) => dataset.access.isRestricted || dataset.access.isProtected)) {
    warnings.push(
      "At least one matching dataset is restricted or protected. Its metadata is public; the data " +
        "behind it is not, and this server provides no route to it.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      datasets,
      pagination: {
        offset: result.pagination.offset,
        limit: result.pagination.limit,
        returned: result.pagination.returned,
        totalItems: result.pagination.totalItems,
        hasMore: result.pagination.hasMore,
      },
    },
    responses: [response],
    warnings,
    truncation: tracker.report(),
    continuation: result.pagination.hasMore
      ? {
          hasMore: true,
          nextArguments: { ...input, offset: input.offset + result.pagination.limit },
        }
      : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.datasets.length === 0) {
    return renderWithEnvelope(
      "No datasets in the Geonorge catalogue matched those filters. That is a statement about the " +
        "catalogue's metadata, not about whether such data exists.",
      envelope,
    );
  }

  const body = data.datasets
    .map((dataset) =>
      [
        `${dataset.title} — ${dataset.id}`,
        ...fields([
          ["Publisher", dataset.publisher],
          ["Themes", dataset.themes.join(", ")],
          [
            "Access",
            dataset.access.label ??
              (dataset.access.isRestricted || dataset.access.isProtected ? "restricted" : "open"),
          ],
          ["Updated", dataset.updatedAt],
          ["Scope", dataset.spatialScope],
        ]),
      ].join("\n"),
    )
    .join("\n\n");

  const header =
    `Showing ${data.datasets.length} of ${data.pagination.totalItems} catalogue record(s) ` +
    `from offset ${data.pagination.offset}.`;
  return renderWithEnvelope(`${header}\n\n${body}`, envelope);
}

export const searchGeonorgeDatasetsTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "search_geonorge_datasets",
  title: "Search the Geonorge dataset catalogue",
  description:
    "Search Geonorge, Norway's national catalogue of geospatial metadata, for datasets by free " +
    "text, publishing organization or theme, returning each record's identifier, publisher, " +
    "access flags and update date. Needs no credentials. " +
    "Use this when the user asks what Norwegian map or geodata exists about a subject, or who " +
    "publishes it. " +
    "Do not use this when the user wants the data itself rather than a description of it: this " +
    "returns catalogue metadata only, and this server neither downloads catalogued resources nor " +
    "accepts a service URL. For actual nature and land data at a place, use get_nature_profile.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
