import type {
  AnyParser,
  InferParserInput,
  InferParserOutput,
  Parser,
} from "./parser";

export function mergeConfigs<
  const TConfig1 extends RequestConfig,
  const TConfig2 extends RequestConfig,
>(config1: TConfig1, config2: TConfig2) {
  const config: Record<string, unknown> = {};
  let key, subKey, source, target: Record<string, unknown>;
  for (key of REPLACEABLE_FIELDS)
    if (!isEmpty(config2[key])) config[key] = config2[key];
    else if (!isEmpty(config1[key])) config[key] = config1[key];
  for (key of MERGEABLE_FIELDS) {
    if (!config1[key] && !config2[key]) continue;
    target = config[key] = {};
    if ((source = config1[key]))
      for (subKey in source)
        if (!isEmpty(source[subKey])) target[subKey] = source[subKey];
    if ((source = config2[key]))
      for (subKey in source)
        if (!isEmpty(source[subKey])) target[subKey] = source[subKey];
  }
  config.pathname = concatPathname(config1.pathname, config2.pathname);
  return config as FieldMerger<TConfig1, TConfig2> extends infer T
    ? { [K in Extract<keyof TConfig1 | keyof TConfig2, keyof T>]: T[K] }
    : never;
}

export function concatPathname<const TParts extends (string | undefined)[]>(
  ...parts: TParts
) {
  let pathname = "",
    part;
  for (part of parts)
    pathname += part?.replace(/^\/*/, "/").replace(/\/+$/, "") ?? "";
  return pathname as ConcatPathnames<TParts>;
}

export function isEmpty(value: any): value is EmptyValue {
  return EMPTY_VALUES.includes(value);
}

export function isVoid(method: any): method is VoidMethod {
  return VOID_METHODS.includes(method);
}

export const VOID_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

const REPLACEABLE_FIELDS = [
    "method",
    "baseUrl",
    "parseSearch",
    "data",
    "parseRequest",
    "parseResponse",
    "parseError",
    "silent",
    "signal",
  ] as const,
  MERGEABLE_FIELDS = ["params", "search", "headers"] as const,
  EMPTY_VALUES = [undefined, null, ""] as const;

export interface RequestConfig {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  baseUrl?: string | URL;
  pathname?: string;
  params?: Record<string, Resolvable<string | number>>;
  search?: Record<string, Resolvable<unknown>>;
  parseSearch?: Parser<any, Record<string, unknown> | undefined>;
  headers?: Record<string, Resolvable<string | undefined | null>>;
  data?: unknown;
  parseRequest?: AnyParser;
  parseResponse?: AnyParser;
  parseError?: AnyParser;
  silent?: boolean;
  signal?: AbortSignal;
}

export interface FieldMerger<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig,
> {
  method: Overwrite<TConfig1, TConfig2, "method", string, "GET">;
  baseUrl: Overwrite<TConfig1, TConfig2, "baseUrl", string | URL>;
  pathname: ConcatPathnames<[TConfig1["pathname"], TConfig2["pathname"]]>;
  params: Merge<TConfig1["params"], TConfig2["params"]>;
  search: Merge<TConfig1["search"], TConfig2["search"]>;
  parseSearch: Overwrite<TConfig1, TConfig2, "parseSearch", AnyParser>;
  headers: Merge<TConfig1["headers"], TConfig2["headers"]>;
  data: Overwrite<TConfig1, TConfig2, "data", unknown>;
  parseRequest: Overwrite<TConfig1, TConfig2, "parseRequest", AnyParser>;
  parseResponse: Overwrite<TConfig1, TConfig2, "parseResponse", AnyParser>;
  parseError: Overwrite<TConfig1, TConfig2, "parseError", AnyParser>;
  silent: Overwrite<TConfig1, TConfig2, "silent", boolean>;
  signal: Overwrite<TConfig1, TConfig2, "signal", AbortSignal>;
}

export interface InferredConfigs<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> {
  params?: ExtractRouteParams<
    FieldMerger<TConfig1, TConfig2>["pathname"]
  > extends infer P
    ? keyof P extends never
      ? Record<string, Resolvable<string | number>>
      : { [K in keyof P]?: P[K] | null }
    : never;
  data?: FieldMerger<TConfig1, TConfig2>["method"] extends VoidMethod
    ? never
    : InferRequest<TConfig1, TConfig2>["Input"];
  /** Config-level `search` is merged key-by-key and resolved lazily, so every key is optional and may be a function. */
  search?: InferSearch<TConfig1, TConfig2>["Input"] extends infer T
    ? T extends Record<string, unknown>
      ? { [K in keyof T]?: Resolvable<T[K]> }
      : T
    : never;
}

export type SendArgs<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig,
> = {
  data: FieldMerger<TConfig1, TConfig2>["method"] extends VoidMethod
    ? never
    : InferRequest<TConfig1, TConfig2>["Input"];
  params: Omit<
    ExtractRouteParams<FieldMerger<TConfig1, TConfig2>["pathname"]>,
    keyof TConfig1["params"] | keyof TConfig2["params"]
  >;
  search: InferSearch<TConfig1, TConfig2>["Input"];
} extends infer T
  ? [
      { [K in keyof T as ArgKind<T[K]> extends "required" ? K : never]: T[K] },
      { [K in keyof T as ArgKind<T[K]> extends "optional" ? K : never]?: T[K] },
    ] extends [infer TRequired, infer TOptional]
    ? keyof TRequired extends never
      ? [config?: TConfig2 & InferredConfigs<TConfig1, TConfig2> & TOptional]
      : [
          config: TConfig2 &
            InferredConfigs<TConfig1, TConfig2> &
            TRequired &
            TOptional,
        ]
    : never
  : never;

/**
 * How a `send()` argument is exposed, based on the parser's input type:
 * - "none":     no parser (`unknown`/`any`) or nothing to provide (`{}`/`undefined`)
 * - "optional": the input accepts `undefined`, so the caller may omit it
 * - "required": anything else
 */
type ArgKind<T> = unknown extends T
  ? "none"
  : undefined extends T
    ? [Exclude<T, undefined>] extends [never]
      ? "none"
      : "optional"
    : [
          T extends unknown
            ? [keyof T] extends [never]
              ? true
              : false
            : never,
        ] extends [true]
      ? "none"
      : "required";

/*************\
|** PARSERS **|
\*************/
interface InferParser<T> {
  Input: InferParserInput<T>;
  Output: InferParserOutput<T>;
}

type InferRequest<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> = InferParser<
  Overwrite<TConfig1, TConfig2, "parseRequest", AnyParser, unknown>
>;

type InferSearch<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> = InferParser<
  Overwrite<TConfig1, TConfig2, "parseSearch", AnyParser, unknown>
>;

export type InferResponse<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> = InferParser<
  Overwrite<
    TConfig1,
    TConfig2,
    "parseResponse",
    AnyParser,
    (input: unknown) => any
  >
>;

/***********\
|** UTILS **|
\***********/
type Resolvable<T> = T | (() => T);

type Overwrite<
  T1,
  T2,
  Key extends keyof T1 | keyof T2,
  Ref,
  Fallback = never,
> = T2 extends { [_ in Key]: Ref }
  ? T2[Key]
  : T1 extends { [_ in Key]: Ref }
    ? T1[Key]
    : Fallback;

type Merge<T1, T2> =
  T1 extends Record<string, unknown>
    ? T2 extends Record<string, unknown>
      ? {
          // NOTE this will cause all fields to be required
          [K in keyof T1 | keyof T2]: K extends keyof T2
            ? T2[K]
            : K extends keyof T1
              ? T1[K]
              : never;
        }
      : T1
    : T2;

/**************\
|** PATHNAME **|
\**************/
type ConcatPathnames<T extends unknown[]> = T extends [infer F, ...infer R]
  ? string extends F
    ? ConcatPathnames<R>
    : F extends string
      ? RemoveOuterSlashes<F> extends ""
        ? ConcatPathnames<R>
        : `/${RemoveOuterSlashes<F>}${ConcatPathnames<R>}`
      : ConcatPathnames<R>
  : "";

type RemoveOuterSlashes<T> = RemoveRightSlash<RemoveLeftSlash<T>>;
type RemoveLeftSlash<T> = T extends `/${infer P}` ? RemoveLeftSlash<P> : T;
type RemoveRightSlash<T> = T extends `${infer P}/` ? RemoveRightSlash<P> : T;

type ExtractRouteParams<T extends string> =
  T extends `${string}{${infer Param}}${infer P}`
    ? Merge<
        { [K in Param]: Resolvable<string | number> },
        ExtractRouteParams<P>
      >
    : {};

/******************\
|** UNION VALUES **|
\******************/
type EmptyValue = (typeof EMPTY_VALUES)[number];
type VoidMethod = (typeof VOID_METHODS)[number];
