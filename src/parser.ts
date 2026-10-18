import type { StandardSchemaV1 } from "./standard-schema";

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "~standard" in value
  );
}

/** Runs either kind of parser and normalizes the outcome. Never throws. */
export async function runParser<TOutput = unknown>(
  parser: AnyParser,
  input: unknown,
): Promise<ParseResult<TOutput>> {
  try {
    if (isStandardSchema(parser)) {
      const result = await parser["~standard"].validate(input);
      return result.issues
        ? { success: false, error: { issues: result.issues } }
        : { success: true, data: result.value as TOutput };
    }
    return {
      success: true,
      data: (await (parser as ParseFn<any, unknown>)(input)) as TOutput,
    };
  } catch (error) {
    return { success: false, error: toParseError(error) };
  }
}

function toParseError(error: unknown): ParseError {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (Array.isArray(issues)) return { issues, cause: error };
  return {
    issues: [
      { message: error instanceof Error ? error.message : String(error) },
    ],
    cause: error,
  };
}

/** A custom parser: any function that turns input into typed output (or throws). */
export type ParseFn<TInput = unknown, TOutput = TInput> = (
  input: TInput,
) => TOutput | Promise<TOutput>;

/**
 * A parser is either a Standard Schema (Zod, Valibot, ArkType, ...) or a plain
 * function (XML reader, file reader, custom transform, ...).
 */
export type Parser<TInput = unknown, TOutput = TInput> =
  | StandardSchemaV1<TInput, TOutput>
  | ParseFn<TInput, TOutput>;

export type AnyParser = Parser<any, unknown>;

/** Which hook produced a parse failure. Mirrors the `parse*` config keys. */
export type ParseTarget = "search" | "request" | "response";

/** Library-neutral parse failure, structurally compatible with ZodError. */
export interface ParseError {
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
  /** The original thrown value when a custom parser threw. */
  readonly cause?: unknown;
}

export type ParseResult<TOutput> =
  | { success: true; data: TOutput }
  | { success: false; error: ParseError };

/** What the caller passes in. Falls back to `unknown` for function parsers without a typed param. */
export type InferParserInput<TParser> = TParser extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<TParser>
  : TParser extends (input: infer TInput) => unknown
    ? TInput
    : unknown;

/** What the parser produces. */
export type InferParserOutput<TParser> = TParser extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<TParser>
  : TParser extends (...args: any[]) => infer TResult
    ? Awaited<TResult>
    : unknown;
