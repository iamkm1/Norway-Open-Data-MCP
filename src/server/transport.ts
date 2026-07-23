/**
 * stdio transport wiring and process lifecycle.
 *
 * Separated from the server factory so the factory stays free of process
 * globals. This module is the only place that touches signals, stdin and the
 * stdout guard.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Logger } from "../logging/logger.js";
import { installStdoutGuard, type StdoutGuard } from "./stdout-guard.js";
import type { NorwayOpenDataMcpServer } from "./factory.js";

export type RunOptions = {
  instance: NorwayOpenDataMcpServer;
  logger: Logger;
  /** Overrides process signal wiring in tests. */
  signals?: readonly NodeJS.Signals[];
};

export type RunningServer = {
  /** Resolves when the client disconnects or a shutdown signal arrives. */
  finished: Promise<void>;
  shutdown(reason: string): Promise<void>;
  guard: StdoutGuard;
};

const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/**
 * Starts the MCP server on stdio and returns a handle that resolves once the
 * session ends.
 *
 * Shutdown is idempotent: a second signal, or a signal racing a client
 * disconnect, performs no additional work.
 */
export async function runStdioServer(options: RunOptions): Promise<RunningServer> {
  const { instance, logger } = options;

  // Installed before the transport so that anything the transport or the SDK
  // logs during startup is diverted rather than framed as protocol output.
  const guard = installStdoutGuard(logger);

  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  let shuttingDown = false;
  const cleanups: (() => void)[] = [];

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down.", { reason });

    for (const cleanup of cleanups) cleanup();

    try {
      await instance.close();
    } catch (error) {
      logger.error("Error while closing the MCP server.", {
        error: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      guard.release();
      resolveFinished();
    }
  };

  const transport = new StdioServerTransport(process.stdin, guard.protocolStream);

  transport.onclose = () => {
    void shutdown("transport-closed");
  };
  transport.onerror = (error: Error) => {
    // Transport errors are frequently a client disconnecting mid-write; they
    // are reported but do not by themselves end the session.
    logger.warn("Transport error.", { error: error.name, message: error.message });
  };

  for (const signal of options.signals ?? DEFAULT_SIGNALS) {
    const onSignal = (): void => {
      void shutdown(`signal:${signal}`);
    };
    process.on(signal, onSignal);
    cleanups.push(() => process.off(signal, onSignal));
  }

  // A client that exits without closing the transport cleanly still ends stdin.
  const onStdinEnd = (): void => {
    void shutdown("stdin-ended");
  };
  process.stdin.on("end", onStdinEnd);
  process.stdin.on("close", onStdinEnd);
  cleanups.push(() => {
    process.stdin.off("end", onStdinEnd);
    process.stdin.off("close", onStdinEnd);
  });

  await instance.server.connect(transport);
  logger.info("Norway Open Data MCP server ready on stdio.", {
    tools: instance.toolCount,
  });

  return { finished, shutdown, guard };
}
