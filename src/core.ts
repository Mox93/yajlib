import type { ZodError, ZodType, z } from "zod";

export function mergeConfigs<
  const TConfig1 extends RequestConfig,
  const TConfig2 extends RequestConfig,
>(config1: TConfig1, config2: TConfig2) {
  const result = mergeRecords(config1, config2);
  let field;
  for (field of CONFIG_MERGE_FIELDS)
    if (config1[field] && config2[field])
      result[field] = mergeRecords(config1[field], config2[field]) as any;
    else if (config1[field]) result[field] = config1[field] as any;

  const pathname = concatPathname(config1.pathname, config2.pathname) as string;
  if (pathname) result.pathname = pathname;

  return result as MergeConfigs<TConfig1, TConfig2>;
}

export function concatPathname<const TPaths extends (string | undefined)[]>(
  ...pathnames: TPaths
) {
  let result = "",
    pathname;
  for (pathname of pathnames)
    if ((pathname = pathname?.replace(/^\/+/g, "").replace(/\/+$/g, "")))
      result += "/" + pathname;
  return result as ConcatPathnames<TPaths>;
}

export function isEmpty(value: any): value is (typeof EMPTY_VALUES)[number] {
  return EMPTY_VALUES.includes(value);
}

export function noBody(method: any): method is (typeof VOID_METHODS)[number] {
  return VOID_METHODS.includes(method);
}

function mergeRecords<T1, T2>(record1: T1, record2: T2) {
  const result = { ...record1 } as Merge<T1, T2>;
  let key: keyof T2;
  for (key in record2)
    if (record2[key] !== undefined)
      result[key as keyof typeof result] = record2[key] as any;
  return result;
}

const VOID_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

const CONFIG_MERGE_FIELDS = ["params", "search", "headers"] as const,
  EMPTY_VALUES = [undefined, null, ""] as const;

export interface FieldMerges<
  T1 extends RequestConfig,
  T2 extends RequestConfig,
> {
  method: Overwrite<T1, T2, "method", string>;
  baseUrl: Overwrite<T1, T2, "baseUrl", string | URL>;
  pathname: ConcatPathnames<[T1["pathname"], T2["pathname"]]>;
  params: Merge<T1["params"], T2["params"]>;
  search: Merge<T1["search"], T2["search"]>;
  validateSearch: Overwrite<T1, T2, "validateSearch", ZodType>;
  headers: Merge<T1["headers"], T2["headers"]>;
  data: Overwrite<T1, T2, "data", unknown>;
  validateRequest: Overwrite<T1, T2, "validateRequest", ZodType>;
  validateResponse: Overwrite<T1, T2, "validateResponse", ZodType>;
  validateError: Overwrite<T1, T2, "validateError", ZodType>;
  silent: Overwrite<T1, T2, "silent", boolean>;
  signal: Overwrite<T1, T2, "signal", AbortSignal>;
}

export type RequestConfig = Partial<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  baseUrl: string | URL;
  pathname: string;
  params: Record<string, Resolvable<unknown>>;
  search: Record<string, Resolvable<unknown>>;
  validateSearch: ZodType<Record<string, unknown>>;
  headers: Record<string, Resolvable<string | undefined | null>>;
  data: unknown;
  validateRequest: ZodType;
  validateResponse: ZodType;
  validateError: ZodType;
  silent: boolean;
  signal: AbortSignal;
}>;

export type Resolvable<T> = T | (() => T);

export type ComputeMissingParams<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig,
> = Omit<
  ExtractRouteParams<[TConfig1["pathname"], TConfig2["pathname"]]>,
  keyof TConfig1["params"] | keyof TConfig2["params"]
>;

export type InferRouteParams<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> = TConfig1 extends { pathname: infer TPath1 }
  ? TConfig2 extends { pathname: infer TPath2 }
    ? GetRouteParams<[TPath1, TPath2]>
    : GetRouteParams<[TConfig1["pathname"]]>
  : GetRouteParams<[TConfig2["pathname"]]>;

export type InferRequestData<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig = {},
> = z.input<Overwrite<TConfig1, TConfig2, "validateRequest", ZodType, unknown>>;

export type InferSearch<
  TConfig1 extends RequestConfig,
  TConfig2 extends RequestConfig,
> = z.input<Overwrite<TConfig1, TConfig2, "validateSearch", ZodType, unknown>>;

export type Overwrite<
  TConfig1,
  TConfig2,
  Key extends keyof TConfig1 | keyof TConfig2,
  Ref,
  Fallback = never,
> = TConfig2 extends { [_ in Key]: Ref }
  ? TConfig2[Key]
  : TConfig1 extends { [_ in Key]: Ref }
    ? TConfig1[Key]
    : Fallback;

export type YajlibError =
  | {
      type: "SERVER_ERROR";
      status: number;
      error: any;
      parseError?: ZodError;
    }
  | {
      type: "PARSE_ERROR";
      error: ZodError;
      target: "data" | "search";
    }
  | { type: "RUNTIME_ERROR"; error: Error };

export type SendArgs<TConfig, TProps extends RequestConfig> = {
  [K in keyof TProps as keyof TProps[K] extends never ? never : K]: TProps[K];
} extends infer TFiltered
  ? keyof TFiltered extends never
    ? [config?: TConfig]
    : [config: TConfig & TFiltered]
  : never;

type GetRouteParams<T extends unknown[]> =
  ExtractRouteParams<T> extends infer P
    ? keyof P extends never
      ? Record<string, Resolvable<string | number>>
      : Partial<P>
    : never;

type MergeConfigs<T1 extends RequestConfig, T2 extends RequestConfig> =
  FieldMerges<T1, T2> extends infer T
    ? {
        [K in keyof T1 | keyof T2]: K extends keyof T
          ? T[K]
          : K extends keyof T2
            ? T2[K]
            : K extends keyof T1
              ? T1[K]
              : never;
      }
    : never;

type ConcatPathnames<T extends unknown[]> = T extends [infer F, ...infer R]
  ? string extends F
    ? ConcatPathnames<R>
    : F extends string
      ? RemoveOuterSlashes<F> extends ""
        ? ConcatPathnames<R>
        : `/${RemoveOuterSlashes<F>}${ConcatPathnames<R>}`
      : ConcatPathnames<R>
  : "";

type ExtractRouteParams<T extends unknown[]> = T extends [infer F, ...infer R]
  ? F extends `${string}{${infer Param}}${infer P}`
    ? Merge<
        { [K in Param]: Resolvable<string | number> },
        ExtractRouteParams<[P, ...R]>
      >
    : ExtractRouteParams<R>
  : {};

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

type RemoveOuterSlashes<T> = RemoveRightSlash<RemoveLeftSlash<T>>;

type RemoveLeftSlash<T> = T extends `/${infer P}` ? RemoveLeftSlash<P> : T;

type RemoveRightSlash<T> = T extends `${infer P}/` ? RemoveRightSlash<P> : T;
