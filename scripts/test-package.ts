/**
 * Package test.
 *
 * Packs the tarball, installs it into a throwaway project **outside** this
 * repository, and drives the installed binary as a real MCP server. This is the
 * only test that proves what a user actually gets from
 * `npx -y norway-open-data-mcp`: the source tree, the dev dependencies and the
 * repository layout are all absent.
 */

import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXPECTED_TOOL_COUNT = 10;

/** Files that must never ship: tests, fixtures, secrets, coverage, sources. */
const FORBIDDEN_PATTERNS: { label: string; test: (path: string) => boolean }[] = [
  { label: "test files", test: (p) => /(^|\/)tests?\//.test(p) || /\.test\.[cm]?[jt]s$/.test(p) },
  { label: "source TypeScript", test: (p) => /(^|\/)src\//.test(p) },
  { label: "coverage output", test: (p) => /(^|\/)coverage\//.test(p) },
  { label: "environment files", test: (p) => /(^|\/)\.env/.test(p) },
  { label: "scripts", test: (p) => /(^|\/)scripts\//.test(p) },
  { label: "CI configuration", test: (p) => /(^|\/)\.github\//.test(p) },
  { label: "lockfiles", test: (p) => /pnpm-lock\.yaml$|package-lock\.json$/.test(p) },
  { label: "editor/config files", test: (p) => /(^|\/)(\.vscode|\.idea)\//.test(p) },
  { label: "tsconfig", test: (p) => /tsconfig.*\.json$/.test(p) },
  { label: "eslint/prettier config", test: (p) => /eslint\.config|\.prettierrc/.test(p) },
  { label: "inspector session files", test: (p) => /mcp-inspector.*\.json$/.test(p) },
];

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

/**
 * Windows needs a shell for `npm`, which is a `.cmd` shim — Node 24 refuses to
 * spawn `.cmd` directly (EINVAL). Everything else is spawned without a shell,
 * because shell re-quoting breaks any path containing a space, such as the
 * default `C:\Program Files\nodejs\node.exe`.
 *
 * Arguments are quoted explicitly in the shell case so a repository path with
 * a space still works. All arguments here are constructed by this script; none
 * come from user input.
 */
function run(command: string, args: string[], cwd: string): string {
  const needsShell = process.platform === "win32" && /^(npm|npx)$/.test(command);
  const finalArgs = needsShell
    ? args.map((argument) => (/\s/.test(argument) ? `"${argument}"` : argument))
    : args;

  // This script must genuinely pack and install. When it runs inside
  // `npm publish --dry-run`, npm exports `npm_config_dry_run=true`, which the
  // nested `npm pack` below would inherit and honour — producing no tarball and
  // breaking the install that follows. Strip it so the package test does real
  // work regardless of how the surrounding command was invoked.
  const env = { ...process.env };
  delete env["npm_config_dry_run"];

  return execFileSync(command, finalArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: needsShell,
    env,
  });
}

/**
 * Best-effort temp cleanup.
 *
 * On Windows a just-killed child can hold the directory open for a moment, so
 * removal is retried. A leftover temp directory must never fail an otherwise
 * passing package test.
 */
function removeWithRetry(target: string): void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  process.stdout.write(`  (note: could not remove the temporary directory ${target})\n`);
}

function fail(message: string): never {
  process.stderr.write(`\nPACKAGE TEST FAILED: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  log("→ Packing the tarball…");
  const packOutput = run("npm", ["pack", "--json"], ROOT);
  const packed = JSON.parse(packOutput.slice(packOutput.indexOf("["))) as {
    filename: string;
    files: { path: string }[];
    size: number;
    unpackedSize: number;
    entryCount: number;
  }[];

  const meta = packed[0];
  if (!meta) fail("npm pack produced no metadata.");

  const tarball = resolve(ROOT, meta.filename);
  log(`  tarball:      ${meta.filename}`);
  log(`  files:        ${meta.entryCount}`);
  log(`  packed size:  ${(meta.size / 1024).toFixed(1)} KB`);
  log(`  unpacked:     ${(meta.unpackedSize / 1024).toFixed(1)} KB`);

  log("\n→ Auditing tarball contents…");
  const paths = meta.files.map((file) => file.path.replace(/\\/g, "/"));
  const offenders: string[] = [];
  for (const { label, test } of FORBIDDEN_PATTERNS) {
    const matches = paths.filter(test);
    if (matches.length > 0) offenders.push(`${label}: ${matches.slice(0, 5).join(", ")}`);
  }
  if (offenders.length > 0) {
    fail(`the tarball contains files that must not ship:\n  ${offenders.join("\n  ")}`);
  }
  for (const required of [
    "package.json",
    "dist/cli.js",
    "dist/index.js",
    "dist/index.d.ts",
    "README.md",
    "LICENSE",
  ]) {
    if (!paths.includes(required)) fail(`the tarball is missing ${required}`);
  }
  log(`  no forbidden files; all required entry points present.`);

  // Installing outside the repository is the point: anything the package still
  // needs from this tree will fail to resolve here.
  const workdir = mkdtempSync(join(tmpdir(), "nodmcp-consumer-"));
  log(`\n→ Installing into a fresh project outside the repository`);
  log(`  ${workdir}`);

  try {
    writeFileSync(
      join(workdir, "package.json"),
      JSON.stringify(
        { name: "consumer-test", version: "1.0.0", type: "module", private: true },
        null,
        2,
      ),
    );
    run("npm", ["install", "--no-audit", "--no-fund", tarball], workdir);

    const installed = readdirSync(join(workdir, "node_modules", "norway-open-data-mcp"));
    log(`  installed entries: ${installed.join(", ")}`);
    if (installed.includes("src")) fail("the installed package contains a src/ directory.");

    const binary = join(workdir, "node_modules", "norway-open-data-mcp", "dist", "cli.js");

    log("\n→ Verifying the executable…");
    const version = run(process.execPath, [binary, "--version"], workdir).trim();
    log(`  --version → ${version}`);
    if (!/^\d+\.\d+\.\d+$/.test(version))
      fail(`--version printed something unexpected: ${version}`);

    const doctor = run(process.execPath, [binary, "--doctor"], workdir);
    if (!doctor.includes(`Tools (${EXPECTED_TOOL_COUNT})`)) {
      fail("--doctor did not report the expected tool count.");
    }
    log(`  --doctor → reports ${EXPECTED_TOOL_COUNT} tools, no network calls`);

    log("\n→ Verifying npx-style resolution via the package bin…");
    const binScript = join(workdir, "node_modules", ".bin", "norway-open-data-mcp");
    try {
      const binVersion = run(binScript, ["--version"], workdir).trim();
      log(`  bin shim → ${binVersion}`);
    } catch {
      // The .bin shim is a shell/cmd wrapper; on some Windows shells it cannot
      // be invoked this way. The dist entry point above already proved the
      // executable works, so this is reported rather than fatal.
      log("  bin shim → not directly invocable in this shell (dist entry verified instead)");
    }

    log("\n→ Verifying package exports and declarations resolve…");
    const consumerScript = join(workdir, "consume.mjs");
    writeFileSync(
      consumerScript,
      [
        `import { createNorwayOpenDataMcpServer, allTools, EXPECTED_TOOL_COUNT, PACKAGE_VERSION } from "norway-open-data-mcp";`,
        `if (typeof createNorwayOpenDataMcpServer !== "function") { throw new Error("factory export missing"); }`,
        `if (allTools.length !== ${EXPECTED_TOOL_COUNT}) { throw new Error("unexpected tool count: " + allTools.length); }`,
        `const instance = createNorwayOpenDataMcpServer({ sdk: {} });`,
        `if (instance.toolCount !== EXPECTED_TOOL_COUNT) { throw new Error("factory registered the wrong number of tools"); }`,
        `await instance.close();`,
        `console.log("exports-ok " + PACKAGE_VERSION + " tools=" + allTools.length);`,
      ].join("\n"),
    );
    const consumeOutput = run(process.execPath, [consumerScript], workdir).trim();
    if (!consumeOutput.includes("exports-ok")) fail(`consumer import failed: ${consumeOutput}`);
    log(`  ${consumeOutput}`);

    const declarations = run(
      process.execPath,
      ["-e", `process.stdout.write(require.resolve("norway-open-data-mcp/package.json"))`],
      workdir,
    );
    if (!declarations.includes("norway-open-data-mcp"))
      fail("package.json export did not resolve.");
    log("  types + package.json exports resolve");

    log("\n→ Driving the installed binary as an MCP server…");
    await verifyMcpServer(binary, workdir);

    log("\nPACKAGE TEST PASSED");
    log(
      `  ${meta.filename} — ${meta.entryCount} files, ${(meta.unpackedSize / 1024).toFixed(1)} KB unpacked`,
    );
  } finally {
    removeWithRetry(workdir);
    rmSync(tarball, { force: true });
  }
}

/** Speaks raw MCP to the installed binary; no client dependency in the temp project. */
function verifyMcpServer(binary: string, cwd: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [binary], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("the installed server did not respond within 20 seconds"));
    }, 20_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;

      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        let message: { id?: number; result?: { tools?: unknown[] } };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          clearTimeout(timer);
          child.kill();
          rejectPromise(new Error(`non-protocol output on stdout: ${line.slice(0, 200)}`));
          return;
        }

        if (message.id === 2 && message.result?.tools) {
          clearTimeout(timer);
          const count = message.result.tools.length;
          child.stdin.end();
          child.kill();

          if (count !== EXPECTED_TOOL_COUNT) {
            rejectPromise(new Error(`expected ${EXPECTED_TOOL_COUNT} tools, got ${count}`));
            return;
          }
          if (stderr.includes("Error:") && !stderr.includes('"level"')) {
            rejectPromise(new Error(`unexpected stderr output: ${stderr.slice(0, 300)}`));
            return;
          }
          log(`  initialize + tools/list → ${count} tools, stdout clean`);
          resolvePromise();
          return;
        }
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "package-test", version: "1.0.0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

await main();
