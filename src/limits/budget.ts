/**
 * Output budgets.
 *
 * An AI model must not be able to pull thousands of records into a context
 * window, and a provider shape change must not be able to either. Every list a
 * tool returns passes through here.
 *
 * The governing rule: **truncation is never silent**. Every reduction is
 * recorded structurally in `TruncationReport` and rendered as prose in the
 * result's warnings, so a model can tell "these are all the results" from
 * "these are the first ten of 214".
 */

import { ResultTooLargeError } from "../errors/map.js";

export const BUDGET = {
  /** Ceiling on the serialized `structuredContent` payload. */
  maxSerializedChars: 120_000,
  /** Ceiling on the rendered text block, which is a summary rather than a copy. */
  maxTextChars: 16_000,
  /** Ceiling on any single string field, e.g. a hazard description. */
  maxStringChars: 1_000,
  /** Backstop for any array a tool forgot to cap explicitly. */
  maxArrayItems: 100,
} as const;

export type TruncationEntry = {
  field: string;
  returned: number;
  availableUpstream?: number;
  reason: "limit" | "budget" | "backstop";
};

export type TruncationReport = {
  truncated: boolean;
  fields: TruncationEntry[];
};

/** Accumulates truncation events across one tool invocation. */
export class TruncationTracker {
  readonly #entries: TruncationEntry[] = [];

  /**
   * Applies a hard item cap, preserving provider order and taking the leading
   * slice so repeated identical calls return identical results.
   */
  limitArray<T>(
    field: string,
    items: readonly T[],
    limit: number,
    availableUpstream?: number,
  ): T[] {
    const effectiveLimit = Math.max(0, Math.min(limit, BUDGET.maxArrayItems));
    const total = availableUpstream ?? items.length;

    if (items.length <= effectiveLimit) {
      // Upstream may still hold more than this page returned.
      if (availableUpstream !== undefined && availableUpstream > items.length) {
        this.#entries.push({
          field,
          returned: items.length,
          availableUpstream,
          reason: "limit",
        });
      }
      return [...items];
    }

    this.#entries.push({
      field,
      returned: effectiveLimit,
      availableUpstream: total,
      reason: items.length > BUDGET.maxArrayItems ? "backstop" : "limit",
    });
    return items.slice(0, effectiveLimit);
  }

  /**
   * Clamps a single string, appending an ellipsis so the cut is visible.
   *
   * `limit` is annotated `number` deliberately: `BUDGET` is `as const`, so an
   * inferred default would give the parameter the literal type `1000` and no
   * other limit could ever be passed.
   */
  clampString(field: string, value: string, limit: number = BUDGET.maxStringChars): string {
    if (value.length <= limit) return value;
    this.#entries.push({
      field,
      returned: limit,
      availableUpstream: value.length,
      reason: "limit",
    });
    return `${value.slice(0, limit - 1)}…`;
  }

  /** Records a reduction performed elsewhere, e.g. by the size guard. */
  record(entry: TruncationEntry): void {
    this.#entries.push(entry);
  }

  get entries(): readonly TruncationEntry[] {
    return this.#entries;
  }

  report(): TruncationReport | null {
    if (this.#entries.length === 0) return null;
    return { truncated: true, fields: [...this.#entries] };
  }

  /** Prose forms of each truncation, appended to the result's warnings. */
  warnings(): string[] {
    return this.#entries.map((entry) => {
      const of =
        entry.availableUpstream !== undefined ? ` of ${entry.availableUpstream} available` : "";
      return entry.reason === "budget"
        ? `Result truncated to fit the output budget: "${entry.field}" reduced to ${entry.returned} items${of}.`
        : `Showing ${entry.returned}${of} for "${entry.field}". Narrow the query or raise the limit to see more.`;
    });
  }
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Final guard applied after per-tool limits.
 *
 * Progressively halves the largest array in the payload until the serialized
 * form fits, recording each reduction. Only top-level `data` arrays are
 * reduced; scalar and object fields are left intact so the result keeps its
 * shape and its attribution.
 */
export function enforceSerializedBudget<T extends Record<string, unknown>>(
  payload: T,
  onReduce: (entry: TruncationEntry) => void,
  maxChars: number = BUDGET.maxSerializedChars,
): T {
  if (serializedLength(payload) <= maxChars) return payload;

  const data = payload["data"];
  if (typeof data !== "object" || data === null) {
    throw new ResultTooLargeError(
      "The provider returned more data than this tool can safely return, and it could not be reduced.",
    );
  }

  const working: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const reduced = new Map<string, number>();

  for (let pass = 0; pass < 12; pass += 1) {
    const next = { ...payload, data: working };
    if (serializedLength(next) <= maxChars) {
      for (const [field, returned] of reduced) {
        onReduce({ field, returned, reason: "budget" });
      }
      return next;
    }

    let largestKey: string | undefined;
    let largestSize = 0;
    for (const [key, value] of Object.entries(working)) {
      if (!Array.isArray(value) || value.length <= 1) continue;
      const size = serializedLength(value);
      if (size > largestSize) {
        largestSize = size;
        largestKey = key;
      }
    }

    if (largestKey === undefined) break;
    const current = working[largestKey] as unknown[];
    const nextLength = Math.max(1, Math.floor(current.length / 2));
    working[largestKey] = current.slice(0, nextLength);
    reduced.set(largestKey, nextLength);
  }

  throw new ResultTooLargeError(
    "The provider returned more data than this tool can safely return. Request a narrower selection or a smaller limit.",
  );
}

/** Clamps the rendered text block, marking the cut. */
export function clampText(text: string, maxChars: number = BUDGET.maxTextChars): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 60)}\n… output truncated to fit the text budget.`;
}
