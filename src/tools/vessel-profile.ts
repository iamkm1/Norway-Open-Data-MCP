import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import {
  componentSchema,
  componentWarnings,
  missingSections,
  componentProvenance,
  projectComponents,
} from "./shared/profile.js";
import {
  AIS_COVERAGE_NOTE,
  OWNER_PRIVACY_NOTE,
  fishingVesselSchema,
  projectFishingVessel,
  projectTrackPoint,
  renderFishingVessel,
  requiresAisCredentials,
  trackPointSchema,
} from "./shared/maritime.js";
import { mmsiSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const inputSchema = z
  .object({
    mmsi: mmsiSchema.describe("Maritime Mobile Service Identity of the vessel, 1-9 digits."),
  })
  .strict();

const dataSchema = z.object({
  mmsi: z.string(),
  ais: z.object({
    /**
     * `no-recent-data` is an ordinary answer, not an error. See
     * `AIS_COVERAGE_NOTE`.
     */
    status: z.enum(["available", "no-recent-data"]),
    latestPosition: trackPointSchema.optional(),
    /** Points recorded in the provider's window, when AIS held any. */
    trackPointCount: z.number().optional(),
    trackFrom: z.string().optional(),
    trackTo: z.string().optional(),
    identity: z
      .object({
        name: z.string().optional(),
        callSign: z.string().optional(),
        imoNumber: z.string().optional(),
        /** Raw AIS ship-type code; not normalized to text. */
        shipType: z.number().optional(),
      })
      .optional(),
  }),
  /** Present only when the vessel is in the Norwegian fishing-vessel register. */
  registration: fishingVesselSchema.optional(),
  weather: z
    .object({
      time: z.string(),
      temperature: z.number().optional(),
      windSpeed: z.number().optional(),
      symbolCode: z.string().optional(),
    })
    .optional(),
  nearestPlace: z
    .object({
      name: z.string(),
      type: z.string().optional(),
      municipalityName: z.string().optional(),
      countyName: z.string().optional(),
    })
    .optional(),
  components: z.array(componentSchema),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  // One SDK call. The cross-provider composition, its per-section failure
  // handling and its provenance are the SDK's job, not this server's.
  const response = await context.getSdk().profiles.vessel({ mmsi: input.mmsi }, { signal });
  const profile = response.data;

  const components = projectComponents(profile.components);
  const missing = missingSections(components);
  const ais = profile.ais;
  const place = profile.nearestPlace;

  const warnings = [
    ...tracker.warnings(),
    ...componentWarnings(components),
    AIS_COVERAGE_NOTE,
    ...(profile.registration !== undefined ? [OWNER_PRIVACY_NOTE] : []),
  ];

  if (ais.status === "no-recent-data") {
    warnings.push(
      "BarentsWatch returned no AIS position for this MMSI in its window. That is not evidence " +
        "the MMSI is unassigned or the vessel does not exist.",
    );
  }

  return buildEnvelope<Data>({
    data: {
      mmsi: profile.mmsi,
      ais: {
        status: ais.status,
        ...(ais.latestPosition !== undefined
          ? { latestPosition: projectTrackPoint(ais.latestPosition) }
          : {}),
        ...(ais.track !== undefined
          ? {
              trackPointCount: ais.track.points.length,
              ...(ais.track.from !== undefined ? { trackFrom: ais.track.from } : {}),
              ...(ais.track.to !== undefined ? { trackTo: ais.track.to } : {}),
            }
          : {}),
        ...(ais.identity !== undefined
          ? {
              identity: {
                ...(ais.identity.name !== undefined ? { name: ais.identity.name } : {}),
                ...(ais.identity.callSign !== undefined ? { callSign: ais.identity.callSign } : {}),
                ...(ais.identity.imoNumber !== undefined
                  ? { imoNumber: ais.identity.imoNumber }
                  : {}),
                ...(ais.identity.shipType !== undefined ? { shipType: ais.identity.shipType } : {}),
              },
            }
          : {}),
      },
      ...(profile.registration !== undefined
        ? { registration: projectFishingVessel(profile.registration) }
        : {}),
      ...(profile.weather !== undefined
        ? {
            weather: {
              time: profile.weather.time,
              ...(profile.weather.temperature !== undefined
                ? { temperature: profile.weather.temperature }
                : {}),
              ...(profile.weather.windSpeed !== undefined
                ? { windSpeed: profile.weather.windSpeed }
                : {}),
              ...(profile.weather.symbolCode !== undefined
                ? { symbolCode: profile.weather.symbolCode }
                : {}),
            },
          }
        : {}),
      ...(place !== undefined
        ? {
            nearestPlace: {
              name: place.name,
              ...(place.type !== undefined ? { type: place.type } : {}),
              ...(place.municipalityName !== undefined
                ? { municipalityName: place.municipalityName }
                : {}),
              ...(place.countyName !== undefined ? { countyName: place.countyName } : {}),
            },
          }
        : {}),
      components,
    },
    responses: componentProvenance(response),
    warnings,
    truncation: tracker.report(),
    partial:
      missing.length > 0
        ? {
            complete: false,
            missing,
            reason: "One or more providers could not be reached or are not configured.",
          }
        : null,
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const identity = data.ais.identity;
  const heading = identity?.name ?? data.registration?.name ?? `MMSI ${data.mmsi}`;

  const sections: string[] = [
    `${heading} (MMSI ${data.mmsi})`,
    [
      "AIS",
      ...fields([
        ["Status", data.ais.status],
        ["Call sign", identity?.callSign],
        ["IMO number", identity?.imoNumber],
        ["Ship type code", identity?.shipType],
        ["Latest position time", data.ais.latestPosition?.messageTime],
        [
          "Latest position",
          data.ais.latestPosition?.latitude !== undefined
            ? `${data.ais.latestPosition.latitude}, ${data.ais.latestPosition.longitude ?? "?"}`
            : undefined,
        ],
        ["Speed (knots)", data.ais.latestPosition?.speedOverGround],
        ["Recorded track points", data.ais.trackPointCount],
      ]),
    ].join("\n"),
  ];

  if (data.registration) {
    sections.push(
      ["Fishing-vessel register", ...renderFishingVessel(data.registration)].join("\n"),
    );
  }
  if (data.nearestPlace) {
    sections.push(
      [
        "Nearest place",
        ...fields([
          ["Name", data.nearestPlace.name],
          ["Municipality", data.nearestPlace.municipalityName],
        ]),
      ].join("\n"),
    );
  }
  if (data.weather) {
    sections.push(
      [
        "Conditions at the latest position",
        ...fields([
          ["Time", data.weather.time],
          ["Temperature", data.weather.temperature],
          ["Wind (m/s)", data.weather.windSpeed],
          ["Symbol", data.weather.symbolCode],
        ]),
      ].join("\n"),
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const vesselProfileTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_vessel_profile",
  title: "Get vessel profile",
  description:
    "Identify one vessel by its MMSI and answer it from several Norwegian providers at once: its " +
    "latest BarentsWatch AIS position and identity, its entry in the Norwegian fishing-vessel " +
    "register when it has one, conditions at the position and the nearest official place name. " +
    "Use this when the user names or asks about a specific vessel and you have its MMSI. " +
    "Do not use this when you want the vessel's movement history — get_vessel_track returns the " +
    "recorded positions themselves — and do not use it to find vessels currently in an area, " +
    "which is get_live_vessel_positions. Owner details for private individuals are never " +
    "returned. Requires NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_ID and " +
    "NORWAY_MCP_BARENTSWATCH_AIS_CLIENT_SECRET, because AIS is the only source that can resolve " +
    "an MMSI at all.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresAisCredentials,
  handler,
  render,
};
