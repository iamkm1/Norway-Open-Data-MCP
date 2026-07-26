import { z } from "zod";
import type { OpenDataResponse, SeaCurrentForecast, WaveForecast } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { MARINE_MODEL_NOTE, requiresBarentswatchCredentials } from "./shared/maritime.js";
import { latitudeSchema, longitudeSchema } from "./shared/schemas.js";
import type { ToolContext, ToolDefinition, ToolInvocation } from "./types.js";

const inputSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    include: z
      .array(z.enum(["waves", "current"]))
      .min(1, "Request at least one of waves or current.")
      .max(2)
      .default(["waves", "current"])
      .describe("Which forecasts to retrieve. Both by default."),
  })
  .strict();

const dataSchema = z.object({
  requested: z.object({ latitude: z.number(), longitude: z.number() }),
  waves: z
    .object({
      forecastTime: z.string().optional(),
      /** Metres. */
      significantWaveHeight: z.number().optional(),
      /** Metres. */
      maximumWaveHeight: z.number().optional(),
      /** Degrees. */
      meanWaveDirection: z.number().optional(),
      /** Seconds. */
      peakPeriod: z.number().optional(),
      /** Centre of the model grid cell that answered, not the requested point. */
      latitude: z.number(),
      longitude: z.number(),
    })
    .nullable()
    .describe("Null when no wave model covers the coordinate, which is a normal outcome."),
  current: z
    .object({
      forecastTime: z.string().optional(),
      /** In the units the model publishes; BarentsWatch states none. */
      speed: z.number(),
      /** Degrees. */
      direction: z.number(),
      latitude: z.number(),
      longitude: z.number(),
    })
    .nullable()
    .describe("Null when no current model covers the coordinate, which is a normal outcome."),
  /** Sections asked for that could not be retrieved because a request failed. */
  failedSections: z.array(z.string()),
});

type Data = z.infer<typeof dataSchema>;

/**
 * Runs one forecast request, converting a provider failure into a recorded
 * absence rather than a failed tool call.
 *
 * The two models are independent services behind one provider: a current-model
 * outage must not withhold a wave forecast the caller can use. A missing
 * section is reported in `failedSections`, in `partial` and as a warning, so it
 * can never be mistaken for "no model covers this point".
 */
async function attempt<T>(
  section: string,
  run: () => Promise<OpenDataResponse<T | undefined>>,
  collected: {
    responses: OpenDataResponse<unknown>[];
    failed: string[];
    warnings: string[];
  },
  signal: AbortSignal,
  context: ToolContext,
): Promise<T | undefined> {
  // The caller may have cancelled while the previous section was in flight.
  // Starting a second request against an already-aborted signal would be a
  // request that can only fail.
  if (signal.aborted) {
    throw Object.assign(new Error("The request was cancelled before it completed."), {
      name: "AbortError",
    });
  }

  try {
    const response = await run();
    collected.responses.push(response);
    return response.data;
  } catch (error) {
    // Cancellation is the caller's, not a provider fault, and must abort the
    // whole call rather than degrade into a partial result. It is detected by
    // the signal, not the error class: the SDK reports an aborted request as a
    // ProviderError, so a class check here would quietly convert the user's own
    // cancellation into a "provider failed" partial result.
    if (signal.aborted) throw error;
    collected.failed.push(section);
    collected.warnings.push(
      `The "${section}" forecast is missing because the provider request failed. This is a partial result, not an absence of data.`,
    );
    context.logger.warn("Marine forecast section failed.", {
      section,
      error: error instanceof Error ? error.name : "unknown",
    });
    return undefined;
  }
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const sdk = context.getSdk();
  const point = { latitude: input.latitude, longitude: input.longitude };
  const collected = {
    responses: [] as OpenDataResponse<unknown>[],
    failed: [] as string[],
    warnings: [] as string[],
  };

  const wantWaves = input.include.includes("waves");
  const wantCurrent = input.include.includes("current");

  // Sequential, not concurrent: both hit the same provider, and the SDK's
  // per-provider request budget is a courtesy limit worth staying inside.
  const waves = wantWaves
    ? await attempt<WaveForecast>(
        "waves",
        () => sdk.marine.getWaveForecast(point, { signal }),
        collected,
        signal,
        context,
      )
    : undefined;
  const current = wantCurrent
    ? await attempt<SeaCurrentForecast>(
        "current",
        () => sdk.marine.getSeaCurrent(point, { signal }),
        collected,
        signal,
        context,
      )
    : undefined;

  if (collected.responses.length === 0) {
    // Every requested section failed; there is no answer and no provenance to
    // report, so this is an error rather than an empty result.
    throw Object.assign(new Error("Every requested marine forecast request failed."), {
      name: "ProviderError",
      provider: "barentswatch",
    });
  }

  const warnings = [...collected.warnings, MARINE_MODEL_NOTE];
  if (wantWaves && waves === undefined && !collected.failed.includes("waves")) {
    warnings.push("No wave model covers this coordinate.");
  }
  if (wantCurrent && current === undefined && !collected.failed.includes("current")) {
    warnings.push("No sea-current model covers this coordinate.");
  }

  return buildEnvelope<Data>({
    data: {
      requested: point,
      waves:
        waves === undefined
          ? null
          : {
              ...(waves.forecastTime !== undefined ? { forecastTime: waves.forecastTime } : {}),
              ...(waves.significantWaveHeight !== undefined
                ? { significantWaveHeight: waves.significantWaveHeight }
                : {}),
              ...(waves.maximumWaveHeight !== undefined
                ? { maximumWaveHeight: waves.maximumWaveHeight }
                : {}),
              ...(waves.meanWaveDirection !== undefined
                ? { meanWaveDirection: waves.meanWaveDirection }
                : {}),
              ...(waves.peakPeriod !== undefined ? { peakPeriod: waves.peakPeriod } : {}),
              latitude: waves.latitude,
              longitude: waves.longitude,
            },
      current:
        current === undefined
          ? null
          : {
              ...(current.forecastTime !== undefined ? { forecastTime: current.forecastTime } : {}),
              speed: current.speed,
              direction: current.direction,
              latitude: current.latitude,
              longitude: current.longitude,
            },
      failedSections: collected.failed,
    },
    responses: collected.responses,
    warnings,
    partial:
      collected.failed.length > 0
        ? {
            complete: false,
            missing: collected.failed,
            reason: "A BarentsWatch forecast request failed.",
          }
        : null,
  });
}

/**
 * Rounds for display only.
 *
 * The models publish raw doubles — a live sea current came back as
 * `0.21719335266844905` — and seventeen significant digits in a human-readable
 * summary is noise, not precision. The structured payload keeps the provider's
 * exact value; only this text form is shortened.
 */
function display(value: number | undefined, digits = 2): number | undefined {
  if (value === undefined) return undefined;
  return Number(value.toFixed(digits));
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [
    `Marine forecast near ${data.requested.latitude}, ${data.requested.longitude}`,
  ];

  sections.push(
    data.waves === null
      ? "Waves: no forecast available for this coordinate."
      : [
          "Waves",
          ...fields([
            ["Valid at", data.waves.forecastTime],
            ["Significant wave height (m)", display(data.waves.significantWaveHeight)],
            ["Maximum wave height (m)", display(data.waves.maximumWaveHeight)],
            ["Mean direction (°)", display(data.waves.meanWaveDirection, 0)],
            ["Peak period (s)", display(data.waves.peakPeriod, 1)],
            ["Model cell", `${data.waves.latitude}, ${data.waves.longitude}`],
          ]),
        ].join("\n"),
  );

  sections.push(
    data.current === null
      ? "Sea current: no forecast available for this coordinate."
      : [
          "Sea current",
          ...fields([
            ["Valid at", data.current.forecastTime],
            ["Speed (model units)", display(data.current.speed)],
            ["Direction (°)", display(data.current.direction, 0)],
            ["Model cell", `${data.current.latitude}, ${data.current.longitude}`],
          ]),
        ].join("\n"),
  );

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const marineForecastTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_marine_forecast",
  title: "Get Norwegian marine forecast",
  description:
    "Get the BarentsWatch wave and sea-current forecast valid now for a coordinate along the " +
    "Norwegian coast: significant and maximum wave height, wave direction and peak period, plus " +
    "current speed and direction. " +
    "Use this when the user asks about sea state, wave height, swell or currents — conditions on " +
    "the water rather than in the air. " +
    "Do not use this for wind, air temperature or precipitation, which is " +
    "get_norwegian_weather_forecast from MET Norway, and do not use it for official danger " +
    "warnings. A coordinate no model covers returns null sections rather than failing. " +
    "Requires NORWAY_MCP_BARENTSWATCH_CLIENT_ID and NORWAY_MCP_BARENTSWATCH_CLIENT_SECRET.",
  inputSchema,
  dataSchema,
  requiredEnvironment: requiresBarentswatchCredentials,
  handler,
  render,
};
