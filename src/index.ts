/**
 * Programmatic entry point.
 *
 * Consumers embedding this server — or testing against it — use
 * `createNorwayOpenDataMcpServer`, which accepts an injected SDK and never
 * touches process globals.
 *
 * ```ts
 * import { createNorwayOpenDataMcpServer } from "norway-open-data-mcp";
 *
 * const { server, close } = createNorwayOpenDataMcpServer({ sdk: myFake });
 * ```
 */

export {
  createNorwayOpenDataMcpServer,
  type CreateServerOptions,
  type NorwayOpenDataMcpServer,
} from "./server/factory.js";

export { runStdioServer, type RunOptions, type RunningServer } from "./server/transport.js";

export { allTools, EXPECTED_TOOL_COUNT } from "./tools/registry.js";
export type { NorwayOpenDataLike, ToolContext, ToolDefinition } from "./tools/types.js";

export { resolveConfig, describeConfig } from "./config/env.js";
export { ENV_VARS, type ServerConfig, type ConfigProblem } from "./config/types.js";

export type { Envelope, EnvelopeSource } from "./formatting/envelope.js";
export type { ToolErrorCode, ToolErrorPayload } from "./errors/types.js";
export { BUDGET } from "./limits/budget.js";

export { createLogger, silentLogger, type Logger } from "./logging/logger.js";
export { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";
