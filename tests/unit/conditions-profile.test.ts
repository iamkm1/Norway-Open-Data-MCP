/**
 * `get_weather_conditions_profile`, the composed conditions picture added in
 * 0.5.0 on `profiles.conditionsAtLocation()`.
 *
 * The SDK composes; these tests pin what this server adds on top: bounded,
 * whitelisted sections, `null` versus present semantics, which omissions make
 * a result partial, SDK notices merged into the envelope's warnings, and
 * provenance built from the real providers with separate `met` and `met-frost`
 * entries. Cancellation is covered by tests/unit/cancellation.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConditionsAtLocationProfile } from "norway-open-data-sdk";

import { createHarness, type Harness } from "../helpers/harness.js";
import { registrySource } from "../helpers/registry.js";
import { BUDGET } from "../../src/limits/budget.js";
import { allTools } from "../../src/tools/registry.js";
import {
  COMPOSITE_PROFILE_SOURCES,
  SOURCES,
  createFakeSdk,
  respond,
  sampleAnonymousConditionsProfile,
  sampleAnonymousConditionsSources,
  sampleConditionsProfile,
  sampleConditionsSources,
  sampleForecast,
  sampleMidnightSunTimes,
  sampleWeatherWarning,
  sdkError,
} from "../../src/testing/fake-sdk.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const TOOL = "get_weather_conditions_profile";
const BERGEN = { latitude: 60.398, longitude: 5.32 };

const dataSchema = allTools.find((tool) => tool.name === TOOL)!.dataSchema;

/** The profile's optional sections, which the SDK leaves out when absent. */
type Section =
  | "municipality"
  | "forecast"
  | "nowcast"
  | "weatherWarnings"
  | "hazards"
  | "hazardMatches"
  | "sun"
  | "ocean"
  | "tides"
  | "airQuality"
  | "observations";

/** A copy of a profile without some sections, as the SDK omits them. */
function without(
  profile: ConditionsAtLocationProfile,
  ...sections: Section[]
): ConditionsAtLocationProfile {
  const copy = { ...profile };
  for (const section of sections) delete copy[section];
  return copy;
}

function profileOf(
  profile: ConditionsAtLocationProfile,
  composite = COMPOSITE_PROFILE_SOURCES["conditions"]!,
  sources = sampleConditionsSources,
) {
  return vi.fn(() => Promise.resolve(respond(profile, composite, { sources })));
}

async function profileHarness(
  conditionsAtLocation: ReturnType<typeof profileOf>,
  config: Record<string, unknown> = {},
) {
  return createHarness({
    sdk: createFakeSdk({ profiles: { conditionsAtLocation } }),
    config,
  });
}

describe("get_weather_conditions_profile", () => {
  it("returns every section when every provider answers, in one SDK call", async () => {
    const spy = profileOf(sampleConditionsProfile);
    harness = await profileHarness(spy);

    const envelope = await harness.callOk(TOOL, BERGEN);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ ...BERGEN, hours: 12 }, expect.anything());
    expect(envelope.data).toMatchObject({
      location: BERGEN,
      municipality: { municipalityCode: "4601", municipalityName: "Bergen", countyCode: "46" },
      nowcast: { radarCoverage: "ok" },
      sun: { date: "2026-07-23", polarCondition: null },
      ocean: { coordinates: { latitude: 60.4, longitude: 5.3 } },
      tides: { referenceLevel: "CD", location: { code: "BGO" } },
      airQuality: { area: { name: "Bergen sentrum", areaClass: "grunnkrets" } },
      observations: {
        station: { id: "SN50540", name: "BERGEN - FLORIDA", distanceKm: 1.2 },
        monthlyTemperatureNormal: { period: "1991/2020", month: 7, normal: 15.4 },
      },
      compositeSource: { id: "met+nve+kartverket+kartverket-tides+met-frost" },
    });
    expect(envelope.data["forecast"]).toHaveLength(12);
    expect(envelope.data["weatherWarnings"]).toHaveLength(1);
    expect(envelope.data["hazards"]).toHaveLength(1);
    expect(envelope.data["hazardMatchEvidence"]).toEqual([
      "flood warning matched on county-code (Vestland).",
    ]);
    expect(envelope.data["components"]).toHaveLength(14);
    expect(envelope.partial).toBeNull();
    expect(dataSchema.safeParse(envelope.data).success).toBe(true);
  });

  it("states every caveat its sections carry, and marks itself experimental", async () => {
    harness = await profileHarness(profileOf(sampleConditionsProfile));

    const envelope = await harness.callOk(TOOL, BERGEN);
    const notes = envelope.warnings.join("\n");

    expect(notes).toContain("Experimental");
    expect(notes).toContain("never an all-clear");
    expect(notes).toContain("MET Norway weather warnings are never an all-clear");
    expect(notes).toContain("warning areas are not included here");
    expect(notes).toContain("nearest MET Norway ocean-model cell");
    expect(notes).toContain("times are UTC");
    expect(notes).toContain("above chart datum");
    expect(notes).toContain("product version 0.1");
  });

  it("forwards the maximum horizon and bounds every list it returns", async () => {
    const spy = profileOf({
      ...sampleConditionsProfile,
      forecast: sampleForecast.timeseries,
      weatherWarnings: Array.from({ length: 25 }, (_unused, index) => ({
        ...sampleWeatherWarning,
        id: `warning-${index}`,
      })),
      warnings: Array.from({ length: 25 }, (_unused, index) => `SDK notice ${index}.`),
    });
    harness = await profileHarness(spy);

    const envelope = await harness.callOk(TOOL, { ...BERGEN, hours: 48 });

    expect(spy).toHaveBeenCalledWith({ ...BERGEN, hours: 48 }, expect.anything());
    expect(envelope.data["forecast"]).toHaveLength(48);
    expect(envelope.data["weatherWarnings"]).toHaveLength(20);
    expect(envelope.truncation?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "forecast", returned: 48, availableUpstream: 60 }),
        expect.objectContaining({ field: "weatherWarnings", returned: 20 }),
        expect.objectContaining({ field: "sdkNotices", returned: 20 }),
      ]),
    );
    expect(envelope.warnings).toContain("SDK notice 19.");
    expect(envelope.warnings).not.toContain("SDK notice 20.");
  });

  it.each([
    ["zero hours", { ...BERGEN, hours: 0 }],
    ["more than 48 hours", { ...BERGEN, hours: 49 }],
    ["fractional hours", { ...BERGEN, hours: 2.5 }],
    ["Infinity latitude", { latitude: Number.POSITIVE_INFINITY, longitude: 5.32 }],
    ["a missing longitude", { latitude: 60.398 }],
    ["an address instead of a coordinate", { query: "Bryggen, Bergen" }],
  ])("rejects %s before contacting any provider", async (_label, args) => {
    const spy = profileOf(sampleConditionsProfile);
    harness = await profileHarness(spy);

    expect((await harness.call(TOOL, args)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("works with no configuration at all and lists what each missing value would add", async () => {
    harness = await profileHarness(
      profileOf(
        sampleAnonymousConditionsProfile,
        COMPOSITE_PROFILE_SOURCES["conditions-anonymous"],
        sampleAnonymousConditionsSources,
      ),
      { contactEmail: undefined, metFrostClientId: undefined },
    );

    const envelope = await harness.callOk(TOOL, BERGEN);

    expect(envelope.data).toMatchObject({
      forecast: null,
      nowcast: null,
      weatherWarnings: null,
      sun: null,
      ocean: null,
      airQuality: null,
      observations: null,
      hazards: [],
    });
    expect(envelope.data["tides"]).not.toBeNull();
    expect(envelope.partial).toEqual({
      complete: false,
      missing: [
        "forecast: not-configured",
        "nowcast: not-configured",
        "weather-warnings: not-configured",
        "sun: not-configured",
        "ocean: not-configured",
        "air-quality: not-configured",
        "observations: not-configured",
        "climate-normals: not-configured",
      ],
      reason: expect.stringContaining("Each entry names the section and the reason") as string,
    });
    const notes = envelope.warnings.join("\n");
    expect(notes).toContain("Set NORWAY_MCP_CONTACT_EMAIL to enable it.");
    expect(notes).toContain("Set NORWAY_MCP_MET_FROST_CLIENT_ID to enable it.");
    // No MET warnings were asked for, so no MET-warning caveat is attached.
    expect(notes).not.toContain("MET Norway weather warnings are never an all-clear");
    expect(envelope.sources).toEqual([
      registrySource("kartverket"),
      {
        ...registrySource("nve"),
        attribution: "Varsler fra Flomvarslingen i Norge og www.varsom.no",
      },
      {
        ...registrySource("nve"),
        attribution: "Varsler fra Snøskredvarslingen i Norge og www.varsom.no",
      },
      {
        ...registrySource("nve"),
        attribution: "Varsler fra Jordskredvarslingen i Norge og www.varsom.no",
      },
      registrySource("kartverket-tides"),
    ]);
    expect(envelope.text).toContain(
      "Forecast: not available — see the notes and components for why.",
    );
  });

  it("does not call an uncovered section partial: no nowcast on Svalbard is an answer", async () => {
    harness = await profileHarness(
      profileOf({
        ...without(sampleConditionsProfile, "nowcast", "tides"),
        components: sampleConditionsProfile.components.map((component) =>
          component.operation === "weather.getNowcast" ||
          component.operation === "tides.getTideTable"
            ? {
                operation: component.operation,
                section: component.section,
                status: "omitted" as const,
                source: component.source,
                reason: "not-covered" as const,
              }
            : component,
        ),
      }),
    );

    const envelope = await harness.callOk(TOOL, { latitude: 78.22, longitude: 15.65 });

    expect(envelope.data["nowcast"]).toBeNull();
    expect(envelope.data["tides"]).toBeNull();
    expect(envelope.partial).toBeNull();
    expect(envelope.warnings.join(" ")).toContain(
      'The "nowcast" section is absent because met answered but publishes nothing for this subject.',
    );
    expect(envelope.text).toContain("Tides: not available");
  });

  it("keeps the other sections when one provider fails, with the SDK's notice verbatim", async () => {
    harness = await profileHarness(
      profileOf({
        ...without(sampleConditionsProfile, "tides"),
        warnings: ["Tide-table lookup failed: Kartverket returned HTTP 503."],
        components: sampleConditionsProfile.components.map((component) =>
          component.operation === "tides.getTideTable"
            ? {
                operation: component.operation,
                section: component.section,
                status: "omitted" as const,
                source: component.source,
                reason: "provider-error" as const,
                error: { name: "ProviderError", message: "Kartverket returned HTTP 503." },
              }
            : component,
        ),
      }),
    );

    const envelope = await harness.callOk(TOOL, BERGEN);

    expect(envelope.data["forecast"]).not.toBeNull();
    expect(envelope.data["tides"]).toBeNull();
    expect(envelope.partial?.missing).toEqual(["tides: provider-error"]);
    expect(envelope.warnings).toContain("Tide-table lookup failed: Kartverket returned HTTP 503.");
    expect(envelope.warnings.join(" ")).toContain(
      'The "tides" section is missing because kartverket-tides failed (ProviderError: Kartverket returned HTTP 503.)',
    );
  });

  it.each([
    [
      "every provider failing",
      sdkError("ProviderError", "Every provider needed for this profile failed.", {
        provider: "profiles",
      }),
      { code: "provider_error", provider: "profiles" },
    ],
    [
      "a rate limit",
      sdkError("RateLimitError", "Too many requests.", { provider: "met", retryAfter: 20 }),
      { code: "rate_limited", retryAfter: 20, retryable: true },
    ],
    [
      "a timeout",
      sdkError("RequestTimeoutError", "Kartverket did not answer in time.", {
        provider: "kartverket",
      }),
      { code: "timeout", retryable: true },
    ],
  ])("maps %s", async (_label, error, expected) => {
    harness = await profileHarness(vi.fn(() => Promise.reject(error)));
    expect(await harness.callErr(TOOL, BERGEN)).toMatchObject(expected);
  });

  it("credits each real provider, with met and met-frost separate and the composite absent", async () => {
    harness = await profileHarness(profileOf(sampleConditionsProfile));

    const envelope = await harness.callOk(TOOL, BERGEN);
    const ids = envelope.sources.map((source) => source.id);

    expect(ids).toContain("met");
    expect(ids).toContain("met-frost");
    expect(ids).toContain("kartverket-tides");
    expect(ids).not.toContain("met+nve+kartverket+kartverket-tides+met-frost");
    expect(envelope.sources).toContainEqual(registrySource("met"));
    expect(envelope.sources).toContainEqual(registrySource("met-frost"));
    expect(envelope.sources).toContainEqual(registrySource("kartverket-tides"));
    // NVE's three feeds keep their own required wording.
    expect(envelope.sources.filter((source) => source.id === "nve")).toHaveLength(3);
    for (const source of envelope.sources) {
      expect(source.license, source.id).toBeTruthy();
      expect(source.attribution, source.id).toBeTruthy();
    }
  });

  it("returns warning text without its area, and station fields without anything extra", async () => {
    harness = await profileHarness(
      profileOf({
        ...sampleConditionsProfile,
        observations: {
          ...sampleConditionsProfile.observations!,
          station: {
            ...sampleConditionsProfile.observations!.station,
            stationHolders: ["A private holder"],
          } as never,
        },
      }),
    );

    const envelope = await harness.callOk(TOOL, BERGEN);

    const warning = (envelope.data["weatherWarnings"] as Record<string, unknown>[])[0]!;
    expect(warning).not.toHaveProperty("geometry");
    expect(warning).not.toHaveProperty("resources");
    expect(JSON.stringify(envelope)).not.toContain("A private holder");
    expect(JSON.stringify(envelope.data)).not.toContain("wigosId");
  });

  it("explains a polar day in the sun section", async () => {
    harness = await profileHarness(
      profileOf({ ...sampleConditionsProfile, sun: sampleMidnightSunTimes }),
    );

    const envelope = await harness.callOk(TOOL, { latitude: 69.65, longitude: 18.96 });

    expect(envelope.data["sun"]).toMatchObject({ polarCondition: "midnight-sun", sunrise: null });
    expect(envelope.warnings.join(" ")).toContain("Midnight sun");
    expect(envelope.text).toContain(
      "Sun (2026-06-21): Midnight sun — the sun does not set on this date.",
    );
  });

  it("renders deterministic, bounded text covering each section", async () => {
    harness = await profileHarness(profileOf(sampleConditionsProfile));

    const first = await harness.callOk(TOOL, BERGEN);
    const second = await harness.callOk(TOOL, BERGEN);

    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeLessThanOrEqual(BUDGET.maxTextChars);
    for (const fragment of [
      "Conditions at 60.398, 5.32",
      "Municipality: Bergen",
      "Forecast (12 hours): now 20°C, wind 3 m/s, partlycloudy_day.",
      "Nowcast: 19 of 25 five-minute steps with precipitation.",
      "MET Norway weather warnings (1):",
      "NVE hazard warnings:",
      "Sun (2026-07-23): Sunrise: 2026-07-23T04:38+02:00",
      "Ocean: sea 15.2°C, waves 0.4 m",
      "Tides (UTC, cm above chart datum, from Bergen (BGO)",
      "Air quality (experimental model forecast) for Bergen sentrum: 12 hourly entries.",
      "Observations at BERGEN - FLORIDA (SN50540), 1.2 km away:",
      "air_temperature 16.8 degC; wind_speed 5.4 m/s",
      "1991/2020 normal for this month: 15.4",
    ]) {
      expect(first.text).toContain(fragment);
    }
  });

  it("renders a profile stripped to its required fields without inventing anything", async () => {
    harness = await profileHarness(
      profileOf(
        {
          location: { latitude: 71.1, longitude: 31 },
          warnings: [],
          components: [
            {
              operation: "places.getMunicipalityAt",
              section: "municipality",
              status: "omitted",
              source: SOURCES["kartverket"]!,
              reason: "not-covered",
            },
            {
              operation: "tides.getTideTable",
              section: "tides",
              status: "available",
              source: SOURCES["kartverket-tides"]!,
              retrievedAt: "2026-07-23T12:00:00.000Z",
              cached: false,
            },
          ],
          // A covered sea point with sparse sections everywhere it can be sparse.
          tides: {
            location: { name: "Vardø", code: "VAW", latitude: 70.37, longitude: 31.1 },
            referenceLevel: "CD",
            unit: "cm",
            serviceMessages: [],
            events: [],
          },
          ocean: { coordinates: { latitude: 71.1, longitude: 31 }, entries: [] },
          forecast: [],
          observations: {
            station: { id: "SN98550", name: "VARDØ RADIO", externalIds: [], icaoCodes: [] },
          },
          airQuality: {
            referenceTime: "2026-07-23T00:00:00Z",
            area: {
              name: "Vardø",
              areaClass: "kommune",
              areaCode: "5634",
              latitude: 70.37,
              longitude: 31.1,
            },
            entries: [{ from: "2026-07-23T10:00:00Z", to: "2026-07-23T11:00:00Z" }],
          },
        },
        COMPOSITE_PROFILE_SOURCES["conditions-anonymous"],
        [SOURCES["kartverket-tides"]!],
      ),
    );

    const envelope = await harness.callOk(TOOL, { latitude: 71.1, longitude: 31 });

    expect(envelope.data).toMatchObject({
      municipality: null,
      hazards: null,
      hazardMatchEvidence: [],
      observations: { latest: [], monthlyTemperatureNormal: null },
    });
    expect(envelope.text).toContain("Forecast (0 hours): no entries.");
    expect(envelope.text).toContain("Ocean: no entries.");
    expect(envelope.text).toContain("No high or low water falls inside this window.");
    expect(envelope.text).toContain("Observations at VARDØ RADIO (SN98550):");
    expect(envelope.text).not.toContain("undefined");
    expect(dataSchema.safeParse(envelope.data).success).toBe(true);
  });
});
