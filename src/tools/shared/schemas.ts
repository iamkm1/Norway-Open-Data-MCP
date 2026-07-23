/**
 * Reusable input primitives.
 *
 * Every value crossing the MCP boundary is validated here at runtime.
 * TypeScript types are not a defence: tool arguments arrive as untrusted JSON
 * from a model that may hallucinate a shape.
 *
 * The rejection rules are deliberate — blank identifiers, `NaN`, `Infinity`,
 * impossible coordinates, negative and extreme limits, over-long queries,
 * invalid and reversed dates, and unsupported enum values are all refused
 * before any provider is contacted.
 */

import { z } from "zod";

/** Trims, then rejects whitespace-only input that would otherwise look non-empty. */
function nonBlank(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** Rejects NaN and both infinities, which JSON can carry as numbers. */
function finiteNumber(label: string) {
  return z
    .number()
    .refine(Number.isFinite, `${label} must be a finite number (not NaN or Infinity).`);
}

export const organizationNumberSchema = z
  .string()
  .trim()
  // Norwegian organization numbers are commonly written "923 609 016".
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\d{9}$/, "Organization number must be exactly nine digits, for example 923609016."),
  );

export const municipalityCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Municipality code must be exactly four digits, for example 0301 for Oslo.");

export const countyCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, "County code must be exactly two digits, for example 03 for Oslo.");

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Postal code must be exactly four digits, for example 0150.");

/** NACE-style industry code, e.g. `62.010` or `62`. */
export const industryCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}(?:\.\d{1,3})?$/, "Industry code must be a NACE code such as 62 or 62.010.");

/** Enhetsregisteret legal-form code, e.g. `AS`, `ASA`, `ENK`. */
export const organizationForm = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(/^[A-ZÆØÅ]{2,10}$/, "Organization form must be a code such as AS, ASA, ENK or SA."),
  );

export const latitudeSchema = finiteNumber("Latitude")
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.");

export const longitudeSchema = finiteNumber("Longitude")
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.");

export const altitudeSchema = z
  .number()
  .int("Altitude must be a whole number of metres.")
  .min(-500, "Altitude must be between -500 and 9000 metres.")
  .max(9_000, "Altitude must be between -500 and 9000 metres.");

export function searchQuerySchema(label = "Query", min = 2, max = 200) {
  return nonBlank(label, min, max);
}

/** A bounded result count. Rejects zero, negatives, fractions and huge values. */
export function limitSchema(defaultValue: number, max: number) {
  return z
    .number()
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(max, `Limit must be at most ${max}.`)
    .default(defaultValue);
}

export function pageSchema(max = 100) {
  return z
    .number()
    .int("Page must be a whole number.")
    .min(0, "Page is zero-based and cannot be negative.")
    .max(max, `Page must be at most ${max}.`)
    .default(0);
}

/**
 * A real calendar date in `YYYY-MM-DD`.
 *
 * The regex alone would accept 2026-02-31, so the parsed date is round-tripped
 * to confirm the components survived normalization.
 */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format, for example 2026-07-23.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) return false;
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Date is not a real calendar date.");

export const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Must be a valid ISO-8601 date-time.");

export const priceAreaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z.enum(["NO1", "NO2", "NO3", "NO4", "NO5"], {
      message:
        "Price area must be one of NO1 (Oslo), NO2 (Kristiansand), NO3 (Trondheim), NO4 (Tromsø) or NO5 (Bergen).",
    }),
  );

export const stopPlaceIdSchema = z
  .string()
  .trim()
  .regex(
    /^NSR:StopPlace:\d{1,12}$/,
    "Stop place ID must look like NSR:StopPlace:58366. Use stopName instead if you do not have one.",
  );

export const tableIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{4,10}$/,
    "SSB table ID must be 4-10 letters, digits, hyphens or underscores, for example 07459.",
  );

export const languageSchema = z.enum(["no", "en"]).default("no");

/** Days between two `YYYY-MM-DD` values, inclusive of neither endpoint. */
export function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

/** Today in Europe/Oslo, matching the SDK's own date defaulting. */
export function osloToday(now: Date): string {
  // `en-CA` yields YYYY-MM-DD, and the SDK documents Europe/Oslo as its
  // reference zone for date-defaulted providers.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
