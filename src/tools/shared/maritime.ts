/**
 * Shared projections and caveats for the maritime tools.
 *
 * Three invariants are enforced here so no individual tool can forget them:
 *
 * 1. **No private vessel-owner details leave this server.** The SDK already
 *    withholds name, postal code and town for natural-person owners. This
 *    projection additionally whitelists the fields it copies, so a future SDK
 *    that started publishing a person's details could not leak them through a
 *    spread. See {@link projectOwners}.
 * 2. **Absence in AIS is never evidence of absence at sea.** BarentsWatch
 *    excludes small fishing and leisure vessels, covers only Norwegian waters
 *    and retains 14 days, so "no position" is an ordinary answer for a vessel
 *    that exists and is afloat. The caveat is attached unconditionally.
 * 3. **BarentsWatch credentials are named, never printed.** The gating helpers
 *    return variable *names* for the error message; the values never leave
 *    `ServerConfig`.
 */

import { z } from "zod";
import type {
  AisTrackPoint,
  AquacultureSite,
  FishingVessel,
  FishingVesselOwner,
} from "norway-open-data-sdk";

import { ENV_VARS, type ServerConfig } from "../../config/types.js";

/**
 * Attached to every AIS-derived result.
 *
 * A model reading "no positions" without this will report that a vessel is not
 * at sea, which the feed cannot support.
 */
export const AIS_COVERAGE_NOTE =
  "BarentsWatch AIS coverage is partial: it covers the Norwegian economic zone plus the " +
  "Svalbard and Jan Mayen protection zones, excludes fishing vessels under 15 m and leisure or " +
  "sailing vessels under 45 m, and retains 14 days. No position is never evidence that a vessel " +
  "does not exist, is not at sea, or has an unassigned MMSI.";

/** Attached to every fishing-vessel result that could carry ownership. */
export const OWNER_PRIVACY_NOTE =
  "Owner details are limited to registered legal entities. Natural-person owners are counted but " +
  "never identified: their names and addresses are not returned by this server.";

/** Attached to marine forecast results. */
export const MARINE_MODEL_NOTE =
  "Marine forecasts come from numerical wave and current models covering the Norwegian coast, not " +
  "the whole ocean. The returned coordinate is the centre of the model grid cell that answered, " +
  "which may be some distance from the requested point, and an uncovered coordinate is a normal " +
  "outcome rather than a failure.";

/** Environment gate for the BarentsWatch AIS scope. */
export function requiresAisCredentials(config: ServerConfig): string[] {
  const missing: string[] = [];
  if (config.barentswatchAisClientId === undefined) missing.push(ENV_VARS.barentswatchAisClientId);
  if (config.barentswatchAisClientSecret === undefined) {
    missing.push(ENV_VARS.barentswatchAisClientSecret);
  }
  return missing;
}

/** Environment gate for the general BarentsWatch `api` scope. */
export function requiresBarentswatchCredentials(config: ServerConfig): string[] {
  const missing: string[] = [];
  if (config.barentswatchClientId === undefined) missing.push(ENV_VARS.barentswatchClientId);
  if (config.barentswatchClientSecret === undefined) {
    missing.push(ENV_VARS.barentswatchClientSecret);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Fishing-vessel register
// ---------------------------------------------------------------------------

export const vesselOwnerSchema = z.object({
  organizationNumber: z.string().optional(),
  name: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
});

export const fishingVesselSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  registrationMark: z.string().optional(),
  radioCallSign: z.string().optional(),
  imoNumber: z.string().optional(),
  municipalityCode: z.string().optional(),
  /** Metres. */
  length: z.number().optional(),
  /** Metres. */
  width: z.number().optional(),
  /** Gross tonnage under the rule named by `tonnageType`. */
  tonnage: z.number().optional(),
  tonnageType: z.string().optional(),
  /** Horsepower. */
  enginePower: z.number().optional(),
  buildYear: z.number().optional(),
  rebuildYear: z.number().optional(),
  registrationDate: z.string().optional(),
  /** Registered legal-entity owners only. */
  companyOwners: z.array(vesselOwnerSchema).optional(),
  /** How many owners are natural persons. Their details are never returned. */
  privateOwnerCount: z.number().optional(),
});

export type ProjectedFishingVessel = z.infer<typeof fishingVesselSchema>;

/**
 * Splits owners into publishable entities and a bare count of private persons.
 *
 * Deliberately field-by-field rather than a spread of the company branch: the
 * union's person branch carries no identifying fields today, and this keeps
 * that true even if the SDK's shape widens.
 */
function projectOwners(owners: readonly FishingVesselOwner[] | undefined): {
  companyOwners?: z.infer<typeof vesselOwnerSchema>[];
  privateOwnerCount?: number;
} {
  if (!owners?.length) return {};

  const companyOwners: z.infer<typeof vesselOwnerSchema>[] = [];
  let privateOwnerCount = 0;

  for (const owner of owners) {
    if (owner.entityType !== "company") {
      privateOwnerCount += 1;
      continue;
    }
    companyOwners.push({
      ...(owner.organizationNumber !== undefined
        ? { organizationNumber: owner.organizationNumber }
        : {}),
      ...(owner.name !== undefined ? { name: owner.name } : {}),
      ...(owner.postalCode !== undefined ? { postalCode: owner.postalCode } : {}),
      ...(owner.city !== undefined ? { city: owner.city } : {}),
    });
  }

  return {
    ...(companyOwners.length > 0 ? { companyOwners } : {}),
    ...(privateOwnerCount > 0 ? { privateOwnerCount } : {}),
  };
}

export function projectFishingVessel(vessel: FishingVessel): ProjectedFishingVessel {
  return {
    id: vessel.id,
    ...(vessel.name !== undefined ? { name: vessel.name } : {}),
    ...(vessel.registrationMark !== undefined ? { registrationMark: vessel.registrationMark } : {}),
    ...(vessel.radioCallSign !== undefined ? { radioCallSign: vessel.radioCallSign } : {}),
    ...(vessel.imoNumber !== undefined ? { imoNumber: vessel.imoNumber } : {}),
    ...(vessel.municipalityCode !== undefined ? { municipalityCode: vessel.municipalityCode } : {}),
    ...(vessel.length !== undefined ? { length: vessel.length } : {}),
    ...(vessel.width !== undefined ? { width: vessel.width } : {}),
    ...(vessel.tonnage !== undefined ? { tonnage: vessel.tonnage } : {}),
    ...(vessel.tonnageType !== undefined ? { tonnageType: vessel.tonnageType } : {}),
    ...(vessel.enginePower !== undefined ? { enginePower: vessel.enginePower } : {}),
    ...(vessel.buildYear !== undefined ? { buildYear: vessel.buildYear } : {}),
    ...(vessel.rebuildYear !== undefined ? { rebuildYear: vessel.rebuildYear } : {}),
    ...(vessel.registrationDate !== undefined ? { registrationDate: vessel.registrationDate } : {}),
    ...projectOwners(vessel.owners),
  };
}

/** True when any vessel in the page carried ownership the register published. */
export function hasOwnerData(vessels: readonly ProjectedFishingVessel[]): boolean {
  return vessels.some(
    (vessel) => vessel.companyOwners !== undefined || vessel.privateOwnerCount !== undefined,
  );
}

export function renderFishingVessel(vessel: ProjectedFishingVessel): string[] {
  return [
    ["Register id", vessel.id],
    ["Registration mark", vessel.registrationMark],
    ["Call sign", vessel.radioCallSign],
    ["IMO number", vessel.imoNumber],
    ["Length (m)", vessel.length],
    ["Width (m)", vessel.width],
    [
      "Tonnage",
      vessel.tonnage !== undefined ? `${vessel.tonnage} (${vessel.tonnageType ?? "?"})` : undefined,
    ],
    ["Engine power (hp)", vessel.enginePower],
    ["Built", vessel.buildYear],
    ["Municipality code", vessel.municipalityCode],
    ["Company owners", vessel.companyOwners?.map((owner) => owner.name ?? "(unnamed)").join(", ")],
    [
      "Private owners",
      vessel.privateOwnerCount !== undefined
        ? `${vessel.privateOwnerCount} (not identified)`
        : undefined,
    ],
  ]
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `  ${String(label)}: ${String(value)}`);
}

// ---------------------------------------------------------------------------
// Aquaculture register
// ---------------------------------------------------------------------------

export const aquacultureSiteSchema = z.object({
  siteNumber: z.string(),
  name: z.string().optional(),
  placementType: z.string().optional(),
  waterType: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  /** Permitted capacity, in `capacityUnitType` units — not comparable across units. */
  capacity: z.number().optional(),
  capacityUnitType: z.string().optional(),
  municipalityCode: z.string().optional(),
  municipalityName: z.string().optional(),
  countyName: z.string().optional(),
  productionAreaCode: z.string().optional(),
  productionAreaName: z.string().optional(),
  /** Traffic-light status, as the register publishes it: GRØNN, GUL or RØD. */
  productionAreaStatus: z.string().optional(),
  speciesTypes: z.array(z.string()).optional(),
  isSlaughterhouse: z.boolean().optional(),
  hasCommercialActivity: z.boolean().optional(),
  licenceNumbers: z.array(z.string()).optional(),
});

export type ProjectedAquacultureSite = z.infer<typeof aquacultureSiteSchema>;

export function projectAquacultureSite(site: AquacultureSite): ProjectedAquacultureSite {
  const placement = site.placement;
  const licenceNumbers = site.licences
    ?.map((licence) => licence.licenceNumber)
    .filter((value): value is string => value !== undefined);

  return {
    siteNumber: site.siteNumber,
    ...(site.name !== undefined ? { name: site.name } : {}),
    ...(site.placementType !== undefined ? { placementType: site.placementType } : {}),
    ...(site.waterType !== undefined ? { waterType: site.waterType } : {}),
    ...(site.latitude !== undefined ? { latitude: site.latitude } : {}),
    ...(site.longitude !== undefined ? { longitude: site.longitude } : {}),
    ...(site.capacity !== undefined ? { capacity: site.capacity } : {}),
    ...(site.capacityUnitType !== undefined ? { capacityUnitType: site.capacityUnitType } : {}),
    ...(placement?.municipalityCode !== undefined
      ? { municipalityCode: placement.municipalityCode }
      : {}),
    ...(placement?.municipalityName !== undefined
      ? { municipalityName: placement.municipalityName }
      : {}),
    ...(placement?.countyName !== undefined ? { countyName: placement.countyName } : {}),
    ...(placement?.productionAreaCode !== undefined
      ? { productionAreaCode: placement.productionAreaCode }
      : {}),
    ...(placement?.productionAreaName !== undefined
      ? { productionAreaName: placement.productionAreaName }
      : {}),
    ...(placement?.productionAreaStatus !== undefined
      ? { productionAreaStatus: placement.productionAreaStatus }
      : {}),
    ...(site.speciesTypes?.length ? { speciesTypes: [...site.speciesTypes] } : {}),
    ...(site.isSlaughterhouse !== undefined ? { isSlaughterhouse: site.isSlaughterhouse } : {}),
    ...(site.hasCommercialActivity !== undefined
      ? { hasCommercialActivity: site.hasCommercialActivity }
      : {}),
    ...(licenceNumbers?.length ? { licenceNumbers } : {}),
  };
}

/**
 * `capacity` means nothing without its unit, and the register mixes units
 * across licence kinds. Stated once, wherever capacity is returned.
 */
export const CAPACITY_UNIT_NOTE =
  "Capacity is expressed in the unit named by capacityUnitType (TN is tonnes of maximum allowed " +
  "biomass; other licence kinds use other units), so capacities are not comparable across sites " +
  "without checking the unit.";

// ---------------------------------------------------------------------------
// AIS track points
// ---------------------------------------------------------------------------

export const trackPointSchema = z.object({
  messageTime: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  /** Degrees true, 0-359.9. */
  courseOverGround: z.number().optional(),
  /** Knots. */
  speedOverGround: z.number().optional(),
  /** Degrees true. */
  trueHeading: z.number().optional(),
  /** Raw AIS navigational-status code; not normalized to text. */
  navigationalStatus: z.number().optional(),
  /** Receiver network the point came from, as the provider labelled it. */
  stream: z.string().optional(),
});

export type ProjectedTrackPoint = z.infer<typeof trackPointSchema>;

export function projectTrackPoint(point: AisTrackPoint): ProjectedTrackPoint {
  return {
    messageTime: point.messageTime,
    ...(point.latitude !== undefined ? { latitude: point.latitude } : {}),
    ...(point.longitude !== undefined ? { longitude: point.longitude } : {}),
    ...(point.courseOverGround !== undefined ? { courseOverGround: point.courseOverGround } : {}),
    ...(point.speedOverGround !== undefined ? { speedOverGround: point.speedOverGround } : {}),
    ...(point.trueHeading !== undefined ? { trueHeading: point.trueHeading } : {}),
    ...(point.navigationalStatus !== undefined
      ? { navigationalStatus: point.navigationalStatus }
      : {}),
    ...(point.stream !== undefined ? { stream: point.stream } : {}),
  };
}
