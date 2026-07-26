/**
 * Tool contracts and the injectable SDK surface.
 *
 * `NorwayOpenDataLike` is a structural subset of the real `NorwayOpenData`
 * facade containing only the namespaces and methods the curated tools actually
 * call. A real `NorwayOpenData` satisfies it, and a test fake can implement it
 * in a few lines — which is what keeps the unit suite off the public APIs.
 */

import type { z } from "zod";
import type {
  AddressProfile,
  AddressSearchParameters,
  AddressSearchResult,
  AisPosition,
  AisPositionStreamParameters,
  AisTrack,
  AisTrackParameters,
  AquacultureSite,
  AquacultureSiteSearchParameters,
  AquacultureSiteSearchResult,
  AutocompleteParameters,
  AutocompletePlace,
  CompanyProfile,
  CompanySearchParameters,
  CompanySearchResult,
  CurrentElectricityPriceParameters,
  Departure,
  DepartureParameters,
  ElectricityPrice,
  ElectricityPriceParameters,
  FisheriesVesselLookup,
  FisheriesVesselSearchParameters,
  FisheriesVesselSearchResult,
  FishingVessel,
  ForecastParameters,
  GeonorgeDatasetSummary,
  GeonorgeMetadata,
  GeonorgeSearchParameters,
  GeonorgeSearchResult,
  HazardWarning,
  HazardWarningParameters,
  InterventionFreeAreaFeature,
  KlassCode,
  KlassCodeResolution,
  KlassGetCodeParameters,
  KlassResolveAdministrativeCodeParameters,
  KlassSearchCodesParameters,
  KlassSearchCodesResult,
  LandResourcePointQuery,
  LandResourceResult,
  MarineForecastParameters,
  Mmsi,
  MunicipalityProfile,
  NatureAtLocationParameters,
  NatureAtLocationProfile,
  NaturbaseBoundingBoxQuery,
  NaturbaseFeatureResult,
  NaturbasePointQuery,
  NatureTypeFeature,
  OpenDataResponse,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
  RequestOptions,
  SeaCurrentForecast,
  StatisticsQuery,
  StatisticsResult,
  StatisticsTableMetadata,
  VesselProfile,
  VesselProfileParameters,
  WaveForecast,
  WeatherForecast,
} from "norway-open-data-sdk";

import type { Logger } from "../logging/logger.js";
import type { Redactor } from "../errors/redact.js";
import type { ServerConfig } from "../config/types.js";
import type { Envelope } from "../formatting/envelope.js";

export type NorwayOpenDataLike = {
  companies: {
    search(
      parameters: CompanySearchParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<CompanySearchResult>>;
  };
  profiles: {
    company(
      organizationNumber: string,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<CompanyProfile>>;
    address(query: string, options?: RequestOptions): Promise<OpenDataResponse<AddressProfile>>;
    municipality(
      query: string,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<MunicipalityProfile>>;
    vessel(
      parameters: VesselProfileParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<VesselProfile>>;
    natureAtLocation(
      parameters: NatureAtLocationParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NatureAtLocationProfile>>;
  };
  addresses: {
    search(
      parameters: AddressSearchParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<AddressSearchResult>>;
  };
  weather: {
    forecast(
      parameters: ForecastParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<WeatherForecast>>;
  };
  hazards: {
    getFloodWarnings(
      parameters?: HazardWarningParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<HazardWarning[]>>;
    getAvalancheWarnings(
      parameters?: HazardWarningParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<HazardWarning[]>>;
    getLandslideWarnings(
      parameters?: HazardWarningParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<HazardWarning[]>>;
  };
  electricity: {
    getPrices(
      parameters: ElectricityPriceParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<ElectricityPrice[]>>;
    getCurrentPrice(
      parameters: CurrentElectricityPriceParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<ElectricityPrice | undefined>>;
  };
  transport: {
    autocomplete(
      parameters: AutocompleteParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<AutocompletePlace[]>>;
    departures(
      parameters: DepartureParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<Departure[]>>;
  };
  statistics: {
    getTableMetadata(
      tableId: string,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<StatisticsTableMetadata>>;
    query(
      query: StatisticsQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<StatisticsResult>>;
  };
  klass: {
    resolveMunicipalityCode(
      parameters: KlassResolveAdministrativeCodeParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<KlassCodeResolution>>;
    resolveCountyCode(
      parameters: KlassResolveAdministrativeCodeParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<KlassCodeResolution>>;
    searchCodes(
      parameters: KlassSearchCodesParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<KlassSearchCodesResult>>;
    getCode(
      parameters: KlassGetCodeParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<KlassCode>>;
  };
  ais: {
    getTrackLast24Hours(mmsi: Mmsi, options?: RequestOptions): Promise<OpenDataResponse<AisTrack>>;
    getTrack(
      parameters: AisTrackParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<AisTrack>>;
    /**
     * A live feed, not a request.
     *
     * Typed as the SDK types it — an `AsyncIterable`, not a promise — because
     * the one tool that consumes it must own the bounds. See
     * `get_live_vessel_positions`: the MCP boundary never sees an unbounded
     * stream.
     */
    streamPositions(parameters?: AisPositionStreamParameters): AsyncIterable<AisPosition>;
  };
  marine: {
    getWaveForecast(
      parameters: MarineForecastParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<WaveForecast | undefined>>;
    getSeaCurrent(
      parameters: MarineForecastParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<SeaCurrentForecast | undefined>>;
  };
  fisheries: {
    searchVessels(
      parameters?: FisheriesVesselSearchParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<FisheriesVesselSearchResult>>;
    getVessel(
      lookup: FisheriesVesselLookup,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<FishingVessel>>;
    searchAquacultureSites(
      parameters?: AquacultureSiteSearchParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<AquacultureSiteSearchResult>>;
    getAquacultureSite(
      siteNumber: string,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<AquacultureSite>>;
  };
  /**
   * Geonorge's national metadata catalogue.
   *
   * Only the two read paths the curated tools use. `searchServices` and the
   * `searchDatasetsAll` / `searchServicesAll` iterators exist on the real client
   * and are deliberately absent here: an MCP tool call must be one bounded
   * request, not a walk of the catalogue.
   */
  geodata: {
    searchDatasets(
      parameters?: GeonorgeSearchParameters,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<GeonorgeSearchResult<GeonorgeDatasetSummary>>>;
    getMetadata(id: string, options?: RequestOptions): Promise<OpenDataResponse<GeonorgeMetadata>>;
  };
  /**
   * Selected Naturbase vector layers from Miljødirektoratet.
   *
   * The `iterate*` generators the real client also exposes are omitted for the
   * same reason as above: they are unbounded by construction, and every tool
   * here returns one bounded page.
   */
  environment: {
    getProtectedAreasAt(
      query: NaturbasePointQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProtectedAreaFeature>>>;
    searchProtectedAreas(
      query: NaturbaseBoundingBoxQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProtectedAreaFeature>>>;
    getProposedProtectedAreasAt(
      query: NaturbasePointQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProposedProtectedAreaFeature>>>;
    getNatureTypesAt(
      query: NaturbasePointQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NaturbaseFeatureResult<NatureTypeFeature>>>;
    getInterventionFreeAreasAt(
      query: NaturbasePointQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<NaturbaseFeatureResult<InterventionFreeAreaFeature>>>;
  };
  /** NIBIO's open, generalized AR50 land-resource classification. */
  land: {
    getLandResourcesAt(
      query: LandResourcePointQuery,
      options?: RequestOptions,
    ): Promise<OpenDataResponse<LandResourceResult>>;
  };
};

/**
 * Everything a tool handler is allowed to reach.
 *
 * `getSdk` is a function rather than a value because SDK construction is lazy:
 * an invalid configuration must surface as a tool error, not as a dead server.
 * It throws `ConfigurationRequiredError`, which the handler wrapper maps.
 */
export type ToolContext = {
  getSdk(): NorwayOpenDataLike;
  config: ServerConfig;
  logger: Logger;
  redactor: Redactor;
  /** Injectable clock, so date-defaulting tools are deterministic under test. */
  now(): Date;
};

/** The abort signal and context handed to a handler for one invocation. */
export type ToolInvocation = {
  signal: AbortSignal;
  context: ToolContext;
};

/**
 * A tool's input schema is a complete Zod object, not a raw shape.
 *
 * Verified against `@modelcontextprotocol/sdk@1.29.0`: passing a full object
 * emits `additionalProperties: false` into the advertised JSON Schema (so
 * unknown properties are rejected) and enforces `.refine()` cross-field rules
 * during `tools/call`. A raw shape would give neither.
 */
export type ToolDefinition<TInputSchema extends z.ZodTypeAny, TData> = {
  name: string;
  title: string;
  description: string;
  inputSchema: TInputSchema;
  dataSchema: z.ZodTypeAny;
  /** Requirement check run before the handler; returns missing env var names. */
  requiredEnvironment?: (config: ServerConfig) => string[];
  handler: (input: z.output<TInputSchema>, invocation: ToolInvocation) => Promise<Envelope<TData>>;
  /** Deterministic text rendering for clients that display text only. */
  render: (data: TData, envelope: Envelope<TData>) => string;
};

/** Erased form used by the registry, which holds tools of differing shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;
