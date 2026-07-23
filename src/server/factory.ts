/**
 * The server factory.
 *
 * Deliberately free of process-global state: it touches no signals, no stdio
 * and no `process.env`. That is what makes it testable in-process with an
 * injected SDK, and what leaves the CLI as the single owner of the process
 * lifecycle.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { resolveConfig } from "../config/env.js";
import { secretsOf } from "../config/env.js";
import type { ServerConfig } from "../config/types.js";
import { Redactor } from "../errors/redact.js";
import { ConfigurationRequiredError, describeToolError, mapToolError } from "../errors/map.js";
import { createLogger, silentLogger, type Logger } from "../logging/logger.js";
import { enforceSerializedBudget } from "../limits/budget.js";
import { clampText } from "../limits/budget.js";
import { envelopeSchema } from "../formatting/envelope.js";
import { allTools } from "../tools/registry.js";
import type { AnyToolDefinition, NorwayOpenDataLike, ToolContext } from "../tools/types.js";
import { createSdkProvider } from "./sdk-provider.js";

export type CreateServerOptions = {
  /**
   * Injected SDK. When omitted, a real client is constructed lazily from
   * `config`. Tests supply a fake implementing only what the tools call.
   */
  sdk?: NorwayOpenDataLike;
  /** Pre-resolved configuration. When omitted, it is read from the environment. */
  config?: Partial<ServerConfig>;
  logger?: Logger;
  /** Injectable clock so date-defaulting tools are deterministic under test. */
  now?: () => Date;
  /** Overrides the registered tool set. Used only by tests. */
  tools?: readonly AnyToolDefinition[];
};

export type NorwayOpenDataMcpServer = {
  server: McpServer;
  config: ServerConfig;
  logger: Logger;
  /** Number of tools registered. */
  toolCount: number;
  close(): Promise<void>;
};

/**
 * `_meta` key carrying the structured error payload on failed tool calls.
 * Namespaced so it cannot collide with another server's metadata.
 */
export const ERROR_META_KEY = "norway-open-data-mcp/error";

/** Machine-readable annotations describing the read-only contract. */
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // Results come from independently operated public APIs, not a closed set.
  openWorldHint: true,
} as const;

export function createNorwayOpenDataMcpServer(
  options: CreateServerOptions = {},
): NorwayOpenDataMcpServer {
  const resolution = resolveConfig();
  const config: ServerConfig = { ...resolution.config, ...options.config };

  const redactor = new Redactor(secretsOf(config));
  const logger =
    options.logger ??
    (config.debug
      ? createLogger({ level: "debug", redactor })
      : createLogger({ level: "info", redactor }));

  for (const problem of resolution.problems) {
    logger.warn(`Configuration problem in ${problem.variable}: ${problem.message}`);
  }

  const sdkProvider = options.sdk
    ? () => options.sdk as NorwayOpenDataLike
    : createSdkProvider(config);

  const context: ToolContext = {
    getSdk: sdkProvider,
    config,
    logger,
    redactor,
    now: options.now ?? (() => new Date()),
  };

  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      instructions:
        "Read-only access to Norwegian public data (companies, addresses, municipalities, " +
        "weather, hazard warnings, electricity prices, public transport and official statistics). " +
        "All data comes from official Norwegian providers and must keep its source attribution. " +
        "Hazard results are never an all-clear: direct users to official Varsom/NVE services for " +
        "safety decisions.",
    },
  );

  const tools = options.tools ?? allTools;
  for (const tool of tools) {
    registerTool(server, tool, context);
  }

  return {
    server,
    config,
    logger,
    toolCount: tools.length,
    close: async () => {
      await server.close();
    },
  };
}

function registerTool(server: McpServer, tool: AnyToolDefinition, context: ToolContext): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as z.ZodTypeAny,
      outputSchema: envelopeSchema(tool.dataSchema),
      annotations: { title: tool.title, ...READ_ONLY_ANNOTATIONS },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (input: any, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
      return runTool(tool, input, extra.signal, context);
    }) as never,
  );
}

/**
 * Runs one tool invocation and converts any outcome into a `CallToolResult`.
 *
 * Errors are returned as `isError: true` results rather than thrown, so the
 * model can read and act on them; throwing would surface a protocol-level
 * failure the model cannot interpret.
 */
async function runTool(
  tool: AnyToolDefinition,
  input: unknown,
  signal: AbortSignal,
  context: ToolContext,
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const missing = tool.requiredEnvironment?.(context.config) ?? [];
    if (missing.length > 0) {
      throw new ConfigurationRequiredError(
        `${tool.name} needs configuration that is not set: ${missing.join(", ")}.`,
        missing,
      );
    }

    const envelope = await tool.handler(input, { signal, context });

    // The size guard runs last, after per-tool limits, and records anything it
    // has to reduce so truncation is never silent.
    const guarded = enforceSerializedBudget(
      envelope as unknown as Record<string, unknown>,
      (entry) => {
        envelope.truncation ??= { truncated: true, fields: [] };
        envelope.truncation.fields.push(entry);
        envelope.warnings.push(
          `Result reduced to fit the output budget: "${entry.field}" cut to ${entry.returned} items.`,
        );
      },
    ) as typeof envelope;

    const text = clampText(tool.render(guarded.data, guarded));

    context.logger.debug("Tool call completed.", {
      tool: tool.name,
      durationMs: Date.now() - started,
      cached: guarded.cached,
      truncated: guarded.truncation !== null,
    });

    return {
      content: [{ type: "text", text }],
      structuredContent: context.redactor.value(guarded) as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const payload = mapToolError(error, { signal, redactor: context.redactor });

    context.logger.warn("Tool call failed.", {
      tool: tool.name,
      code: payload.code,
      provider: payload.provider,
      durationMs: Date.now() - started,
    });

    // Error results must NOT carry `structuredContent`.
    //
    // Verified against @modelcontextprotocol/sdk@1.29.0: the *server* skips
    // output validation when `isError` is set, but the *client* validates
    // whenever `structuredContent` is present, error or not. An error payload
    // there would fail the envelope schema and surface as a protocol-level
    // McpError, hiding the actual problem from the model. The client
    // explicitly permits an error result with no structured content, so the
    // machine-readable detail goes in `_meta`, which is not schema-validated.
    return {
      isError: true,
      content: [{ type: "text", text: describeToolError(payload) }],
      _meta: { [ERROR_META_KEY]: payload },
    };
  }
}

/** Exported for the CLI's `--doctor`, which must not construct a transport. */
export { silentLogger };
