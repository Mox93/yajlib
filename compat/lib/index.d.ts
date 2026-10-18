//#region src/standard-schema.d.ts
/**
 * Vendored copy of the Standard Schema spec (https://standardschema.dev).
 * The spec is intentionally designed to be copied, so no runtime or type
 * dependency is needed. Keep in sync with `@standard-schema/spec` if desired.
 */
/** The Standard Schema interface. */
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
declare namespace StandardSchemaV1 {
  /** The Standard Schema properties interface. */
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }
  type Result<Output> = SuccessResult<Output> | FailureResult;
  interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  interface PathSegment {
    readonly key: PropertyKey;
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
//#endregion
//#region src/parser.d.ts
/** A custom parser: any function that turns input into typed output (or throws). */
type ParseFn<TInput = unknown, TOutput = TInput> = (input: TInput) => TOutput | Promise<TOutput>;
/**
 * A parser is either a Standard Schema (Zod, Valibot, ArkType, ...) or a plain
 * function (XML reader, file reader, custom transform, ...).
 */
type Parser<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput> | ParseFn<TInput, TOutput>;
type AnyParser = Parser<any, unknown>;
/** Which hook produced a parse failure. Mirrors the `parse*` config keys. */
type ParseTarget = "search" | "request" | "response";
/** Library-neutral parse failure, structurally compatible with ZodError. */
interface ParseError {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
  /** The original thrown value when a custom parser threw. */
  readonly cause?: unknown;
}
/** What the caller passes in. Falls back to `unknown` for function parsers without a typed param. */
type InferParserInput<TParser> = TParser extends StandardSchemaV1 ? StandardSchemaV1.InferInput<TParser> : TParser extends ((input: infer TInput) => unknown) ? TInput : unknown;
/** What the parser produces. */
type InferParserOutput<TParser> = TParser extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<TParser> : TParser extends ((...args: any[]) => infer TResult) ? Awaited<TResult> : unknown;
//#endregion
//#region src/core.d.ts
declare const VOID_METHODS: readonly ["GET", "HEAD", "OPTIONS"];
interface RequestConfig {
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
interface FieldMerger<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig> {
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
interface InferredConfigs<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig = {}> {
  params?: ExtractRouteParams<FieldMerger<TConfig1, TConfig2>["pathname"]> extends (infer P) ? keyof P extends never ? Record<string, Resolvable<string | number>> : { [K in keyof P]?: P[K] | null; } : never;
  data?: FieldMerger<TConfig1, TConfig2>["method"] extends VoidMethod ? never : InferRequest<TConfig1, TConfig2>["Input"];
  /** Config-level `search` is merged key-by-key and resolved lazily, so every key is optional and may be a function. */
  search?: InferSearch<TConfig1, TConfig2>["Input"] extends (infer T) ? T extends Record<string, unknown> ? { [K in keyof T]?: Resolvable<T[K]>; } : T : never;
}
type SendArgs<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig> = {
  data: FieldMerger<TConfig1, TConfig2>["method"] extends VoidMethod ? never : InferRequest<TConfig1, TConfig2>["Input"];
  params: Omit<ExtractRouteParams<FieldMerger<TConfig1, TConfig2>["pathname"]>, keyof TConfig1["params"] | keyof TConfig2["params"]>;
  search: InferSearch<TConfig1, TConfig2>["Input"];
} extends (infer T) ? [{ [K in keyof T as ArgKind<T[K]> extends "required" ? K : never]: T[K]; }, { [K in keyof T as ArgKind<T[K]> extends "optional" ? K : never]?: T[K]; }] extends [infer TRequired, infer TOptional] ? keyof TRequired extends never ? [config?: TConfig2 & InferredConfigs<TConfig1, TConfig2> & TOptional] : [config: TConfig2 & InferredConfigs<TConfig1, TConfig2> & TRequired & TOptional] : never : never;
/**
 * How a `send()` argument is exposed, based on the parser's input type:
 * - "none":     no parser (`unknown`/`any`) or nothing to provide (`{}`/`undefined`)
 * - "optional": the input accepts `undefined`, so the caller may omit it
 * - "required": anything else
 */
type ArgKind<T> = unknown extends T ? "none" : undefined extends T ? [Exclude<T, undefined>] extends [never] ? "none" : "optional" : [T extends unknown ? [keyof T] extends [never] ? true : false : never] extends [true] ? "none" : "required";
/*************\
|** PARSERS **|
\*************/
interface InferParser<T> {
  Input: InferParserInput<T>;
  Output: InferParserOutput<T>;
}
type InferRequest<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig = {}> = InferParser<Overwrite<TConfig1, TConfig2, "parseRequest", AnyParser, unknown>>;
type InferSearch<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig = {}> = InferParser<Overwrite<TConfig1, TConfig2, "parseSearch", AnyParser, unknown>>;
type InferResponse<TConfig1 extends RequestConfig, TConfig2 extends RequestConfig = {}> = InferParser<Overwrite<TConfig1, TConfig2, "parseResponse", AnyParser, (input: unknown) => any>>;
/***********\
|** UTILS **|
\***********/
type Resolvable<T> = T | (() => T);
type Overwrite<T1, T2, Key extends keyof T1 | keyof T2, Ref, Fallback = never> = T2 extends { [_ in Key]: Ref; } ? T2[Key] : T1 extends { [_ in Key]: Ref; } ? T1[Key] : Fallback;
type Merge<T1, T2> = T1 extends Record<string, unknown> ? T2 extends Record<string, unknown> ? { [K in keyof T1 | keyof T2]: K extends keyof T2 ? T2[K] : K extends keyof T1 ? T1[K] : never; } : T1 : T2;
/**************\
|** PATHNAME **|
\**************/
type ConcatPathnames<T extends unknown[]> = T extends [infer F, ...infer R] ? string extends F ? ConcatPathnames<R> : F extends string ? RemoveOuterSlashes<F> extends "" ? ConcatPathnames<R> : `/${RemoveOuterSlashes<F>}${ConcatPathnames<R>}` : ConcatPathnames<R> : "";
type RemoveOuterSlashes<T> = RemoveRightSlash<RemoveLeftSlash<T>>;
type RemoveLeftSlash<T> = T extends `/${infer P}` ? RemoveLeftSlash<P> : T;
type RemoveRightSlash<T> = T extends `${infer P}/` ? RemoveRightSlash<P> : T;
type ExtractRouteParams<T extends string> = T extends `${string}{${infer Param}}${infer P}` ? Merge<{ [K in Param]: Resolvable<string | number>; }, ExtractRouteParams<P>> : {};
type VoidMethod = (typeof VOID_METHODS)[number];
//#endregion
//#region src/builder.d.ts
export declare function yajlib<const TConfig extends RequestConfig & InferredConfigs<TConfig>>(config: TConfig): RequestBuilder<TConfig>;
export declare class RequestBuilder<const TConfig extends RequestConfig> {
  private _config;
  constructor(_config: TConfig);
  get config(): TConfig;
  extend<const TNewConfig extends RequestConfig & InferredConfigs<TConfig, TNewConfig>>(config: TNewConfig): RequestBuilder<{ [K in Extract<keyof TConfig, keyof FieldMerger<TConfig, TNewConfig>> | Extract<keyof TNewConfig, keyof FieldMerger<TConfig, TNewConfig>>]: FieldMerger<TConfig, TNewConfig>[K]; }>;
  send<const TNewConfig extends RequestConfig>(...[config]: SendArgs<TConfig, TNewConfig>): Promise<InferParserOutput<TNewConfig extends {
    parseResponse: AnyParser;
  } ? TNewConfig["parseResponse"] : TConfig extends {
    parseResponse: AnyParser;
  } ? TConfig["parseResponse"] : (input: unknown) => any>>;
}
//#endregion
//#region src/errors.d.ts
/** Base class for everything `send()` can throw. Use `instanceof YajlibError` or `isYajlibError()`. */
export declare abstract class YajlibError extends Error {
  abstract readonly type: "SERVER_ERROR" | "PARSE_ERROR" | "RUNTIME_ERROR";
}
/** The server answered with a non-2xx status. */
export declare class YajlibServerError extends YajlibError {
  readonly status: number;
  /** The error body: parsed by `parseError` if it succeeded, raw JSON/text otherwise. */
  readonly error: any;
  /** Set when `parseError` was configured but the body did not match. */
  readonly parseError?: ParseError | undefined;
  readonly type = "SERVER_ERROR";
  readonly name = "YajlibServerError";
  constructor(status: number,
  /** The error body: parsed by `parseError` if it succeeded, raw JSON/text otherwise. */
  error: any,
  /** Set when `parseError` was configured but the body did not match. */
  parseError?: ParseError | undefined);
}
/** A `parseSearch`, `parseRequest` or `parseResponse` hook rejected its input. */
export declare class YajlibParseError extends YajlibError {
  readonly target: ParseTarget;
  readonly error: ParseError;
  readonly type = "PARSE_ERROR";
  readonly name = "YajlibParseError";
  constructor(target: ParseTarget, error: ParseError);
}
/** Anything else: network failure, abort, bug in a custom parser's environment, etc. */
export declare class YajlibRuntimeError extends YajlibError {
  readonly error: unknown;
  readonly type = "RUNTIME_ERROR";
  readonly name = "YajlibRuntimeError";
  constructor(error: unknown);
}
/** The concrete error classes as a union, so `switch (error.type)` narrows. */
type AnyYajlibError = YajlibServerError | YajlibParseError | YajlibRuntimeError;
export declare function isYajlibError(value: unknown): value is AnyYajlibError;
//#endregion
export type { AnyYajlibError, InferResponse, ParseError, ParseFn, ParseTarget, Parser, RequestConfig, StandardSchemaV1 };