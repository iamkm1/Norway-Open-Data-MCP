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

/**
 * A Maritime Mobile Service Identity.
 *
 * Kept as a string, never a number, because leading zeros are significant and
 * `Number("002310495")` would silently discard them. The SDK documents one to
 * nine digits; nine is the standard length, but shorter identities exist for
 * some station classes, so the range is not narrowed further here.
 */
export const mmsiSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, "MMSI must be 1-9 digits, for example 257123456. Do not include spaces.");

/**
 * A Norwegian fishing-vessel registration mark.
 *
 * The register stores `R 0062H` and also accepts the hyphenated `R-62-H`
 * people write on paper. The SDK's `normalizeRegistrationMark` rewrites between
 * those forms, so this only has to refuse input that is not a mark at all.
 */
export const registrationMarkSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(
        /^[A-ZÆØÅ]{1,2}[\s-]?\d{1,4}[\s-]?[A-ZÆØÅ]{0,2}$/,
        "Registration mark must look like R 0062H, R-62-H or F 12 T.",
      ),
  );

/**
 * A maritime radio call sign.
 *
 * The one identifier AIS and the fishing-vessel register both publish, which is
 * what lets the vessel profile join them. Norwegian call signs are three
 * letters and four characters (e.g. `LDMV`), but foreign vessels appear too, so
 * the pattern stays general.
 */
export const callSignSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9]{3,10}$/, "Call sign must be 3-10 letters or digits, for example LDMV."),
  );

/** Fiskeridirektoratet's public aquaculture site number (lokalitetsnummer). */
export const siteNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{1,7}$/, "Site number must be 1-7 digits, for example 10318.");

/** Production-area code along the Norwegian coast, 1-13. */
export const productionAreaCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, "Production area code must be one or two digits, 1 to 13.")
  .refine((value) => {
    const parsed = Number(value);
    return parsed >= 1 && parsed <= 13;
  }, "Production area code must be between 1 and 13.");

/**
 * Largest window this MCP server will accept, in degrees.
 *
 * **This is a limit imposed by this MCP server, not by BarentsWatch.**
 * BarentsWatch publishes no maximum bounding-box size for its AIS APIs, and the
 * SDK's own `boundingBoxSchema` enforces only latitude/longitude ranges, edge
 * ordering and a refusal to cross the antimeridian. A caller using the SDK
 * directly may request any box the provider will serve.
 *
 * The cap exists because of what MCP is: a tool call returns one bounded result
 * into a model's context window. AIS traffic scales with sea area, so a box
 * spanning the whole Norwegian coast would fill the result budget with whichever
 * few vessels happened to transmit first — an answer that looks like an area
 * survey but is an arbitrary sample of one. Refusing the request is more honest
 * than returning that, and it also keeps one tool call from holding a
 * high-volume stream open on the provider's behalf.
 *
 * 6° × 12° is roughly the Norwegian coast from Stavanger to Trondheim: large
 * enough for any real regional question, small enough that a sample of it means
 * something. It is a product decision and may be revised; it is not a provider
 * constraint and must not be documented as one.
 */
export const MAX_BOX_SPAN_DEGREES = { latitude: 6, longitude: 12 } as const;

/**
 * A WGS84 bounding box, validated before the SDK sees it.
 *
 * The SDK enforces the same ordering rules and rejects an antimeridian-crossing
 * box. Re-stating them here means the caller gets a field-level schema error
 * naming the edge that is wrong, rather than a provider-shaped error after the
 * request has already been built.
 */
export const boundingBoxSchema = z
  .object({
    south: latitudeSchema.describe("Southern latitude edge, -90 to 90."),
    west: longitudeSchema.describe("Western longitude edge, -180 to 180."),
    north: latitudeSchema.describe("Northern latitude edge, greater than south."),
    east: longitudeSchema.describe("Eastern longitude edge, greater than west."),
  })
  .strict()
  .refine((box) => box.north > box.south, {
    message: "The bounding box north edge must be greater than its south edge.",
  })
  .refine((box) => box.east > box.west, {
    message:
      "The bounding box east edge must be greater than its west edge. A box crossing the antimeridian is not supported.",
  })
  .refine((box) => box.north - box.south <= MAX_BOX_SPAN_DEGREES.latitude, {
    message: `The bounding box spans more than ${MAX_BOX_SPAN_DEGREES.latitude} degrees of latitude. This is a limit of this MCP server, not of BarentsWatch: a sample of an area that large is not representative of it. Request a smaller area.`,
  })
  .refine((box) => box.east - box.west <= MAX_BOX_SPAN_DEGREES.longitude, {
    message: `The bounding box spans more than ${MAX_BOX_SPAN_DEGREES.longitude} degrees of longitude. This is a limit of this MCP server, not of BarentsWatch: a sample of an area that large is not representative of it. Request a smaller area.`,
  });

/**
 * Largest window the geospatial feature searches accept, in degrees.
 *
 * **A limit of this MCP server, not of Miljødirektoratet or NIBIO.** Neither
 * provider publishes a maximum query extent, and the SDK's own
 * `boundingBoxSchema` enforces only edge ordering and the antimeridian rule.
 *
 * The cap is larger than the AIS one because a mapped protected area is a
 * static polygon rather than a moving vessel, so a regional question is
 * meaningful here. It is still a cap: feature geometry is the largest payload
 * this server can produce, and a box spanning the country would return an
 * arbitrary first page of it. 2° × 4° is roughly 220 km square at Norwegian
 * latitudes — a county-sized window.
 */
export const MAX_FEATURE_BOX_SPAN_DEGREES = { latitude: 2, longitude: 4 } as const;

/**
 * A WGS84 bounding box for the Naturbase feature searches.
 *
 * Deliberately a separate schema from {@link boundingBoxSchema} rather than a
 * parameterization of it: the two carry different caps for different reasons,
 * and the AIS message must keep naming BarentsWatch.
 */
export const featureBoundingBoxSchema = z
  .object({
    south: latitudeSchema.describe("Southern latitude edge, -90 to 90."),
    west: longitudeSchema.describe("Western longitude edge, -180 to 180."),
    north: latitudeSchema.describe("Northern latitude edge, greater than south."),
    east: longitudeSchema.describe("Eastern longitude edge, greater than west."),
  })
  .strict()
  .refine((box) => box.north > box.south, {
    message: "The bounding box north edge must be greater than its south edge.",
  })
  .refine((box) => box.east > box.west, {
    message:
      "The bounding box east edge must be greater than its west edge. A box crossing the antimeridian is not supported by the SDK and is refused here.",
  })
  .refine((box) => box.north - box.south <= MAX_FEATURE_BOX_SPAN_DEGREES.latitude, {
    message: `The bounding box spans more than ${MAX_FEATURE_BOX_SPAN_DEGREES.latitude} degrees of latitude. This is a limit of this MCP server, not of the provider: a bounded page of an area that large is not a survey of it. Request a smaller area.`,
  })
  .refine((box) => box.east - box.west <= MAX_FEATURE_BOX_SPAN_DEGREES.longitude, {
    message: `The bounding box spans more than ${MAX_FEATURE_BOX_SPAN_DEGREES.longitude} degrees of longitude. This is a limit of this MCP server, not of the provider: a bounded page of an area that large is not a survey of it. Request a smaller area.`,
  });

/**
 * A Geonorge metadata identifier.
 *
 * Geonorge publishes opaque UUID-shaped identifiers. The pattern accepts those
 * and nothing that could be a location: no scheme, no slash, no whitespace and
 * no control character, so a URL — the one input that would turn a curated
 * catalogue tool into an arbitrary-URL proxy — cannot be smuggled in.
 */
export const metadataIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
    "Metadata ID must be a Geonorge catalogue identifier such as 6bfe2f5d-...-9b3c. URLs, paths and service endpoints are not accepted: this server does not fetch arbitrary addresses.",
  )
  .refine(
    (value) => !value.includes("://"),
    "Metadata ID must be a catalogue identifier, not a URL. This server never fetches a caller-supplied address.",
  );

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

/**
 * SSB Klass speaks its own language codes, distinct from the `no`/`en` used by
 * the PxWeb statistics API: `nb` (Bokmål), `nn` (Nynorsk) and `en`. `nb` is the
 * SDK's own default and the most complete Klass language, so it is the default
 * here too.
 */
export const klassLanguageSchema = z.enum(["nb", "nn", "en"]).default("nb");

/**
 * A Klass classification identifier — the stable numeric id of an official
 * classification or codelist (e.g. 131 for municipalities, 6 for industry).
 * A positive integer; blank, zero, negative, fractional and absurd values are
 * refused before any request is made. It is not restricted to a fixed list,
 * because Klass publishes well over a hundred classifications.
 */
export const classificationIdSchema = z
  .number()
  .int("Classification ID must be a whole number, for example 131 for municipalities.")
  .min(1, "Classification ID must be a positive number.")
  .max(999_999, "Classification ID is out of range.");

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
