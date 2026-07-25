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
  ForecastParameters,
  HazardWarning,
  HazardWarningParameters,
  KlassCode,
  KlassCodeResolution,
  KlassGetCodeParameters,
  KlassResolveAdministrativeCodeParameters,
  KlassSearchCodesParameters,
  KlassSearchCodesResult,
  MunicipalityProfile,
  OpenDataResponse,
  RequestOptions,
  StatisticsQuery,
  StatisticsResult,
  StatisticsTableMetadata,
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
