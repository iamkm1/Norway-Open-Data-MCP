/**
 * Regression guard for the live-test wiring.
 *
 * A prior defect excluded `tests/live/**` in vitest.config.ts, which silently
 * made the opt-in `pnpm test:live` script find no tests at all. This guard runs
 * in the **default** suite (so CI executes it) and fails if either invariant of
 * the opt-in design is broken:
 *
 *   1. the live spec stays discoverable — no quoted `tests/live` path may appear
 *      as a vitest config entry, or `test:live` goes dead again;
 *   2. the live spec stays env-gated — it must skip unless RUN_LIVE_TESTS is
 *      set, or live provider traffic could leak into ordinary CI runs.
 *
 * Together these make the two failure directions loud instead of silent.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../", import.meta.url);

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, repoRoot)), "utf8");
}

describe("live-test wiring", () => {
  it("keeps the live spec discoverable: no quoted tests/live entry, include still matches it", () => {
    const config = read("vitest.config.ts");

    // A *quoted* tests/live path only appears as an actual config array entry.
    // The explanatory comment uses backticks, so it is deliberately not matched
    // here — only a real exclude/include entry would trip this.
    expect(config, "vitest config must not reference tests/live as a path entry").not.toMatch(
      /["']tests[\\/]+live/,
    );

    // The include glob must still match the live spec's .test.ts filename.
    expect(config).toContain('"tests/**/*.test.ts"');
  });

  it("keeps the live spec env-gated so it never runs in ordinary CI", () => {
    const source = read("tests/live/providers.live.test.ts");

    // The opt-in switch and the skip fallback must both be present.
    expect(source).toContain('process.env["RUN_LIVE_TESTS"]');
    expect(source).toContain("describe.skip");
    // And no suite may use a bare `describe(` that would run unconditionally;
    // every suite must route through the gated `describeLive`.
    expect(source).not.toMatch(/(^|[^a-zA-Z.])describe\s*\(/m);
  });
});
