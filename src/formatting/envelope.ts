/**
 * The common result envelope.
 *
 * Every tool returns the same outer shape, so a client can read attribution,
 * freshness, truncation and partial-result state uniformly without knowing
 * which tool produced the payload.
 *
 * All provenance fields are copied from the SDK's `OpenDataResponse`. Nothing
 * here is invented: if the SDK does not report it, it is not in the envelope.
 */

import { z } from "zod";
import type { OpenDataResponse, OpenDataSource } from "norway-open-data-sdk";
import type { TruncationReport } from "../limits/budget.js";

export type EnvelopeSource = {
  id: string;
  name: string;
  homepage: string;
  documentation: string;
  license?: string;
  attribution?: string;
};

export type PartialReport = {
  complete: boolean;
  missing: string[];
  reason: string;
};

export type Continuation = {
  hasMore: boolean;
  nextArguments: Record<string, unknown>;
};

export type Envelope<TData> = {
  data: TData;
  sources: EnvelopeSource[];
  retrievedAt: string;
  cached: boolean;
  warnings: string[];
  truncation: TruncationReport | null;
  partial: PartialReport | null;
  continuation: Continuation | null;
};

export const sourceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    homepage: z.string(),
    documentation: z.string(),
    license: z.string().optional(),
    attribution: z.string().optional(),
  })
  .describe("Official provider of this data, with its licence and attribution requirements.");

export const truncationSchema = z
  .object({
    truncated: z.boolean(),
    fields: z.array(
      z.object({
        field: z.string(),
        returned: z.number(),
        availableUpstream: z.number().optional(),
        reason: z.enum(["limit", "budget", "backstop"]),
      }),
    ),
  })
  .nullable()
  .describe("Non-null when results were shortened. Truncation is never silent.");

export const partialSchema = z
  .object({
    complete: z.boolean(),
    missing: z.array(z.string()),
    reason: z.string(),
  })
  .nullable()
  .describe("Non-null when some requested section could not be retrieved.");

export const continuationSchema = z
  .object({
    hasMore: z.boolean(),
    nextArguments: z.record(z.string(), z.unknown()),
  })
  .nullable()
  .describe("When present, arguments to pass back to this same tool for the next page.");

/**
 * Builds the output schema for a tool by wrapping its data schema in the
 * shared envelope fields. Passed to `registerTool` as `outputSchema`, so the
 * MCP SDK validates every result we emit against it.
 */
export function envelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return {
    data: dataSchema,
    sources: z.array(sourceSchema),
    retrievedAt: z.string().describe("ISO-8601 timestamp of the SDK retrieval."),
    cached: z.boolean().describe("True when every underlying response came from the local cache."),
    warnings: z.array(z.string()),
    truncation: truncationSchema,
    partial: partialSchema,
    continuation: continuationSchema,
  };
}

function toEnvelopeSource(source: OpenDataSource): EnvelopeSource {
  return {
    id: source.id,
    name: source.name,
    homepage: source.homepage,
    documentation: source.documentation,
    ...(source.license !== undefined ? { license: source.license } : {}),
    ...(source.attribution !== undefined ? { attribution: source.attribution } : {}),
  };
}

/**
 * Collects provenance across one or more SDK responses.
 *
 * `retrievedAt` takes the newest value; `cached` is true only when *every*
 * contributing response was cached, so a composed tool cannot claim freshness
 * it does not have.
 */
export function mergeProvenance(responses: readonly OpenDataResponse<unknown>[]): {
  sources: EnvelopeSource[];
  retrievedAt: string;
  cached: boolean;
} {
  const byId = new Map<string, EnvelopeSource>();
  let retrievedAt = "";
  let cached = responses.length > 0;

  for (const response of responses) {
    if (!byId.has(response.source.id)) {
      byId.set(response.source.id, toEnvelopeSource(response.source));
    }
    if (response.retrievedAt > retrievedAt) retrievedAt = response.retrievedAt;
    if (!response.cached) cached = false;
  }

  return {
    sources: [...byId.values()],
    retrievedAt: retrievedAt || new Date().toISOString(),
    cached,
  };
}

export type BuildEnvelopeInput<TData> = {
  data: TData;
  responses: readonly OpenDataResponse<unknown>[];
  warnings?: readonly string[];
  truncation?: TruncationReport | null;
  partial?: PartialReport | null;
  continuation?: Continuation | null;
};

export function buildEnvelope<TData>(input: BuildEnvelopeInput<TData>): Envelope<TData> {
  const provenance = mergeProvenance(input.responses);
  return {
    data: input.data,
    sources: provenance.sources,
    retrievedAt: provenance.retrievedAt,
    cached: provenance.cached,
    warnings: [...(input.warnings ?? [])],
    truncation: input.truncation ?? null,
    partial: input.partial ?? null,
    continuation: input.continuation ?? null,
  };
}
