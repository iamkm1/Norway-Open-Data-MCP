import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `tests/live/**` is intentionally NOT excluded here: doing so also hid it
    // from the opt-in `test:live` script, which filters to that directory.
    // Live tests are gated at runtime instead — `describeLive` skips them unless
    // RUN_LIVE_TESTS=true, and no default or CI script targets tests/live — so
    // they never reach the network in the default pipeline.
    exclude: ["node_modules/**", "dist/**"],
    // Integration tests spawn the built binary; give them room without
    // letting a hung subprocess stall the suite forever.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/cli/bin.ts",
        "src/server/transport.ts",
        "src/testing/**",
        "src/**/types.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
        "src/tools/**": { lines: 90, functions: 85, branches: 80, statements: 90 },
        "src/errors/**": { lines: 95, functions: 90, branches: 85, statements: 95 },
        "src/limits/**": { lines: 95, functions: 90, branches: 85, statements: 95 },
        "src/config/**": { lines: 90, functions: 85, branches: 80, statements: 90 },
        "src/formatting/**": { lines: 90, functions: 85, branches: 80, statements: 90 },
      },
    },
  },
});
