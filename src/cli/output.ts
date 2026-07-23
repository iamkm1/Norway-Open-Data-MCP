/**
 * The only module in this package permitted to write to stdout.
 *
 * These writes happen exclusively in the `--help`, `--version` and `--doctor`
 * paths, which print and exit **before** any MCP transport is created. Once the
 * transport starts, stdout belongs entirely to the JSON-RPC stream and this
 * module is never called again.
 *
 * `eslint.config.js` grants this file — and only this file — an exemption from
 * the `process.stdout.write` restriction, so the exception is visible in the
 * lint configuration rather than hidden behind an inline disable comment.
 */

export function printLine(text = ""): void {
  process.stdout.write(`${text}\n`);
}

export function printLines(lines: readonly string[]): void {
  printLine(lines.join("\n"));
}
