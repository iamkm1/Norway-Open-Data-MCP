/**
 * Test doubles for the SDK surface.
 *
 * Exported from the package so downstream consumers can test their own
 * integrations without calling live Norwegian public APIs — the same reason
 * this package's own suite never touches the network.
 *
 * The fakes return exactly the shapes declared by `norway-open-data-sdk`, so a
 * test that passes here would pass against the real SDK's contract.
 */

import type {
  AddressProfile,
  AddressSearchResult,
  AisPosition,
  AisTrack,
  AquacultureSite,
  AquacultureSiteSearchResult,
  AutocompletePlace,
  CompanyProfile,
  CompanySearchResult,
  Departure,
  ElectricityPrice,
  FisheriesVesselSearchResult,
  FishingVessel,
  HazardWarning,
  KlassCode,
  KlassCodeResolution,
  KlassSearchCodesResult,
  MunicipalityProfile,
  OpenDataResponse,
  OpenDataSource,
  SeaCurrentForecast,
  StatisticsResult,
  StatisticsTableMetadata,
  VesselProfile,
  WaveForecast,
  WeatherForecast,
} from "norway-open-data-sdk";

import type { NorwayOpenDataLike } from "../tools/types.js";

/** Provider metadata matching the real registry, so attribution assertions are meaningful. */
export const SOURCES: Record<string, OpenDataSource> = {
  brreg: {
    id: "brreg",
    name: "Brønnøysundregistrene",
    homepage: "https://www.brreg.no/",
    documentation: "https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  },
  kartverket: {
    id: "kartverket",
    name: "Kartverket",
    homepage: "https://www.kartverket.no/en",
    documentation: "https://ws.geonorge.no/adresser/v1/",
    license: "See Geonorge dataset-specific terms and licences",
    attribution: "Attribute Kartverket where required by the selected dataset.",
  },
  met: {
    id: "met",
    name: "MET Norway",
    homepage: "https://www.met.no/en",
    documentation: "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
    license: "NLOD 2.0 and CC BY 4.0 unless the product states otherwise",
    attribution: "Credit the Norwegian Meteorological Institute as required by its terms.",
  },
  nve: {
    id: "nve",
    name: "Norwegian Water Resources and Energy Directorate (NVE)",
    homepage: "https://www.nve.no/",
    documentation: "https://api.nve.no/doc/",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
    attribution: "Credit NVE; Varsom warning data also requires its specified attribution.",
  },
  ssb: {
    id: "ssb",
    name: "Statistics Norway (SSB)",
    homepage: "https://www.ssb.no/en/",
    documentation: "https://www.ssb.no/en/api/pxwebapiv2",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    attribution: "Attribute Statistics Norway when redistributing data.",
  },
  "ssb-klass": {
    id: "ssb-klass",
    name: "Statistics Norway (SSB) Klass",
    homepage: "https://www.ssb.no/en/klass/",
    documentation: "https://data.ssb.no/api/klass/v1/api-guide.html",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    attribution:
      "Statistics Norway (SSB), Klass — CC BY 4.0. Link to ssb.no and the licence, and indicate changes.",
  },
  entur: {
    id: "entur",
    name: "Entur",
    homepage: "https://entur.no/",
    documentation: "https://developer.entur.no/",
    license: "Norwegian Licence for Open Government Data (NLOD)",
    attribution: "Attribute Entur and the relevant source transport authority.",
  },
  hvakosterstrommen: {
    id: "hvakosterstrommen",
    name: "Hva koster strømmen?",
    homepage: "https://www.hvakosterstrommen.no/",
    documentation: "https://www.hvakosterstrommen.no/strompris-api",
    license: "Provider describes the API as open and free; no standardized licence stated",
    attribution: "Credit hvakosterstrommen.no.",
  },
  barentswatch: {
    id: "barentswatch",
    name: "BarentsWatch",
    homepage: "https://www.barentswatch.no/",
    documentation: "https://developer.barentswatch.no/docs/appreg/",
    license: "Norwegian Licence for Open Government Data (NLOD)",
    attribution: "Credit BarentsWatch and the wave forecast's own upstream model provider.",
  },
  "barentswatch-ais": {
    id: "barentswatch-ais",
    name: "BarentsWatch AIS",
    homepage: "https://www.barentswatch.no/",
    documentation: "https://developer.barentswatch.no/docs/AIS/live-ais-api/",
    license: "Norwegian Licence for Open Government Data (NLOD)",
    attribution:
      "AIS data is provided by the Norwegian Coastal Administration (Kystverket) via BarentsWatch; credit both.",
  },
  "fiskeridir-vessels": {
    id: "fiskeridir-vessels",
    name: "Norwegian Directorate of Fisheries — vessel register",
    homepage: "https://www.fiskeridir.no/english",
    documentation: "https://api.fiskeridir.no/vessel-api/api/openapi.json",
    license: "Fiskeridirektoratet data licence, published under NLOD terms",
    attribution: "Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).",
  },
  "fiskeridir-aqua": {
    id: "fiskeridir-aqua",
    name: "Norwegian Directorate of Fisheries — aquaculture register",
    homepage: "https://www.fiskeridir.no/english",
    documentation: "https://api.fiskeridir.no/pub-aqua/api/swagger-ui/index.html",
    license: "Fiskeridirektoratet data licence, published under NLOD terms",
    attribution: "Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).",
  },
};

/**
 * The synthetic composite source the SDK puts on a **composed profile**.
 *
 * Copied verbatim from a live `profiles.vessel()` response on SDK 0.7.0. It
 * carries no `license` and no `attribution` and its homepage is the SDK's own
 * repository, which is precisely why profile tools must build provenance from
 * their components instead. Fixtures use this so the offline suite cannot
 * accidentally pass on attribution the real provider never sends.
 */
export const COMPOSITE_PROFILE_SOURCES: Record<string, OpenDataSource> = {
  vessel: {
    id: "barentswatch-ais+kartverket",
    name: "BarentsWatch AIS and Kartverket",
    homepage: "https://github.com/iamkm1/Norway-Open-Data",
    documentation: "https://github.com/iamkm1/Norway-Open-Data#cross-provider-vessel-profile",
  },
  company: {
    id: "brreg+kartverket",
    name: "Brønnøysundregistrene and Kartverket",
    homepage: "https://github.com/iamkm1/Norway-Open-Data",
    documentation: "https://github.com/iamkm1/Norway-Open-Data#cross-provider-company-profile",
  },
};

export function respond<T>(
  data: T,
  source: OpenDataSource,
  overrides: Partial<OpenDataResponse<T>> = {},
): OpenDataResponse<T> {
  return {
    data,
    source,
    retrievedAt: "2026-07-23T12:00:00.000Z",
    cached: false,
    ...overrides,
  };
}

/** An SDK error indistinguishable from a real one for mapping purposes. */
export function sdkError(
  name: string,
  message: string,
  details: { provider?: string; statusCode?: number; retryAfter?: number; cause?: unknown } = {},
): Error {
  const error = new Error(message);
  error.name = name;
  return Object.assign(error, details);
}

/** Rejects with the given error, and records that it was called. */
export function failing(error: Error): () => Promise<never> {
  return () => Promise.reject(error);
}

/**
 * Never settles until the caller's signal aborts, then rejects the way the SDK
 * does. Used to prove the abort signal reaches the SDK call.
 */
export function abortable(): (...args: unknown[]) => Promise<never> {
  return (...args: unknown[]) => {
    const options = args.at(-1) as { signal?: AbortSignal } | undefined;
    return new Promise<never>((_resolve, reject) => {
      const signal = options?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(sdkError("ProviderError", "Request aborted.", { provider: "test" }));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(sdkError("ProviderError", "Request aborted.", { provider: "test" })),
        { once: true },
      );
    });
  };
}

const notImplemented = (method: string) => (): Promise<never> =>
  Promise.reject(new Error(`Fake SDK: ${method} was called but not configured for this test.`));

/** Synchronous form, for the streaming methods that return rather than resolve. */
const notImplementedStream = (method: string) => (): AsyncIterable<never> => {
  throw new Error(`Fake SDK: ${method} was called but not configured for this test.`);
};

export type FakeSdkOverrides = {
  companies?: Partial<NorwayOpenDataLike["companies"]>;
  profiles?: Partial<NorwayOpenDataLike["profiles"]>;
  addresses?: Partial<NorwayOpenDataLike["addresses"]>;
  weather?: Partial<NorwayOpenDataLike["weather"]>;
  hazards?: Partial<NorwayOpenDataLike["hazards"]>;
  electricity?: Partial<NorwayOpenDataLike["electricity"]>;
  transport?: Partial<NorwayOpenDataLike["transport"]>;
  statistics?: Partial<NorwayOpenDataLike["statistics"]>;
  klass?: Partial<NorwayOpenDataLike["klass"]>;
  ais?: Partial<NorwayOpenDataLike["ais"]>;
  marine?: Partial<NorwayOpenDataLike["marine"]>;
  fisheries?: Partial<NorwayOpenDataLike["fisheries"]>;
};

/**
 * Builds a fake SDK. Anything not overridden rejects with a clear message, so a
 * test that accidentally exercises an unexpected provider fails loudly instead
 * of silently passing.
 */
export function createFakeSdk(overrides: FakeSdkOverrides = {}): NorwayOpenDataLike {
  return {
    companies: { search: notImplemented("companies.search"), ...overrides.companies },
    profiles: {
      company: notImplemented("profiles.company"),
      address: notImplemented("profiles.address"),
      municipality: notImplemented("profiles.municipality"),
      vessel: notImplemented("profiles.vessel"),
      ...overrides.profiles,
    },
    addresses: { search: notImplemented("addresses.search"), ...overrides.addresses },
    weather: { forecast: notImplemented("weather.forecast"), ...overrides.weather },
    hazards: {
      getFloodWarnings: notImplemented("hazards.getFloodWarnings"),
      getAvalancheWarnings: notImplemented("hazards.getAvalancheWarnings"),
      getLandslideWarnings: notImplemented("hazards.getLandslideWarnings"),
      ...overrides.hazards,
    },
    electricity: {
      getPrices: notImplemented("electricity.getPrices"),
      getCurrentPrice: notImplemented("electricity.getCurrentPrice"),
      ...overrides.electricity,
    },
    transport: {
      autocomplete: notImplemented("transport.autocomplete"),
      departures: notImplemented("transport.departures"),
      ...overrides.transport,
    },
    statistics: {
      getTableMetadata: notImplemented("statistics.getTableMetadata"),
      query: notImplemented("statistics.query"),
      ...overrides.statistics,
    },
    klass: {
      resolveMunicipalityCode: notImplemented("klass.resolveMunicipalityCode"),
      resolveCountyCode: notImplemented("klass.resolveCountyCode"),
      searchCodes: notImplemented("klass.searchCodes"),
      getCode: notImplemented("klass.getCode"),
      ...overrides.klass,
    },
    ais: {
      getTrackLast24Hours: notImplemented("ais.getTrackLast24Hours"),
      getTrack: notImplemented("ais.getTrack"),
      streamPositions: notImplementedStream("ais.streamPositions"),
      ...overrides.ais,
    },
    marine: {
      getWaveForecast: notImplemented("marine.getWaveForecast"),
      getSeaCurrent: notImplemented("marine.getSeaCurrent"),
      ...overrides.marine,
    },
    fisheries: {
      searchVessels: notImplemented("fisheries.searchVessels"),
      getVessel: notImplemented("fisheries.getVessel"),
      searchAquacultureSites: notImplemented("fisheries.searchAquacultureSites"),
      getAquacultureSite: notImplemented("fisheries.getAquacultureSite"),
      ...overrides.fisheries,
    },
  };
}

/**
 * A finite AIS stream, for tests that must stay deterministic and offline.
 *
 * `closed` records whether the consumer released the iterator — by `break`,
 * by throwing, or by abort — which is exactly what
 * `get_live_vessel_positions` must guarantee on every path.
 */
export type FakeStreamParameters = Record<string, unknown> & { signal?: AbortSignal };

export type FakeStream = {
  stream: (parameters?: FakeStreamParameters) => AsyncIterable<AisPosition>;
  /** True once the iterator's `return()` ran or its signal aborted. */
  closed: () => boolean;
  /** Parameters the tool passed on the most recent call. */
  lastParameters: () => FakeStreamParameters | undefined;
};

/**
 * Builds a stream that yields `items` and then, if `endless` is set, waits for
 * an abort instead of completing — the shape of the real live feed.
 */
export function createFakeStream(
  items: readonly AisPosition[],
  options: { endless?: boolean; delayMs?: number } = {},
): FakeStream {
  let closed = false;
  let lastParameters: FakeStreamParameters | undefined;

  const stream = (parameters?: FakeStreamParameters): AsyncIterable<AisPosition> => {
    lastParameters = parameters;
    const signal = parameters?.signal;

    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<AisPosition, void, undefined> {
        try {
          for (const item of items) {
            if (signal?.aborted === true) return;
            if (options.delayMs) {
              await new Promise((resolve) => setTimeout(resolve, options.delayMs));
            }
            yield item;
          }
          if (options.endless === true) {
            // Never resolves on its own. Only an abort ends it, which is how the
            // real feed behaves in a quiet area.
            await new Promise<void>((resolve) => {
              if (signal?.aborted === true) {
                resolve();
                return;
              }
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          }
        } finally {
          // Runs on normal completion, on `break` (via `return()`) and on throw.
          closed = true;
        }
      },
    };
  };

  return { stream, closed: () => closed, lastParameters: () => lastParameters };
}

// ---------------------------------------------------------------------------
// Sample payloads
// ---------------------------------------------------------------------------

export const sampleCompanySearch: CompanySearchResult = {
  items: [
    {
      organizationNumber: "923609016",
      name: "EQUINOR ASA",
      organizationForm: { code: "ASA", description: "Allmennaksjeselskap" },
      industry: { code: "06.100", description: "Utvinning av råolje" },
      municipality: { code: "1103", name: "STAVANGER" },
      numberOfEmployees: 20000,
      registeredAt: "1995-09-18",
      businessAddress: {
        addressText: "Forusbeen 50",
        postalCode: "4035",
        postalPlace: "STAVANGER",
        municipalityName: "STAVANGER",
      },
    },
  ],
  pagination: { page: 0, size: 10, totalItems: 1, totalPages: 1 },
};

export const sampleCompanyProfile: CompanyProfile = {
  company: sampleCompanySearch.items[0]!,
  location: {
    address: {
      addressText: "Forusbeen 50",
      postalCode: "4035",
      postalPlace: "STAVANGER",
      latitude: 58.8944,
      longitude: 5.7086,
    },
    matchConfidence: "exact",
  },
  components: [
    {
      operation: "companies.get",
      section: "company",
      status: "available",
      source: SOURCES["brreg"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
  ],
};

export const sampleAddressSearch: AddressSearchResult = {
  items: [
    {
      addressText: "Karl Johans gate 1",
      postalCode: "0154",
      postalPlace: "OSLO",
      municipalityCode: "0301",
      municipalityName: "OSLO",
      countyName: "Oslo",
      latitude: 59.9098,
      longitude: 10.7469,
    },
  ],
  total: 1,
};

export const sampleHazard: HazardWarning = {
  id: "flood-1",
  type: "flood",
  level: "2",
  title: "Flomfare gult nivå",
  description: "Lokale oversvømmelser i bekker og mindre elver.",
  validFrom: "2026-07-23T00:00:00+02:00",
  validTo: "2026-07-24T00:00:00+02:00",
  forecastRegion: { id: "3", name: "Østlandet" },
  municipalities: [{ code: "0301", name: "Oslo" }],
  counties: [{ code: "03", name: "Oslo" }],
};

export const sampleAddressProfile: AddressProfile = {
  address: sampleAddressSearch.items[0]!,
  weather: {
    time: "2026-07-23T12:00:00Z",
    temperature: 21.4,
    windSpeed: 3.2,
    symbolCode: "cloudy",
  },
  hazards: [sampleHazard],
  hazardMatches: [
    {
      warning: sampleHazard,
      matchBasis: "municipality-code",
      addressArea: { code: "0301", name: "OSLO" },
      warningArea: { code: "0301", name: "Oslo" },
    },
  ],
  components: [
    {
      operation: "addresses.search",
      section: "address",
      status: "available",
      source: SOURCES["kartverket"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
  ],
};

export const sampleMunicipalityProfile: MunicipalityProfile = {
  municipality: { code: "5401", name: "Tromsø", countyCode: "54" },
  population: {
    total: 78638,
    year: "2025",
    previousTotal: 77991,
    previousYear: "2024",
    change: 647,
  },
  lifeExpectancy: { years: 82.4, period: "2018_2024", measure: "life_expectancy" },
  companies: { registered: 9421 },
  hazards: [],
  components: [],
};

export const sampleForecast: WeatherForecast = {
  updatedAt: "2026-07-23T11:00:00Z",
  coordinates: { latitude: 59.9098, longitude: 10.7469 },
  timeseries: Array.from({ length: 60 }, (_unused, index) => ({
    time: new Date(Date.UTC(2026, 6, 23, 12 + index)).toISOString(),
    temperature: 20 + (index % 5),
    windSpeed: 3 + (index % 3),
    symbolCode: "partlycloudy_day",
  })),
};

export const samplePrices: ElectricityPrice[] = Array.from({ length: 24 }, (_unused, hour) => ({
  area: "NO1" as const,
  startsAt: `2026-07-23T${String(hour).padStart(2, "0")}:00:00+02:00`,
  endsAt: `2026-07-23T${String(hour + 1).padStart(2, "0")}:00:00+02:00`,
  nokPerKwh: Number((0.4 + hour * 0.01).toFixed(4)),
  eurPerKwh: Number((0.035 + hour * 0.001).toFixed(4)),
  exchangeRate: 11.5,
}));

export const sampleStops: AutocompletePlace[] = [
  {
    id: "NSR:StopPlace:58366",
    name: "Majorstuen",
    category: "onstreetBus",
    latitude: 59.93,
    longitude: 10.71,
  },
  {
    id: "NSR:StopPlace:58367",
    name: "Majorstuen T",
    category: "metroStation",
    latitude: 59.93,
    longitude: 10.71,
  },
  { id: "NSR:Address:1", name: "Majorstuveien 1" },
];

export const sampleDepartures: Departure[] = [
  {
    stopPlaceId: "NSR:StopPlace:58366",
    stopName: "Majorstuen",
    aimedDepartureTime: "2026-07-23T12:05:00+02:00",
    expectedDepartureTime: "2026-07-23T12:06:00+02:00",
    destinationDisplay: "Bekkestua",
    realtime: true,
    cancelled: false,
    transportMode: "bus",
    line: { id: "RUT:Line:20", publicCode: "20", name: "Skøyen - Galgeberg" },
  },
];

export const sampleTableMetadata: StatisticsTableMetadata = {
  tableId: "07459",
  title: "Population, by region, sex, age and year",
  updatedAt: "2026-02-20T08:00:00Z",
  dimensions: [
    {
      code: "Region",
      label: "region",
      values: [
        { code: "0301", label: "Oslo" },
        { code: "5401", label: "Tromsø" },
      ],
    },
    { code: "Tid", label: "year", values: [{ code: "2025", label: "2025" }] },
  ],
};

export const sampleStatisticsResult: StatisticsResult = {
  tableId: "07459",
  title: "Population, by region, sex, age and year",
  updatedAt: "2026-02-20T08:00:00Z",
  dimensions: sampleTableMetadata.dimensions,
  rows: [
    { Region: "0301", Tid: "2025", value: 717710 },
    { Region: "5401", Tid: "2025", value: 78638 },
  ],
};

// ---------------------------------------------------------------------------
// SSB Klass sample payloads
// ---------------------------------------------------------------------------

/** A municipal merge: several old codes fold into one successor. */
export const sampleMunicipalityMergeResolution: KlassCodeResolution = {
  kind: "municipality",
  input: { code: "1142", sourceDate: "2019-01-01", targetDate: "2024-01-01" },
  status: "merged",
  sourceCode: { code: "1142", name: "Rennesøy", validFrom: "1965-01-01", validTo: "2020-01-01" },
  matches: [{ code: "1103", name: "Stavanger", validFrom: "2020-01-01" }],
  predecessors: [
    { code: "1102", name: "Stavanger", validTo: "2020-01-01" },
    { code: "1141", name: "Finnøy", validTo: "2020-01-01" },
    { code: "1142", name: "Rennesøy", validTo: "2020-01-01" },
  ],
  successors: [{ code: "1103", name: "Stavanger", validFrom: "2020-01-01" }],
  changes: [
    {
      oldCode: "1142",
      oldName: "Rennesøy",
      newCode: "1103",
      newName: "Stavanger",
      occurredAt: "2020-01-01",
    },
  ],
  warnings: [],
};

/** A county split: one old code becomes several successors. Every branch kept. */
export const sampleCountySplitResolution: KlassCodeResolution = {
  kind: "county",
  input: { code: "30", targetDate: "2024-01-01" },
  status: "split",
  sourceCode: { code: "30", name: "Viken", validFrom: "2020-01-01", validTo: "2024-01-01" },
  matches: [
    { code: "31", name: "Østfold", validFrom: "2024-01-01" },
    { code: "32", name: "Akershus", validFrom: "2024-01-01" },
    { code: "33", name: "Buskerud", validFrom: "2024-01-01" },
  ],
  predecessors: [{ code: "30", name: "Viken", validTo: "2024-01-01" }],
  successors: [
    { code: "31", name: "Østfold", validFrom: "2024-01-01" },
    { code: "32", name: "Akershus", validFrom: "2024-01-01" },
    { code: "33", name: "Buskerud", validFrom: "2024-01-01" },
  ],
  changes: [
    {
      oldCode: "30",
      oldName: "Viken",
      newCode: "31",
      newName: "Østfold",
      occurredAt: "2024-01-01",
    },
    {
      oldCode: "30",
      oldName: "Viken",
      newCode: "32",
      newName: "Akershus",
      occurredAt: "2024-01-01",
    },
    {
      oldCode: "30",
      oldName: "Viken",
      newCode: "33",
      newName: "Buskerud",
      occurredAt: "2024-01-01",
    },
  ],
  warnings: ["Viken was dissolved on 2024-01-01 into three counties."],
};

/** An unchanged current code. */
export const sampleUnchangedResolution: KlassCodeResolution = {
  kind: "municipality",
  input: { code: "0301", targetDate: "2024-01-01" },
  status: "unchanged",
  sourceCode: { code: "0301", name: "Oslo", validFrom: "2020-01-01" },
  matches: [{ code: "0301", name: "Oslo", validFrom: "2020-01-01" }],
  predecessors: [],
  successors: [],
  changes: [],
  warnings: [],
};

/** A code-pattern search result (STYRK occupation codes beginning 25). */
export const sampleClassificationCodes: KlassSearchCodesResult = {
  items: [
    {
      code: "2511",
      name: "Systemutviklere",
      level: "3",
      parentCode: "251",
      validFrom: "2011-01-01",
    },
    {
      code: "2512",
      name: "Programvareutviklere",
      level: "3",
      parentCode: "251",
      validFrom: "2011-01-01",
    },
  ],
  pagination: { page: 0, pageSize: 10, totalItems: 2, totalPages: 1, upstreamPaged: false },
};

/** A single exact code, as returned by `getCode`. */
export const sampleKlassCode: KlassCode = {
  code: "0301",
  name: "Oslo",
  level: "1",
  validFrom: "2020-01-01",
};

// ---------------------------------------------------------------------------
// Maritime sample payloads
// ---------------------------------------------------------------------------

export const sampleAisTrack: AisTrack = {
  mmsi: "257123456",
  points: Array.from({ length: 12 }, (_unused, index) => ({
    mmsi: "257123456",
    messageTime: new Date(Date.UTC(2026, 6, 23, 6 + index)).toISOString(),
    latitude: 63.4 + index * 0.01,
    longitude: 10.4 + index * 0.02,
    name: "NORDLYS",
    courseOverGround: 245.3,
    speedOverGround: 12.4,
    trueHeading: 244,
    navigationalStatus: 0,
    shipType: 60,
    stream: "terrestrial",
  })),
  from: "2026-07-23T06:00:00.000Z",
  to: "2026-07-23T17:00:00.000Z",
};

export const sampleAisPositions: AisPosition[] = Array.from({ length: 5 }, (_unused, index) => ({
  kind: "position" as const,
  mmsi: `25712345${index}`,
  messageTime: new Date(Date.UTC(2026, 6, 23, 12, index)).toISOString(),
  messageType: 1,
  latitude: 63.4 + index * 0.005,
  longitude: 10.4 + index * 0.005,
  courseOverGround: 180 + index,
  speedOverGround: 8 + index,
  trueHeading: 180,
  navigationalStatus: 0,
  aisClass: "A",
  stream: "terrestrial",
}));

/**
 * A fishing vessel with one company owner and one natural-person owner.
 *
 * The person branch carries no identifying fields, exactly as the SDK publishes
 * it. Tests assert that nothing about that owner reaches a tool result.
 */
export const sampleFishingVessel: FishingVessel = {
  id: "10412",
  name: "HAVSTRAUM",
  registrationMark: "R 0062H",
  radioCallSign: "LDMV",
  imoNumber: "9123456",
  municipalityCode: "1103",
  tonnageType: "LC",
  tonnage: 412,
  length: 34.8,
  width: 8.6,
  enginePower: 1200,
  engineBuildYear: 2014,
  buildYear: 2012,
  measureDate: "2012-06-01",
  registrationDate: "2012-08-15",
  owners: [
    {
      entityType: "company",
      organizationNumber: "912345678",
      name: "HAVSTRAUM AS",
      postalCode: "4370",
      city: "EGERSUND",
    },
    { entityType: "person" },
  ],
};

export const sampleFishingVesselSearch: FisheriesVesselSearchResult = {
  items: [sampleFishingVessel],
  pagination: { page: 1, pageSize: 10, hasMore: false },
};

export const sampleAquacultureSite: AquacultureSite = {
  siteNumber: "10318",
  name: "STORVIKA",
  placementType: "Offshore",
  waterType: "Salt",
  latitude: 63.7412,
  longitude: 9.2188,
  capacity: 3120,
  capacityUnitType: "TN",
  firstClearanceTime: "2004-05-12T00:00:00Z",
  placement: {
    municipalityCode: "5055",
    municipalityName: "Heim",
    countyCode: "50",
    countyName: "Trøndelag",
    productionAreaCode: "6",
    productionAreaName: "Nordmøre og Sør-Trøndelag",
    productionAreaStatus: "GRØNN",
  },
  speciesTypes: ["Salmon", "Rainbow trout"],
  isSlaughterhouse: false,
  hasCommercialActivity: true,
  licences: [{ licenceNumber: "H-KM-0018", validFrom: "2004-05-12T00:00:00Z" }],
};

export const sampleAquacultureSearch: AquacultureSiteSearchResult = {
  items: [sampleAquacultureSite],
  pagination: { offset: 0, limit: 10, hasMore: false },
};

export const sampleWaveForecast: WaveForecast = {
  forecastTime: "2026-07-23T12:00:00Z",
  significantWaveHeight: 1.8,
  maximumWaveHeight: 3.1,
  meanWaveDirection: 212,
  peakPeriod: 7.4,
  latitude: 63.75,
  longitude: 9.25,
};

export const sampleSeaCurrent: SeaCurrentForecast = {
  forecastTime: "2026-07-23T12:00:00Z",
  speed: 0.42,
  direction: 118,
  latitude: 63.75,
  longitude: 9.25,
};

/** A complete vessel profile: AIS available, register matched, weather present. */
export const sampleVesselProfile: VesselProfile = {
  mmsi: "257123456",
  ais: {
    status: "available",
    latestPosition: sampleAisTrack.points.at(-1)!,
    track: sampleAisTrack,
    identity: {
      name: "HAVSTRAUM",
      callSign: "LDMV",
      imoNumber: "9123456",
      shipType: 30,
    },
  },
  registration: sampleFishingVessel,
  weather: {
    time: "2026-07-23T17:00:00Z",
    temperature: 13.2,
    windSpeed: 6.1,
    symbolCode: "cloudy",
  },
  nearestPlace: {
    name: "Storvika",
    type: "vik",
    municipalityCode: "5055",
    municipalityName: "Heim",
    countyName: "Trøndelag",
  },
  components: [
    {
      operation: "ais.getVesselSnapshot",
      section: "ais",
      status: "available",
      source: SOURCES["barentswatch-ais"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "fisheries.searchVessels",
      section: "registration",
      status: "available",
      source: SOURCES["fiskeridir-vessels"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
  ],
};

/**
 * A degraded profile: AIS held nothing, the register was not applicable, MET is
 * not configured and the place lookup failed. Every omission reason the tools
 * must explain, in one payload.
 */
export const samplePartialVesselProfile: VesselProfile = {
  mmsi: "257000999",
  ais: { status: "no-recent-data" },
  components: [
    {
      operation: "ais.getTrackLast24Hours",
      section: "ais",
      status: "available",
      source: SOURCES["barentswatch-ais"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "fisheries.searchVessels",
      section: "registration",
      status: "omitted",
      source: SOURCES["fiskeridir-vessels"]!,
      reason: "not-applicable",
    },
    {
      operation: "weather.current",
      section: "weather",
      status: "omitted",
      source: SOURCES["met"]!,
      reason: "not-configured",
    },
    {
      operation: "places.nearby",
      section: "place",
      status: "omitted",
      source: SOURCES["kartverket"]!,
      reason: "provider-error",
      error: { name: "ProviderError", message: "Kartverket returned HTTP 503." },
    },
  ],
};
