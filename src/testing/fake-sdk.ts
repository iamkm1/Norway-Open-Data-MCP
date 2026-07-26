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
  GeonorgeDatasetSummary,
  GeonorgeMetadata,
  GeonorgeSearchResult,
  HazardWarning,
  InterventionFreeAreaFeature,
  KlassCode,
  KlassCodeResolution,
  KlassSearchCodesResult,
  LandResourceFeature,
  LandResourceResult,
  MunicipalityProfile,
  NaturbaseFeatureResult,
  NatureAtLocationProfile,
  NatureTypeFeature,
  OpenDataResponse,
  OpenDataSource,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
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
  geonorge: {
    id: "geonorge",
    name: "Geonorge / Kartverket",
    homepage: "https://www.geonorge.no/",
    documentation: "https://kartkatalog.geonorge.no/swagger/index.html",
    license:
      "CC BY 4.0 for Kartverket open products; catalogued resources have publisher-specific licences and access constraints.",
    attribution:
      "Credit © Kartverket for the Geonorge catalogue; also follow each resource publisher's licence and attribution metadata.",
  },
  naturbase: {
    id: "naturbase",
    name: "Norwegian Environment Agency (Miljødirektoratet) / Naturbase",
    homepage: "https://www.miljodirektoratet.no/",
    documentation: "https://kartkatalog.miljodirektoratet.no/",
    license: "Norwegian Licence for Open Government Data (NLOD)",
    attribution:
      "Contains data made available by Miljødirektoratet under the Norwegian Licence for Open Government Data (NLOD).",
  },
  /**
   * The intervention-free layer, which the SDK returns under the **same
   * `naturbase` id** but with its own licence version and its own required
   * wording. Copied verbatim from `norway-open-data-sdk@0.8.0`, because a
   * fixture that collapsed it into the general Naturbase source would let an
   * attribution regression pass unnoticed.
   */
  "naturbase-intervention-free": {
    id: "naturbase",
    name: "Norwegian Environment Agency (Miljødirektoratet) / Naturbase",
    homepage: "https://www.miljodirektoratet.no/",
    documentation: "https://kartkatalog.miljodirektoratet.no/",
    license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
    attribution: "Miljødirektoratet - inngrepsfri natur 01.2023",
  },
  nibio: {
    id: "nibio",
    name: "Norwegian Institute of Bioeconomy Research (NIBIO)",
    homepage: "https://www.nibio.no/",
    documentation: "https://www.nibio.no/tjenester/wfs-tjenester/wfs-tjeneste-ar50",
    license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
    attribution: "Kilde: NIBIO.",
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
  nature: {
    id: "naturbase+nibio+kartverket",
    name: "Miljødirektoratet / Naturbase, NIBIO and Kartverket",
    homepage: "https://github.com/iamkm1/Norway-Open-Data",
    documentation: "https://github.com/iamkm1/Norway-Open-Data#cross-provider-nature-profile",
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
  geodata?: Partial<NorwayOpenDataLike["geodata"]>;
  environment?: Partial<NorwayOpenDataLike["environment"]>;
  land?: Partial<NorwayOpenDataLike["land"]>;
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
      natureAtLocation: notImplemented("profiles.natureAtLocation"),
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
    geodata: {
      searchDatasets: notImplemented("geodata.searchDatasets"),
      getMetadata: notImplemented("geodata.getMetadata"),
      ...overrides.geodata,
    },
    environment: {
      getProtectedAreasAt: notImplemented("environment.getProtectedAreasAt"),
      searchProtectedAreas: notImplemented("environment.searchProtectedAreas"),
      getProposedProtectedAreasAt: notImplemented("environment.getProposedProtectedAreasAt"),
      getNatureTypesAt: notImplemented("environment.getNatureTypesAt"),
      getInterventionFreeAreasAt: notImplemented("environment.getInterventionFreeAreasAt"),
      ...overrides.environment,
    },
    land: {
      getLandResourcesAt: notImplemented("land.getLandResourcesAt"),
      ...overrides.land,
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

// ---------------------------------------------------------------------------
// Geospatial sample payloads
// ---------------------------------------------------------------------------

/**
 * A polygon **with a hole**.
 *
 * The second ring is an interior ring. Tests assert it survives, because
 * dropping it would silently enlarge a protected area by the part that is
 * explicitly excluded from it.
 */
export const samplePolygonWithHole = {
  type: "Polygon" as const,
  coordinates: [
    [
      [8.0, 61.0],
      [8.2, 61.0],
      [8.2, 61.2],
      [8.0, 61.2],
      [8.0, 61.0],
    ],
    [
      [8.08, 61.08],
      [8.12, 61.08],
      [8.12, 61.12],
      [8.08, 61.12],
      [8.08, 61.08],
    ],
  ] as [number, number][][],
};

/** A two-part multipolygon; the second part also has a hole. */
export const sampleMultiPolygon = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [10.0, 63.0],
        [10.1, 63.0],
        [10.1, 63.1],
        [10.0, 63.1],
        [10.0, 63.0],
      ],
    ],
    [
      [
        [10.5, 63.5],
        [10.7, 63.5],
        [10.7, 63.7],
        [10.5, 63.7],
        [10.5, 63.5],
      ],
      [
        [10.55, 63.55],
        [10.6, 63.55],
        [10.6, 63.6],
        [10.55, 63.6],
        [10.55, 63.55],
      ],
    ],
  ] as [number, number][][][],
};

/**
 * A geometry far past the per-feature vertex ceiling.
 *
 * Not an invented extreme: the live AR50 polygon at Galdhøpiggen carries 19,403
 * vertices across 63 rings, so a geometry this size is the ordinary case for
 * generalized national land cover rather than an edge case.
 */
export const sampleHugeGeometry = {
  type: "Polygon" as const,
  coordinates: [
    Array.from(
      { length: 6_000 },
      (_unused, index) => [8 + index / 1_000_000, 61 + index / 1_000_000] as [number, number],
    ),
  ],
};

export const sampleProtectedArea: ProtectedAreaFeature = {
  type: "Feature",
  id: "VV00001",
  geometry: samplePolygonWithHole,
  properties: {
    id: "VV00001",
    cddaId: "555512345",
    name: "Jotunheimen",
    officialName: "Jotunheimen nasjonalpark",
    protectionForm: "Nasjonalpark",
    aggregatedProtectionForm: "Nasjonalpark",
    iucnCategory: "II",
    municipality: "Lom, Vågå, Vang",
    managementAuthority: "Jotunheimen nasjonalparkstyre",
    managementAuthorityType: "Nasjonalparkstyre",
    protectedAt: "1980-12-05",
    firstProtectedAt: "1980-12-05",
    protectionPlan: "Nasjonalparkplanen",
    threatAssessment: "Ingen kjent trussel",
    majorEcosystemType: "Fjell",
    revisionStatus: "Ikke under revisjon",
    factSheetUrl: "https://faktaark.naturbase.no/?id=VV00001",
    regulationUrl: "https://lovdata.no/dokument/MV/forskrift/1980-12-05-1",
  },
};

export const sampleProposedProtectedArea: ProposedProtectedAreaFeature = {
  type: "Feature",
  id: "FV00042",
  geometry: sampleMultiPolygon,
  properties: {
    id: "FV00042",
    name: "Storlia",
    protectionForm: "Naturreservat",
    protectionPlan: "Frivillig vern av skog",
    municipality: "Heim",
    objectType: "ForeslattVerneomrade",
    capturedAt: "2024-05-12",
    surveyMethod: "Digitalisert fra kart",
    accuracyMeters: 25,
    factSheetUrl: "https://faktaark.naturbase.no/?id=FV00042",
  },
};

export const sampleNatureType: NatureTypeFeature = {
  type: "Feature",
  id: "NINF00123",
  geometry: samplePolygonWithHole,
  properties: {
    id: "NINF00123",
    areaName: "Storvika sørvest",
    municipalities: "Heim",
    natureType: "Åpen grunnlendt kalkmark",
    natureTypeCode: "T2-C-1",
    localityQuality: 3,
    condition: 2,
    conditionDescription: "God",
    biodiversity: 3,
    biodiversityDescription: "Svært viktig",
    majorEcosystem: "Fastmarkssystemer",
    mosaic: false,
    accuracy: 10,
    uncertainty: 1,
    uncertaintyDescription: "Liten usikkerhet",
    surveyedAt: "2023-07-14",
    surveyYear: 2023,
    redListed: true,
    nearThreatened: false,
    centralEcosystemFunction: true,
    poorlyMapped: false,
    factSheetUrl: "https://faktaark.naturbase.no/?id=NINF00123",
  },
};

/** Carries the intervention-free layer's own licence and attribution. */
export const sampleInterventionFreeArea: InterventionFreeAreaFeature = {
  type: "Feature",
  id: "INON-9001",
  geometry: samplePolygonWithHole,
  properties: {
    id: "INON-9001",
    zone: "v",
    zoneDescription: "At least 5 km from major infrastructure (wilderness-like nature)",
    areaSquareKilometers: 412.6,
    statusDate: "2023-01",
  },
};

/** A feature the provider published without geometry at all. */
export const sampleNullGeometryLandResource: LandResourceFeature = {
  type: "Feature",
  id: "AR50-null",
  geometry: null,
  properties: { id: "AR50-null", objectType: "ArealressursFlate", landTypeCode: "99" },
};

export const sampleLandResource: LandResourceFeature = {
  type: "Feature",
  id: "AR50-1",
  geometry: sampleMultiPolygon,
  properties: {
    id: "AR50-1",
    objectType: "ArealressursFlate",
    landTypeCode: "30",
    forestProductivityCode: "12",
    treeTypeCode: "31",
    agricultureCode: "99",
    vegetationCoverCode: "51",
    updatedAt: "2023-11-01",
  },
};

const WGS84_CRS = {
  identifier: "OGC:CRS84" as const,
  uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" as const,
  axisOrder: "longitude-latitude" as const,
  declared: false,
};

const NATURBASE_SOURCE_CRS = {
  identifier: "EPSG:25833" as const,
  uri: "http://www.opengis.net/def/crs/EPSG/0/25833" as const,
  axisOrder: "easting-northing" as const,
};

const NIBIO_SOURCE_CRS = {
  identifier: "EPSG:4258" as const,
  uri: "http://www.opengis.net/def/crs/EPSG/0/4258" as const,
  axisOrder: "latitude-longitude" as const,
};

/** Builds a Naturbase feature result with the SDK's exact envelope shape. */
export function naturbaseResult<Feature>(
  features: Feature[],
  pagination: Partial<NaturbaseFeatureResult<Feature>["pagination"]> = {},
): NaturbaseFeatureResult<Feature> {
  return {
    type: "FeatureCollection",
    features,
    crs: WGS84_CRS,
    sourceCrs: NATURBASE_SOURCE_CRS,
    pagination: {
      limit: 100,
      pageSize: 100,
      pagesFetched: 1,
      returned: features.length,
      truncated: false,
      ...pagination,
    },
  };
}

/** Builds an AR50 feature result with the SDK's exact envelope shape. */
export function landResourceResult(
  features: LandResourceFeature[],
  pagination: Partial<LandResourceResult["pagination"]> = {},
): LandResourceResult {
  return {
    type: "FeatureCollection",
    features,
    crs: { ...WGS84_CRS, identifier: "EPSG:4326", declared: true, original: "EPSG:4326" },
    sourceCrs: NIBIO_SOURCE_CRS,
    pagination: {
      limit: 100,
      pageSize: 100,
      pagesFetched: 1,
      returned: features.length,
      truncated: false,
      ...pagination,
    },
  };
}

export const sampleGeonorgeDataset: GeonorgeDatasetSummary = {
  type: "dataset",
  id: "dd9d5e94-5b3d-4e46-9b3c-000000000001",
  title: "Naturvernområder",
  description: "Vernede områder etter naturmangfoldloven.",
  publisher: "Miljødirektoratet",
  themes: ["Miljø"],
  access: { isOpenData: true, isRestricted: false, isProtected: false, label: "Åpne data" },
  updatedAt: "2026-05-04T00:00:00Z",
  spatialScope: "Nasjonal",
};

export const sampleGeonorgeDatasetSearch: GeonorgeSearchResult<GeonorgeDatasetSummary> = {
  items: [sampleGeonorgeDataset],
  pagination: {
    offset: 0,
    limit: 10,
    returned: 1,
    totalItems: 1,
    hasMore: false,
    truncated: false,
  },
};

export const sampleGeonorgeMetadata: GeonorgeMetadata = {
  id: "dd9d5e94-5b3d-4e46-9b3c-000000000001",
  title: "Naturvernområder",
  type: "dataset",
  description: "Vernede områder etter naturmangfoldloven, forvaltet av Miljødirektoratet.",
  publisher: "Miljødirektoratet",
  themes: ["Miljø"],
  keywords: ["vern", "naturvernområde", "nasjonalpark"],
  spatialScope: "Nasjonal",
  geographicExtent: { south: 57.75, west: 4.09, north: 71.38, east: 31.29 },
  referenceSystems: [{ name: "EUREF89 UTM sone 33", url: "https://epsg.io/25833" }],
  contacts: [
    {
      name: "Kari Nordmann",
      organization: "Miljødirektoratet",
      email: "kari.nordmann@example.no",
      role: "pointOfContact",
    },
  ],
  license: {
    name: "Norsk lisens for offentlige data (NLOD)",
    url: "https://data.norge.no/nlod/no",
  },
  attribution: "Kilde: Miljødirektoratet",
  useLimitations: "Kartlaget er ikke juridisk bindende.",
  access: { isOpenData: true, isRestricted: false, isProtected: false, label: "Åpne data" },
  updates: {
    publishedAt: "2019-01-01",
    updatedAt: "2026-05-04",
    maintenanceFrequency: "daily",
    status: "onGoing",
  },
  distributions: [
    {
      kind: "wfs",
      protocol: "OGC:WFS",
      protocolName: "OGC Web Feature Service",
      url: "https://kart.miljodirektoratet.no/geoserver/wfs",
      name: "naturvern",
      organization: "Miljødirektoratet",
      formats: [{ name: "GML", version: "3.2" }],
    },
  ],
  services: [
    {
      id: "aa000000-0000-0000-0000-000000000002",
      title: "Naturvernområder WMS",
      kind: "wms",
      protocol: "OGC:WMS",
      url: "https://kart.miljodirektoratet.no/geoserver/wms",
    },
  ],
  operatesOn: [],
};

/** A complete nature profile: every dataset answered, place resolved. */
export const sampleNatureProfile: NatureAtLocationProfile = {
  location: { latitude: 61.1, longitude: 8.1 },
  municipality: { code: "3434", name: "Lom", countyCode: "34", countyName: "Innlandet" },
  nearestPlace: {
    name: "Galdhøpiggen",
    type: "fjell",
    municipalityCode: "3434",
    municipalityName: "Lom",
    countyCode: "34",
    countyName: "Innlandet",
  },
  protectedAreas: [sampleProtectedArea],
  proposedProtectedAreas: [sampleProposedProtectedArea],
  natureTypes: [sampleNatureType],
  interventionFreeAreas: [sampleInterventionFreeArea],
  landResources: [sampleLandResource],
  pagination: {
    protectedAreas: {
      limit: 10,
      pageSize: 10,
      pagesFetched: 1,
      returned: 1,
      truncated: false,
    },
    landResources: {
      limit: 10,
      pageSize: 10,
      pagesFetched: 1,
      returned: 1,
      truncated: true,
      nextOffset: 1,
    },
  },
  warnings: ["The land resources result was truncated at 1 feature."],
  components: [
    {
      operation: "environment.getProtectedAreasAt",
      section: "protected-areas",
      status: "available",
      source: SOURCES["naturbase"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "environment.getProposedProtectedAreasAt",
      section: "proposed-protected-areas",
      status: "available",
      source: SOURCES["naturbase"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "environment.getNatureTypesAt",
      section: "nature-types",
      status: "available",
      source: SOURCES["naturbase"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "environment.getInterventionFreeAreasAt",
      section: "intervention-free-areas",
      status: "available",
      source: SOURCES["naturbase-intervention-free"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "land.getLandResourcesAt",
      section: "land-resources",
      status: "available",
      source: SOURCES["nibio"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "places.nearby",
      section: "place",
      status: "available",
      source: SOURCES["kartverket"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
  ],
};

/**
 * A degraded nature profile: Naturbase failed for two datasets, NIBIO answered,
 * the place lookup found nothing. Proves one provider failure cannot destroy
 * the components that did succeed.
 */
export const samplePartialNatureProfile: NatureAtLocationProfile = {
  location: { latitude: 61.1, longitude: 8.1 },
  natureTypes: [sampleNatureType],
  landResources: [sampleLandResource],
  pagination: {
    natureTypes: { limit: 10, pageSize: 10, pagesFetched: 1, returned: 1, truncated: false },
    landResources: { limit: 10, pageSize: 10, pagesFetched: 1, returned: 1, truncated: false },
  },
  warnings: ["Protected-area lookup failed: Miljødirektoratet returned HTTP 503."],
  components: [
    {
      operation: "environment.getProtectedAreasAt",
      section: "protected-areas",
      status: "omitted",
      source: SOURCES["naturbase"]!,
      reason: "provider-error",
      error: { name: "ProviderError", message: "Miljødirektoratet returned HTTP 503." },
    },
    {
      operation: "environment.getProposedProtectedAreasAt",
      section: "proposed-protected-areas",
      status: "omitted",
      source: SOURCES["naturbase"]!,
      reason: "provider-error",
      error: { name: "ProviderError", message: "Miljødirektoratet returned HTTP 503." },
    },
    {
      operation: "environment.getNatureTypesAt",
      section: "nature-types",
      status: "available",
      source: SOURCES["naturbase"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "land.getLandResourcesAt",
      section: "land-resources",
      status: "available",
      source: SOURCES["nibio"]!,
      retrievedAt: "2026-07-23T12:00:00.000Z",
      cached: false,
    },
    {
      operation: "places.nearby",
      section: "place",
      status: "omitted",
      source: SOURCES["kartverket"]!,
      reason: "not-found",
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
