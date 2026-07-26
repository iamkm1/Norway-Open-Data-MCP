/**
 * CLI entry point and process lifecycle owner.
 *
 * The server factory deliberately knows nothing about `process`; everything
 * that touches signals, exit codes or stdio lives here.
 */

import { createLogger } from "../logging/logger.js";
import { Redactor } from "../errors/redact.js";
import { resolveConfig, secretsOf } from "../config/env.js";
import { ENV_VARS } from "../config/types.js";
import { createNorwayOpenDataMcpServer } from "../server/factory.js";
import { runStdioServer } from "../server/transport.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { buildDoctorReport } from "./doctor.js";
import { printLine, printLines } from "./output.js";

const HELP = `${PACKAGE_NAME} v${PACKAGE_VERSION}

Local MCP server exposing curated read-only tools for Norwegian public data.
It speaks the Model Context Protocol over stdio and is started by an MCP client
such as Claude Desktop, Cursor, VS Code or the MCP Inspector.

USAGE
  norway-open-data-mcp              Start the MCP server on stdio (default)
  norway-open-data-mcp --help       Show this help and exit
  norway-open-data-mcp --version    Print the version and exit
  norway-open-data-mcp --doctor     Report configuration and readiness, then exit

ENVIRONMENT
  ${ENV_VARS.applicationName}      Caller identity sent to providers that require one.
                              Defaults to ${PACKAGE_NAME}/${PACKAGE_VERSION}.
  ${ENV_VARS.contactEmail}  Contact address required by MET Norway. Without it the
                              weather tool returns a clear configuration error.
  ${ENV_VARS.nveApiKey}    Optional free NVE HydAPI key. No current tool requires it.
  ${ENV_VARS.barentswatchClientId}
  ${ENV_VARS.barentswatchClientSecret}
                              BarentsWatch OAuth2 client credentials (api scope).
                              Both are required together. Without them
                              get_marine_forecast returns a configuration error.
  ${ENV_VARS.barentswatchAisClientId}
  ${ENV_VARS.barentswatchAisClientSecret}
                              BarentsWatch OAuth2 client credentials (ais scope).
                              A separate registered client from the one above.
                              Both are required together. Without them
                              get_vessel_profile, get_vessel_track and
                              get_live_vessel_positions return a configuration
                              error. Every other tool keeps working.
  ${ENV_VARS.timeoutMs}     Request timeout in ms (1000-60000, default 10000).
  ${ENV_VARS.retries}       Retry attempts after the first (0-5, default 2).
  ${ENV_VARS.cache}         In-process response cache (1 or 0, default 1).
  ${ENV_VARS.debug}         Verbose stderr diagnostics (1 or 0, default 0).

NOTES
  Runs entirely on this machine. There is no hosted backend, no HTTP listener,
  no database and no telemetry. Requests go directly from here to the relevant
  Norwegian public API. Diagnostics are written to stderr only; stdout carries
  the MCP protocol exclusively.

  Provider terms, licences and rate limits still apply. See PROVIDERS.md in
  norway-open-data-sdk for each provider's terms.`;

export type MainOptions = {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * @returns the process exit code. The caller decides whether to exit, so tests
 * can run `main` without terminating the test runner.
 */
export async function main(options: MainOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;

  if (argv.includes("--help") || argv.includes("-h")) {
    printLine(HELP);
    return 0;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    printLine(PACKAGE_VERSION);
    return 0;
  }

  if (argv.includes("--doctor")) {
    const report = buildDoctorReport(env);
    printLines(report.lines);
    return report.exitCode;
  }

  const unknown = argv.filter((argument) => argument.startsWith("-"));
  if (unknown.length > 0) {
    // Written to stderr: an unknown flag must not put prose on stdout, in case
    // a client launched us expecting protocol output.
    process.stderr.write(
      `Unknown option(s): ${unknown.join(", ")}\nRun with --help to see supported options.\n`,
    );
    return 2;
  }

  return startServer(env);
}

async function startServer(env: NodeJS.ProcessEnv): Promise<number> {
  const { config } = resolveConfig(env);
  const redactor = new Redactor(secretsOf(config));
  const logger = createLogger({ level: config.debug ? "debug" : "info", redactor });

  try {
    const instance = createNorwayOpenDataMcpServer({ config });
    const running = await runStdioServer({ instance, logger });

    const onFatal = (kind: string) => (error: unknown) => {
      logger.error(`Fatal ${kind}; shutting down.`, {
        error: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : undefined,
      });
      void running.shutdown(kind);
    };
    process.on("uncaughtException", onFatal("uncaughtException"));
    process.on("unhandledRejection", onFatal("unhandledRejection"));

    await running.finished;
    return 0;
  } catch (error) {
    logger.error("The MCP server failed to start.", {
      error: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? redactor.text(error.message) : undefined,
    });
    return 1;
  }
}
