/**
 * Static audit of stdout discipline and dependency hygiene.
 *
 * Lint rules cover most of this, but this script is deliberately independent:
 * it reads the source text directly, so it still fires if a rule is disabled,
 * an eslint-disable comment is added, or a file is excluded from linting.
 *
 * Exits non-zero on any violation, and is part of `pnpm verify`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

type Violation = { file: string; line: number; rule: string; text: string };

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The single audited exception: pre-transport CLI output. */
const STDOUT_ALLOWLIST = ["src/cli/output.ts"];

const RULES: { rule: string; pattern: RegExp; allow?: string[] }[] = [
  {
    rule: "no-console",
    pattern: /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir|table)\s*\(/,
  },
  {
    rule: "no-stdout-write",
    pattern: /process\s*\.\s*stdout\s*\.\s*write\s*\(/,
    allow: STDOUT_ALLOWLIST,
  },
  {
    rule: "no-direct-fetch",
    // All network access must go through norway-open-data-sdk.
    pattern: /(?<![.\w])fetch\s*\(|new\s+XMLHttpRequest|require\(["']https?["']\)/,
  },
  {
    rule: "no-http-server",
    pattern: /createServer\s*\(|\.listen\s*\(|from\s+["']node:(http|https|net)["']/,
  },
  {
    rule: "no-filesystem-writes",
    pattern: /writeFileSync|createWriteStream|\bmkdirSync|appendFileSync|\brmSync/,
  },
  {
    rule: "no-shell-execution",
    pattern: /child_process|execSync|spawnSync|\bexec\s*\(/,
  },
  {
    rule: "no-unsafe-any-cast",
    pattern: /\bas\s+any\b/,
  },
  {
    rule: "no-telemetry",
    pattern: /posthog|mixpanel|segment\.io|amplitude|sentry|analytics/i,
  },
];

async function main(): Promise<void> {
  const violations: Violation[] = [];
  const files: string[] = [];

  for await (const entry of glob("src/**/*.ts", { cwd: ROOT })) {
    files.push(entry.replace(/\\/g, "/"));
  }

  if (files.length === 0) {
    process.stderr.write("check-stdout: found no source files to audit.\n");
    process.exitCode = 1;
    return;
  }

  for (const relative of files.sort()) {
    const contents = readFileSync(new URL(relative, new URL("../", import.meta.url)), "utf8");
    const lines = contents.split(/\r?\n/);

    for (const { rule, pattern, allow } of RULES) {
      if (allow?.includes(relative)) continue;

      lines.forEach((text, index) => {
        // Comments describe these rules constantly; only real code counts.
        const code = text.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (code.trim().startsWith("*")) return;
        if (pattern.test(code)) {
          violations.push({ file: relative, line: index + 1, rule, text: text.trim() });
        }
      });
    }
  }

  process.stdout.write(`check-stdout: audited ${files.length} source files.\n`);

  if (violations.length > 0) {
    process.stderr.write("\nstdout / safety audit failed:\n");
    for (const violation of violations) {
      process.stderr.write(
        `  ${violation.file}:${violation.line} [${violation.rule}] ${violation.text}\n`,
      );
    }
    process.stderr.write(
      `\n${violations.length} violation(s). stdout belongs to the MCP protocol; ` +
        "diagnostics must use src/logging/logger.ts.\n",
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write("check-stdout: no violations.\n");
}

await main();
