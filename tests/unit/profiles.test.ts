/**
 * The three cross-provider profile tools: company, location and municipality.
 *
 * These carry the project's most important interpretation rules — component
 * provenance, the hazard non-all-clear notice, and FHI suppression — so the
 * assertions here are about meaning, not only shape.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileComponent } from "norway-open-data-sdk";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  SOURCES,
  createFakeSdk,
  respond,
  sampleAddressProfile,
  sampleCompanyProfile,
  sampleHazard,
  sampleMunicipalityProfile,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const omittedWeather: ProfileComponent = {
  operation: "weather.current",
  section: "weather",
  status: "omitted",
  source: SOURCES["met"]!,
  reason: "not-configured",
};

const failedHazards: ProfileComponent = {
  operation: "hazards.getFloodWarnings",
  section: "hazards",
  status: "omitted",
  source: SOURCES["nve"]!,
  reason: "provider-error",
  error: { name: "ProviderError", message: "NVE returned 503." },
};

describe("get_norwegian_company_profile", () => {
  it("returns the company with its official coordinate match", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          company: () => Promise.resolve(respond(sampleCompanyProfile, SOURCES["brreg"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_company_profile", {
      organizationNumber: "923609016",
    });

    const company = envelope.data["company"] as Record<string, unknown>;
    expect(company["name"]).toBe("EQUINOR ASA");
    expect(envelope.data["location"]).toMatchObject({ matchConfidence: "exact" });
    expect(envelope.sources[0]!.id).toBe("brreg");
    expect(envelope.text).toContain("Coordinate: 58.8944, 5.7086");
  });

  it("warns when the coordinate match is not exact", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          company: () =>
            Promise.resolve(
              respond(
                {
                  ...sampleCompanyProfile,
                  location: { ...sampleCompanyProfile.location!, matchConfidence: "possible" },
                },
                SOURCES["brreg"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_company_profile", {
      organizationNumber: "923609016",
    });

    expect(envelope.warnings.join(" ")).toContain("not exact");
  });

  it("distinguishes a genuinely unknown organization from an outage", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          company: () =>
            Promise.reject(
              sdkError("NotFoundError", "Organization 000000000 was not found.", {
                provider: "brreg",
                statusCode: 404,
              }),
            ),
        },
      }),
    });

    const error = await harness.callErr("get_norwegian_company_profile", {
      organizationNumber: "000000000",
    });

    expect(error).toMatchObject({ code: "not_found", retryable: false, statusCode: 404 });
  });

  it.each([
    ["blank", "   "],
    ["too short", "12345"],
    ["letters", "abcdefghi"],
    ["too long", "1234567890"],
  ])("rejects an organization number that is %s", async (_label, organizationNumber) => {
    harness = await createHarness({ sdk: createFakeSdk() });

    const call = await harness.call("get_norwegian_company_profile", { organizationNumber });

    expect(call.isError).toBe(true);
  });
});

describe("get_norwegian_location_profile", () => {
  it("always attaches the hazard non-all-clear notice", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () => Promise.resolve(respond(sampleAddressProfile, SOURCES["kartverket"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Karl Johans gate 1",
    });

    expect(envelope.warnings.join(" ")).toContain("never an all-clear");
    expect(envelope.data["hazards"]).toHaveLength(1);
    expect(envelope.data["hazardMatchEvidence"]).toEqual([
      "flood warning matched on municipality-code (OSLO).",
    ]);
  });

  it("attaches the notice even when there are no warnings at all", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () =>
            Promise.resolve(
              respond(
                { ...sampleAddressProfile, hazards: [], hazardMatches: [] },
                SOURCES["kartverket"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Storgata 1",
    });

    expect(envelope.data["hazards"]).toEqual([]);
    expect(envelope.warnings.join(" ")).toContain("never an all-clear");
    expect(envelope.text).toContain("not an all-clear");
  });

  it("explains a section skipped for missing configuration and names the variable", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () => {
            // The key is omitted rather than set to undefined: that is how the
            // SDK actually represents a section it never requested.
            const { weather: _weather, ...withoutWeather } = sampleAddressProfile;
            return Promise.resolve(
              respond({ ...withoutWeather, components: [omittedWeather] }, SOURCES["kartverket"]!),
            );
          },
        },
      }),
      config: { contactEmail: undefined },
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Storgata 1",
    });

    expect(envelope.data["weather"]).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("NORWAY_MCP_CONTACT_EMAIL");
    expect(envelope.partial).toMatchObject({ complete: false, missing: ["weather"] });
  });

  it("reports a failed section as a partial result rather than dropping it", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () =>
            Promise.resolve(
              respond(
                { ...sampleAddressProfile, components: [failedHazards] },
                SOURCES["kartverket"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Storgata 1",
    });

    expect(envelope.partial).toMatchObject({ complete: false, missing: ["hazards"] });
    expect(envelope.warnings.join(" ")).toContain("NVE returned 503");
  });

  it("caps and clamps oversized hazard descriptions, reporting the cut", async () => {
    const many = Array.from({ length: 40 }, () => ({
      ...sampleHazard,
      description: "x".repeat(5000),
    }));
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () =>
            Promise.resolve(
              respond({ ...sampleAddressProfile, hazards: many }, SOURCES["kartverket"]!),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Storgata 1",
    });

    const hazards = envelope.data["hazards"] as { description: string }[];
    expect(hazards).toHaveLength(20);
    expect(hazards[0]!.description).toHaveLength(1000);
    expect(hazards[0]!.description.endsWith("…")).toBe(true);
    expect(envelope.truncation!.truncated).toBe(true);
  });

  it("states that road candidates are a bounding box, not a radius", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          address: () =>
            Promise.resolve(
              respond(
                {
                  ...sampleAddressProfile,
                  roads: [
                    { sequenceId: 1, roadReference: "EV6 S1D1 m100-200", roadType: "Europaveg" },
                  ],
                  roadSearch: {
                    shape: "bounding-box",
                    halfSizeMetres: 250,
                    boundingBox: [10.74, 59.9, 10.75, 59.91],
                    requestedPageSize: 10,
                    truncated: true,
                  },
                },
                SOURCES["kartverket"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_location_profile", {
      query: "Storgata 1",
    });

    const joined = envelope.warnings.join(" ");
    expect(joined).toContain("bounding box");
    expect(joined).toContain("not a complete or distance-ranked list");
  });

  it.each([
    ["blank", "  "],
    ["too short", "a"],
    ["too long", "x".repeat(201)],
  ])("rejects a query that is %s", async (_label, query) => {
    harness = await createHarness({ sdk: createFakeSdk() });
    const call = await harness.call("get_norwegian_location_profile", { query });
    expect(call.isError).toBe(true);
  });
});

describe("get_norwegian_municipality_profile", () => {
  it("returns population, life expectancy and company counts", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          municipality: () => Promise.resolve(respond(sampleMunicipalityProfile, SOURCES["ssb"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_municipality_profile", { query: "5401" });

    expect(envelope.data["population"]).toMatchObject({ total: 78638, year: "2025", change: 647 });
    expect(envelope.data["registeredCompanies"]).toBe(9421);
    expect(envelope.text).toContain("78,638");
  });

  it("preserves an FHI suppression flag and forbids reconstruction", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          municipality: () =>
            Promise.resolve(
              respond(
                {
                  ...sampleMunicipalityProfile,
                  lifeExpectancy: {
                    years: null,
                    period: "2018_2024",
                    measure: "life_expectancy",
                    flag: ":",
                    flagMeaning: "Anonymisert eller skjult av andre årsaker",
                  },
                },
                SOURCES["ssb"]!,
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_norwegian_municipality_profile", { query: "5401" });

    expect((envelope.data["lifeExpectancy"] as { years: null }).years).toBeNull();
    const joined = envelope.warnings.join(" ");
    expect(joined).toContain("Anonymisert");
    expect(joined).toContain("must not be estimated or reconstructed");
  });

  it("accepts a four-digit code and a name, but not a mixture", async () => {
    const municipality = vi.fn(() =>
      Promise.resolve(respond(sampleMunicipalityProfile, SOURCES["ssb"]!)),
    );
    harness = await createHarness({ sdk: createFakeSdk({ profiles: { municipality } }) });

    await harness.callOk("get_norwegian_municipality_profile", { query: "0301" });
    await harness.callOk("get_norwegian_municipality_profile", { query: "Tromsø" });

    const mixed = await harness.call("get_norwegian_municipality_profile", { query: "Oslo 301" });
    expect(mixed.isError).toBe(true);
    expect(errorText(mixed)).toContain("four-digit municipality code");
  });
});
