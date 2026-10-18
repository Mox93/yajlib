import { describe, expect, it } from "vitest";
import {
  isYajlibError,
  YajlibError,
  YajlibParseError,
  YajlibRuntimeError,
  YajlibServerError,
  type AnyYajlibError,
} from "../src/errors";

describe("error classes", () => {
  it("are real Errors with a stack, a name and a discriminant", () => {
    const errors: AnyYajlibError[] = [
      new YajlibServerError(500, { a: 1 }),
      new YajlibParseError("search", { issues: [{ message: "bad" }] }),
      new YajlibRuntimeError(new TypeError("net")),
    ];
    const meta = errors.map((e) => [e.name, e.type]);
    expect(meta).toEqual([
      ["YajlibServerError", "SERVER_ERROR"],
      ["YajlibParseError", "PARSE_ERROR"],
      ["YajlibRuntimeError", "RUNTIME_ERROR"],
    ]);
    for (const e of errors) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(YajlibError);
      expect(typeof e.stack).toBe("string");
      expect(isYajlibError(e)).toBe(true);
    }
  });

  it("isYajlibError rejects everything else", () => {
    for (const x of [
      new Error("x"),
      "s",
      null,
      undefined,
      { type: "SERVER_ERROR" },
    ])
      expect(isYajlibError(x)).toBe(false);
  });

  describe("YajlibServerError", () => {
    it("exposes status, body and parse failure", () => {
      const parseError = { issues: [{ message: "no" }] };
      const e = new YajlibServerError(404, { code: "X" }, parseError);
      expect(e.status).toBe(404);
      expect(e.error).toEqual({ code: "X" });
      expect(e.parseError).toBe(parseError);
      expect(e.message).toBe("Request failed with status 404");
    });
  });

  describe("YajlibParseError", () => {
    it("reports the target and formats issue paths in the message", () => {
      const e = new YajlibParseError("request", {
        issues: [
          { message: "required", path: ["user", "name"] },
          { message: "bad id", path: [{ key: "id" }] },
          { message: "no path" },
        ],
      });
      expect(e.target).toBe("request");
      expect(e.message).toBe(
        "Failed to parse request: user.name: required; id: bad id; no path",
      );
    });

    it("forwards the parser's cause only when there is one", () => {
      const cause = new Error("inner");
      expect(new YajlibParseError("search", { issues: [], cause }).cause).toBe(
        cause,
      );
      expect("cause" in new YajlibParseError("search", { issues: [] })).toBe(
        false,
      );
    });
  });

  describe("YajlibRuntimeError", () => {
    it("wraps an Error, keeping its message and the original as cause", () => {
      const original = new TypeError("network down");
      const e = new YajlibRuntimeError(original);
      expect(e.message).toBe("network down");
      expect(e.cause).toBe(original);
      expect(e.error).toBe(original);
    });

    it("wraps non-Error values", () => {
      expect(new YajlibRuntimeError("oops").message).toBe("oops");
    });
  });

  it("narrows by `type` in a switch", () => {
    const describeError = (e: AnyYajlibError) => {
      switch (e.type) {
        case "SERVER_ERROR":
          return `server ${e.status}`;
        case "PARSE_ERROR":
          return `parse ${e.target}`;
        case "RUNTIME_ERROR":
          return `runtime ${(e.error as Error).message}`;
      }
    };
    expect(describeError(new YajlibServerError(500, null))).toBe("server 500");
    expect(
      describeError(new YajlibParseError("response", { issues: [] })),
    ).toBe("parse response");
    expect(describeError(new YajlibRuntimeError(new Error("x")))).toBe(
      "runtime x",
    );
  });
});
