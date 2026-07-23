/** Configuration resolved from the environment, ready to build an SDK client. */
export type ServerConfig = {
  /** Sent as Entur `ET-Client-Name`, Vegvesen `X-Client`, part of MET's User-Agent. */
  applicationName: string;
  /**
   * Required by MET Norway only. Never defaulted — a fake address would be sent
   * upstream as the caller's identity.
   *
   * Explicitly `| undefined` so a caller can *unset* it when overriding
   * configuration, which `exactOptionalPropertyTypes` would otherwise forbid.
   */
  contactEmail?: string | undefined;
  /** Free NVE HydAPI key. No v0.1 tool requires it. */
  nveApiKey?: string | undefined;
  timeoutMs: number;
  retries: number;
  /** In-process response cache. Never written to disk. */
  cacheEnabled: boolean;
  debug: boolean;
};

/** A configuration value that was present but unusable. */
export type ConfigProblem = {
  variable: string;
  message: string;
};

export type ConfigResolution = {
  config: ServerConfig;
  /**
   * Problems found while reading the environment. These never stop the server:
   * the offending value falls back to its default and the problem is reported
   * by `--doctor` and on stderr.
   */
  problems: ConfigProblem[];
};

/** Environment variables this server reads. The complete, documented set. */
export const ENV_VARS = {
  applicationName: "NORWAY_MCP_APP_NAME",
  contactEmail: "NORWAY_MCP_CONTACT_EMAIL",
  nveApiKey: "NORWAY_MCP_NVE_API_KEY",
  timeoutMs: "NORWAY_MCP_TIMEOUT_MS",
  retries: "NORWAY_MCP_RETRIES",
  cache: "NORWAY_MCP_CACHE",
  debug: "NORWAY_MCP_DEBUG",
} as const;
