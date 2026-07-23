import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "*.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // stdout belongs to the MCP stdio transport. Diagnostics go to stderr
      // through src/logging/logger.ts, never through console.
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "All network access must go through norway-open-data-sdk." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='stdout'][property.name='write']",
          message:
            "Direct process.stdout.write corrupts the MCP protocol. Use the logger (stderr) or the transport.",
        },
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: "`as any` defeats the strict boundary between the SDK and the MCP layer.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  // The CLI is allowed to write to stdout, but only in the pre-transport
  // --help/--version/--doctor paths. Those go through src/cli/output.ts, which
  // is the single audited exception in the codebase.
  {
    files: ["src/cli/output.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  prettier,
);
