import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import {
  CAPACITY_UNIT_NOTE,
  aquacultureSiteSchema,
  projectAquacultureSite,
} from "./shared/maritime.js";
import { siteNumberSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const inputSchema = z
  .object({
    siteNumber: siteNumberSchema.describe(
      "The register's public site number (lokalitetsnummer), for example 10318.",
    ),
  })
  .strict();

const dataSchema = z.object({ site: aquacultureSiteSchema });

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const response = await context
    .getSdk()
    .fisheries.getAquacultureSite(input.siteNumber, { signal });
  const site = projectAquacultureSite(response.data);

  return buildEnvelope<Data>({
    data: { site },
    responses: [response],
    warnings: site.capacity !== undefined ? [CAPACITY_UNIT_NOTE] : [],
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const site = data.site;
  const body = [
    `${site.name ?? "(unnamed)"} — site ${site.siteNumber}`,
    ...fields([
      ["Municipality", site.municipalityName],
      ["Municipality code", site.municipalityCode],
      ["County", site.countyName],
      ["Production area", site.productionAreaCode],
      ["Production area name", site.productionAreaName],
      ["Production area status", site.productionAreaStatus],
      ["Water type", site.waterType],
      ["Placement", site.placementType],
      [
        "Capacity",
        site.capacity !== undefined
          ? `${site.capacity} ${site.capacityUnitType ?? "(unit not stated)"}`
          : undefined,
      ],
      ["Species", site.speciesTypes?.join(", ")],
      ["Licences", site.licenceNumbers?.join(", ")],
      ["Slaughterhouse", site.isSlaughterhouse === true ? "yes" : undefined],
      ["Commercial activity", site.hasCommercialActivity === true ? "yes" : undefined],
      [
        "Coordinate",
        site.latitude !== undefined ? `${site.latitude}, ${site.longitude ?? "?"}` : undefined,
      ],
    ]),
  ].join("\n");

  return renderWithEnvelope(body, envelope);
}

export const aquacultureLocationTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_aquaculture_location",
  title: "Get a Norwegian aquaculture location",
  description:
    "Return one aquaculture site from Fiskeridirektoratet's public register by its site number " +
    "(lokalitetsnummer), including coordinate, water type, placement, permitted capacity with " +
    "its unit, species groups, valid licence numbers and the production area with its " +
    "traffic-light status. Needs no credentials. " +
    "Use this when a specific site number is already known. " +
    "Do not use this to discover sites by area, company or species — that is " +
    "search_aquaculture_locations — and do not confuse the site number with a licence number " +
    "such as H-KM-0018, which is a different identifier.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
