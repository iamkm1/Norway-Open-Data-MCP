/**
 * Test harness.
 *
 * Tools are driven through the **real** registration path — `McpServer`, a
 * linked in-memory transport, and the official MCP `Client` — rather than by
 * calling handlers directly. That means every test also exercises input schema
 * validation, output schema validation, envelope construction and error
 * mapping, which is where the interesting failures live.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createNorwayOpenDataMcpServer } from "../../src/server/factory.js";
import { ERROR_META_KEY } from "../../src/server/factory.js";
import type { ServerConfig } from "../../src/config/types.js";
import type { NorwayOpenDataLike } from "../../src/tools/types.js";
import type { ToolErrorPayload } from "../../src/errors/types.js";
import { silentLogger } from "../../src/logging/logger.js";

export const FIXED_NOW = new Date("2026-07-23T10:00:00.000Z");

export type Harness = {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** Calls a tool and asserts it succeeded, returning the parsed envelope. */
  callOk(name: string, args?: Record<string, unknown>): Promise<EnvelopeResult>;
  /** Calls a tool and asserts it failed, returning the structured error. */
  callErr(name: string, args?: Record<string, unknown>): Promise<ToolErrorPayload>;
  close(): Promise<void>;
};

export type EnvelopeResult = {
  data: Record<string, unknown>;
  sources: { id: string; name: string; homepage: string; license?: string; attribution?: string }[];
  retrievedAt: string;
  cached: boolean;
  warnings: string[];
  truncation: { truncated: boolean; fields: { field: string; returned: number }[] } | null;
  partial: { complete: boolean; missing: string[]; reason: string } | null;
  continuation: { hasMore: boolean; nextArguments: Record<string, unknown> } | null;
  text: string;
};

export async function createHarness(options: {
  sdk: NorwayOpenDataLike;
  config?: Partial<ServerConfig>;
  now?: () => Date;
}): Promise<Harness> {
  const instance = createNorwayOpenDataMcpServer({
    sdk: options.sdk,
    // A contact email is supplied by default so most tests exercise the happy
    // path; the missing-configuration tests override it explicitly.
    config: { contactEmail: "test@example.com", ...options.config },
    logger: silentLogger,
    now: options.now ?? (() => FIXED_NOW),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([client.connect(clientTransport), instance.server.connect(serverTransport)]);

  const call = (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

  return {
    client,
    call,
    callOk: async (name, args) => {
      const result = await call(name, args);
      if (result.isError) {
        throw new Error(
          `Expected ${name} to succeed but it failed: ${JSON.stringify(result.content)}`,
        );
      }
      const structured = result.structuredContent as unknown as EnvelopeResult;
      const first = result.content?.[0];
      return {
        ...structured,
        text: first && first.type === "text" ? first.text : "",
      };
    },
    callErr: async (name, args) => {
      const result = await call(name, args);
      if (!result.isError) {
        throw new Error(`Expected ${name} to fail but it succeeded.`);
      }
      const meta = result._meta as Record<string, unknown> | undefined;
      return meta?.[ERROR_META_KEY] as ToolErrorPayload;
    },
    close: async () => {
      await client.close();
      await instance.close();
    },
  };
}

/** Text of a failed call, for assertions on the human-readable form. */
export function errorText(result: CallToolResult): string {
  const first = result.content?.[0];
  return first && first.type === "text" ? first.text : "";
}
