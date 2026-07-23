/**
 * Shared projections for the SDK's cross-provider profiles and hazard data.
 *
 * Two invariants are enforced here so no individual tool can forget them:
 *
 * 1. **Component provenance survives.** A profile section that was skipped or
 *    failed is reported with its reason, never silently dropped. "We did not
 *    ask MET Norway" and "MET Norway returned no data" are different answers
 *    and a model must be able to tell them apart.
 * 2. **A hazard result is never an all-clear.** The SDK states this for every
 *    hazard-bearing path; the warning is attached unconditionally.
 */

import { z } from "zod";
import type {
  AddressHazardMatch,
  HazardWarning,
  NorwegianAddress,
  ProfileComponent,
} from "norway-open-data-sdk";

import type { TruncationTracker } from "../../limits/budget.js";

export const HAZARD_DISCLAIMER =
  "Hazard warnings here are a discovery summary and are never an all-clear. " +
  "An empty list does not mean an area is safe. Use the official Varsom/NVE " +
  "services (varsom.no) for any safety-related decision.";

export const componentSchema = z.object({
  operation: z.string(),
  section: z.string(),
  status: z.enum(["available", "omitted"]),
  provider: z.string(),
  /** Present only for omitted sections. */
  reason: z.string().optional(),
  /** Sanitized provider failure summary, when the SDK supplied one. */
  error: z.string().optional(),
});

export const addressSchema = z.object({
  addressText: z.string().optional(),
  postalCode: z.string().optional(),
  postalPlace: z.string().optional(),
  municipalityCode: z.string().optional(),
  municipalityName: z.string().optional(),
  countyName: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const hazardSchema = z.object({
  type: z.enum(["flood", "avalanche", "landslide", "other"]),
  level: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  forecastRegion: z.string().optional(),
  municipalities: z.array(z.string()).optional(),
  counties: z.array(z.string()).optional(),
});

export type ProjectedComponent = z.infer<typeof componentSchema>;
export type ProjectedAddress = z.infer<typeof addressSchema>;
export type ProjectedHazard = z.infer<typeof hazardSchema>;

export function projectAddress(address: NorwegianAddress): ProjectedAddress {
  return {
    ...(address.addressText !== undefined ? { addressText: address.addressText } : {}),
    ...(address.postalCode !== undefined ? { postalCode: address.postalCode } : {}),
    ...(address.postalPlace !== undefined ? { postalPlace: address.postalPlace } : {}),
    ...(address.municipalityCode !== undefined
      ? { municipalityCode: address.municipalityCode }
      : {}),
    ...(address.municipalityName !== undefined
      ? { municipalityName: address.municipalityName }
      : {}),
    ...(address.countyName !== undefined ? { countyName: address.countyName } : {}),
    ...(address.latitude !== undefined ? { latitude: address.latitude } : {}),
    ...(address.longitude !== undefined ? { longitude: address.longitude } : {}),
  };
}

export function projectHazard(
  warning: HazardWarning,
  tracker: TruncationTracker,
  index: number,
): ProjectedHazard {
  return {
    type: warning.type,
    ...(warning.level !== undefined ? { level: warning.level } : {}),
    ...(warning.title !== undefined ? { title: warning.title } : {}),
    ...(warning.description !== undefined
      ? {
          // Varsom descriptions are prose and occasionally very long; clamping
          // is recorded so the cut is visible in the result.
          description: tracker.clampString(`warnings[${index}].description`, warning.description),
        }
      : {}),
    ...(warning.validFrom !== undefined ? { validFrom: warning.validFrom } : {}),
    ...(warning.validTo !== undefined ? { validTo: warning.validTo } : {}),
    ...(warning.forecastRegion?.name !== undefined
      ? { forecastRegion: warning.forecastRegion.name }
      : {}),
    ...(warning.municipalities?.length
      ? { municipalities: warning.municipalities.map((area) => area.name) }
      : {}),
    ...(warning.counties?.length ? { counties: warning.counties.map((area) => area.name) } : {}),
  };
}

export function projectComponents(
  components: readonly ProfileComponent[] | undefined,
): ProjectedComponent[] {
  if (!components) return [];
  return components.map((component) => ({
    operation: component.operation,
    section: component.section,
    status: component.status,
    provider: component.source.id,
    ...(component.status === "omitted" ? { reason: component.reason } : {}),
    ...(component.status === "omitted" && component.error !== undefined
      ? { error: `${component.error.name}: ${component.error.message}` }
      : {}),
  }));
}

/**
 * Turns omitted components into prose warnings.
 *
 * A missing section is actionable information — "set NORWAY_MCP_CONTACT_EMAIL
 * to get weather here" — so it is surfaced rather than left for the caller to
 * infer from a null field.
 */
export function componentWarnings(components: readonly ProjectedComponent[]): string[] {
  const warnings: string[] = [];
  for (const component of components) {
    if (component.status !== "omitted") continue;
    switch (component.reason) {
      case "not-configured":
        warnings.push(
          `The "${component.section}" section was skipped because ${component.provider} needs configuration this server does not have. ` +
            (component.provider === "met"
              ? "Set NORWAY_MCP_CONTACT_EMAIL to enable it."
              : "See the README for the required environment variable."),
        );
        break;
      case "provider-error":
        warnings.push(
          `The "${component.section}" section is missing because ${component.provider} failed${
            component.error ? ` (${component.error})` : ""
          }. This is a partial result.`,
        );
        break;
      case "missing-coordinate":
        warnings.push(
          `The "${component.section}" section was skipped because the resolved location has no coordinate.`,
        );
        break;
      case "not-applicable":
        break;
      default:
        break;
    }
  }
  return warnings;
}

/** Sections that were requested but could not be delivered. */
export function missingSections(components: readonly ProjectedComponent[]): string[] {
  return [
    ...new Set(
      components
        .filter(
          (component) =>
            component.status === "omitted" &&
            (component.reason === "provider-error" || component.reason === "not-configured"),
        )
        .map((component) => component.section),
    ),
  ];
}

export function describeHazardMatches(
  matches: readonly AddressHazardMatch[] | undefined,
): string[] {
  if (!matches?.length) return [];
  return matches.map(
    (match) =>
      `${match.warning.type} warning matched on ${match.matchBasis} (${
        match.addressArea.name ?? match.addressArea.code ?? "unknown area"
      }).`,
  );
}

export function renderHazardLines(hazards: readonly ProjectedHazard[]): string {
  if (hazards.length === 0) return "No matching warnings were returned (this is not an all-clear).";
  return hazards
    .map((hazard) => {
      const areas = [...(hazard.municipalities ?? []), ...(hazard.counties ?? [])];
      const where = areas.length > 0 ? ` — ${areas.join(", ")}` : "";
      const level = hazard.level ? ` (level ${hazard.level})` : "";
      const valid = hazard.validFrom ? ` valid from ${hazard.validFrom}` : "";
      return `- ${hazard.type}${level}: ${hazard.title ?? "(no title)"}${where}${valid}`;
    })
    .join("\n");
}
