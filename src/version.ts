/**
 * Package identity, compiled in rather than read from disk at runtime.
 *
 * The built server must work from anywhere, including a global npx cache, so it
 * never resolves its own `package.json` at runtime. `tests/unit/version.test.ts`
 * asserts these constants match the manifest, so they cannot drift.
 */
export const PACKAGE_NAME = "norway-open-data-mcp";
export const PACKAGE_VERSION = "0.3.0";

/** Default caller identity sent to providers that require identification. */
export const DEFAULT_APPLICATION_NAME = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
