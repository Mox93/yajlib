import { z, ZodError, ZodType } from "zod";
import {
  ComputeMissingParams,
  concatPathname,
  InferRequestData,
  InferRouteParams,
  InferSearch,
  isEmpty,
  mergeConfigs,
  noBody,
  Overwrite,
  RequestConfig,
  SendArgs,
  VOID_METHODS,
} from "./core";

export function yajlib<
  const TConfig extends RequestConfig & {
    params?: InferRouteParams<TConfig>;
    data?: InferRequestData<TConfig>;
  },
>(config: TConfig) {
  return new Yajlib(config);
}

export class Yajlib<const TConfig extends RequestConfig> {
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
    return new Yajlib(mergeConfigs(this.config, config));
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
        validateSearch,
        headers,
        data,
        validateRequest,
        signal,
        validateResponse,
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
      let resolvedSearch: Record<string, any> = {};

      for ([key, value] of Object.entries(search))
        resolvedSearch[key] = typeof value === "function" ? value() : value;

      if (validateSearch) {
        const result = validateSearch.safeParse(resolvedSearch);
        if (result.success) resolvedSearch = result.data;
        else
          throw {
            type: "PARSE_ERROR",
            error: result.error,
            target: "search",
          };
      }

      for ([key, value] of Object.entries(resolvedSearch))
        if (!isEmpty(value)) url.searchParams.append(key, `${value}`);
    }

    const resolvedHeaders = new Headers();
    if (headers)
      for ([key, value] of Object.entries(headers))
        if (!isEmpty((value = typeof value === "function" ? value() : value)))
          resolvedHeaders.set(key, value);

    let body: any;
    if (!excludeBody) {
      body = data;
      if (body && validateRequest) {
        body = validateRequest.safeParse(body);
        if (body.success) body = body.data;
        else
          throw {
            type: "PARSE_ERROR",
            error: body.error,
            target: "data",
          };
      }
    }

    if (body instanceof FormData)
      resolvedHeaders.set("Content-Type", "multipart/form-data");
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
          const { validateError } = mergedConfig;
          if (validateError) errorData = validateError.parse(errorData);
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

      return (
        validateResponse ? validateResponse.parse(data) : data
      ) as z.infer<
        Overwrite<TConfig, TNewConfig, "validateResponse", ZodType, any>
      >;
    } catch (error: any) {
      if (EXPECTED_ERROR.includes(error.type)) throw error;
      throw { type: "RUNTIME_ERROR", error };
    }
  }
}

const EXPECTED_ERROR = ["SERVER_ERROR", "PARSE_ERROR"];
