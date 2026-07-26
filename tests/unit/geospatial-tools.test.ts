/**
 * The geospatial tool set: SDK delegation, spatial input validation, output
 * bounds, geometry handling, attribution and partial results.
 *
 * Every test drives the real MCP path through the harness, so input schema
 * validation, output schema validation and error mapping are exercised
 * alongside the handler. Nothing here touches the network: the SDK surface is a
 * fake returning the exact shapes `norway-open-data-sdk@0.8.0` declares.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeonorgeMetadata,
  InterventionFreeAreaFeature,
  ProposedProtectedAreaFeature,
  LandResourceFeature,
  NatureTypeFeature,
  ProtectedAreaFeature,
} from "norway-open-data-sdk";

import { createHarness, errorText, type Harness } from "../helpers/harness.js";
import {
  COMPOSITE_PROFILE_SOURCES,
  SOURCES,
  createFakeSdk,
  landResourceResult,
  naturbaseResult,
  respond,
  sampleGeonorgeDatasetSearch,
  sampleGeonorgeMetadata,
  sampleHugeGeometry,
  sampleInterventionFreeArea,
  sampleLandResource,
  sampleMultiPolygon,
  sampleNatureProfile,
  sampleNatureType,
  sampleNullGeometryLandResource,
  samplePartialNatureProfile,
  samplePolygonWithHole,
  sampleProposedProtectedArea,
  sampleProtectedArea,
  sdkError,
} from "../../src/testing/fake-sdk.js";
import {
  MAX_GEOMETRY_VERTICES_PER_FEATURE,
  MAX_GEOMETRY_VERTICES_PER_RESULT,
} from "../../src/tools/shared/geo.js";
import { MAX_FEATURE_BOX_SPAN_DEGREES } from "../../src/tools/shared/schemas.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const POINT = { latitude: 61.1, longitude: 8.1 };
const BOX = { south: 61.0, west: 8.0, north: 61.2, east: 8.4 };

const protectedAreasAt = (features: ProtectedAreaFeature[] = [sampleProtectedArea]) =>
  vi.fn(() => Promise.resolve(respond(naturbaseResult(features), SOURCES["naturbase"]!)));

const natureTypesAt = (features: NatureTypeFeature[] = [sampleNatureType]) =>
  vi.fn(() => Promise.resolve(respond(naturbaseResult(features), SOURCES["naturbase"]!)));

const interventionFreeAt = (
  features: InterventionFreeAreaFeature[] = [sampleInterventionFreeArea],
) =>
  vi.fn(() =>
    Promise.resolve(respond(naturbaseResult(features), SOURCES["naturbase-intervention-free"]!)),
  );

const landResourcesAt = (features: LandResourceFeature[] = [sampleLandResource]) =>
  vi.fn(() => Promise.resolve(respond(landResourceResult(features), SOURCES["nibio"]!)));

/** A catalogue record that declares no licence at all. */
function withoutLicense(metadata: GeonorgeMetadata): GeonorgeMetadata {
  const { license: _license, ...rest } = metadata;
  return rest;
}

// ---------------------------------------------------------------------------
// Spatial input validation
// ---------------------------------------------------------------------------

describe("spatial input validation", () => {
  const POINT_TOOLS = [
    "get_protected_areas_at",
    "get_nature_types_at",
    "get_intervention_free_nature_at",
    "get_land_resources_at",
    "get_nature_profile",
  ] as const;

  it("refuses NaN and infinite coordinates before any provider is contacted", async () => {
    const environment = {
      getProtectedAreasAt: protectedAreasAt(),
      getNatureTypesAt: natureTypesAt(),
      getInterventionFreeAreasAt: interventionFreeAt(),
    };
    const land = { getLandResourcesAt: landResourcesAt() };
    harness = await createHarness({ sdk: createFakeSdk({ environment, land }) });

    for (const name of POINT_TOOLS) {
      for (const bad of [
        { latitude: Number.NaN, longitude: 8.1 },
        { latitude: 61.1, longitude: Number.POSITIVE_INFINITY },
        { latitude: Number.NEGATIVE_INFINITY, longitude: 8.1 },
      ]) {
        const result = await harness.call(name, bad);
        expect(result.isError, `${name} ${JSON.stringify(bad)}`).toBe(true);
      }
    }

    // Not one provider call was made for any of them.
    expect(environment.getProtectedAreasAt).not.toHaveBeenCalled();
    expect(environment.getNatureTypesAt).not.toHaveBeenCalled();
    expect(environment.getInterventionFreeAreasAt).not.toHaveBeenCalled();
    expect(land.getLandResourcesAt).not.toHaveBeenCalled();
  });

  it("refuses out-of-range coordinates", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });

    for (const bad of [
      { latitude: 91, longitude: 8.1 },
      { latitude: -90.5, longitude: 8.1 },
      { latitude: 61.1, longitude: 180.5 },
      { latitude: 61.1, longitude: -181 },
    ]) {
      const result = await harness.call("get_nature_types_at", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
  });

  it("refuses a bounding box whose north is not above its south", async () => {
    const searchProtectedAreas = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const result = await harness.call("search_protected_areas", {
      boundingBox: { south: 61.2, west: 8.0, north: 61.0, east: 8.4 },
    });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("north edge must be greater");
    expect(searchProtectedAreas).not.toHaveBeenCalled();
  });

  it("refuses an antimeridian-crossing box, which the SDK does not support", async () => {
    const searchProtectedAreas = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const result = await harness.call("search_protected_areas", {
      boundingBox: { south: 61.0, west: 179.5, north: 61.2, east: -179.5 },
    });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("antimeridian");
    expect(searchProtectedAreas).not.toHaveBeenCalled();
  });

  it("refuses a box larger than this server's own span cap, and says whose limit it is", async () => {
    const searchProtectedAreas = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const result = await harness.call("search_protected_areas", {
      boundingBox: {
        south: 60,
        west: 8,
        north: 60 + MAX_FEATURE_BOX_SPAN_DEGREES.latitude + 0.01,
        east: 8.4,
      },
    });

    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("limit of this MCP server");
    expect(searchProtectedAreas).not.toHaveBeenCalled();
  });

  it("accepts a box exactly at the cap", async () => {
    const searchProtectedAreas = vi.fn(() =>
      Promise.resolve(respond(naturbaseResult<ProtectedAreaFeature>([]), SOURCES["naturbase"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const envelope = await harness.callOk("search_protected_areas", {
      boundingBox: {
        south: 60,
        west: 8,
        north: 60 + MAX_FEATURE_BOX_SPAN_DEGREES.latitude,
        east: 8 + MAX_FEATURE_BOX_SPAN_DEGREES.longitude,
      },
    });

    expect(envelope.data["protectedAreas"]).toEqual([]);
  });

  it("refuses an empty or blank catalogue search, and an unfiltered one", async () => {
    const searchDatasets = vi.fn();
    harness = await createHarness({ sdk: createFakeSdk({ geodata: { searchDatasets } }) });

    for (const bad of [{}, { query: "   " }, { query: "a" }, { limit: 10 }]) {
      const result = await harness.call("search_geonorge_datasets", bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
    expect(searchDatasets).not.toHaveBeenCalled();
  });

  it("refuses a URL, a path traversal or a control character as a metadata ID", async () => {
    const getMetadata = vi.fn();
    harness = await createHarness({ sdk: createFakeSdk({ geodata: { getMetadata } }) });

    for (const id of [
      "https://kart.example.no/geoserver/wfs?request=GetFeature",
      "http://example.com",
      "../../etc/passwd",
      "..",
      "short",
      "has space in it",
      "with\u0000null",
    ]) {
      const result = await harness.call("get_geonorge_metadata", { id });
      expect(result.isError, id).toBe(true);
    }
    expect(getMetadata).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Limit enforcement and SDK delegation
// ---------------------------------------------------------------------------

describe("limit enforcement and SDK delegation", () => {
  it("refuses a limit above each tool's ceiling", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });

    for (const [name, args] of [
      ["get_protected_areas_at", { ...POINT, limit: 51 }],
      ["search_protected_areas", { boundingBox: BOX, limit: 101 }],
      ["get_nature_types_at", { ...POINT, limit: 51 }],
      ["get_intervention_free_nature_at", { ...POINT, limit: 26 }],
      ["get_land_resources_at", { ...POINT, limit: 26 }],
      ["get_nature_profile", { ...POINT, limit: 51 }],
      ["search_geonorge_datasets", { query: "vern", limit: 51 }],
    ] as [string, Record<string, unknown>][]) {
      const result = await harness.call(name, args);
      expect(result.isError, name).toBe(true);
    }
  });

  it("refuses a zero, negative or fractional limit", async () => {
    harness = await createHarness({ sdk: createFakeSdk() });

    for (const limit of [0, -1, 2.5]) {
      const result = await harness.call("get_nature_types_at", { ...POINT, limit });
      expect(result.isError, String(limit)).toBe(true);
    }
  });

  it("refuses the one limit that makes the intervention-free WFS answer invalidly", async () => {
    // Verified live: the SDK derives its upstream page size from the remaining
    // limit, so limit 1 asks Miljødirektoratet's WFS for COUNT=1, and whenever
    // that would match a zone the service returns a page the SDK rejects.
    // Refusing it here is clearer than a confusing upstream error.
    const getInterventionFreeAreasAt = interventionFreeAt();
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getInterventionFreeAreasAt } }),
    });

    const refused = await harness.call("get_intervention_free_nature_at", { ...POINT, limit: 1 });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toContain("at least 2");
    expect(getInterventionFreeAreasAt).not.toHaveBeenCalled();

    const accepted = await harness.callOk("get_intervention_free_nature_at", {
      ...POINT,
      limit: 2,
    });
    expect(accepted.data["interventionFreeAreas"]).toHaveLength(1);

    // The composed profile fans the same limit out to that dataset, so it
    // carries the same floor.
    const profileRefused = await harness.call("get_nature_profile", { ...POINT, limit: 1 });
    expect(profileRefused.isError).toBe(true);
  });

  it("forwards the caller's bounds to the SDK and bounds the upstream page walk", async () => {
    const getNatureTypesAt = natureTypesAt();
    harness = await createHarness({ sdk: createFakeSdk({ environment: { getNatureTypesAt } }) });

    await harness.callOk("get_nature_types_at", { ...POINT, limit: 7 });

    expect(getNatureTypesAt).toHaveBeenCalledTimes(1);
    const [query] = getNatureTypesAt.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(query).toMatchObject({ latitude: 61.1, longitude: 8.1, limit: 7 });
    // A hard ceiling on provider requests, independent of what the caller asked.
    expect(query["maxPages"]).toBeLessThanOrEqual(3);
    // `pageSize` is deliberately NOT forwarded. It is the SDK's own tuning, and
    // overriding it with the caller's limit made Miljødirektoratet's WFS return
    // a page the SDK rejected as invalid — a live failure at limit 1. The MCP
    // layer bounds what it returns, not how the SDK talks to a provider.
    expect(query).not.toHaveProperty("pageSize");
  });

  it("delegates each tool to exactly its own SDK method", async () => {
    const environment = {
      getProtectedAreasAt: protectedAreasAt(),
      searchProtectedAreas: vi.fn(() =>
        Promise.resolve(respond(naturbaseResult([sampleProtectedArea]), SOURCES["naturbase"]!)),
      ),
      getProposedProtectedAreasAt: vi.fn(() =>
        Promise.resolve(
          respond(naturbaseResult([sampleProposedProtectedArea]), SOURCES["naturbase"]!),
        ),
      ),
      getNatureTypesAt: natureTypesAt(),
      getInterventionFreeAreasAt: interventionFreeAt(),
    };
    const land = { getLandResourcesAt: landResourcesAt() };
    const geodata = {
      searchDatasets: vi.fn(() =>
        Promise.resolve(respond(sampleGeonorgeDatasetSearch, SOURCES["geonorge"]!)),
      ),
      getMetadata: vi.fn(() =>
        Promise.resolve(respond(sampleGeonorgeMetadata, SOURCES["geonorge"]!)),
      ),
    };
    const profiles = {
      natureAtLocation: vi.fn(() =>
        Promise.resolve(
          respond(sampleNatureProfile, COMPOSITE_PROFILE_SOURCES["nature"]!, {
            sources: [SOURCES["naturbase"]!, SOURCES["nibio"]!],
          }),
        ),
      ),
    };

    harness = await createHarness({ sdk: createFakeSdk({ environment, land, geodata, profiles }) });

    await harness.callOk("search_geonorge_datasets", { query: "vern" });
    await harness.callOk("get_geonorge_metadata", { id: sampleGeonorgeMetadata.id });
    await harness.callOk("get_protected_areas_at", { ...POINT, includeProposed: true });
    await harness.callOk("search_protected_areas", { boundingBox: BOX });
    await harness.callOk("get_nature_types_at", POINT);
    await harness.callOk("get_intervention_free_nature_at", POINT);
    await harness.callOk("get_land_resources_at", POINT);
    await harness.callOk("get_nature_profile", POINT);

    expect(geodata.searchDatasets).toHaveBeenCalledTimes(1);
    expect(geodata.getMetadata).toHaveBeenCalledTimes(1);
    expect(environment.getProtectedAreasAt).toHaveBeenCalledTimes(1);
    expect(environment.getProposedProtectedAreasAt).toHaveBeenCalledTimes(1);
    expect(environment.searchProtectedAreas).toHaveBeenCalledTimes(1);
    expect(environment.getNatureTypesAt).toHaveBeenCalledTimes(1);
    expect(environment.getInterventionFreeAreasAt).toHaveBeenCalledTimes(1);
    expect(land.getLandResourcesAt).toHaveBeenCalledTimes(1);
    expect(profiles.natureAtLocation).toHaveBeenCalledTimes(1);
  });

  it("does not query proposed protection unless it was asked for", async () => {
    const getProposedProtectedAreasAt = vi.fn();
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: { getProtectedAreasAt: protectedAreasAt(), getProposedProtectedAreasAt },
      }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", POINT);

    expect(getProposedProtectedAreasAt).not.toHaveBeenCalled();
    expect(envelope.data["proposedProtectedAreas"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty and truncated results
// ---------------------------------------------------------------------------

describe("empty and truncated results", () => {
  it("never presents an empty protected-area result as an environmental clearance", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: { getProtectedAreasAt: protectedAreasAt([]) },
      }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", POINT);

    expect(envelope.data["protectedAreas"]).toEqual([]);
    const notes = envelope.warnings.join(" ");
    expect(notes).toContain("not evidence that no species, habitat, environmental interest");
    expect(notes).toContain("four selected Naturbase datasets");
    expect(envelope.text).toContain("not an environmental clearance");
  });

  it("says what an empty intervention-free result actually means", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getInterventionFreeAreasAt: interventionFreeAt([]) } }),
    });

    const envelope = await harness.callOk("get_intervention_free_nature_at", POINT);

    expect(envelope.warnings.join(" ")).toContain(
      "within about a kilometre of major infrastructure",
    );
    expect(envelope.warnings.join(" ")).toContain("says nothing about the value");
  });

  it("reports truncation and hasMore, and offers a continuation", async () => {
    const searchProtectedAreas = vi.fn(() =>
      Promise.resolve(
        respond(
          naturbaseResult([sampleProtectedArea], {
            limit: 1,
            returned: 1,
            truncated: true,
            nextOffset: 1,
          }),
          SOURCES["naturbase"]!,
        ),
      ),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const envelope = await harness.callOk("search_protected_areas", {
      boundingBox: BOX,
      limit: 1,
    });

    const pagination = envelope.data["pagination"] as Record<string, unknown>;
    expect(pagination["truncated"]).toBe(true);
    expect(pagination["hasMore"]).toBe(true);
    expect(pagination["nextOffset"]).toBe(1);
    expect(envelope.continuation?.hasMore).toBe(true);
    expect(envelope.continuation?.nextArguments["offset"]).toBe(1);
    expect(envelope.warnings.join(" ")).toContain("not a complete inventory");
    expect(envelope.text).toContain("hasMore: true");
  });

  it("reports a complete page as complete", async () => {
    const searchProtectedAreas = vi.fn(() =>
      Promise.resolve(respond(naturbaseResult([sampleProtectedArea]), SOURCES["naturbase"]!)),
    );
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { searchProtectedAreas } }),
    });

    const envelope = await harness.callOk("search_protected_areas", { boundingBox: BOX });

    expect((envelope.data["pagination"] as Record<string, unknown>)["hasMore"]).toBe(false);
    expect(envelope.continuation).toBeNull();
    expect(envelope.warnings.join(" ")).not.toContain("not a complete inventory");
  });

  it("pages the Geonorge catalogue rather than walking it", async () => {
    const searchDatasets = vi.fn(() =>
      Promise.resolve(
        respond(
          {
            items: sampleGeonorgeDatasetSearch.items,
            pagination: {
              offset: 0,
              limit: 10,
              returned: 1,
              totalItems: 214,
              hasMore: true,
              truncated: true,
            },
          },
          SOURCES["geonorge"]!,
        ),
      ),
    );
    harness = await createHarness({ sdk: createFakeSdk({ geodata: { searchDatasets } }) });

    const envelope = await harness.callOk("search_geonorge_datasets", { query: "vern" });

    expect((envelope.data["pagination"] as Record<string, unknown>)["totalItems"]).toBe(214);
    expect(envelope.continuation?.nextArguments["offset"]).toBe(10);
    expect(envelope.text).toContain("of 214 catalogue record(s)");
  });
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe("geometry output", () => {
  it("omits geometry by default but still reports its shape", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt() } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", POINT);
    const area = (envelope.data["protectedAreas"] as Record<string, unknown>[])[0]!;

    expect(area["geometry"]).toBeNull();
    expect(area["geometrySummary"]).toMatchObject({
      type: "Polygon",
      polygonCount: 1,
      holeCount: 1,
      included: false,
      omittedReason: "not-requested",
    });
    expect(envelope.text).toContain("1 hole(s)");
  });

  it("returns a polygon with its holes intact, ring for ring", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt() } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", {
      ...POINT,
      includeGeometry: true,
    });
    const area = (envelope.data["protectedAreas"] as Record<string, unknown>[])[0]!;

    // The interior ring must survive: dropping it would silently enlarge the
    // protected area by the part explicitly excluded from it.
    expect(area["geometry"]).toEqual(samplePolygonWithHole);
    expect((area["geometry"] as { coordinates: unknown[] }).coordinates).toHaveLength(2);
    expect(area["geometrySummary"]).toMatchObject({ included: true, holeCount: 1 });
  });

  it("returns every part of a multipolygon, including a part's holes", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ land: { getLandResourcesAt: landResourcesAt() } }),
    });

    const envelope = await harness.callOk("get_land_resources_at", {
      ...POINT,
      includeGeometry: true,
    });
    const area = (envelope.data["landResources"] as Record<string, unknown>[])[0]!;

    expect(area["geometry"]).toEqual(sampleMultiPolygon);
    expect((area["geometry"] as { coordinates: unknown[][] }).coordinates).toHaveLength(2);
    expect(area["geometrySummary"]).toMatchObject({
      type: "MultiPolygon",
      polygonCount: 2,
      holeCount: 1,
      included: true,
    });
  });

  it("handles a provider feature with null geometry without losing its attributes", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        land: { getLandResourcesAt: landResourcesAt([sampleNullGeometryLandResource]) },
      }),
    });

    const envelope = await harness.callOk("get_land_resources_at", {
      ...POINT,
      includeGeometry: true,
    });
    const area = (envelope.data["landResources"] as Record<string, unknown>[])[0]!;

    expect(area["geometry"]).toBeNull();
    expect(area["id"]).toBe("AR50-null");
    expect(area["landTypeCode"]).toBe("99");
    expect(area["geometrySummary"]).toMatchObject({
      type: "none",
      vertexCount: 0,
      included: false,
      omittedReason: "not-published",
    });
    expect(envelope.warnings.join(" ")).toContain("null geometry from the provider");
  });

  it("drops an oversized geometry whole rather than simplifying it, and says so", async () => {
    const huge: ProtectedAreaFeature = {
      ...sampleProtectedArea,
      geometry: sampleHugeGeometry,
    };
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt([huge]) } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", {
      ...POINT,
      includeGeometry: true,
    });
    const area = (envelope.data["protectedAreas"] as Record<string, unknown>[])[0]!;

    expect(area["geometry"]).toBeNull();
    expect(area["geometrySummary"]).toMatchObject({
      type: "Polygon",
      included: false,
      omittedReason: "too-large",
      vertexCount: 6_000,
    });
    // The attributes are untouched: only the coordinates were refused.
    expect(area["name"]).toBe("Jotunheimen");
    expect(envelope.truncation?.truncated).toBe(true);
    expect(envelope.warnings.join(" ")).toContain(
      `exceeding ${MAX_GEOMETRY_VERTICES_PER_FEATURE} vertices`,
    );
    expect(envelope.warnings.join(" ")).toContain("dropped whole rather than simplified");
  });

  it("stops including geometry once the result-wide vertex budget is spent", async () => {
    // Each feature is individually acceptable; together they exceed the result
    // budget, so later ones lose their coordinates and are reported.
    const perFeature = MAX_GEOMETRY_VERTICES_PER_FEATURE;
    const count = Math.ceil(MAX_GEOMETRY_VERTICES_PER_RESULT / perFeature) + 2;
    const ring = Array.from(
      { length: perFeature },
      (_unused, index) => [8 + index / 1_000_000, 61 + index / 1_000_000] as [number, number],
    );
    const features: ProtectedAreaFeature[] = Array.from({ length: count }, (_unused, index) => ({
      ...sampleProtectedArea,
      id: `VV0000${String(index)}`,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { ...sampleProtectedArea.properties, id: `VV0000${String(index)}` },
    }));

    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt(features) } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", {
      ...POINT,
      includeGeometry: true,
      limit: count,
    });
    const areas = envelope.data["protectedAreas"] as Record<string, unknown>[];

    const summaries = areas.map((area) => area["geometrySummary"] as Record<string, unknown>);
    expect(summaries.filter((summary) => summary["included"] === true).length).toBeGreaterThan(0);
    expect(summaries.some((summary) => summary["omittedReason"] === "result-budget")).toBe(true);
    // Every feature is still present; only coordinates were rationed.
    expect(areas).toHaveLength(count);
    expect(envelope.warnings.join(" ")).toContain("vertex budget");
  });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe("attribution", () => {
  it("credits Miljødirektoratet with its NLOD licence and required wording", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt() } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", POINT);

    expect(envelope.sources).toHaveLength(1);
    expect(envelope.sources[0]).toMatchObject({
      id: "naturbase",
      license: "Norwegian Licence for Open Government Data (NLOD)",
    });
    expect(envelope.sources[0]?.attribution).toContain("Miljødirektoratet");
    expect(envelope.text).toContain("Licence: Norwegian Licence for Open Government Data (NLOD)");
    expect(envelope.retrievedAt).toBe("2026-07-23T12:00:00.000Z");
  });

  it("keeps the intervention-free layer's own licence and attribution wording", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getInterventionFreeAreasAt: interventionFreeAt() } }),
    });

    const envelope = await harness.callOk("get_intervention_free_nature_at", POINT);

    expect(envelope.sources[0]?.attribution).toBe("Miljødirektoratet - inngrepsfri natur 01.2023");
    expect(envelope.sources[0]?.license).toContain("NLOD) 1.0");
  });

  it("credits NIBIO on AR50 results", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ land: { getLandResourcesAt: landResourcesAt() } }),
    });

    const envelope = await harness.callOk("get_land_resources_at", POINT);

    expect(envelope.sources[0]).toMatchObject({ id: "nibio", attribution: "Kilde: NIBIO." });
  });

  it("credits Geonorge and repeats that catalogued resources carry their own terms", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          searchDatasets: () =>
            Promise.resolve(respond(sampleGeonorgeDatasetSearch, SOURCES["geonorge"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("search_geonorge_datasets", { query: "vern" });

    expect(envelope.sources[0]?.id).toBe("geonorge");
    expect(envelope.sources[0]?.attribution).toContain("Kartverket");
    expect(envelope.warnings.join(" ")).toContain("publisher licence and access constraints");
  });
});

// ---------------------------------------------------------------------------
// The nature profile
// ---------------------------------------------------------------------------

describe("get_nature_profile", () => {
  const completeProfile = () =>
    createFakeSdk({
      profiles: {
        natureAtLocation: () =>
          Promise.resolve(
            respond(sampleNatureProfile, COMPOSITE_PROFILE_SOURCES["nature"]!, {
              sources: [
                SOURCES["naturbase"]!,
                SOURCES["naturbase-intervention-free"]!,
                SOURCES["nibio"]!,
                SOURCES["kartverket"]!,
              ],
            }),
          ),
      },
    });

  it("returns every available component with its place and municipality context", async () => {
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);

    expect(envelope.data["location"]).toEqual({ latitude: 61.1, longitude: 8.1 });
    expect(envelope.data["municipality"]).toMatchObject({ name: "Lom", countyName: "Innlandet" });
    expect(envelope.data["nearestPlace"]).toMatchObject({ name: "Galdhøpiggen", type: "fjell" });
    expect(envelope.data["protectedAreas"]).toHaveLength(1);
    expect(envelope.data["proposedProtectedAreas"]).toHaveLength(1);
    expect(envelope.data["natureTypes"]).toHaveLength(1);
    expect(envelope.data["interventionFreeAreas"]).toHaveLength(1);
    expect(envelope.data["landResources"]).toHaveLength(1);
    expect(envelope.partial).toBeNull();
    expect(envelope.text).toContain("Nature profile for 61.1, 8.1");
    expect(envelope.text).toContain("Galdhøpiggen");
  });

  it("credits every real provider, never the SDK's synthetic composite source", async () => {
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const ids = envelope.sources.map((source) => source.id);

    expect(ids).not.toContain("naturbase+nibio+kartverket");
    expect(ids).toContain("naturbase");
    expect(ids).toContain("nibio");
    expect(ids).toContain("kartverket");
    for (const source of envelope.sources) {
      expect(source.license, `${source.id} licence`).toBeTruthy();
      expect(source.attribution, `${source.id} attribution`).toBeTruthy();
    }
  });

  it("keeps two Naturbase entries when their licence terms differ", async () => {
    // The intervention-free layer shares the `naturbase` id but carries its own
    // licence version and its own required wording. Keying provenance on the id
    // alone would silently drop one of them.
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const naturbase = envelope.sources.filter((source) => source.id === "naturbase");

    expect(naturbase).toHaveLength(2);
    expect(naturbase.map((source) => source.attribution)).toContain(
      "Miljødirektoratet - inngrepsfri natur 01.2023",
    );
  });

  it("preserves the synthetic composite source as data rather than as attribution", async () => {
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const composite = envelope.data["compositeSource"] as Record<string, unknown>;

    expect(composite["id"]).toBe("naturbase+nibio+kartverket");
    expect(composite["documentation"]).toContain("cross-provider-nature-profile");
    // It is not a provider, so it must carry no licence field at all.
    expect(composite["license"]).toBeUndefined();
    expect(composite["attribution"]).toBeUndefined();
  });

  it("survives a provider failure without losing the components that succeeded", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          natureAtLocation: () =>
            Promise.resolve(
              respond(samplePartialNatureProfile, COMPOSITE_PROFILE_SOURCES["nature"]!, {
                sources: [SOURCES["naturbase"]!, SOURCES["nibio"]!],
              }),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_nature_profile", POINT);

    // Failed sections are null, not empty: "the provider failed" and "the
    // provider found nothing" must stay distinguishable.
    expect(envelope.data["protectedAreas"]).toBeNull();
    expect(envelope.data["proposedProtectedAreas"]).toBeNull();
    // Successful ones are intact.
    expect(envelope.data["natureTypes"]).toHaveLength(1);
    expect(envelope.data["landResources"]).toHaveLength(1);

    expect(envelope.partial?.complete).toBe(false);
    expect(envelope.partial?.missing).toContain("protected-areas");

    const notes = envelope.warnings.join(" ");
    // The SDK's own failure notice is preserved verbatim.
    expect(notes).toContain("Protected-area lookup failed");
    expect(notes).toContain("naturbase failed");
    expect(envelope.text).toContain("Protected areas: unavailable");
  });

  it("still credits the providers that answered when others failed", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          natureAtLocation: () =>
            Promise.resolve(
              respond(samplePartialNatureProfile, COMPOSITE_PROFILE_SOURCES["nature"]!, {
                sources: [SOURCES["naturbase"]!, SOURCES["nibio"]!],
              }),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const ids = envelope.sources.map((source) => source.id);

    expect(ids).toEqual(expect.arrayContaining(["naturbase", "nibio"]));
    // Kartverket was omitted as not-found, so it contributed nothing and is not
    // credited.
    expect(ids).not.toContain("kartverket");
  });

  it("reports each section's own pagination and truncation", async () => {
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const pagination = envelope.data["pagination"] as Record<
      string,
      Record<string, unknown> | null
    >;

    expect(pagination["protectedAreas"]).toMatchObject({ truncated: false, hasMore: false });
    expect(pagination["landResources"]).toMatchObject({ truncated: true, hasMore: true });
    // A section the SDK did not report on stays null rather than claiming zero.
    expect(pagination["natureTypes"]).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("land resources result was truncated");
  });

  it("carries every dataset caveat, including the AR50 and CRS limits", async () => {
    harness = await createHarness({ sdk: completeProfile() });

    const envelope = await harness.callOk("get_nature_profile", POINT);
    const notes = envelope.warnings.join(" ");

    expect(notes).toContain("four selected Naturbase datasets");
    expect(notes).toContain("AR50 is a generalized national land-resource map");
    expect(notes).toContain("January 2023 status only");
    expect(notes).toContain("neither the SDK nor this server reprojects coordinates locally");
    expect(notes).toContain("not from an administrative boundary lookup");
  });
});

// ---------------------------------------------------------------------------
// Projection and privacy
// ---------------------------------------------------------------------------

describe("projection", () => {
  it("labels the AR50 land type but passes the other class codes through undecoded", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({ land: { getLandResourcesAt: landResourcesAt() } }),
    });

    const envelope = await harness.callOk("get_land_resources_at", POINT);
    const area = (envelope.data["landResources"] as Record<string, unknown>[])[0]!;

    expect(area["landTypeCode"]).toBe("30");
    expect(area["landType"]).toBe("Forest (skog)");
    // Codes this server cannot cite a published list for are not invented.
    expect(area["forestProductivityCode"]).toBe("12");
    expect(area).not.toHaveProperty("forestProductivity");
    expect(envelope.warnings.join(" ")).toContain("returned undecoded");
  });

  it("returns the raw code unlabelled when it is outside the known list", async () => {
    const unknown: LandResourceFeature = {
      ...sampleLandResource,
      properties: { ...sampleLandResource.properties, landTypeCode: "77" as never },
    };
    harness = await createHarness({
      sdk: createFakeSdk({ land: { getLandResourcesAt: landResourcesAt([unknown]) } }),
    });

    const envelope = await harness.callOk("get_land_resources_at", POINT);
    const area = (envelope.data["landResources"] as Record<string, unknown>[])[0]!;

    expect(area["landTypeCode"]).toBe("77");
    expect(area["landType"]).toBeUndefined();
    expect(envelope.warnings.join(" ")).toContain("rather than guessed at");
  });

  it("reduces catalogue contacts to organizations, never named individuals", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          getMetadata: () => Promise.resolve(respond(sampleGeonorgeMetadata, SOURCES["geonorge"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_geonorge_metadata", {
      id: sampleGeonorgeMetadata.id,
    });

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("Kari Nordmann");
    expect(serialized).not.toContain("kari.nordmann@example.no");
    expect(envelope.data["contacts"]).toEqual([
      { organization: "Miljødirektoratet", role: "pointOfContact" },
    ]);
    expect(envelope.warnings.join(" ")).toContain("Named individuals");
  });

  it("describes advertised endpoints without offering to call them", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          getMetadata: () => Promise.resolve(respond(sampleGeonorgeMetadata, SOURCES["geonorge"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_geonorge_metadata", {
      id: sampleGeonorgeMetadata.id,
    });

    expect(envelope.data["distributions"]).toEqual([
      expect.objectContaining({ kind: "wfs", formats: ["GML 3.2"] }),
    ]);
    expect(envelope.warnings.join(" ")).toContain("This server does not call them");
    expect(envelope.data["license"]).toMatchObject({
      name: "Norsk lisens for offentlige data (NLOD)",
    });
  });

  it("warns rather than implies permission when a catalogue record declares no licence", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          getMetadata: () =>
            Promise.resolve(respond(withoutLicense(sampleGeonorgeMetadata), SOURCES["geonorge"]!)),
        },
      }),
    });

    const envelope = await harness.callOk("get_geonorge_metadata", {
      id: sampleGeonorgeMetadata.id,
    });

    expect(envelope.data["license"]).toBeNull();
    expect(envelope.warnings.join(" ")).toContain("Absence of a licence field is not permission");
  });
});

// ---------------------------------------------------------------------------
// Sparse provider payloads
// ---------------------------------------------------------------------------

describe("sparse provider payloads", () => {
  // Every optional attribute absent. Providers legitimately publish records
  // this thin, and a tool that assumed a field would render "undefined" into a
  // model's context or fail output-schema validation.

  it("renders a protected area that carries nothing but an identifier", async () => {
    const bare: ProtectedAreaFeature = {
      type: "Feature",
      geometry: null,
      properties: { id: "VV99999" },
    };
    harness = await createHarness({
      sdk: createFakeSdk({ environment: { getProtectedAreasAt: protectedAreasAt([bare]) } }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", POINT);
    const area = (envelope.data["protectedAreas"] as Record<string, unknown>[])[0]!;

    expect(area).toEqual({
      id: "VV99999",
      geometry: null,
      geometrySummary: {
        type: "none",
        polygonCount: 0,
        holeCount: 0,
        vertexCount: 0,
        included: false,
        omittedReason: "not-published",
      },
    });
    expect(envelope.text).toContain("(unnamed)");
    expect(envelope.text).not.toContain("undefined");
  });

  it("renders a proposed area, a nature locality and an AR50 polygon with no attributes", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: {
          getProtectedAreasAt: protectedAreasAt([]),
          getProposedProtectedAreasAt: vi.fn(() =>
            Promise.resolve(
              respond(
                naturbaseResult<ProposedProtectedAreaFeature>([
                  { type: "Feature", geometry: null, properties: { id: "FV1" } },
                ]),
                SOURCES["naturbase"]!,
              ),
            ),
          ),
          getNatureTypesAt: natureTypesAt([
            { type: "Feature", geometry: null, properties: { id: "NIN1" } },
          ]),
        },
        land: {
          getLandResourcesAt: landResourcesAt([
            { type: "Feature", geometry: null, properties: { id: "AR1" } },
          ]),
        },
      }),
    });

    const proposed = await harness.callOk("get_protected_areas_at", {
      ...POINT,
      includeProposed: true,
    });
    expect((proposed.data["proposedProtectedAreas"] as unknown[])[0]).toMatchObject({ id: "FV1" });
    expect(proposed.text).toContain("(unnamed)");

    const nature = await harness.callOk("get_nature_types_at", POINT);
    expect((nature.data["natureTypes"] as unknown[])[0]).toMatchObject({ id: "NIN1" });
    expect(nature.text).toContain("(unclassified)");

    const land = await harness.callOk("get_land_resources_at", POINT);
    expect((land.data["landResources"] as unknown[])[0]).toEqual({
      id: "AR1",
      geometry: null,
      geometrySummary: {
        type: "none",
        polygonCount: 0,
        holeCount: 0,
        vertexCount: 0,
        included: false,
        omittedReason: "not-published",
      },
    });
    expect(land.text).toContain("Land type (unstated)");
  });

  it("renders a catalogue hit and a catalogue record stripped to their required fields", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          searchDatasets: () =>
            Promise.resolve(
              respond(
                {
                  items: [
                    {
                      type: "dataset",
                      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                      title: "Bare record",
                      themes: [],
                      access: { isRestricted: true, isProtected: false },
                    },
                  ],
                  pagination: {
                    offset: 0,
                    limit: 10,
                    returned: 1,
                    totalItems: 1,
                    hasMore: false,
                    truncated: false,
                  },
                },
                SOURCES["geonorge"]!,
              ),
            ),
          getMetadata: () =>
            Promise.resolve(
              respond(
                {
                  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  title: "Bare record",
                  type: "unknown",
                  themes: [],
                  keywords: [],
                  referenceSystems: [],
                  contacts: [],
                  access: { isRestricted: false, isProtected: false },
                  updates: {},
                  distributions: [],
                  services: [],
                  operatesOn: [],
                },
                SOURCES["geonorge"]!,
              ),
            ),
        },
      }),
    });

    const search = await harness.callOk("search_geonorge_datasets", { query: "bare" });
    expect(search.text).toContain("Access: restricted");
    expect(search.warnings.join(" ")).toContain("restricted or protected");

    const record = await harness.callOk("get_geonorge_metadata", {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(record.data["geographicExtent"]).toBeNull();
    expect(record.data["license"]).toBeNull();
    expect(record.data["contacts"]).toEqual([]);
    expect(record.text).toContain("not declared in the catalogue");
    expect(record.text).not.toContain("undefined");
    // With no endpoints and no contacts, neither of those notes is emitted.
    expect(record.warnings.join(" ")).not.toContain("This server does not call them");
    expect(record.warnings.join(" ")).not.toContain("Named individuals");
  });

  it("renders a nature profile with no place, no municipality and empty sections", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        profiles: {
          natureAtLocation: () =>
            Promise.resolve(
              respond(
                {
                  location: POINT,
                  protectedAreas: [],
                  natureTypes: [],
                  interventionFreeAreas: [],
                  landResources: [],
                  proposedProtectedAreas: [],
                  pagination: {},
                  warnings: [],
                  components: [
                    {
                      operation: "environment.getProtectedAreasAt",
                      section: "protected-areas",
                      status: "available",
                      source: SOURCES["naturbase"]!,
                      retrievedAt: "2026-07-23T12:00:00.000Z",
                      cached: false,
                    },
                  ],
                },
                COMPOSITE_PROFILE_SOURCES["nature"]!,
                { sources: [SOURCES["naturbase"]!] },
              ),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_nature_profile", POINT);

    expect(envelope.data["municipality"]).toBeNull();
    expect(envelope.data["nearestPlace"]).toBeNull();
    expect(envelope.data["protectedAreas"]).toEqual([]);
    expect(envelope.partial).toBeNull();
    expect(envelope.text).toContain("none cover this point");
    expect(envelope.text).toContain("none mapped at this point");
    expect(envelope.text).not.toContain("undefined");
    // No place was resolved, so the boundary-inference caveat is not claimed.
    expect(envelope.warnings.join(" ")).not.toContain("administrative boundary lookup");
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  it("maps a Naturbase outage to a retryable provider error", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: {
          getNatureTypesAt: () =>
            Promise.reject(
              sdkError("ProviderError", "Miljødirektoratet returned HTTP 503.", {
                provider: "naturbase",
                statusCode: 503,
              }),
            ),
        },
      }),
    });

    const error = await harness.callErr("get_nature_types_at", POINT);

    expect(error.code).toBe("provider_error");
    expect(error.provider).toBe("naturbase");
    expect(error.retryable).toBe(true);
  });

  it("maps an unknown catalogue identifier to not_found without retry advice", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        geodata: {
          getMetadata: () =>
            Promise.reject(
              sdkError("NotFoundError", "Geonorge holds no record for that identifier.", {
                provider: "geonorge",
                statusCode: 404,
              }),
            ),
        },
      }),
    });

    const error = await harness.callErr("get_geonorge_metadata", {
      id: "dd9d5e94-5b3d-4e46-9b3c-000000000009",
    });

    expect(error.code).toBe("not_found");
    expect(error.retryable).toBe(false);
  });

  it("fails the whole call when the dataset the tool exists for is unavailable", async () => {
    // The current-protection lookup is the reason this tool exists, so its
    // failure is an error rather than a partial result.
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: {
          getProtectedAreasAt: () =>
            Promise.reject(
              sdkError("ProviderError", "Miljødirektoratet is unavailable.", {
                provider: "naturbase",
              }),
            ),
          getProposedProtectedAreasAt: () =>
            Promise.resolve(
              respond(naturbaseResult([sampleProposedProtectedArea]), SOURCES["naturbase"]!),
            ),
        },
      }),
    });

    const error = await harness.callErr("get_protected_areas_at", {
      ...POINT,
      includeProposed: true,
    });

    expect(error.code).toBe("provider_error");
  });

  it("keeps the protection answer when only the proposal lookup fails", async () => {
    harness = await createHarness({
      sdk: createFakeSdk({
        environment: {
          getProtectedAreasAt: protectedAreasAt(),
          getProposedProtectedAreasAt: () =>
            Promise.reject(
              sdkError("ProviderError", "Miljødirektoratet is unavailable.", {
                provider: "naturbase",
              }),
            ),
        },
      }),
    });

    const envelope = await harness.callOk("get_protected_areas_at", {
      ...POINT,
      includeProposed: true,
    });

    expect(envelope.data["protectedAreas"]).toHaveLength(1);
    expect(envelope.data["proposedProtectedAreas"]).toBeNull();
    expect(envelope.partial?.missing).toEqual(["proposed-protected-areas"]);
    expect(envelope.warnings.join(" ")).toContain("proposed-protection lookup failed");
  });
});
