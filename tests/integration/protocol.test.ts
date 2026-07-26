/**
 * Protocol integration: the built binary is spawned as a real subprocess and
 * driven over stdio, exactly as an MCP client would.
 *
 * These tests deliberately use `dist/cli.js`, not the TypeScript sources, so
 * they also verify the build output, the shebang, the module format and the
 * package's independence from the repository layout.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { EXPECTED_TOOL_COUNT } from "../../src/tools/registry.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../src/version.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(`dist/cli.js is missing. Run \`pnpm build\` before the integration suite.`);
  }
});

describe("MCP client over a spawned subprocess", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: { ...process.env, NORWAY_MCP_DEBUG: "1" },
      stderr: "pipe",
    });
    client = new Client({ name: "integration-test", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("completes the initialization handshake and identifies itself", () => {
    expect(client.getServerVersion()).toMatchObject({
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
    });
  });

  it("advertises tool capabilities", () => {
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it("lists exactly the documented tools with complete schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it("returns a readable configuration error instead of failing the protocol", async () => {
    // No NORWAY_MCP_CONTACT_EMAIL is set for this subprocess.
    const result = await client.callTool({
      name: "get_norwegian_weather_forecast",
      arguments: { latitude: 59.9139, longitude: 10.7522 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("NORWAY_MCP_CONTACT_EMAIL");
    // An error result must not carry structuredContent, or the client rejects it.
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects invalid arguments at the protocol boundary", async () => {
    const result = await client.callTool({
      name: "search_norwegian_companies",
      arguments: { limit: -1 },
    });

    expect(result.isError).toBe(true);
  });

  it("rejects unknown properties", async () => {
    const result = await client.callTool({
      name: "search_norwegian_companies",
      arguments: { name: "Equinor", notARealField: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("notARealField");
  });

  it("advertises both SSB Klass tools with strict schemas", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "resolve_norwegian_administrative_code",
      "search_norwegian_classification_codes",
    ]) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.additionalProperties, name).toBe(false);
      expect(tool!.outputSchema, name).toBeDefined();
    }
  });

  it("rejects unknown properties on the Klass classification search", async () => {
    const result = await client.callTool({
      name: "search_norwegian_classification_codes",
      arguments: { classificationId: 131, codePattern: "0301", notARealField: true },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("notARealField");
  });

  it("rejects a malformed administrative code before any request", async () => {
    // A two-digit code is not a valid municipality code; this must be refused by
    // the schema, not routed to the provider.
    const result = await client.callTool({
      name: "resolve_norwegian_administrative_code",
      arguments: { kind: "municipality", code: "30", targetDate: "2024-01-01" },
    });

    expect(result.isError).toBe(true);
  });

  it("routes a valid administrative resolution to its handler and stays alive", async () => {
    // SSB Klass is anonymous, so a well-formed request needs no configuration.
    // CI may or may not have network: a success or a clean provider error are
    // both acceptable. What must hold is a well-formed MCP result — never a
    // protocol crash — and a session that keeps serving afterwards.
    const result = await client.callTool({
      name: "resolve_norwegian_administrative_code",
      arguments: { kind: "municipality", code: "1142", targetDate: "2024-01-01" },
    });

    expect(result).toHaveProperty("content");
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("advertises all eight maritime tools with strict schemas over stdio", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "get_vessel_profile",
      "get_vessel_track",
      "get_live_vessel_positions",
      "search_fishing_vessels",
      "get_fishing_vessel",
      "search_aquaculture_locations",
      "get_aquaculture_location",
      "get_marine_forecast",
    ]) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.additionalProperties, name).toBe(false);
      expect(tool!.outputSchema, name).toBeDefined();
      expect(tool!.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("returns a readable credential error for the AIS tools, naming both variables", async () => {
    // This subprocess has no BarentsWatch credentials configured.
    const result = await client.callTool({
      name: "get_vessel_profile",
      arguments: { mmsi: "257123456" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID");
    expect(text).toContain("NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET");
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects a live-feed request that omits any of its three bounds", async () => {
    // No credentials are needed to prove this: the schema rejects the request
    // before the environment gate is reached, so no stream is ever opened.
    for (const args of [
      { limit: 10, timeoutMs: 1000 },
      { boundingBox: { south: 63.3, west: 10.2, north: 63.6, east: 10.7 }, timeoutMs: 1000 },
      { boundingBox: { south: 63.3, west: 10.2, north: 63.6, east: 10.7 }, limit: 10 },
      // Inverted box.
      {
        boundingBox: { south: 63.6, west: 10.2, north: 63.3, east: 10.7 },
        limit: 10,
        timeoutMs: 1000,
      },
    ]) {
      const result = await client.callTool({ name: "get_live_vessel_positions", arguments: args });
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it("routes a credential-free maritime request to its handler and stays alive", async () => {
    // The Fiskeridirektoratet registers are anonymous, so a well-formed request
    // needs no configuration. CI may or may not have network: a success or a
    // clean provider error are both acceptable. What must hold is a well-formed
    // MCP result and a session that keeps serving afterwards.
    const result = await client.callTool({
      name: "get_aquaculture_location",
      arguments: { siteNumber: "10318" },
    });

    expect(result).toHaveProperty("content");
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("keeps serving requests after an error", async () => {
    await client.callTool({ name: "search_norwegian_companies", arguments: { limit: -1 } });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it("honours a cancelled request without killing the session", async () => {
    const controller = new AbortController();
    const pending = client.callTool(
      // A stop-name lookup reaches the network, so it stays pending long enough
      // to cancel. There is no provider access in CI, so either outcome is fine
      // — what matters is that the session survives.
      { name: "get_norwegian_transport_departures", arguments: { stopName: "Majorstuen" } },
      undefined,
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow();

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });
});

describe("stdout carries protocol frames only", () => {
  let child: ChildProcessWithoutNullStreams;
  let stdout = "";
  let stderr = "";

  beforeAll(async () => {
    child = spawn(process.execPath, [CLI], {
      env: { ...process.env, NORWAY_MCP_DEBUG: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "1.0.0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    // An error path, which logs to stderr while the protocol continues.
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_norwegian_weather_forecast", arguments: { latitude: 1, longitude: 1 } },
    });

    await new Promise((resolve) => setTimeout(resolve, 2500));
  });

  afterAll(() => {
    child?.kill();
  });

  it("emits only valid JSON-RPC on stdout", () => {
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);

    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toMatchObject({ jsonrpc: "2.0" });
    }
  });

  it("writes no banner, prose or log line to stdout", () => {
    for (const marker of [
      "Norway Open Data MCP server ready",
      "norway-open-data-mcp v",
      "Shutting down",
      "Blocked a non-protocol write",
    ]) {
      expect(stdout, `stdout must not contain ${marker}`).not.toContain(marker);
    }

    // Structural rather than substring-based: log-shaped words such as
    // "level" and "message" legitimately appear *inside* protocol payloads
    // (tool descriptions, zod validation messages). What must never happen is
    // a top-level object that is not a JSON-RPC envelope.
    for (const line of stdout.split("\n").filter((entry) => entry.trim().length > 0)) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed["jsonrpc"]).toBe("2.0");
      expect(Object.keys(parsed).sort()).toEqual(expect.arrayContaining(["jsonrpc"]));
      for (const key of Object.keys(parsed)) {
        expect(["jsonrpc", "id", "result", "error", "method", "params"]).toContain(key);
      }
    }
  });

  it("writes diagnostics to stderr without corrupting the protocol", () => {
    expect(stderr).toContain("norway-open-data-mcp");
    // stderr is JSON lines, and stdout stayed parseable regardless.
    const stderrLines = stderr.split("\n").filter((line) => line.trim().length > 0);
    for (const line of stderrLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("does not leak configuration values into diagnostics", () => {
    expect(stderr).not.toContain("NORWAY_MCP_NVE_API_KEY=");
    expect(stderr.toLowerCase()).not.toContain("bearer ");
  });

  it("shuts down cleanly when stdin closes", async () => {
    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });
    child.stdin.end();

    const code = await Promise.race([
      exited,
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 8000)),
    ]);

    // A hanging timer or an unclosed handle would surface as "timeout" here.
    expect(code).not.toBe("timeout");
  });
});

describe("CLI modes exit before any transport starts", () => {
  const run = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      child.on("exit", (code) => resolve({ code, stdout: out, stderr: err }));
    });

  it("--version prints only the version", async () => {
    const result = await run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
  });

  it("--help documents every environment variable", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    for (const variable of [
      "NORWAY_MCP_APP_NAME",
      "NORWAY_MCP_CONTACT_EMAIL",
      "NORWAY_MCP_NVE_API_KEY",
      "NORWAY_MCP_BARENTSWATCH_CLIENT_ID",
      "NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET",
      "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID",
      "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET",
      "NORWAY_MCP_TIMEOUT_MS",
      "NORWAY_MCP_RETRIES",
      "NORWAY_MCP_CACHE",
      "NORWAY_MCP_DEBUG",
    ]) {
      expect(result.stdout).toContain(variable);
    }
  });

  it("--doctor reports readiness and exits zero", async () => {
    const result = await run(["--doctor"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Tools (20)");
    expect(result.stdout).toContain("No network requests were made");
  });

  it("--doctor never prints a configured BarentsWatch credential", async () => {
    const child = await new Promise<{ stdout: string }>((resolve) => {
      const process_ = spawn(process.execPath, [CLI, "--doctor"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID: "doctor-ais-id-secretvalue",
          NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET: "doctor-ais-secret-value",
        },
      });
      let out = "";
      process_.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      process_.on("exit", () => resolve({ stdout: out }));
    });

    expect(child.stdout).not.toContain("doctor-ais-id-secretvalue");
    expect(child.stdout).not.toContain("doctor-ais-secret-value");
    expect(child.stdout).toContain("NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET: (set, masked)");
    expect(child.stdout).toContain("get_vessel_profile: ready");
  });

  it("rejects an unknown flag on stderr, keeping stdout clean", async () => {
    const result = await run(["--not-a-flag"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option");
  });
});
