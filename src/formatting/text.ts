/**
 * Deterministic text rendering.
 *
 * Some MCP clients show only `content[0].text`. That block is a readable
 * summary — never a second serialization of the whole payload — and it always
 * carries the same provenance and caveats as the structured form, so a
 * text-only client is not shown a more confident answer than a structured one.
 *
 * Rendering is pure and deterministic: the same data always produces the same
 * string, which is what makes the text form testable.
 */

import type { Envelope } from "./envelope.js";
import { clampText } from "../limits/budget.js";

export function formatNumber(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A value that has a meaningful string form. Objects are deliberately excluded. */
export type FieldValue = string | number | boolean | undefined | null;

/**
 * Renders `key: value` lines, skipping entries with nothing to show.
 *
 * The value type is restricted to primitives so an object can never reach here
 * and render as `[object Object]`; callers project their own summaries first.
 */
export function fields(entries: readonly (readonly [string, FieldValue])[]): string[] {
  const lines: string[] = [];
  for (const [label, value] of entries) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`  ${label}: ${String(value)}`);
  }
  return lines;
}

export function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Wraps a tool's own body with the shared footer.
 *
 * The footer is where attribution, freshness, cache state, warnings and
 * truncation live, so no tool can accidentally omit them.
 */
export function renderWithEnvelope(body: string, envelope: Envelope<unknown>): string {
  const sections: string[] = [body.trimEnd()];

  if (envelope.partial && !envelope.partial.complete) {
    sections.push(
      `Partial result: ${envelope.partial.reason} Missing: ${envelope.partial.missing.join(", ") || "none"}.`,
    );
  }

  if (envelope.warnings.length > 0) {
    sections.push(`Notes:\n${bulletList(envelope.warnings)}`);
  }

  if (envelope.continuation?.hasMore) {
    sections.push(
      `More results are available. Call this tool again with: ${JSON.stringify(
        envelope.continuation.nextArguments,
      )}`,
    );
  }

  const attribution = envelope.sources.map((source) => {
    const parts = [`${source.name} (${source.homepage})`];
    if (source.license) parts.push(`Licence: ${source.license}`);
    if (source.attribution) parts.push(source.attribution);
    return parts.join(" — ");
  });

  sections.push(
    [
      `Source${envelope.sources.length === 1 ? "" : "s"}:`,
      bulletList(attribution),
      `Retrieved: ${envelope.retrievedAt}${envelope.cached ? " (from local cache)" : ""}`,
    ].join("\n"),
  );

  return clampText(sections.join("\n\n"));
}
