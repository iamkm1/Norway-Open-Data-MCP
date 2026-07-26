/**
 * Environment → validated `ServerConfig`.
 *
 * This is the only module that reads `process.env`. Nothing downstream touches
 * the environment, which is what makes the server factory testable with a plain
 * object and keeps the documented variable list exhaustive by construction.
 *
 * A bad value never stops the server. It falls back to the documented default
 * and is reported as a `ConfigProblem`, because an MCP client that shows only
 * "server exited" gives the user nothing to act on.
 */

import { DEFAULT_APPLICATION_NAME } from "../version.js";
import { ENV_VARS, type ConfigProblem, type ConfigResolution, type ServerConfig } from "./types.js";

export type EnvSource = Record<string, string | undefined>;

const TIMEOUT_RANGE = { min: 1_000, max: 60_000 } as const;
const RETRIES_RANGE = { min: 0, max: 5 } as const;
const APP_NAME_MAX = 120;

/**
 * Deliberately permissive but structural. MET Norway needs a real, reachable
 * address; this catches the obvious mistakes without pretending to validate
 * deliverability.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function readTrimmed(env: EnvSource, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(
  env: EnvSource,
  key: string,
  fallback: boolean,
  problems: ConfigProblem[],
): boolean {
  const raw = readTrimmed(env, key);
  if (raw === undefined) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  problems.push({
    variable: key,
    message: `Expected a boolean such as 1/0 or true/false. Using the default (${fallback}).`,
  });
  return fallback;
}

function readInteger(
  env: EnvSource,
  key: string,
  fallback: number,
  range: { min: number; max: number },
  problems: ConfigProblem[],
): number {
  const raw = readTrimmed(env, key);
  if (raw === undefined) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    problems.push({
      variable: key,
      message: `Expected a whole number. Using the default (${fallback}).`,
    });
    return fallback;
  }
  if (parsed < range.min || parsed > range.max) {
    problems.push({
      variable: key,
      message: `Expected a value between ${range.min} and ${range.max}. Using the default (${fallback}).`,
    });
    return fallback;
  }
  return parsed;
}

/**
 * Reads an OAuth2 client-credentials pair.
 *
 * A half-configured pair is refused rather than passed through: the SDK would
 * accept it and only fail at the token endpoint, where the message names an
 * HTTP status rather than the variable the user actually forgot. Both values
 * are dropped so the affected tools report one clear "not configured" error
 * naming both variables.
 */
function readCredentialPair(
  env: EnvSource,
  idKey: string,
  secretKey: string,
  problems: ConfigProblem[],
): { clientId: string | undefined; clientSecret: string | undefined } {
  const clientId = readTrimmed(env, idKey);
  const clientSecret = readTrimmed(env, secretKey);

  if (clientId !== undefined && clientSecret === undefined) {
    problems.push({
      variable: secretKey,
      message: `Set together with ${idKey}. Both are required, so neither is used until both are present.`,
    });
    return { clientId: undefined, clientSecret: undefined };
  }
  if (clientSecret !== undefined && clientId === undefined) {
    problems.push({
      variable: idKey,
      message: `Set together with ${secretKey}. Both are required, so neither is used until both are present.`,
    });
    return { clientId: undefined, clientSecret: undefined };
  }

  return { clientId, clientSecret };
}

export function resolveConfig(env: EnvSource = process.env): ConfigResolution {
  const problems: ConfigProblem[] = [];

  let applicationName = readTrimmed(env, ENV_VARS.applicationName) ?? DEFAULT_APPLICATION_NAME;
  if (applicationName.length > APP_NAME_MAX) {
    problems.push({
      variable: ENV_VARS.applicationName,
      message: `Longer than ${APP_NAME_MAX} characters. Using the default identity.`,
    });
    applicationName = DEFAULT_APPLICATION_NAME;
  }

  const rawEmail = readTrimmed(env, ENV_VARS.contactEmail);
  let contactEmail: string | undefined;
  if (rawEmail !== undefined) {
    if (EMAIL_PATTERN.test(rawEmail)) {
      contactEmail = rawEmail;
    } else {
      // Not carried forward: the SDK would reject it at construction time and
      // take every tool down with it, not just the weather tools.
      problems.push({
        variable: ENV_VARS.contactEmail,
        message: "Not a valid email address. MET Norway tools stay disabled until it is corrected.",
      });
    }
  }

  const barentswatch = readCredentialPair(
    env,
    ENV_VARS.barentswatchClientId,
    ENV_VARS.barentswatchClientSecret,
    problems,
  );
  const barentswatchAis = readCredentialPair(
    env,
    ENV_VARS.barentswatchAisClientId,
    ENV_VARS.barentswatchAisClientSecret,
    problems,
  );

  const config: ServerConfig = {
    applicationName,
    contactEmail,
    nveApiKey: readTrimmed(env, ENV_VARS.nveApiKey),
    barentswatchClientId: barentswatch.clientId,
    barentswatchClientSecret: barentswatch.clientSecret,
    barentswatchAisClientId: barentswatchAis.clientId,
    barentswatchAisClientSecret: barentswatchAis.clientSecret,
    timeoutMs: readInteger(env, ENV_VARS.timeoutMs, 10_000, TIMEOUT_RANGE, problems),
    retries: readInteger(env, ENV_VARS.retries, 2, RETRIES_RANGE, problems),
    cacheEnabled: readBoolean(env, ENV_VARS.cache, true, problems),
    debug: readBoolean(env, ENV_VARS.debug, false, problems),
  };

  return { config, problems };
}

/**
 * Secret values held by this process, for the redactor.
 *
 * OAuth2 client ids are included alongside the secrets. A client id is not a
 * password, but it identifies a registered client and the SDK redacts it for
 * the same reason: it has no place in a tool result or a log line.
 */
export function secretsOf(config: ServerConfig): (string | undefined)[] {
  return [
    config.contactEmail,
    config.nveApiKey,
    config.barentswatchClientId,
    config.barentswatchClientSecret,
    config.barentswatchAisClientId,
    config.barentswatchAisClientSecret,
  ];
}

/** `--doctor` view of the configuration, with secrets masked. */
export function describeConfig(config: ServerConfig): Record<string, string> {
  return {
    [ENV_VARS.applicationName]: config.applicationName,
    [ENV_VARS.contactEmail]: config.contactEmail ? maskEmail(config.contactEmail) : "(not set)",
    [ENV_VARS.nveApiKey]: config.nveApiKey ? "(set, masked)" : "(not set)",
    [ENV_VARS.barentswatchClientId]: config.barentswatchClientId ? "(set, masked)" : "(not set)",
    [ENV_VARS.barentswatchClientSecret]: config.barentswatchClientSecret
      ? "(set, masked)"
      : "(not set)",
    [ENV_VARS.barentswatchAisClientId]: config.barentswatchAisClientId
      ? "(set, masked)"
      : "(not set)",
    [ENV_VARS.barentswatchAisClientSecret]: config.barentswatchAisClientSecret
      ? "(set, masked)"
      : "(not set)",
    [ENV_VARS.timeoutMs]: String(config.timeoutMs),
    [ENV_VARS.retries]: String(config.retries),
    [ENV_VARS.cache]: config.cacheEnabled ? "enabled (in-process only)" : "disabled",
    [ENV_VARS.debug]: config.debug ? "enabled" : "disabled",
  };
}

/**
 * Shows enough to confirm the right address is configured without printing it.
 * `ola.nordmann@example.com` becomes `o***n@example.com`.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "(set, masked)";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local.slice(0, 1)}***${domain}`;
  return `${local.slice(0, 1)}***${local.slice(-1)}${domain}`;
}
