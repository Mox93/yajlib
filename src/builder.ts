import type { z, ZodType } from "zod";
import { ZodError } from "zod";
import type {
  ComputeMissingParams,
  InferRequestData,
  InferRouteParams,
  InferSearch,
  Overwrite,
  RequestConfig,
  SendArgs,
} from "./core";
import {
  concatPathname,
  isEmpty,
  mergeConfigs,
  noBody,
  VOID_METHODS,
} from "./core";

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

  async send<const TNewConfig extends RequestConfig>(
    ...[config]: SendArgs<
      TNewConfig & { params?: InferRouteParams<TConfig, TNewConfig> },
      {
        data: InferRequestData<TConfig, TNewConfig>;
        params: ComputeMissingParams<TConfig, TNewConfig>;
        search: InferSearch<TConfig, TNewConfig>;
      }
    >
  ) {
    const mergedConfig = config
        ? mergeConfigs(this.config, config)
        : this.config,
      {
        baseUrl,
        method = "GET",
        pathname,
        params,
        search,
        parseSearch,
        headers,
        data,
        parseRequest,
        signal,
        parseResponse,
      } = mergedConfig,
      url = new URL(
        typeof baseUrl === "string" ? baseUrl : baseUrl?.href || "/",
      ),
      excludeBody = noBody(method);

    if (excludeBody && data)
      console.error(
        new Error(`Methods [${VOID_METHODS.join(", ")}] do not accept a body!`),
      );

    if (url.pathname && pathname)
      url.pathname = concatPathname(url.pathname, pathname);

    if (url.pathname && params) {
      url.pathname = decodeURIComponent(url.pathname).replace(
        /\{([a-zA-Z0-9_]+)\}/g,
        (match, key) => {
          const value = (params as RequestConfig["params"] & {})[key];
          return !isEmpty(value)
            ? encodeURIComponent(
                `${typeof value === "function" ? value() : value}`,
              )
            : match;
        },
      );
    }

    let key, value;

    if (search) {
      let resolvedSearch: Record<string, any> | undefined | null = {};

      for ([key, value] of Object.entries(search))
        resolvedSearch[key] = typeof value === "function" ? value() : value;

      if (parseSearch) {
        const result = await parseSearch.safeParseAsync(resolvedSearch);
        if (result.success) resolvedSearch = result.data;
        else
          throw {
            type: "PARSE_ERROR",
            error: result.error,
            target: "search",
          };
      }

      if (resolvedSearch)
        for ([key, value] of Object.entries(resolvedSearch)) {
          if (isEmpty(value)) continue;
          if (Array.isArray(value)) {
            let val;
            for (val of value) url.searchParams.append(key, `${val}`);
          } else url.searchParams.set(key, `${value}`);
        }
    }

    const resolvedHeaders = new Headers();
    if (headers)
      for ([key, value] of Object.entries(headers))
        if (!isEmpty((value = typeof value === "function" ? value() : value)))
          resolvedHeaders.set(key, value);

    let body: any;
    if (!excludeBody) {
      body = data;
      if (body && parseRequest) {
        body = await parseRequest.safeParseAsync(body);
        if (body.success) body = body.data;
        else
          throw {
            type: "PARSE_ERROR",
            error: body.error,
            target: "data",
          };
      }
    }

    if (body instanceof FormData) resolvedHeaders.delete("Content-Type");
    else if (body) {
      let contentType: string | undefined;
      switch (typeof body) {
        case "object":
          body = JSON.stringify(body);
          contentType = "application/json";
          break;
        case "string":
          contentType = "text/plain";
          break;
      }
      if (contentType && !resolvedHeaders.has("Content-Type"))
        resolvedHeaders.set("Content-Type", contentType);
    }

    try {
      const response = await fetch(url.href, {
        method,
        headers: resolvedHeaders,
        body,
        signal,
      });
      if (!response.ok && !mergedConfig.silent) {
        let errorData, parseError;
        const errorText = await response.text();
        try {
          errorData = JSON.parse(errorText);
          const { parseError } = mergedConfig;
          if (parseError) errorData = parseError.parse(errorData);
        } catch (error) {
          if (error instanceof ZodError) parseError = error;
          else errorData = errorText;
        }
        throw {
          type: "SERVER_ERROR",
          status: response.status,
          error: errorData,
          parseError,
        };
      }

      const data = await response.json();

      return (parseResponse ? parseResponse.parse(data) : data) as z.infer<
        Overwrite<TConfig, TNewConfig, "parseResponse", ZodType, any>
      >;
    } catch (error: any) {
      if (EXPECTED_ERROR.includes(error.type)) throw error;
      throw { type: "RUNTIME_ERROR", error };
    }
  }
}

const EXPECTED_ERROR = ["SERVER_ERROR", "PARSE_ERROR"];
