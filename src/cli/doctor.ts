/**
 * `--doctor`: local configuration and readiness report.
 *
 * Makes **no network requests**. It reports what is configured, which tools are
 * available and whether the SDK can be constructed — nothing that could consume
 * a provider's request budget or trip a rate limit. Every value it prints is
 * masked by the same rules that protect tool output.
 */

import { describeConfig, resolveConfig, secretsOf } from "../config/env.js";
import { ENV_VARS } from "../config/types.js";
import { Redactor } from "../errors/redact.js";
import { createSdkProvider } from "../server/sdk-provider.js";
import { allTools } from "../tools/registry.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

export type DoctorReport = {
  lines: string[];
  /** Non-zero when something would stop the server from working at all. */
  exitCode: number;
};

export function buildDoctorReport(env: NodeJS.ProcessEnv = process.env): DoctorReport {
  const { config, problems } = resolveConfig(env);
  const redactor = new Redactor(secretsOf(config));
  const lines: string[] = [];
  let exitCode = 0;

  lines.push(`${PACKAGE_NAME} v${PACKAGE_VERSION} — doctor`, "");

  lines.push("Runtime");
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const nodeOk = major >= 22;
  lines.push(
    `  Node.js: ${process.versions.node} ${nodeOk ? "(ok)" : "(TOO OLD — requires >= 22)"}`,
  );
  if (!nodeOk) exitCode = 1;
  lines.push(`  Platform: ${process.platform} ${process.arch}`);

  // The electricity, hazard and profile paths depend on Europe/Oslo formatting,
  // which a Node build without full ICU cannot do.
  const hasFullIcu = (() => {
    try {
      return (
        new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(new Date()).length > 0
      );
    } catch {
      return false;
    }
  })();
  lines.push(
    `  Europe/Oslo time zone data: ${hasFullIcu ? "available" : "MISSING (full-ICU build required)"}`,
  );
  if (!hasFullIcu) exitCode = 1;
  lines.push("");

  lines.push("Configuration");
  for (const [key, value] of Object.entries(describeConfig(config))) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push("");

  if (problems.length > 0) {
    lines.push("Configuration problems");
    for (const problem of problems) {
      lines.push(`  ${problem.variable}: ${problem.message}`);
    }
    lines.push("");
  }

  lines.push("SDK");
  try {
    createSdkProvider(config)();
    lines.push("  norway-open-data-sdk: constructed successfully");
  } catch (error) {
    lines.push(
      `  norway-open-data-sdk: FAILED — ${redactor.text(
        error instanceof Error ? error.message : "unknown error",
      )}`,
    );
    exitCode = 1;
  }
  lines.push("");

  lines.push(`Tools (${allTools.length})`);
  for (const tool of allTools) {
    const missing = tool.requiredEnvironment?.(config) ?? [];
    const status =
      missing.length === 0 ? "ready" : `needs ${missing.join(", ")} — will return a clear error`;
    lines.push(`  ${tool.name}: ${status}`);
  }
  lines.push("");

  if (config.contactEmail === undefined) {
    lines.push(
      `Note: ${ENV_VARS.contactEmail} is not set. MET Norway requires callers to identify`,
      "themselves, so get_norwegian_weather_forecast will return a configuration error and the",
      "weather section of get_norwegian_location_profile will be omitted. Every other tool works.",
      "",
    );
  }

  lines.push("No network requests were made by this command.");

  return { lines, exitCode };
}
