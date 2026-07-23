import { z } from "zod";
import type { ElectricityPrice, OpenDataResponse } from "norway-open-data-sdk";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { daysBetween, isoDateSchema, osloToday, priceAreaSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

// A Norwegian local day has 23, 24 or 25 hours across DST transitions. The cap
// is the physical maximum, so this tool needs no user-facing limit.
const MAX_HOURS_IN_DAY = 25;

const inputSchema = z
  .object({
    area: priceAreaSchema,
    date: isoDateSchema.optional(),
    includeCurrent: z.boolean().default(true),
  })
  .strict();

const priceSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  nokPerKwh: z.number(),
  eurPerKwh: z.number(),
  exchangeRate: z.number(),
});

const dataSchema = z.object({
  area: z.string(),
  date: z.string(),
  prices: z.array(priceSchema),
  currentPrice: priceSchema.nullable(),
  summary: z
    .object({
      minNokPerKwh: z.number(),
      maxNokPerKwh: z.number(),
      averageNokPerKwh: z.number(),
      cheapestHour: z.string(),
      mostExpensiveHour: z.string(),
    })
    .nullable(),
});

type Data = z.infer<typeof dataSchema>;

function toPrice(price: ElectricityPrice): z.infer<typeof priceSchema> {
  return {
    startsAt: price.startsAt,
    endsAt: price.endsAt,
    nokPerKwh: price.nokPerKwh,
    eurPerKwh: price.eurPerKwh,
    exchangeRate: price.exchangeRate,
  };
}

function summarize(prices: readonly z.infer<typeof priceSchema>[]): Data["summary"] {
  if (prices.length === 0) return null;
  let cheapest = prices[0] as z.infer<typeof priceSchema>;
  let dearest = prices[0] as z.infer<typeof priceSchema>;
  let total = 0;
  for (const price of prices) {
    if (price.nokPerKwh < cheapest.nokPerKwh) cheapest = price;
    if (price.nokPerKwh > dearest.nokPerKwh) dearest = price;
    total += price.nokPerKwh;
  }
  return {
    minNokPerKwh: cheapest.nokPerKwh,
    maxNokPerKwh: dearest.nokPerKwh,
    averageNokPerKwh: Number((total / prices.length).toFixed(4)),
    cheapestHour: cheapest.startsAt,
    mostExpensiveHour: dearest.startsAt,
  };
}

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();
  const sdk = context.getSdk();
  const today = osloToday(context.now());
  const date = input.date ?? today;

  const responses: OpenDataResponse<unknown>[] = [];
  const priceResponse = await sdk.electricity.getPrices({ area: input.area, date }, { signal });
  responses.push(priceResponse);

  // The "current hour" only exists inside today's published day; asking for it
  // on a historical date would be meaningless.
  let currentPrice: z.infer<typeof priceSchema> | null = null;
  if (input.includeCurrent && date === today) {
    const currentResponse = await sdk.electricity.getCurrentPrice({ area: input.area }, { signal });
    responses.push(currentResponse);
    currentPrice = currentResponse.data ? toPrice(currentResponse.data) : null;
  }

  const prices = tracker.limitArray("prices", priceResponse.data, MAX_HOURS_IN_DAY).map(toPrice);

  const warnings = [
    ...tracker.warnings(),
    "Spot prices exclude grid rent (nettleie), taxes and surcharges, so they are not the final " +
      "consumer price.",
    "Hva koster strømmen? is an independent third-party service, not an official government " +
      "endpoint. It derives prices from ENTSO-E and converts them with Norges Bank rates.",
  ];

  if (prices.length !== 24) {
    warnings.push(
      `This day has ${prices.length} hourly intervals rather than 24, which is expected across a daylight-saving transition.`,
    );
  }

  return buildEnvelope<Data>({
    data: {
      area: input.area,
      date,
      prices,
      currentPrice,
      summary: summarize(prices),
    },
    responses,
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  if (data.prices.length === 0) {
    return renderWithEnvelope(`No published prices for ${data.area} on ${data.date}.`, envelope);
  }

  const rows = data.prices
    .map((price) => `- ${price.startsAt.slice(11, 16)}: ${price.nokPerKwh.toFixed(4)} NOK/kWh`)
    .join("\n");

  const lines = [`Electricity spot prices for ${data.area} on ${data.date}:`];
  if (data.summary) {
    lines.push(
      `Average ${data.summary.averageNokPerKwh.toFixed(4)} NOK/kWh; ` +
        `cheapest at ${data.summary.cheapestHour.slice(11, 16)} (${data.summary.minNokPerKwh.toFixed(4)}), ` +
        `most expensive at ${data.summary.mostExpensiveHour.slice(11, 16)} (${data.summary.maxNokPerKwh.toFixed(4)}).`,
    );
  }
  if (data.currentPrice) {
    lines.push(`Current hour: ${data.currentPrice.nokPerKwh.toFixed(4)} NOK/kWh.`);
  }

  return renderWithEnvelope(`${lines.join("\n")}\n\n${rows}`, envelope);
}

export const electricityPricesTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_norwegian_electricity_prices",
  title: "Get Norwegian electricity spot prices",
  description:
    "Get hourly electricity spot prices in NOK and EUR per kWh for one Norwegian bidding zone and " +
    "day, with the cheapest and most expensive hours. Zones are NO1 (Oslo/Øst), NO2 " +
    "(Kristiansand/Sør), NO3 (Trondheim/Midt), NO4 (Tromsø/Nord) and NO5 (Bergen/Vest). " +
    "Use this when the user asks what electricity costs today or on a given date, when the " +
    "cheapest hours are, or about strømpris. " +
    "Do not use this for national energy production, reservoir levels or power plants, which this " +
    "server does not expose, or for general energy statistics, which would be " +
    "query_norwegian_statistics. " +
    "Prices exclude grid rent, taxes and surcharges. Next-day prices are normally published in " +
    "the early afternoon; asking earlier reports that the day is not yet published.",
  inputSchema,
  dataSchema,
  handler,
  render,
};

/** Exposed for tests that assert the date guard without hitting a provider. */
export const __testing = { daysBetween };
