/**
 * Release guard for the `norway-open-data-sdk` version floor.
 *
 * The floor rises with the capabilities this package depends on:
 * - 0.5.3 corrected a population-aggregation bug behind
 *   `get_norwegian_municipality_profile`.
 * - 0.6.0 added the `sdk.klass` namespace, which the two SSB Klass tools
 *   (`resolve_norwegian_administrative_code`,
 *   `search_norwegian_classification_codes`) call directly.
 * - 0.7.0 added `sdk.ais`, `sdk.marine`, `sdk.fisheries`, `profiles.vessel()`
 *   and OAuth2 client-credentials support, which the eight maritime tools call
 *   directly. On 0.6.0 those namespaces do not exist, so the failure would be a
 *   `TypeError` at call time rather than anything a user could act on.
 * - 0.8.0 added `sdk.geodata`, `sdk.environment`, `sdk.land` and
 *   `profiles.natureAtLocation()`, which the eight geospatial tools call
 *   directly, plus `OpenDataResponse.sources` — the array the profile tools now
 *   union into their provenance. On 0.7.0 none of that exists.
 *
 * The SDK is pre-1.0, so its breaking (and feature) changes ship as minor
 * versions and a caret range does not float across them automatically — the
 * floor is only what this manifest declares. This test fails the build if
 * either the manifest range or the resolved lockfile version would allow an SDK
 * below the required minimum, in a way no `pnpm install` can silently undo.
 *
 * It runs in `pnpm test`, `pnpm test:coverage` and `pnpm verify`, and therefore
 * in CI and in `prepublishOnly` before any tarball is produced.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REQUIRED_MINIMUM = "0.8.0";
const SDK = "norway-open-data-sdk";

const repoFile = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");

type Version = { major: number; minor: number; patch: number };

/** Parses `major.minor.patch` into comparable parts; throws on anything else. */
function parseVersion(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new Error(`Not a plain semver version: "${version}"`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** True when `version` is >= `floor`. */
function atLeast(version: string, floor: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(floor);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

describe(`${SDK} version floor`, () => {
  it(`package.json requires an SDK range whose floor is >= ${REQUIRED_MINIMUM}`, () => {
    const manifest = JSON.parse(repoFile("package.json")) as {
      dependencies: Record<string, string>;
    };
    const range = manifest.dependencies[SDK];
    expect(range, `${SDK} must be a runtime dependency`).toBeTypeOf("string");

    // Only caret ranges are used here; the range's lowest allowed version is its
    // written base. Reject any operator that could widen the floor downwards.
    const floor = /^\^(\d+\.\d+\.\d+)$/.exec(range ?? "")?.[1];
    expect(typeof floor, `expected a caret range like "^${REQUIRED_MINIMUM}", got "${range}"`).toBe(
      "string",
    );
    if (typeof floor !== "string") return;
    expect(
      atLeast(floor, REQUIRED_MINIMUM),
      `package.json permits ${SDK}@${floor}, below the required ${REQUIRED_MINIMUM}`,
    ).toBe(true);
  });

  it(`the lockfile resolves ${SDK} to >= ${REQUIRED_MINIMUM}`, () => {
    const lock = repoFile("pnpm-lock.yaml");

    // Every version the lockfile associates with the SDK: the resolved import
    // specifier and each package/snapshot key. All must satisfy the floor, so a
    // stale lockfile that still pins the old build fails here.
    const found = new Set<string>();
    for (const match of lock.matchAll(new RegExp(`${SDK}@(\\d+\\.\\d+\\.\\d+)`, "g"))) {
      found.add(match[1]!);
    }
    // The importer block records the resolution as a bare `version:` field.
    const importer = new RegExp(
      `\\n {6}${SDK}:\\n {8}specifier:[^\\n]*\\n {8}version: (\\d+\\.\\d+\\.\\d+)`,
    ).exec(lock);
    if (importer) found.add(importer[1]!);

    expect(found.size, `no resolved ${SDK} version found in pnpm-lock.yaml`).toBeGreaterThan(0);
    for (const version of found) {
      expect(
        atLeast(version, REQUIRED_MINIMUM),
        `lockfile resolves ${SDK}@${version}, below the required ${REQUIRED_MINIMUM}`,
      ).toBe(true);
    }
  });
});
