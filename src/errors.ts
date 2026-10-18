import type { ParseError, ParseTarget } from "./parser";

/** Base class for everything `send()` can throw. Use `instanceof YajlibError` or `isYajlibError()`. */
export abstract class YajlibError extends Error {
  abstract readonly type: "SERVER_ERROR" | "PARSE_ERROR" | "RUNTIME_ERROR";
}

/** The server answered with a non-2xx status. */
export class YajlibServerError extends YajlibError {
  readonly type = "SERVER_ERROR";
  override readonly name = "YajlibServerError";

  constructor(
    readonly status: number,
    /** The error body: parsed by `parseError` if it succeeded, raw JSON/text otherwise. */
    readonly error: any,
    /** Set when `parseError` was configured but the body did not match. */
    readonly parseError?: ParseError,
  ) {
    super(`Request failed with status ${status}`);
  }
}

/** A `parseSearch`, `parseRequest` or `parseResponse` hook rejected its input. */
export class YajlibParseError extends YajlibError {
  readonly type = "PARSE_ERROR";
  override readonly name = "YajlibParseError";

  constructor(
    readonly target: ParseTarget,
    readonly error: ParseError,
  ) {
    super(
      `Failed to parse ${target}: ${formatIssues(error.issues)}`,
      error.cause === undefined ? undefined : { cause: error.cause },
    );
  }
}

/** Anything else: network failure, abort, bug in a custom parser's environment, etc. */
export class YajlibRuntimeError extends YajlibError {
  readonly type = "RUNTIME_ERROR";
  override readonly name = "YajlibRuntimeError";

  constructor(readonly error: unknown) {
    super(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

/** The concrete error classes as a union, so `switch (error.type)` narrows. */
export type AnyYajlibError =
  | YajlibServerError
  | YajlibParseError
  | YajlibRuntimeError;

export function isYajlibError(value: unknown): value is AnyYajlibError {
  return value instanceof YajlibError;
}

function formatIssues(issues: ParseError["issues"]) {
  return issues
    .map(({ message, path }) => {
      const where = path
        ?.map((segment) =>
          String(typeof segment === "object" ? segment.key : segment),
        )
        .join(".");
      return where ? `${where}: ${message}` : message;
    })
    .join("; ");
}
