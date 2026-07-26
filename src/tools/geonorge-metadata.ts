import { z } from "zod";

import { buildEnvelope, type Envelope } from "../formatting/envelope.js";
import { fields, renderWithEnvelope } from "../formatting/text.js";
import { TruncationTracker } from "../limits/budget.js";
import { GEONORGE_CATALOGUE_NOTE } from "./shared/geo.js";
import { metadataIdSchema } from "./shared/schemas.js";
import type { ToolDefinition, ToolInvocation } from "./types.js";

const MAX_KEYWORDS = 30;
const MAX_DISTRIBUTIONS = 20;
const MAX_SERVICES = 20;
const MAX_REFERENCE_SYSTEMS = 10;
const MAX_OPERATES_ON = 20;
const MAX_CONTACTS = 10;

const inputSchema = z
  .object({
    id: metadataIdSchema.describe(
      "Geonorge catalogue identifier, as returned by search_geonorge_datasets.",
    ),
  })
  .strict();

const dataSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["dataset", "service", "series", "service-layer", "software", "unknown"]),
  description: z.string().optional(),
  publisher: z.string().optional(),
  themes: z.array(z.string()),
  keywords: z.array(z.string()),
  spatialScope: z.string().optional(),
  /** WGS84 extent the publisher declares for the resource. */
  geographicExtent: z
    .object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() })
    .nullable(),
  referenceSystems: z.array(z.object({ name: z.string().optional(), url: z.string().optional() })),
  /**
   * Responsible organizations only.
   *
   * Geonorge publishes named individuals with e-mail addresses for many
   * records. The organization and its role answer "who is responsible for this
   * dataset"; the individual's name and address are personal data this server
   * does not relay. See docs/privacy.md.
   */
  contacts: z.array(z.object({ organization: z.string().optional(), role: z.string().optional() })),
  license: z.object({ name: z.string().optional(), url: z.string().optional() }).nullable(),
  attribution: z.string().optional(),
  useLimitations: z.string().optional(),
  access: z.object({
    isOpenData: z.boolean().optional(),
    isRestricted: z.boolean(),
    isProtected: z.boolean(),
    label: z.string().optional(),
    accessConstraints: z.string().optional(),
  }),
  updates: z.object({
    publishedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    metadataUpdatedAt: z.string().optional(),
    maintenanceFrequency: z.string().optional(),
    status: z.string().optional(),
  }),
  /** Endpoints the publisher advertises. Described, never fetched by this server. */
  distributions: z.array(
    z.object({
      kind: z.string(),
      protocol: z.string().optional(),
      url: z.string().optional(),
      name: z.string().optional(),
      organization: z.string().optional(),
      formats: z.array(z.string()),
    }),
  ),
  services: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().optional(),
      kind: z.string(),
      url: z.string().optional(),
    }),
  ),
  operatesOn: z.array(z.string()),
  serviceType: z.string().optional(),
});

type Data = z.infer<typeof dataSchema>;

async function handler(
  input: z.output<typeof inputSchema>,
  { signal, context }: ToolInvocation,
): Promise<Envelope<Data>> {
  const tracker = new TruncationTracker();

  const response = await context.getSdk().geodata.getMetadata(input.id, { signal });
  const metadata = response.data;

  const data: Data = {
    id: metadata.id,
    title: metadata.title,
    type: metadata.type,
    ...(metadata.description !== undefined
      ? { description: tracker.clampString("description", metadata.description, 2_000) }
      : {}),
    ...(metadata.publisher !== undefined ? { publisher: metadata.publisher } : {}),
    themes: [...metadata.themes],
    keywords: tracker.limitArray("keywords", metadata.keywords, MAX_KEYWORDS),
    ...(metadata.spatialScope !== undefined ? { spatialScope: metadata.spatialScope } : {}),
    geographicExtent: metadata.geographicExtent ? { ...metadata.geographicExtent } : null,
    referenceSystems: tracker
      .limitArray("referenceSystems", metadata.referenceSystems, MAX_REFERENCE_SYSTEMS)
      .map((system) => ({
        ...(system.name !== undefined ? { name: system.name } : {}),
        ...(system.url !== undefined ? { url: system.url } : {}),
      })),
    contacts: tracker.limitArray("contacts", metadata.contacts, MAX_CONTACTS).map((contact) => ({
      ...(contact.organization !== undefined ? { organization: contact.organization } : {}),
      ...(contact.role !== undefined ? { role: contact.role } : {}),
    })),
    license: metadata.license
      ? {
          ...(metadata.license.name !== undefined ? { name: metadata.license.name } : {}),
          ...(metadata.license.url !== undefined ? { url: metadata.license.url } : {}),
        }
      : null,
    ...(metadata.attribution !== undefined ? { attribution: metadata.attribution } : {}),
    ...(metadata.useLimitations !== undefined
      ? { useLimitations: tracker.clampString("useLimitations", metadata.useLimitations, 1_000) }
      : {}),
    access: {
      ...(metadata.access.isOpenData !== undefined
        ? { isOpenData: metadata.access.isOpenData }
        : {}),
      isRestricted: metadata.access.isRestricted,
      isProtected: metadata.access.isProtected,
      ...(metadata.access.label !== undefined ? { label: metadata.access.label } : {}),
      ...(metadata.access.accessConstraints !== undefined
        ? { accessConstraints: metadata.access.accessConstraints }
        : {}),
    },
    updates: {
      ...(metadata.updates.publishedAt !== undefined
        ? { publishedAt: metadata.updates.publishedAt }
        : {}),
      ...(metadata.updates.updatedAt !== undefined
        ? { updatedAt: metadata.updates.updatedAt }
        : {}),
      ...(metadata.updates.metadataUpdatedAt !== undefined
        ? { metadataUpdatedAt: metadata.updates.metadataUpdatedAt }
        : {}),
      ...(metadata.updates.maintenanceFrequency !== undefined
        ? { maintenanceFrequency: metadata.updates.maintenanceFrequency }
        : {}),
      ...(metadata.updates.status !== undefined ? { status: metadata.updates.status } : {}),
    },
    distributions: tracker
      .limitArray("distributions", metadata.distributions, MAX_DISTRIBUTIONS)
      .map((distribution) => ({
        kind: distribution.kind,
        ...(distribution.protocol !== undefined ? { protocol: distribution.protocol } : {}),
        ...(distribution.url !== undefined ? { url: distribution.url } : {}),
        ...(distribution.name !== undefined ? { name: distribution.name } : {}),
        ...(distribution.organization !== undefined
          ? { organization: distribution.organization }
          : {}),
        formats: distribution.formats.map((format) =>
          format.version === undefined ? format.name : `${format.name} ${format.version}`,
        ),
      })),
    services: tracker.limitArray("services", metadata.services, MAX_SERVICES).map((service) => ({
      ...(service.id !== undefined ? { id: service.id } : {}),
      ...(service.title !== undefined ? { title: service.title } : {}),
      kind: service.kind,
      ...(service.url !== undefined ? { url: service.url } : {}),
    })),
    operatesOn: tracker.limitArray("operatesOn", metadata.operatesOn, MAX_OPERATES_ON),
    ...(metadata.serviceType !== undefined ? { serviceType: metadata.serviceType } : {}),
  };

  const warnings = [GEONORGE_CATALOGUE_NOTE, ...tracker.warnings()];

  if (data.license === null) {
    warnings.push(
      "This record declares no licence in the catalogue. Absence of a licence field is not " +
        "permission: check with the publisher before reusing the resource.",
    );
  }
  if (data.access.isRestricted || data.access.isProtected) {
    warnings.push(
      "This resource is marked restricted or protected. Only its metadata is open, and this " +
        "server offers no way to reach the data itself.",
    );
  }
  if (data.distributions.length > 0 || data.services.length > 0) {
    warnings.push(
      "The listed endpoints are advertised by the publisher and are reported here as metadata. " +
        "This server does not call them, and no tool here accepts a service URL.",
    );
  }
  if (metadata.contacts.length > 0) {
    warnings.push(
      "Contacts are reduced to responsible organizations and roles. Named individuals and their " +
        "e-mail addresses appear in the Geonorge record but are not relayed by this server.",
    );
  }

  return buildEnvelope<Data>({
    data,
    responses: [response],
    warnings,
    truncation: tracker.report(),
  });
}

function render(data: Data, envelope: Envelope<Data>): string {
  const sections: string[] = [
    [
      `${data.title} (${data.type})`,
      ...fields([
        ["Identifier", data.id],
        ["Publisher", data.publisher],
        ["Themes", data.themes.join(", ")],
        ["Keywords", data.keywords.slice(0, 10).join(", ")],
        ["Scope", data.spatialScope],
        ["Licence", data.license?.name ?? "not declared in the catalogue"],
        ["Attribution", data.attribution],
        ["Use limitations", data.useLimitations],
        [
          "Access",
          data.access.label ??
            (data.access.isRestricted || data.access.isProtected ? "restricted" : "open"),
        ],
        ["Updated", data.updates.updatedAt],
        ["Maintenance", data.updates.maintenanceFrequency],
        [
          "Extent (S,W,N,E)",
          data.geographicExtent
            ? `${data.geographicExtent.south}, ${data.geographicExtent.west}, ${data.geographicExtent.north}, ${data.geographicExtent.east}`
            : undefined,
        ],
        ["Reference systems", data.referenceSystems.map((system) => system.name ?? "?").join(", ")],
        ["Responsible", data.contacts.map((contact) => contact.organization ?? "?").join(", ")],
      ]),
    ].join("\n"),
  ];

  if (data.distributions.length > 0) {
    sections.push(
      `Advertised distributions (${data.distributions.length}, not fetched by this server):\n` +
        data.distributions
          .map(
            (distribution) =>
              `- ${distribution.kind}${distribution.name ? ` — ${distribution.name}` : ""}${
                distribution.formats.length > 0 ? ` [${distribution.formats.join(", ")}]` : ""
              }`,
          )
          .join("\n"),
    );
  }

  if (data.services.length > 0) {
    sections.push(
      `Related services (${data.services.length}):\n` +
        data.services
          .map((service) => `- ${service.kind}: ${service.title ?? service.id ?? "(untitled)"}`)
          .join("\n"),
    );
  }

  return renderWithEnvelope(sections.join("\n\n"), envelope);
}

export const geonorgeMetadataTool: ToolDefinition<typeof inputSchema, Data> = {
  name: "get_geonorge_metadata",
  title: "Get one Geonorge catalogue record",
  description:
    "Retrieve the full catalogue record for one Geonorge identifier: abstract, keywords, " +
    "geographic extent, coordinate reference systems, licence terms, use limitations, update " +
    "regime and the endpoints its publisher advertises. Needs no credentials. " +
    "Use this after search_geonorge_datasets when the user asks who owns a dataset, how current " +
    "it is, under what licence it may be reused, or in which projection it is published. " +
    "Do not use this to obtain the data itself, and do not pass it a web address: it accepts only " +
    "a catalogue identifier, and this server never fetches a caller-supplied endpoint.",
  inputSchema,
  dataSchema,
  handler,
  render,
};
