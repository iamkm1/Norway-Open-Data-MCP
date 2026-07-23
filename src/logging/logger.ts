/**
 * stderr-only diagnostics.
 *
 * The MCP stdio transport owns stdout: any non-protocol byte written there
 * desynchronises the JSON-RPC framing and the client drops the connection.
 * Every diagnostic in this package therefore goes to stderr, which MCP clients
 * capture to a log file (Claude Desktop writes it to
 * `mcp-server-<name>.log`) without touching the protocol stream.
 *
 * Writes are best-effort: a broken stderr pipe must never crash a running
 * server, so failures are swallowed.
 */

import { type Redactor, passthroughRedactor } from "../errors/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
};

export type LoggerOptions = {
  /** Minimum level emitted. Defaults to `info`; `NORWAY_MCP_DEBUG=1` lowers it to `debug`. */
  level?: LogLevel;
  /** Applied to the message and every detail value before writing. */
  redactor?: Redactor;
  /** Sink override for tests. Defaults to `process.stderr`. */
  write?: (line: string) => void;
};

function defaultWrite(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    // A closed or broken stderr pipe must not take the server down.
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimum = LEVEL_ORDER[options.level ?? "info"];
  const redactor = options.redactor ?? passthroughRedactor;
  const write = options.write ?? defaultWrite;

  const emit = (level: LogLevel, message: string, details?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < minimum) return;

    const record: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      name: "norway-open-data-mcp",
      message: redactor.text(message),
    };
    if (details && Object.keys(details).length > 0) {
      record["details"] = redactor.value(details);
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // Details that cannot be serialized must not silence the message itself.
      line = JSON.stringify({ ...record, details: "[unserializable]" });
    }
    write(`${line}\n`);
  };

  return {
    debug: (message, details) => emit("debug", message, details),
    info: (message, details) => emit("info", message, details),
    warn: (message, details) => emit("warn", message, details),
    error: (message, details) => emit("error", message, details),
  };
}

/** A logger that discards everything, for tests and for `--help`-style paths. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
