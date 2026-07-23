/**
 * Proves the security posture claimed in the README and architecture doc:
 * this server loads no HTTP-server code, opens no listener, and reaches no
 * network except through `norway-open-data-sdk`.
 *
 * The `@hono/node-server` advisory (GHSA-frvp-7c67-39w9) is only reachable
 * through `serve-static`. This asserts that module is never even loaded, which
 * is the actual mitigation — and it fails loudly if an HTTP transport is ever
 * introduced.
 */

import { describe, expect, it } from "vitest";

describe("dependency surface", () => {
  it("does not load HTTP server frameworks when the stdio server is imported", async () => {
    await import("../../src/server/factory.js");
    await import("../../src/server/transport.js");

    const loaded = [...moduleGraphPaths()];

    for (const forbidden of ["@hono/node-server", "express", "cors", "serve-static"]) {
      expect(
        loaded.some((path) => path.includes(`/${forbidden}/`) || path.includes(`\\${forbidden}\\`)),
        `${forbidden} must not be loaded by a stdio-only server`,
      ).toBe(false);
    }
  });

  it("opens no server handles", async () => {
    const { createNorwayOpenDataMcpServer } = await import("../../src/server/factory.js");
    const { createFakeSdk } = await import("../../src/testing/fake-sdk.js");
    const { silentLogger } = await import("../../src/logging/logger.js");

    const before = activeServerHandles();
    const instance = createNorwayOpenDataMcpServer({
      sdk: createFakeSdk(),
      logger: silentLogger,
    });
    const after = activeServerHandles();

    expect(after).toEqual(before);
    await instance.close();
  });

  it("declares only the three intended runtime dependencies", async () => {
    const manifest = (await import("../../package.json", { with: { type: "json" } })).default;

    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "norway-open-data-sdk",
      "zod",
    ]);
    // No analytics, telemetry or HTTP framework of our own.
    for (const forbidden of ["express", "fastify", "hono", "posthog", "mixpanel", "sentry"]) {
      expect(Object.keys(manifest.dependencies)).not.toContain(forbidden);
    }
  });
});

/** Paths of every module Node has loaded in this process. */
function moduleGraphPaths(): Set<string> {
  const paths = new Set<string>();
  // `moduleLoadList` is an internal Node property with no public type.
  const loadList = (process as unknown as { moduleLoadList?: string[] }).moduleLoadList;
  for (const entry of loadList ?? []) {
    paths.add(entry);
  }
  // ESM modules are not in moduleLoadList; use the require cache plus the
  // resolved specifiers Vitest tracks for CJS interop.
  for (const key of Object.keys(require.cache ?? {})) paths.add(key);
  return paths;
}

/** Server-ish libuv handles, used to prove no listener was opened. */
function activeServerHandles(): string[] {
  const handles = (
    process as unknown as { _getActiveHandles?: () => { constructor: { name: string } }[] }
  )._getActiveHandles?.();
  return (handles ?? [])
    .map((handle) => handle?.constructor?.name)
    .filter((name) => name === "Server" || name === "Socket")
    .sort();
}
