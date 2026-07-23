#!/usr/bin/env node
/**
 * Executable entry point.
 *
 * Kept to a few lines so the CLI logic in `main.ts` stays unit-testable without
 * terminating the test runner. The shebang is preserved into `dist/cli.js` by
 * esbuild.
 */

import { main } from "./main.js";

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Last-resort handler. stderr only: stdout may be a live protocol stream.
    process.stderr.write(
      `norway-open-data-mcp failed to start: ${
        error instanceof Error ? error.name : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });
