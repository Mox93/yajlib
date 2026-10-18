import type {
  InferredConfigs,
  InferResponse,
  RequestConfig,
  SendArgs,
} from "./core";
import {
  concatPathname,
  isEmpty,
  isVoid,
  mergeConfigs,
  VOID_METHODS,
} from "./core";
import {
  YajlibError,
  YajlibParseError,
  YajlibRuntimeError,
  YajlibServerError,
} from "./errors";
import type { ParseError } from "./parser";
import { runParser } from "./parser";

export function yajlib<
  const TConfig extends RequestConfig & InferredConfigs<TConfig>,
>(config: TConfig) {
  return new RequestBuilder(config);
}

export class RequestBuilder<const TConfig extends RequestConfig> {
  constructor(private _config: TConfig) {}

  get config() {
    return this._config;
  }

  extend<
    const TNewConfig extends RequestConfig &
      InferredConfigs<TConfig, TNewConfig>,
  >(config: TNewConfig) {
    return new RequestBuilder(mergeConfigs(this.config, config));
  }

  async send<const TNewConfig extends RequestConfig>(
    ...[config]: SendArgs<TConfig, TNewConfig>
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

    let key, value, resolvedSearch: Record<string, any> | undefined | null;

    if (search) {
      resolvedSearch = {};
      for ([key, value] of Object.entries(search))
        resolvedSearch[key] = typeof value === "function" ? value() : value;
    }

    if (parseSearch) {
      const result = await runParser<Record<string, any> | undefined>(
        parseSearch,
        resolvedSearch,
      );
      if (!result.success) throw new YajlibParseError("search", result.error);
      resolvedSearch = result.data;
    }

    if (resolvedSearch)
      for ([key, value] of Object.entries(resolvedSearch)) {
        if (isEmpty(value)) continue;
        if (Array.isArray(value)) {
          let val;
          for (val of value) url.searchParams.append(key, `${val}`);
        } else url.searchParams.set(key, `${value}`);
      }

    const resolvedHeaders = new Headers();
    if (headers)
      for ([key, value] of Object.entries(headers))
        if (!isEmpty((value = typeof value === "function" ? value() : value)))
          resolvedHeaders.set(key, value);

    let body: any;
    if (isVoid(method)) {
      if (data)
        console.error(
          new Error(
            `Methods [${VOID_METHODS.join(", ")}] do not accept a body!`,
          ),
        );
    } else {
      body = data;
      if (parseRequest) {
        const result = await runParser(parseRequest, body);
        if (!result.success)
          throw new YajlibParseError("request", result.error);
        body = result.data;
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

    type Output = InferResponse<TConfig, TNewConfig>["Output"];

    try {
      const response = await fetch(url.href, {
        method,
        headers: resolvedHeaders,
        body,
        signal,
      });
      if (!response.ok && !mergedConfig.silent) {
        const errorText = await response.text();
        let errorData: unknown = errorText,
          parseError: ParseError | undefined;
        try {
          const json = JSON.parse(errorText);
          errorData = json;
          if (mergedConfig.parseError) {
            const result = await runParser(mergedConfig.parseError, json);
            if (result.success) errorData = result.data;
            else parseError = result.error;
          }
        } catch {
          // Not JSON: keep the raw text.
        }
        throw new YajlibServerError(response.status, errorData, parseError);
      }

      const responseData = await response.json();
      if (!parseResponse) return responseData as Output;

      const result = await runParser(parseResponse, responseData);
      if (!result.success) throw new YajlibParseError("response", result.error);
      return result.data as Output;
    } catch (error: any) {
      if (error instanceof YajlibError) throw error;
      throw new YajlibRuntimeError(error);
    }
  }
}
