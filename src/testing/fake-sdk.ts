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
  AutocompletePlace,
  CompanyProfile,
  CompanySearchResult,
  Departure,
  ElectricityPrice,
  HazardWarning,
  MunicipalityProfile,
  OpenDataResponse,
  OpenDataSource,
  StatisticsResult,
  StatisticsTableMetadata,
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

export type FakeSdkOverrides = {
  companies?: Partial<NorwayOpenDataLike["companies"]>;
  profiles?: Partial<NorwayOpenDataLike["profiles"]>;
  addresses?: Partial<NorwayOpenDataLike["addresses"]>;
  weather?: Partial<NorwayOpenDataLike["weather"]>;
  hazards?: Partial<NorwayOpenDataLike["hazards"]>;
  electricity?: Partial<NorwayOpenDataLike["electricity"]>;
  transport?: Partial<NorwayOpenDataLike["transport"]>;
  statistics?: Partial<NorwayOpenDataLike["statistics"]>;
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
  };
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
