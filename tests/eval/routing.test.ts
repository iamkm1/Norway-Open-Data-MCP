/**
 * Structural validation of the routing evaluation corpus.
 *
 * This does not score a model — that is opt-in and needs credentials CI does
 * not have. What it does guarantee is that the corpus stays *usable*: every
 * tool it names exists, every argument set it records actually validates
 * against the real input schema, and the ambiguity pairs documented in
 * docs/tool-catalogue.md are all covered.
 *
 * Without this, the corpus would silently rot the first time a tool is renamed
 * or a schema tightened.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allTools } from "../../src/tools/registry.js";

type EvalCase = {
  id: string;
  question: string;
  language: "no" | "en";
  expectedTool: string | null;
  mustNotSelect: string[];
  reason: string;
  requiredArguments: Record<string, unknown>;
  expectedClarification?: string;
};

const corpus = JSON.parse(
  readFileSync(new URL("./tool-routing.json", import.meta.url), "utf8"),
) as { version: number; cases: EvalCase[] };

const toolNames = new Set(allTools.map((tool) => tool.name));
const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

describe("routing evaluation corpus", () => {
  it("has at least 40 cases", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(40);
  });

  it("covers both Norwegian and English realistically", () => {
    const norwegian = corpus.cases.filter((entry) => entry.language === "no").length;
    const english = corpus.cases.filter((entry) => entry.language === "en").length;

    expect(norwegian).toBeGreaterThanOrEqual(15);
    expect(english).toBeGreaterThanOrEqual(15);
  });

  it("uses unique case ids", () => {
    const ids = corpus.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names only tools that exist", () => {
    for (const entry of corpus.cases) {
      if (entry.expectedTool !== null) {
        expect(toolNames, `${entry.id} expectedTool`).toContain(entry.expectedTool);
      }
      for (const name of entry.mustNotSelect) {
        expect(toolNames, `${entry.id} mustNotSelect`).toContain(name);
      }
    }
  });

  it("never lists the expected tool as one that must not be selected", () => {
    for (const entry of corpus.cases) {
      if (entry.expectedTool === null) continue;
      expect(entry.mustNotSelect, entry.id).not.toContain(entry.expectedTool);
    }
  });

  it("records arguments that satisfy the real input schema", () => {
    for (const entry of corpus.cases) {
      if (entry.expectedTool === null) continue;
      const tool = toolsByName.get(entry.expectedTool)!;

      const parsed = tool.inputSchema.safeParse(entry.requiredArguments);
      expect(
        parsed.success,
        `${entry.id}: arguments rejected by ${entry.expectedTool}: ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
    }
  });

  it("explains its reasoning for every case", () => {
    for (const entry of corpus.cases) {
      expect(entry.reason.length, entry.id).toBeGreaterThan(20);
      expect(entry.question.length, entry.id).toBeGreaterThan(10);
    }
  });

  it("expects a clarification wherever the tool cannot answer alone", () => {
    // Every case with no expected tool must tell the assistant what to say.
    for (const entry of corpus.cases.filter((item) => item.expectedTool === null)) {
      expect(entry.expectedClarification, entry.id).toBeTruthy();
    }
  });

  it("covers every documented ambiguity pair", () => {
    // Mirrors the routing-ambiguity register in docs/tool-catalogue.md.
    const pairs: [string, string][] = [
      ["search_norwegian_companies", "get_norwegian_company_profile"],
      ["search_norwegian_addresses", "get_norwegian_location_profile"],
      ["get_norwegian_location_profile", "get_norwegian_weather_forecast"],
      ["get_norwegian_weather_forecast", "get_current_norwegian_hazards"],
      ["get_norwegian_municipality_profile", "query_norwegian_statistics"],
      ["get_norwegian_electricity_prices", "query_norwegian_statistics"],
      ["get_norwegian_transport_departures", "search_norwegian_addresses"],
      ["get_norwegian_municipality_profile", "resolve_norwegian_administrative_code"],
      ["resolve_norwegian_administrative_code", "search_norwegian_classification_codes"],
      ["query_norwegian_statistics", "search_norwegian_classification_codes"],
      ["get_vessel_profile", "get_vessel_track"],
      ["get_vessel_track", "get_live_vessel_positions"],
      ["search_fishing_vessels", "get_fishing_vessel"],
      ["search_aquaculture_locations", "get_aquaculture_location"],
      ["get_marine_forecast", "get_norwegian_weather_forecast"],
      ["get_live_vessel_positions", "get_vessel_profile"],
    ];

    for (const [a, b] of pairs) {
      const covered = corpus.cases.some(
        (entry) =>
          (entry.expectedTool === a && entry.mustNotSelect.includes(b)) ||
          (entry.expectedTool === b && entry.mustNotSelect.includes(a)),
      );
      expect(covered, `ambiguity pair ${a} vs ${b} is not covered by the corpus`).toBe(true);
    }
  });

  it("exercises every tool at least once", () => {
    const exercised = new Set(
      corpus.cases
        .map((entry) => entry.expectedTool)
        .filter((name): name is string => name !== null),
    );
    for (const name of toolNames) {
      expect(exercised, `${name} has no positive routing case`).toContain(name);
    }
  });

  it("includes out-of-scope cases so the assistant learns to decline", () => {
    const outOfScope = corpus.cases.filter((entry) => entry.expectedTool === null);
    expect(outOfScope.length).toBeGreaterThanOrEqual(3);
  });
});
