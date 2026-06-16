import {
  ComputeMissingParams,
  InferRequestData,
  InferRouteParams,
  InferSearch,
  mergeConfigs,
  RequestConfig,
  SendArgs,
} from "./core";
import { RequestResolver } from "./resolver";

export function yajlib<
  const TConfig extends RequestConfig & {
    params?: InferRouteParams<TConfig>;
    data?: InferRequestData<TConfig>;
  },
>(config: TConfig) {
  return new RequestBuilder(config);
}

export class RequestBuilder<const TConfig extends RequestConfig> {
  constructor(private _config: TConfig) {}

  get config() {
    return this._config;
  }

  extend<
    const TNewConfig extends RequestConfig & {
      params?: InferRouteParams<TConfig, TNewConfig>;
      data?: InferRequestData<TConfig, TNewConfig>;
    },
  >(config: TNewConfig) {
    return new RequestBuilder(mergeConfigs(this.config, config));
  }

  send<const TNewConfig extends RequestConfig>(
    ...[config]: SendArgs<
      TNewConfig & { params?: InferRouteParams<TConfig, TNewConfig> },
      {
        data: InferRequestData<TConfig, TNewConfig>;
        params: ComputeMissingParams<TConfig, TNewConfig>;
        search: InferSearch<TConfig, TNewConfig>;
      }
    >
  ) {
    return new RequestResolver(
      config ? mergeConfigs(this.config, config) : this.config,
    );
  }
}
