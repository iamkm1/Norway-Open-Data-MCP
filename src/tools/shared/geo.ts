/**
 * Shared projections, bounds and caveats for the geospatial tools.
 *
 * Four invariants are enforced here so no individual tool can forget them:
 *
 * 1. **An empty result is never an all-clear.** These are four selected
 *    datasets, not a register of everything of environmental value. "Naturbase
 *    holds no mapped protected area at this point" and "there is nothing of
 *    environmental interest here" are entirely different claims, and only the
 *    first is supportable. The caveat is attached unconditionally.
 * 2. **Geometry is never silently reduced.** Feature geometry is the largest
 *    payload this server can produce. When it does not fit the budget the whole
 *    geometry is dropped and reported — never simplified, never stripped of its
 *    holes, never reduced to the first polygon of a multipolygon. Ring and
 *    polygon counts are reported either way, so a caller can always tell that
 *    an area has holes or several parts even when the coordinates are absent.
 * 3. **Provider class codes are passed through, not reinterpreted.** The SDK
 *    deliberately preserves AR50's own codes rather than decoding them. Only
 *    the land-type code, whose SOSI code list is stable and unambiguous, is
 *    given an English label here; every other code is surfaced verbatim with a
 *    pointer to NIBIO's published code lists.
 * 4. **Nothing here fetches anything.** Discovered service endpoints from the
 *    Geonorge catalogue are returned as metadata and never followed.
 */

import { z } from "zod";
import type {
  GeoJsonMultiPolygon,
  GeoJsonPolygonGeometry,
  FeaturePagePagination,
  InterventionFreeAreaFeature,
  LandResourceFeature,
  NatureTypeFeature,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
} from "norway-open-data-sdk";

import { fields } from "../../formatting/text.js";
import type { TruncationTracker } from "../../limits/budget.js";

// ---------------------------------------------------------------------------
// Caveats
// ---------------------------------------------------------------------------

/**
 * Attached to every Naturbase-derived result.
 *
 * The single most likely misreading of these tools is treating an empty
 * feature list as an environmental clearance, which no selected dataset can
 * support.
 */
export const NATURBASE_SCOPE_NOTE =
  "This covers four selected Naturbase datasets only: current protected areas, proposed protected " +
  "areas, modern NiN nature localities of national importance, and the January 2023 " +
  "intervention-free nature status. An empty result means these datasets hold no mapped feature " +
  "at this location — it is not evidence that no species, habitat, environmental interest or " +
  "legal restriction exists there. Naturbase publishes many further layers this server does not " +
  "expose, and mapping coverage is uneven. Never present an empty result as an environmental " +
  "clearance; consult Miljødirektoratet and the responsible municipality for any decision.";

/** Attached to every AR50 result. */
export const AR50_SCOPE_NOTE =
  "AR50 is a generalized national land-resource map intended for scales of roughly 1:20,000 to " +
  "1:100,000. Areas below about 15 decares may be merged into a surrounding class, so a polygon " +
  "is not a property boundary and must not be read at parcel precision. The detailed AR5 map, " +
  "agricultural-land records and soil or cultivation-suitability products are separate, " +
  "agreement-based datasets that this server does not provide.";

/** Attached to intervention-free results, whose vintage is fixed. */
export const INTERVENTION_FREE_VINTAGE_NOTE =
  "Intervention-free nature (inngrepsfri natur, INON) is the January 2023 status only, not a live " +
  "assessment. Zones are distance bands from major infrastructure: 1 is 1-3 km, 2 is 3-5 km and v " +
  "is at least 5 km, which Miljødirektoratet describes as wilderness-like nature. Infrastructure " +
  "built since the status date is not reflected.";

/** Attached to every result that carries WGS84 coordinates from these providers. */
export const CRS_NOTE =
  "Coordinates are WGS84 decimal degrees (longitude first, as GeoJSON requires). The providers " +
  "convert server-side from their own projections — Naturbase publishes EPSG:25833 and NIBIO " +
  "EPSG:4258 — and neither the SDK nor this server reprojects coordinates locally. Areas, " +
  "distances and overlaps must not be computed from these degrees without a proper projection.";

/** Attached to every Geonorge catalogue result. */
export const GEONORGE_CATALOGUE_NOTE =
  "Geonorge is a metadata catalogue. A record describes a dataset or service and lists the " +
  "endpoints its publisher advertises; it is not the data itself, and this server never fetches a " +
  "discovered endpoint or accepts a URL as input. Each catalogued resource carries its own " +
  "publisher licence and access constraints, which may be more restrictive than the catalogue's.";

/** Attached whenever geometry was requested. */
export const GEOMETRY_NOTE =
  "Geometry is returned exactly as the provider published it, including interior rings (holes) " +
  "and every part of a multipolygon. A geometry too large for the result budget is omitted whole " +
  "and reported in truncation, never simplified or partially returned.";

// ---------------------------------------------------------------------------
// Output bounds
// ---------------------------------------------------------------------------

/**
 * Vertex ceilings for returned geometry.
 *
 * A single Norwegian protected area can carry tens of thousands of vertices, so
 * a handful of them would exhaust the serialized budget and force the generic
 * size guard to halve arrays — losing whole features to keep coordinates. These
 * caps make the trade explicit and in the other direction: features are kept,
 * oversized geometry is dropped and named.
 *
 * The result ceiling is derived from `BUDGET.maxSerializedChars`, not chosen
 * freely: a WGS84 position serializes to roughly 21 characters, so 4,000
 * vertices is about 84 KB of the 120 KB payload allowance, leaving room for
 * attributes and provenance. Raising it past that point would simply move the
 * cut from this explicit, reported guard to the generic size guard, which
 * halves whole arrays.
 *
 * The per-feature ceiling is the same value, so one moderately complex area can
 * spend the whole budget on its own — verified against live data, a single
 * intervention-free zone at Galdhøpiggen carries 3,552 vertices across four
 * rings, and refusing that would make `includeGeometry` useless for the areas
 * people actually ask about. Genuinely huge geometry stays out of reach: the
 * AR50 polygon at the same point has 19,403 vertices across 63 rings, which no
 * setting of these constants could fit in one MCP payload.
 */
export const MAX_GEOMETRY_VERTICES_PER_FEATURE = 4_000;
export const MAX_GEOMETRY_VERTICES_PER_RESULT = 4_000;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const positionSchema = z.tuple([z.number(), z.number()]);
const ringSchema = z.array(positionSchema);

const polygonSchema = z.object({
  type: z.literal("Polygon"),
  /** First ring is the exterior; any further rings are holes. */
  coordinates: z.array(ringSchema),
});

const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ringSchema)),
});

/** GeoJSON area geometry, or null where the provider published none. */
export const areaGeometrySchema = z
  .union([polygonSchema, multiPolygonSchema])
  .nullable()
  .describe(
    "GeoJSON Polygon or MultiPolygon in WGS84, verbatim from the provider, or null when geometry " +
      "was not requested, was not published, or was omitted for size. Check geometrySummary.",
  );

export const geometrySummarySchema = z
  .object({
    type: z.enum(["Polygon", "MultiPolygon", "none"]),
    /** Parts of a multipolygon; 1 for a polygon; 0 when there is no geometry. */
    polygonCount: z.number(),
    /** Interior rings across every part. Non-zero means the area has holes. */
    holeCount: z.number(),
    vertexCount: z.number(),
    /** True when the coordinates themselves are in this result. */
    included: z.boolean(),
    /** Why coordinates are absent, when they are. */
    omittedReason: z
      .enum(["not-requested", "not-published", "too-large", "result-budget"])
      .optional(),
  })
  .describe(
    "Shape of the provider's geometry, reported whether or not the coordinates were returned.",
  );

export type AreaGeometry = z.infer<typeof areaGeometrySchema>;
export type GeometrySummary = z.infer<typeof geometrySummarySchema>;

type SdkAreaGeometry = GeoJsonPolygonGeometry | GeoJsonMultiPolygon | null;

function measure(geometry: SdkAreaGeometry): {
  polygonCount: number;
  holeCount: number;
  vertexCount: number;
} {
  if (geometry === null) return { polygonCount: 0, holeCount: 0, vertexCount: 0 };

  const parts: (readonly (readonly (readonly number[])[])[])[] =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  let holeCount = 0;
  let vertexCount = 0;
  for (const rings of parts) {
    holeCount += Math.max(0, rings.length - 1);
    for (const ring of rings) vertexCount += ring.length;
  }
  return { polygonCount: parts.length, holeCount, vertexCount };
}

/**
 * Per-invocation geometry budget.
 *
 * Held by the tool rather than by each feature, so a result cannot exceed the
 * total by returning many individually acceptable geometries.
 */
export class GeometryBudget {
  #remaining: number;
  readonly #perFeature: number;

  constructor(
    perResult: number = MAX_GEOMETRY_VERTICES_PER_RESULT,
    perFeature: number = MAX_GEOMETRY_VERTICES_PER_FEATURE,
  ) {
    this.#remaining = perResult;
    this.#perFeature = perFeature;
  }

  /** Reserves room for one geometry, or refuses it with a reason. */
  admit(vertexCount: number): "ok" | "too-large" | "result-budget" {
    if (vertexCount > this.#perFeature) return "too-large";
    if (vertexCount > this.#remaining) return "result-budget";
    this.#remaining -= vertexCount;
    return "ok";
  }
}

export type ProjectedGeometry = {
  geometry: AreaGeometry;
  geometrySummary: GeometrySummary;
};

/**
 * Decides whether one feature's geometry travels, and records the decision.
 *
 * The geometry is either returned untouched or not returned at all. There is
 * no middle path: a simplified polygon looks authoritative and is not, and a
 * multipolygon reduced to its largest part is a different area than the one
 * the provider published.
 */
export function projectGeometry(
  geometry: SdkAreaGeometry,
  options: {
    include: boolean;
    budget: GeometryBudget;
    tracker: TruncationTracker;
    /** Field path used in the truncation report, e.g. `features[3].geometry`. */
    field: string;
  },
): ProjectedGeometry {
  const shape = measure(geometry);

  if (geometry === null) {
    return {
      geometry: null,
      geometrySummary: { type: "none", ...shape, included: false, omittedReason: "not-published" },
    };
  }

  const base = { type: geometry.type, ...shape } as const;

  if (!options.include) {
    return {
      geometry: null,
      geometrySummary: { ...base, included: false, omittedReason: "not-requested" },
    };
  }

  const verdict = options.budget.admit(shape.vertexCount);
  if (verdict !== "ok") {
    options.tracker.record({
      field: options.field,
      returned: 0,
      availableUpstream: shape.vertexCount,
      reason: verdict === "too-large" ? "limit" : "budget",
    });
    return {
      geometry: null,
      geometrySummary: { ...base, included: false, omittedReason: verdict },
    };
  }

  return {
    // Copied structurally so the returned value cannot alias the SDK's cached
    // response object, while every ring and every part survives intact.
    geometry:
      geometry.type === "Polygon"
        ? { type: "Polygon", coordinates: geometry.coordinates.map((ring) => [...ring]) }
        : {
            type: "MultiPolygon",
            coordinates: geometry.coordinates.map((part) => part.map((ring) => [...ring])),
          },
    geometrySummary: { ...base, included: true },
  };
}

/** Prose for geometry this server chose not to return. */
export function geometryWarnings(summaries: readonly GeometrySummary[]): string[] {
  const warnings: string[] = [];

  const tooLarge = summaries.filter((summary) => summary.omittedReason === "too-large").length;
  if (tooLarge > 0) {
    warnings.push(
      `${tooLarge} feature geometr${tooLarge === 1 ? "y was" : "ies were"} omitted for exceeding ` +
        `${MAX_GEOMETRY_VERTICES_PER_FEATURE} vertices. The geometry was dropped whole rather than ` +
        "simplified; geometrySummary still reports its parts, holes and vertex count. Request a " +
        "smaller limit or query the provider directly for full geometry.",
    );
  }

  const budgeted = summaries.filter((summary) => summary.omittedReason === "result-budget").length;
  if (budgeted > 0) {
    warnings.push(
      `${budgeted} feature geometr${budgeted === 1 ? "y was" : "ies were"} omitted after this ` +
        `result reached its ${MAX_GEOMETRY_VERTICES_PER_RESULT}-vertex budget. Lower the limit to ` +
        "get geometry for the features you care about.",
    );
  }

  const unpublished = summaries.filter(
    (summary) => summary.omittedReason === "not-published",
  ).length;
  if (unpublished > 0) {
    warnings.push(
      `${unpublished} feature${unpublished === 1 ? "" : "s"} arrived with null geometry from the ` +
        "provider. The attributes are still complete; only the shape is missing.",
    );
  }

  if (summaries.some((summary) => summary.holeCount > 0 && !summary.included)) {
    warnings.push(
      "At least one area whose geometry is not included has interior rings (holes) — its mapped " +
        "extent excludes areas inside its outer boundary.",
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const featurePaginationSchema = z
  .object({
    limit: z.number(),
    returned: z.number(),
    /** Upstream requests this call made. Always small and bounded. */
    pagesFetched: z.number(),
    /** True when a bound stopped the walk while the provider held more. */
    truncated: z.boolean(),
    /** Same condition as `truncated`, named for callers that page. */
    hasMore: z.boolean(),
    nextOffset: z.number().optional(),
  })
  .describe(
    "Completeness of this bounded page. `truncated` is never inferred; it comes from the SDK.",
  );

export type ProjectedFeaturePagination = z.infer<typeof featurePaginationSchema>;

export function projectPagination(
  pagination: FeaturePagePagination,
  offset: number,
): ProjectedFeaturePagination {
  return {
    limit: pagination.limit,
    returned: pagination.returned,
    pagesFetched: pagination.pagesFetched,
    truncated: pagination.truncated,
    hasMore: pagination.truncated,
    ...(pagination.truncated
      ? { nextOffset: pagination.nextOffset ?? offset + pagination.returned }
      : {}),
  };
}

/** Prose for a page the provider could have continued. */
export function paginationWarnings(pagination: ProjectedFeaturePagination): string[] {
  if (!pagination.truncated) return [];
  return [
    `The provider held more features than this bounded call returned (${pagination.returned} of ` +
      "an unstated total). This page is not a complete inventory of the area. Continue from " +
      `offset ${String(pagination.nextOffset ?? pagination.returned)} or narrow the query.`,
  ];
}

// ---------------------------------------------------------------------------
// Naturbase feature projections
// ---------------------------------------------------------------------------

const featureBase = {
  geometry: areaGeometrySchema,
  geometrySummary: geometrySummarySchema,
};

export const protectedAreaSchema = z.object({
  id: z.string(),
  /** Common Database on Designated Areas identifier, when published. */
  cddaId: z.string().optional(),
  name: z.string().optional(),
  officialName: z.string().optional(),
  /** Protection form as Naturbase publishes it, e.g. nasjonalpark. */
  protectionForm: z.string().optional(),
  aggregatedProtectionForm: z.string().optional(),
  /** IUCN protected-area management category, when assigned. */
  iucnCategory: z.string().optional(),
  municipality: z.string().optional(),
  managementAuthority: z.string().optional(),
  managementAuthorityType: z.string().optional(),
  protectedAt: z.string().optional(),
  firstProtectedAt: z.string().optional(),
  protectionPlan: z.string().optional(),
  threatAssessment: z.string().optional(),
  majorEcosystemType: z.string().optional(),
  revisionStatus: z.string().optional(),
  /** Miljødirektoratet fact sheet for this area. */
  factSheetUrl: z.string().optional(),
  /** Lovdata regulation establishing the protection. */
  regulationUrl: z.string().optional(),
  ...featureBase,
});

export const proposedProtectedAreaSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  protectionForm: z.string().optional(),
  protectionPlan: z.string().optional(),
  municipality: z.string().optional(),
  objectType: z.string().optional(),
  capturedAt: z.string().optional(),
  surveyMethod: z.string().optional(),
  /** Stated positional accuracy in metres. */
  accuracyMeters: z.number().optional(),
  factSheetUrl: z.string().optional(),
  ...featureBase,
});

export const natureTypeSchema = z.object({
  id: z.string(),
  areaName: z.string().optional(),
  municipalities: z.string().optional(),
  natureType: z.string().optional(),
  natureTypeCode: z.string().optional(),
  /** NiN locality quality score, as published. */
  localityQuality: z.number().optional(),
  condition: z.number().optional(),
  conditionDescription: z.string().optional(),
  biodiversity: z.number().optional(),
  biodiversityDescription: z.string().optional(),
  majorEcosystem: z.string().optional(),
  mosaic: z.boolean().optional(),
  surveyedAt: z.string().optional(),
  surveyYear: z.number().optional(),
  redListed: z.boolean().optional(),
  nearThreatened: z.boolean().optional(),
  centralEcosystemFunction: z.boolean().optional(),
  poorlyMapped: z.boolean().optional(),
  uncertainty: z.number().optional(),
  uncertaintyDescription: z.string().optional(),
  factSheetUrl: z.string().optional(),
  ...featureBase,
});

export const interventionFreeAreaSchema = z.object({
  id: z.string(),
  /** Official zone code: 1, 2 or v. */
  zone: z.string(),
  zoneDescription: z.string(),
  areaSquareKilometers: z.number().optional(),
  /** Fixed vintage of the whole layer. */
  statusDate: z.string(),
  ...featureBase,
});

export const landResourceSchema = z.object({
  id: z.string(),
  objectType: z.string().optional(),
  /** Official AR50 land-type code. */
  landTypeCode: z.string().optional(),
  /** English label for `landTypeCode`, from the published SOSI code list. */
  landType: z.string().optional(),
  /** Further AR50 class codes, passed through undecoded. See AR50_CODE_NOTE. */
  forestProductivityCode: z.string().optional(),
  treeTypeCode: z.string().optional(),
  agricultureCode: z.string().optional(),
  vegetationCoverCode: z.string().optional(),
  information: z.string().optional(),
  updatedAt: z.string().optional(),
  ...featureBase,
});

export type ProjectedProtectedArea = z.infer<typeof protectedAreaSchema>;
export type ProjectedProposedProtectedArea = z.infer<typeof proposedProtectedAreaSchema>;
export type ProjectedNatureType = z.infer<typeof natureTypeSchema>;
export type ProjectedInterventionFreeArea = z.infer<typeof interventionFreeAreaSchema>;
export type ProjectedLandResource = z.infer<typeof landResourceSchema>;

/** Drops undefined entries so an absent provider field never becomes `null`. */
function defined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

export function projectProtectedArea(
  feature: ProtectedAreaFeature,
  geometry: ProjectedGeometry,
): ProjectedProtectedArea {
  const properties = feature.properties;
  return {
    ...defined({
      id: properties.id,
      cddaId: properties.cddaId,
      name: properties.name,
      officialName: properties.officialName,
      protectionForm: properties.protectionForm,
      aggregatedProtectionForm: properties.aggregatedProtectionForm,
      iucnCategory: properties.iucnCategory,
      municipality: properties.municipality,
      managementAuthority: properties.managementAuthority,
      managementAuthorityType: properties.managementAuthorityType,
      protectedAt: properties.protectedAt,
      firstProtectedAt: properties.firstProtectedAt,
      protectionPlan: properties.protectionPlan,
      threatAssessment: properties.threatAssessment,
      majorEcosystemType: properties.majorEcosystemType,
      revisionStatus: properties.revisionStatus,
      factSheetUrl: properties.factSheetUrl,
      regulationUrl: properties.regulationUrl,
    }),
    ...geometry,
  };
}

export function projectProposedProtectedArea(
  feature: ProposedProtectedAreaFeature,
  geometry: ProjectedGeometry,
): ProjectedProposedProtectedArea {
  const properties = feature.properties;
  return {
    ...defined({
      id: properties.id,
      name: properties.name,
      protectionForm: properties.protectionForm,
      protectionPlan: properties.protectionPlan,
      municipality: properties.municipality,
      objectType: properties.objectType,
      capturedAt: properties.capturedAt,
      surveyMethod: properties.surveyMethod,
      accuracyMeters: properties.accuracyMeters,
      factSheetUrl: properties.factSheetUrl,
    }),
    ...geometry,
  };
}

export function projectNatureType(
  feature: NatureTypeFeature,
  geometry: ProjectedGeometry,
): ProjectedNatureType {
  const properties = feature.properties;
  return {
    ...defined({
      id: properties.id,
      areaName: properties.areaName,
      municipalities: properties.municipalities,
      natureType: properties.natureType,
      natureTypeCode: properties.natureTypeCode,
      localityQuality: properties.localityQuality,
      condition: properties.condition,
      conditionDescription: properties.conditionDescription,
      biodiversity: properties.biodiversity,
      biodiversityDescription: properties.biodiversityDescription,
      majorEcosystem: properties.majorEcosystem,
      mosaic: properties.mosaic,
      surveyedAt: properties.surveyedAt,
      surveyYear: properties.surveyYear,
      redListed: properties.redListed,
      nearThreatened: properties.nearThreatened,
      centralEcosystemFunction: properties.centralEcosystemFunction,
      poorlyMapped: properties.poorlyMapped,
      uncertainty: properties.uncertainty,
      uncertaintyDescription: properties.uncertaintyDescription,
      factSheetUrl: properties.factSheetUrl,
    }),
    ...geometry,
  };
}

export function projectInterventionFreeArea(
  feature: InterventionFreeAreaFeature,
  geometry: ProjectedGeometry,
): ProjectedInterventionFreeArea {
  const properties = feature.properties;
  return {
    ...defined({
      id: properties.id,
      zone: properties.zone,
      zoneDescription: properties.zoneDescription,
      areaSquareKilometers: properties.areaSquareKilometers,
      statusDate: properties.statusDate,
    }),
    ...geometry,
  };
}

/**
 * English labels for the AR50 land-type code list.
 *
 * Only this one code list is decoded. It is the SOSI `ARTYPE` list, which is
 * stable, published and unambiguous. The productivity, tree-type, agriculture
 * and vegetation-cover lists are surfaced as codes because guessing a wrong
 * label for a land classification is worse than returning the code the
 * provider actually published.
 */
const AR50_LAND_TYPE_LABELS: Record<string, string> = {
  "10": "Built-up and transport (bebygd og samferdsel)",
  "20": "Agricultural land (jordbruksareal)",
  "30": "Forest (skog)",
  "50": "Open firm ground (åpen fastmark)",
  "60": "Mire (myr)",
  "70": "Snow and glacier (snøisbre)",
  "81": "Freshwater (ferskvann)",
  "82": "Sea (hav)",
  "99": "Not mapped (ikke kartlagt)",
};

export const AR50_CODE_NOTE =
  "AR50 class codes are the provider's own. Only landTypeCode is given an English label here; " +
  "forestProductivityCode, treeTypeCode, agricultureCode and vegetationCoverCode are returned " +
  "undecoded, because this server does not restate a classification it cannot cite. Their code " +
  "lists are published at https://www.nibio.no/tjenester/wfs-tjenester/wfs-tjeneste-ar50.";

export function projectLandResource(
  feature: LandResourceFeature,
  geometry: ProjectedGeometry,
): ProjectedLandResource {
  const properties = feature.properties;
  const landType =
    properties.landTypeCode === undefined
      ? undefined
      : AR50_LAND_TYPE_LABELS[properties.landTypeCode];

  return {
    ...defined({
      id: properties.id,
      objectType: properties.objectType,
      landTypeCode: properties.landTypeCode,
      landType,
      forestProductivityCode: properties.forestProductivityCode,
      treeTypeCode: properties.treeTypeCode,
      agricultureCode: properties.agricultureCode,
      vegetationCoverCode: properties.vegetationCoverCode,
      information: properties.information,
      updatedAt: properties.updatedAt,
    }),
    ...geometry,
  };
}

// ---------------------------------------------------------------------------
// Bounded feature projection
// ---------------------------------------------------------------------------

/**
 * Maps one bounded provider page into projected features.
 *
 * The geometry budget is threaded through every feature in the page, so the
 * decision to include or omit coordinates is made once per result rather than
 * once per feature in isolation.
 */
export function projectFeatures<Feature, Projected>(
  features: readonly Feature[],
  options: {
    field: string;
    include: boolean;
    tracker: TruncationTracker;
    budget: GeometryBudget;
    geometryOf: (feature: Feature) => SdkAreaGeometry;
    project: (feature: Feature, geometry: ProjectedGeometry) => Projected;
  },
): { items: Projected[]; summaries: GeometrySummary[] } {
  const items: Projected[] = [];
  const summaries: GeometrySummary[] = [];

  features.forEach((feature, index) => {
    const geometry = projectGeometry(options.geometryOf(feature), {
      include: options.include,
      budget: options.budget,
      tracker: options.tracker,
      field: `${options.field}[${String(index)}].geometry`,
    });
    summaries.push(geometry.geometrySummary);
    items.push(options.project(feature, geometry));
  });

  return { items, summaries };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** One-line shape note, so the text form never hides an omitted geometry. */
export function describeGeometry(summary: GeometrySummary): string | undefined {
  if (summary.type === "none") return "no geometry published";
  const parts = summary.polygonCount > 1 ? `${summary.polygonCount} parts, ` : "";
  const holes = summary.holeCount > 0 ? `${summary.holeCount} hole(s), ` : "";
  const state = summary.included ? "included" : `omitted (${summary.omittedReason ?? "unknown"})`;
  return `${summary.type}, ${parts}${holes}${summary.vertexCount} vertices, ${state}`;
}

/** Text block for one protected area, shared by the point and search tools. */
export function renderProtectedArea(area: ProjectedProtectedArea): string {
  return [
    `${area.officialName ?? area.name ?? "(unnamed)"} — ${area.id}`,
    ...fields([
      ["Protection form", area.protectionForm],
      ["IUCN category", area.iucnCategory],
      ["Municipality", area.municipality],
      ["Protected at", area.protectedAt],
      ["Managed by", area.managementAuthority],
      ["Regulation", area.regulationUrl],
      ["Fact sheet", area.factSheetUrl],
      ["Geometry", describeGeometry(area.geometrySummary)],
    ]),
  ].join("\n");
}

/** Text-form line for a bounded feature page. */
export function describePagination(pagination: ProjectedFeaturePagination): string {
  return pagination.truncated
    ? `Showing ${pagination.returned} feature(s); more exist upstream (hasMore: true).`
    : `Showing ${pagination.returned} feature(s); the provider reported no further matches.`;
}
