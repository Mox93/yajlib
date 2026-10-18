import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AnyYajlibError,
  InferResponse,
  ParseError,
  ParseFn,
  Parser,
  ParseTarget,
  RequestConfig,
  StandardSchemaV1,
} from "../src/index";
import * as lib from "../src/index";

describe("public API surface", () => {
  it("exports exactly these runtime values (anything else is a leak)", () => {
    expect(Object.keys(lib).sort()).toEqual([
      "RequestBuilder",
      "YajlibError",
      "YajlibParseError",
      "YajlibRuntimeError",
      "YajlibServerError",
      "isYajlibError",
      "yajlib",
    ]);
  });

  it("exports the documented types", () => {
    // Compile-time only: the `import type` above fails `tsc` if any name disappears.
    expectTypeOf<RequestConfig>().toBeObject();
    expectTypeOf<ParseTarget>().toEqualTypeOf<
      "search" | "request" | "response"
    >();
    expectTypeOf<ParseError["issues"]>().toEqualTypeOf<
      ReadonlyArray<StandardSchemaV1.Issue>
    >();
    expectTypeOf<ParseFn<string, number>>().toEqualTypeOf<
      (input: string) => number | Promise<number>
    >();
    expectTypeOf<Parser<string, number>>().toExtend<
      StandardSchemaV1<string, number> | ParseFn<string, number>
    >();
    expectTypeOf<AnyYajlibError["type"]>().toEqualTypeOf<
      "SERVER_ERROR" | "PARSE_ERROR" | "RUNTIME_ERROR"
    >();
  });

  it("lets users derive a builder's response type", () => {
    const api = lib.yajlib({
      baseUrl: "https://x.test",
      parseResponse: (r: unknown) => ({ id: Number(r) }),
    });
    type Response = InferResponse<typeof api.config>["Output"];
    expectTypeOf<Response>().toEqualTypeOf<{ id: number }>();
  });
});
