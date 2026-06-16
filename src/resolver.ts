import { z, ZodError, ZodType } from "zod";
import { concatPathname, isEmpty, noBody, RequestConfig } from "./core";

export class RequestResolver<TConfig extends RequestConfig> extends Promise<
  z.infer<TConfig["validateResponse"]>
> {
  #target: "json" | "text" | "blob" | undefined;
  #validateResponse: TConfig["validateResponse"] | undefined;

  constructor(config: TConfig) {
    super(
      typeof config === "function"
        ? config
        : async (resolve, reject) => {
            const {
                baseUrl,
                method = "GET",
                pathname,
                params,
                search,
                validateSearch,
                validateRequest,
                data,
                signal,
              } = config,
              excludeBody = noBody(method);

            if (excludeBody && data)
              console.error(
                new Error(`Method [${method}] dose not accept a body!`),
              );

            try {
              const headers = this.#resolveHeaders(config.headers),
                response = await fetch(
                  this.#resolveUrl({
                    baseUrl,
                    params,
                    pathname,
                    search,
                    validateSearch,
                  }),
                  {
                    method,
                    headers,
                    signal,
                    body: excludeBody
                      ? null
                      : this.#resolveBody({ headers, data, validateRequest }),
                  },
                );

              if (!response.ok && !config.silent)
                await this.#parseError({
                  response,
                  validateError: config.validateError,
                });

              resolve(
                VOID_CODES.includes(response.status) ||
                  response.headers.get("content-length") === "0"
                  ? null
                  : await this.#parseResponse({
                      response,
                      validateResponse: config.validateResponse,
                    }),
              );
            } catch (error: any) {
              return reject(
                EXPECTED_ERROR.includes(error.type)
                  ? error
                  : { type: "RUNTIME_ERROR", error },
              );
            }
          },
    );
  }

  json<T = z.infer<TConfig["validateResponse"]>>(
    validateResponse?: ZodType<T>,
  ) {
    this.#target = "json";
    this.#validateResponse = validateResponse;
    return this as Promise<T>;
  }

  text() {
    this.#target = "text";
    return this as Promise<string>;
  }

  blob() {
    this.#target = "blob";
    return this as Promise<Blob>;
  }

  #resolveUrl({
    baseUrl,
    pathname,
    params,
    search,
    validateSearch,
  }: Pick<
    TConfig,
    "baseUrl" | "pathname" | "params" | "search" | "validateSearch"
  >) {
    const url = new URL(
      typeof baseUrl === "string" ? baseUrl : baseUrl?.href || "/",
    );

    if (url.pathname && pathname)
      url.pathname = concatPathname(url.pathname, pathname);

    if (url.pathname && params) {
      url.pathname = decodeURIComponent(url.pathname).replace(
        VARIABLE_REGEX,
        (match, key) => {
          const value = params[key];
          return !isEmpty(value)
            ? `${typeof value === "function" ? value() : value}`
            : match;
        },
      );
    }

    if (search) {
      let resolvedSearch: Record<string, any> = {},
        key,
        value;

      for ([key, value] of Object.entries(search))
        resolvedSearch[key] = typeof value === "function" ? value() : value;

      if (validateSearch) {
        const result = validateSearch.safeParse(resolvedSearch);
        if (result.success) resolvedSearch = result.data;
        else
          throw { type: "PARSE_ERROR", error: result.error, target: "search" };
      }

      for ([key, value] of Object.entries(resolvedSearch))
        if (!isEmpty(value)) url.searchParams.set(key, `${value}`);
    }

    return url;
  }

  #resolveHeaders(record: TConfig["headers"]) {
    let key, value;
    const headers = new Headers();
    if (!record) return headers;
    for ([key, value] of Object.entries(record))
      if (!isEmpty((value = typeof value === "function" ? value() : value)))
        headers.set(key, value);
    return headers;
  }

  #resolveBody({
    headers,
    data,
    validateRequest,
  }: Pick<TConfig, "data" | "validateRequest"> & {
    headers: Headers;
  }) {
    let body: any;
    if ((body = data) && validateRequest) {
      body = validateRequest.safeParse(body);
      if (body.success) body = body.data;
      else throw { type: "PARSE_ERROR", error: body.error, target: "data" };
    }

    if (!body) return body as BodyInit;

    if (CUSTOM_BODY_TYPES.some((type) => body instanceof type))
      headers.delete("content-type");
    else {
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
      if (contentType && !headers.has("content-type"))
        headers.set("content-type", contentType);
    }

    return body as BodyInit;
  }

  async #parseError({
    response,
    validateError,
  }: Pick<TConfig, "validateError"> & { response: Response }) {
    let errorData, parseError;
    try {
      errorData = await response.text();
      errorData = JSON.parse(errorData);
      if (validateError) errorData = validateError.parse(errorData);
    } catch (error) {
      if (error instanceof ZodError) parseError = error;
    }
    throw {
      type: "SERVER_ERROR",
      status: response.status,
      error: errorData,
      parseError,
    };
  }

  async #parseResponse({
    response,
    validateResponse,
  }: Pick<TConfig, "validateResponse"> & { response: Response }) {
    let payload = undefined;
    switch (this.#target) {
      case "text":
        payload = await response.text();
        break;
      case "blob":
        payload = await response.blob();
        break;
      case "json":
        payload = await response.json();
        break;
      default:
        const contentType = response.headers.get("content-type");
        if (!contentType) payload = await response.json();
        else if (JSON_REGEX.test(contentType)) payload = await response.json();
        else if (TEXT_REGEX.test(contentType)) payload = await response.text();
        else if (BLOB_REGEX.test(contentType)) payload = await response.blob();
        else payload = await response.json();
    }

    if ((validateResponse = this.#validateResponse || validateResponse)) {
      payload = validateResponse.safeParse(payload);
      if (payload.success) return payload.data;
      else throw { type: "PARSE_ERROR", error: payload.error, target: "data" };
    }

    return payload;
  }
}

const EXPECTED_ERROR = ["SERVER_ERROR", "PARSE_ERROR"],
  CUSTOM_BODY_TYPES = [FormData, URLSearchParams, Blob] as const,
  VOID_CODES = [204, 205, 304],
  VARIABLE_REGEX = /\{([a-zA-Z0-9_]+)\}/g,
  // TODO include /api/{version?}/cart ({version: "v2"} -> /api/v2/cart), ({} -> /api/cart)
  OPTIONAL_VARIABLE_REGEX = /\{([a-zA-Z0-9_]+)\?\}/g,
  // TODO include /api/{...resource}/edit ({resource: "branch"} -> /api/branch/edit), ({resource: ["branch", "store"]} -> /api/branch/store/edit)
  MULTI_VARIABLE_REGEX = /\{\.\.\.([a-zA-Z0-9_]+)\}/g,
  JSON_REGEX = /(^|\W)json($|\W)/gi,
  TEXT_REGEX = /(^|\W)text|(application\/(xml|javascript))($|\W)/gi,
  BLOB_REGEX =
    /(^|\W)(application\/(zip|pdf|octet-stream))|((image|video|audio)\/\w+)($|\W)/gi;
