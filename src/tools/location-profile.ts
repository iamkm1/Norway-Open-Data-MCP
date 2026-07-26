import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { searchQuerySchema } from "./shared/schemas.js";
import {
  HAZARD_DISCLAIMER,
  addressSchema,
  componentSchema,
  componentWarnings,
  describeHazardMatches,
  hazardSchema,
  missingSections,
  projectAddress,
  componentProvenance,
  projectComponents,
  projectHazard,
  renderHazardLines,
} from "./shared/profile.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const MAX_HAZARDS = 20;
const MAX_ROADS = 25;
const MAX_COMPONENTS = 20;

const inputSchema = z
  .object({
    query: searchQuerySchema("Address query", 2, 200),
  })
  .strict();

const dataSchema = z.object({
  address: addressSchema,
  weather: z
    .object({
      time: z.string(),
      temperature: z.number().optional(),
      windSpeed: z.number().optional(),
      humidity: z.number().optional(),
      cloudCover: z.number().optional(),
      precipitationNextHour: z.number().optional(),
      symbolCode: z.string().optional(),
    })
    .nullable(),
  hazards: z.array(hazardSchema),
  hazardMatchEvidence: z.array(z.string()),
  roads: z.array(
    z.object({
      roadReference: z.string().optional(),
      roadType: z.string().optional(),
      length: z.number().optional(),
      municipalityCode: z.string().optional(),
    }),
  ),
  roadSearch: z
    .object({
      shape: z.string(),
      halfSizeMetres: z.number(),
      boundingBox: z.array(z.number()),
      truncated: z.boolean(),
    })
    .nullable(),
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const response = await context.getSdk().profiles.address(input.query, { signal });
  const profile = response.data;

  const components = tracker.limitArray(
    "components",
    projectComponents(profile.components),
    MAX_COMPONENTS,
  );
  const hazards = tracker
    .limitArray("hazards", profile.hazards, MAX_HAZARDS)
    .map((warning, index) => projectHazard(warning, tracker, index));
  const roads = tracker.limitArray("roads", profile.roads ?? [], MAX_ROADS).map((segment) => ({
    ...(segment.roadReference !== undefined ? { roadReference: segment.roadReference } : {}),
    ...(segment.roadType !== undefined ? { roadType: segment.roadType } : {}),
    ...(segment.length !== undefined ? { length: segment.length } : {}),
    ...(segment.municipalityCode !== undefined
      ? { municipalityCode: segment.municipalityCode }
      : {}),
  }));

  const data: Data = {
    address: projectAddress(profile.address),
    weather: profile.weather
      ? {
          time: profile.weather.time,
          ...(profile.weather.temperature !== undefined
            ? { temperature: profile.weather.temperature }
            : {}),
          ...(profile.weather.windSpeed !== undefined
            ? { windSpeed: profile.weather.windSpeed }
            : {}),
          ...(profile.weather.humidity !== undefined ? { humidity: profile.weather.humidity } : {}),
          ...(profile.weather.cloudCover !== undefined
            ? { cloudCover: profile.weather.cloudCover }
            : {}),
          ...(profile.weather.precipitationNextHour !== undefined
            ? { precipitationNextHour: profile.weather.precipitationNextHour }
            : {}),
          ...(profile.weather.symbolCode !== undefined
            ? { symbolCode: profile.weather.symbolCode }
            : {}),
        }
      : null,
    hazards,
    hazardMatchEvidence: describeHazardMatches(profile.hazardMatches),
    roads,
    roadSearch: profile.roadSearch
      ? {
          shape: profile.roadSearch.shape,
          halfSizeMetres: profile.roadSearch.halfSizeMetres,
          boundingBox: [...profile.roadSearch.boundingBox],
          truncated: profile.roadSearch.truncated,
        }
      : null,
    components,
  };

  const warnings = [HAZARD_DISCLAIMER, ...componentWarnings(components), ...tracker.warnings()];
  if (data.roadSearch?.truncated) {
    warnings.push(
      "Nearby roads are the first page of bounding-box candidates from NVDB, not a complete or " +
        "distance-ranked list. More segments exist inside the same box.",
    );
  }
  if (data.roads.length > 0) {
    warnings.push(
      "Road segments intersect a square bounding box around the address, not a circular radius.",
    );
  }

  const missing = missingSections(components);

  return buildEnvelope<Data>({
    data,
    responses: componentProvenance(response),
    warnings,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason: "One or more location sections could not be retrieved.",
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [];
  const address = data.address;
  sections.push(
    [
      address.addressText ?? "(address)",
      ...fields([
        ["Postal", [address.postalCode, address.postalPlace].filter(Boolean).join(" ")],
        ["Municipality", address.municipalityName],
        ["County", address.countyName],
        [
          "Coordinate",
          address.latitude !== undefined && address.longitude !== undefined
            ? `${address.latitude}, ${address.longitude}`
            : undefined,
        ],
      ]),
    ].join("\n"),
  );

  if (data.weather) {
    sections.push(
      [
        `Conditions at ${data.weather.time}:`,
        ...fields([
          ["Temperature", data.weather.temperature],
          ["Wind speed", data.weather.windSpeed],
          ["Humidity", data.weather.humidity],
          ["Cloud cover", data.weather.cloudCover],
          ["Precipitation next hour", data.weather.precipitationNextHour],
          ["Symbol", data.weather.symbolCode],
        ]),
      ].join("\n"),
    );
  }

  sections.push(`Hazard warnings matching this address:\n${renderHazardLines(data.hazards)}`);

  if (data.roads.length > 0) {
    sections.push(
      `Nearby road segments (${data.roads.length}):\n` +
        data.roads
          .map(
            (road) =>
              `- ${road.roadReference ?? "(unnamed)"}${road.roadType ? ` (${road.roadType})` : ""}`,
          )
          .join("\n"),
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const locationProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_location_profile",
  title: "Get Norwegian location profile",
  description:
    "Answer ONE specific Norwegian address from several agencies at once: the official Kartverket " +
    "address match, current weather conditions at that coordinate (MET Norway), official NVE " +
    "hazard warnings whose administrative area matches the address, and nearby road segments. " +
    "Sections whose provider is not configured are omitted with a stated reason instead of " +
    "failing the call. " +
    "Use this when the user asks what things are like at one known address or place. " +
    "Do not use this when choosing between several addresses or when only a postal code is needed " +
    "(search_norwegian_addresses), when a multi-hour forecast for a coordinate is wanted " +
    "(get_norwegian_weather_forecast), or when nationwide warnings are wanted " +
    "(get_current_norwegian_hazards).",
  inputSchema,
  dataSchema,
  handler,
  render,
};
