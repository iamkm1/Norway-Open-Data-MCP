/**
 * Lazy, memoised construction of the Norway Open Data SDK client.
 *
 * `new NorwayOpenData(config)` validates its input with zod and **throws**
 * `ConfigurationError` on a bad value — verified against the installed SDK,
 * where a malformed `contactEmail` or a negative `timeoutMs` rejects at
 * construction.
 *
 * Constructing it eagerly would mean one bad environment variable kills the
 * process before the MCP handshake, and the user sees only "server exited".
 * Constructing it here, on first use, turns the same mistake into an ordinary
 * tool error that names the variable to fix, while `tools/list` and every
 * unaffected tool keep working.
 */

import { NorwayOpenData } from "norway-open-data-sdk";

import { ConfigurationRequiredError } from "../errors/map.js";
import { ENV_VARS, type ServerConfig } from "../config/types.js";
import type { NorwayOpenDataLike } from "../tools/types.js";

/** Cache entries are small normalized objects; 200 is generous and bounded. */
const CACHE_MAX_ENTRIES = 200;

export function createSdkProvider(config: ServerConfig): () => NorwayOpenDataLike {
  let instance: NorwayOpenDataLike | undefined;
  let failure: Error | undefined;

  return () => {
    if (instance) return instance;
    if (failure) throw failure;

    try {
      instance = new NorwayOpenData({
        applicationName: config.applicationName,
        ...(config.contactEmail !== undefined ? { contactEmail: config.contactEmail } : {}),
        timeoutMs: config.timeoutMs,
        retries: config.retries,
        cache: {
          // In-process only. The cache dies with the process; nothing is ever
          // written to disk, which is what keeps "no persistent storage" true.
          enabled: config.cacheEnabled,
          maxEntries: CACHE_MAX_ENTRIES,
        },
        ...(config.nveApiKey !== undefined
          ? { credentials: { nve: { apiKey: config.nveApiKey } } }
          : {}),
      });
      return instance;
    } catch (error) {
      // Remembered so a broken configuration produces the same clear message on
      // every call instead of retrying a construction that cannot succeed.
      failure = new ConfigurationRequiredError(
        `The Norway Open Data SDK could not be configured: ${
          error instanceof Error ? error.message : "unknown configuration error"
        }`,
        [ENV_VARS.applicationName, ENV_VARS.contactEmail, ENV_VARS.timeoutMs, ENV_VARS.retries],
      );
      throw failure;
    }
  };
}
