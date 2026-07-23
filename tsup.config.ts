import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/bin.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  // Declarations are only meaningful for the programmatic entry point; the CLI
  // is an executable, not an importable module.
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  // Runtime dependencies stay external so consumers get the real, auditable
  // packages rather than an inlined copy.
  external: ["@modelcontextprotocol/sdk", "norway-open-data-sdk", "zod"],
  // The shebang lives at the top of src/cli/bin.ts. esbuild preserves an entry
  // point's hashbang, so it is not injected here — a banner would wrongly add
  // one to the library entry as well.
  outExtension: () => ({ js: ".js" }),
});
