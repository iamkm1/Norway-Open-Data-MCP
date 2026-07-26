/**
 * Contract-level guarantees that are not specific to any one tool:
 * the registered tool set, description quality, the stdout guard, the
 * dependency surface, and version consistency.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHarness, type Harness } from "../helpers/harness.js";
import { EXPECTED_TOOL_COUNT, allTools } from "../../src/tools/registry.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../src/version.js";
import { installStdoutGuard } from "../../src/server/stdout-guard.js";
import { createLogger } from "../../src/logging/logger.js";
import { Redactor } from "../../src/errors/redact.js";
import { buildDoctorReport } from "../../src/cli/doctor.js";
import {
  createFakeSdk,
  respond,
  SOURCES,
  sampleCompanySearch,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("tool registry", () => {
  it("advertises exactly the documented number of tools", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    const { tools } = await harness.client.listTools();

    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(allTools).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(EXPECTED_TOOL_COUNT).toBe(20);
  });

  it("registers the two SSB Klass tools exactly once, without disturbing the existing set", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    const { tools } = await harness.client.listTools();
    const names = tools.map((tool) => tool.name);

    // The two new tools are present exactly once each.
    for (const klassTool of [
      "resolve_norwegian_administrative_code",
      "search_norwegian_classification_codes",
    ]) {
      expect(names.filter((name) => name === klassTool)).toHaveLength(1);
    }

    // Every previously shipped tool is still registered, unchanged in name.
    for (const existing of [
      "search_norwegian_companies",
      "get_norwegian_company_profile",
      "search_norwegian_addresses",
      "get_norwegian_location_profile",
      "get_norwegian_municipality_profile",
      "get_norwegian_weather_forecast",
      "get_current_norwegian_hazards",
      "get_norwegian_electricity_prices",
      "get_norwegian_transport_departures",
      "query_norwegian_statistics",
    ]) {
      expect(names).toContain(existing);
    }
  });

  it("exposes a klass namespace on the injectable SDK surface", () => {
    const sdk = createFakeSdk();
    expect(typeof sdk.klass.resolveMunicipalityCode).toBe("function");
    expect(typeof sdk.klass.resolveCountyCode).toBe("function");
    expect(typeof sdk.klass.searchCodes).toBe("function");
    expect(typeof sdk.klass.getCode).toBe("function");
  });

  it("lists and calls the Klass tools with no configured credentials at all", async () => {
    // SSB Klass is anonymous: an empty config must not gate these tools.
    harness = await createHarness({
      sdk: createFakeSdk({
        klass: {
          searchCodes: () =>
            Promise.resolve(
              respond(
                {
                  items: [{ code: "0301", name: "Oslo", level: "1" }],
                  pagination: {
                    page: 0,
                    pageSize: 10,
                    totalItems: 1,
                    totalPages: 1,
                    upstreamPaged: false,
                  },
                },
                SOURCES["ssb-klass"]!,
              ),
            ),
        },
      }),
      config: { contactEmail: undefined },
    });

    const envelope = await harness.callOk("search_norwegian_classification_codes", {
      classificationId: 131,
      codePattern: "03*",
      date: "2024-01-01",
    });
    expect(envelope.data["codes"]).toHaveLength(1);
  });

  it("gives every tool a unique name, a title, a strict schema and an output schema", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    const { tools } = await harness.client.listTools();

    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);

    for (const tool of tools) {
      expect(tool.name, `${tool.name} name`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description?.length ?? 0, `${tool.name} description`).toBeGreaterThan(120);
      expect(tool.outputSchema, `${tool.name} outputSchema`).toBeDefined();
      // Strictness: unknown properties must be rejected.
      expect(tool.inputSchema.additionalProperties, `${tool.name} strictness`).toBe(false);
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(false);
    }
  });

  it("tells the model when NOT to use each tool", () => {
    // Routing quality depends on negative guidance as much as positive.
    for (const tool of allTools) {
      expect(tool.description.toLowerCase(), `${tool.name}`).toContain("do not use this");
    }
  });

  it("has no two tool descriptions that a model could confuse", () => {
    // Jaccard overlap on the leading sentence, which is what dominates routing.
    const summaries = allTools.map((tool) => ({
      name: tool.name,
      tokens: new Set(
        (tool.description.split(". ")[0] ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9åæø\s]/g, " ")
          .split(/\s+/)
          .filter((token) => token.length > 3),
      ),
    }));

    for (let i = 0; i < summaries.length; i += 1) {
      for (let j = i + 1; j < summaries.length; j += 1) {
        const a = summaries[i]!;
        const b = summaries[j]!;
        const intersection = [...a.tokens].filter((token) => b.tokens.has(token)).length;
        const union = new Set([...a.tokens, ...b.tokens]).size;
        const similarity = union === 0 ? 0 : intersection / union;
        expect(similarity, `${a.name} vs ${b.name} similarity`).toBeLessThan(0.6);
      }
    }
  });

  it("identifies the server by package name and version", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    expect(harness.client.getServerVersion()).toMatchObject({
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
    });
  });

  it("advertises tool capabilities", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });
    expect(harness.client.getServerCapabilities()?.tools).toBeDefined();
  });
});

describe("version consistency", () => {
  it("matches package.json, so the compiled identity cannot drift", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.name).toBe(PACKAGE_NAME);
    expect(manifest.version).toBe(PACKAGE_VERSION);
    expect(manifest.bin[PACKAGE_NAME]).toBe("dist/cli.js");
  });
});

describe("stdout guard", () => {
  it("diverts a non-protocol stdout write to stderr and reports it", () => {
    const stderrLines: string[] = [];
    const logger = createLogger({
      write: (line) => stderrLines.push(line),
      redactor: new Redactor(),
    });

    const guard = installStdoutGuard(logger);
    try {
      // Simulates a stray console.log anywhere in the process.
      process.stdout.write("this would corrupt the protocol\n");

      expect(guard.divertedCount()).toBe(1);
      expect(stderrLines.join("")).toContain("Blocked a non-protocol write to stdout");
    } finally {
      guard.release();
    }
  });

  it("lets protocol frames through untouched via the reserved stream", () => {
    const written: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as never);

    const guard = installStdoutGuard(createLogger({ write: () => {} }));
    try {
      guard.protocolStream.write('{"jsonrpc":"2.0"}\n');
      expect(written.join("")).toContain('{"jsonrpc":"2.0"}');
      expect(guard.divertedCount()).toBe(0);
    } finally {
      guard.release();
      spy.mockRestore();
      process.stdout.write = originalWrite;
    }
  });

  it("restores the original writer on release and is idempotent", () => {
    // Reference identity is exactly what is under test here, so the unbound
    // reference is deliberate rather than a scoping mistake.
    /* eslint-disable @typescript-eslint/unbound-method */
    const before = process.stdout.write;
    const guard = installStdoutGuard(createLogger({ write: () => {} }));
    expect(process.stdout.write).not.toBe(before);

    guard.release();
    guard.release();
    expect(process.stdout.write).toBe(before);
    /* eslint-enable @typescript-eslint/unbound-method */
  });
});

describe("logger", () => {
  it("writes structured JSON lines and redacts secrets", () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      redactor: new Redactor(["s3cr3t-value"]),
      level: "debug",
    });

    logger.info("used s3cr3t-value", { key: "s3cr3t-value" });

    const record = JSON.parse(lines[0]!);
    expect(record.level).toBe("info");
    expect(record.name).toBe("norway-open-data-mcp");
    expect(JSON.stringify(record)).not.toContain("s3cr3t-value");
  });

  it("honours the level threshold", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line), level: "warn" });

    logger.debug("hidden");
    logger.info("hidden");
    logger.warn("shown");

    expect(lines).toHaveLength(1);
  });

  it("still emits the message when the details cannot be serialized", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line) });
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    logger.error("boom", { cyclic: BigInt(1) as unknown as string });

    expect(lines[0]).toContain("boom");
  });
});

describe("doctor", () => {
  it("reports readiness and gated tools without making network calls", () => {
    const report = buildDoctorReport({});

    const text = report.lines.join("\n");
    expect(report.exitCode).toBe(0);
    expect(text).toContain("Tools (20)");
    expect(text).toContain("get_norwegian_weather_forecast: needs NORWAY_MCP_CONTACT_EMAIL");
    // SSB Klass tools need no configuration and are ready even with an empty env.
    expect(text).toContain("resolve_norwegian_administrative_code: ready");
    expect(text).toContain("search_norwegian_classification_codes: ready");
    // The Fiskeridirektoratet registers are open and need no credentials either.
    expect(text).toContain("search_fishing_vessels: ready");
    expect(text).toContain("get_aquaculture_location: ready");
    // The BarentsWatch tools name both variables they need.
    expect(text).toContain(
      "get_vessel_profile: needs NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID, NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET",
    );
    expect(text).toContain(
      "get_marine_forecast: needs NORWAY_MCP_BARENTSWATCH_CLIENT_ID, NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET",
    );
    expect(text).toContain("No network requests were made");
  });

  it("masks BarentsWatch credentials rather than printing them", () => {
    const report = buildDoctorReport({
      NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID: "ais-id-abcdef",
      NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET: "ais-secret-abcdef",
    });

    const text = report.lines.join("\n");
    expect(text).not.toContain("ais-id-abcdef");
    expect(text).not.toContain("ais-secret-abcdef");
    expect(text).toContain("NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET: (set, masked)");
    // With both halves present the AIS tools report ready.
    expect(text).toContain("get_vessel_profile: ready");
  });

  it("masks secrets in its output", () => {
    const report = buildDoctorReport({
      NORWAY_MCP_CONTACT_EMAIL: "ola.nordmann@example.com",
      NORWAY_MCP_NVE_API_KEY: "abcdef-secret",
    });

    const text = report.lines.join("\n");
    expect(text).not.toContain("abcdef-secret");
    expect(text).not.toContain("ola.nordmann@example.com");
  });

  it("marks every tool ready once a contact email is configured", () => {
    const report = buildDoctorReport({ NORWAY_MCP_CONTACT_EMAIL: "ola@example.com" });
    expect(report.lines.join("\n")).toContain("get_norwegian_weather_forecast: ready");
  });

  it("surfaces configuration problems", () => {
    const report = buildDoctorReport({ NORWAY_MCP_TIMEOUT_MS: "nope" });
    expect(report.lines.join("\n")).toContain("Configuration problems");
  });
});

describe("lazy SDK construction", () => {
  it("keeps the server alive and every tool listable when configuration is broken", async () => {
    // No injected SDK: the real one is constructed lazily from this config.
    harness = await createHarness({
      sdk: createFakeSdk({
        companies: {
          search: () => Promise.resolve(respond(sampleCompanySearch, SOURCES["brreg"]!)),
        },
      }),
      config: { timeoutMs: 10_000 },
    });

    const { tools } = await harness.client.listTools();
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);

    const envelope = await harness.callOk("search_norwegian_companies", { name: "Equinor" });
    expect(envelope.data["companies"]).toHaveLength(1);
  });
});
