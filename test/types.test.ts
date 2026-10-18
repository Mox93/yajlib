import { type } from "arktype";
import * as v from "valibot";
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { yajlib } from "../src/builder";
import { mergeConfigs } from "../src/core";
import { isYajlibError, type AnyYajlibError } from "../src/errors";

/*
 * These tests are checked by `tsc` (via vitest's typecheck mode) and never run.
 * `// @ts-expect-error` means "this MUST NOT compile"; an unused directive fails the test.
 */

const base = { baseUrl: "https://x.test" } as const;

describe("response inference", () => {
  it("infers the parser output, across libraries and custom functions", async () => {
    const zod = await yajlib({
      ...base,
      parseResponse: z.object({ ok: z.boolean() }),
    }).send();
    expectTypeOf(zod).toEqualTypeOf<{ ok: boolean }>();

    const valibot = await yajlib({
      ...base,
      parseResponse: v.object({ a: v.string() }),
    }).send();
    expectTypeOf(valibot).toEqualTypeOf<{ a: string }>();

    const arktype = await yajlib({
      ...base,
      parseResponse: type({ a: "number" }),
    }).send();
    expectTypeOf(arktype).toEqualTypeOf<{ a: number }>();

    const fn = await yajlib({
      ...base,
      parseResponse: async (raw: unknown) => ({ tag: String(raw) }),
    }).send();
    expectTypeOf(fn).toEqualTypeOf<{ tag: string }>();
  });

  it("uses the transformed output, not the input", async () => {
    const r = await yajlib({
      ...base,
      parseResponse: z.object({ n: z.string().transform(Number) }),
    }).send();
    expectTypeOf(r).toEqualTypeOf<{ n: number }>();
  });

  it("is `any` without a parser", async () => {
    expectTypeOf(await yajlib(base).send()).toBeAny();
  });

  it("follows extend() and send()-time overrides", async () => {
    const api = yajlib({
      ...base,
      parseResponse: z.object({ ok: z.boolean() }),
    });
    expectTypeOf(
      await api.extend({ parseResponse: z.object({ n: z.number() }) }).send(),
    ).toEqualTypeOf<{ n: number }>();
    expectTypeOf(
      await yajlib(base).send({ parseResponse: z.string() }),
    ).toEqualTypeOf<string>();
    expectTypeOf(await api.send({})).toEqualTypeOf<{ ok: boolean }>();
  });
});

describe("request data: required / optional / none", () => {
  const optional = yajlib({
    ...base,
    method: "POST",
    parseRequest: z.object({ n: z.number() }).optional(),
  });
  const required = yajlib({
    ...base,
    method: "POST",
    parseRequest: z.object({ n: z.number() }),
  });
  const none = yajlib({ ...base, method: "POST" });
  const union = yajlib({
    ...base,
    method: "POST",
    parseRequest: z.union([
      z.object({ a: z.string() }),
      z.object({ b: z.number() }),
    ]),
  });

  it("is optional when the parser accepts undefined, and still typed", async () => {
    await optional.send();
    await optional.send({ data: { n: 1 } });
    // @ts-expect-error typed when provided
    await optional.send({ data: { n: "x" } });
  });

  it("is required otherwise", async () => {
    // @ts-expect-error
    await required.send();
    await required.send({ data: { n: 1 } });
    // @ts-expect-error
    await required.send({ data: { n: "x" } });
  });

  it("stays required for unions with no shared keys", async () => {
    // @ts-expect-error
    await union.send();
    await union.send({ data: { b: 1 } });
  });

  it("is free-form without a parser", async () => {
    await none.send();
    await none.send({ data: { anything: 1 } });
  });

  it("uses the input type (pre-transform) for callers", async () => {
    const api = yajlib({
      ...base,
      method: "POST",
      parseRequest: z.object({ n: z.string().transform(Number) }),
    });
    await api.send({ data: { n: "5" } });
    // @ts-expect-error the caller passes the INPUT type
    await api.send({ data: { n: 5 } });
  });

  it("supports a parser provided at send time", async () => {
    await none.send({
      parseRequest: z.object({ n: z.number() }),
      data: { n: 1 },
    });
    // @ts-expect-error data becomes required
    await none.send({ parseRequest: z.object({ n: z.number() }) });
  });
});

describe("search: required / optional / none", () => {
  const optional = yajlib({
    ...base,
    parseSearch: z.object({ page: z.number() }).optional(),
  });
  const required = yajlib({
    ...base,
    parseSearch: z.object({ page: z.number() }),
  });
  const optionalFn = yajlib({
    ...base,
    parseSearch: (i?: { page: number }) => ({ page: String(i?.page ?? 1) }),
  });
  const requiredFn = yajlib({
    ...base,
    parseSearch: (i: { page: number }) => ({ page: String(i.page) }),
  });
  const defaulted = yajlib({
    ...base,
    parseSearch: z.object({ page: z.number().default(1) }).default({ page: 1 }),
  });

  it("is optional when the parser accepts undefined", async () => {
    await optional.send();
    await optional.send({ search: { page: 2 } });
    await optionalFn.send();
    await defaulted.send();
    // @ts-expect-error typed when provided
    await optional.send({ search: { page: "2" } });
  });

  it("is required otherwise", async () => {
    // @ts-expect-error
    await required.send();
    // @ts-expect-error
    await requiredFn.send();
    await required.send({ search: { page: 1 } });
  });

  it("is free-form without a parser", async () => {
    await yajlib({ ...base, search: { a: 1, b: () => "x" } }).send({
      search: { c: 3 },
    });
  });

  it("supports a parser provided at send time", async () => {
    await yajlib(base).send({
      parseSearch: z.object({ a: z.string() }),
      search: { a: "x" },
    });
    // @ts-expect-error search becomes required
    await yajlib(base).send({ parseSearch: z.object({ a: z.string() }) });
  });
});

describe("config-level search", () => {
  const parser = z.object({ page: z.number(), q: z.string() });

  it("accepts partial and function values, and rejects wrong types", () => {
    yajlib({ ...base, parseSearch: parser, search: { page: 1 } });
    yajlib({ ...base, parseSearch: parser, search: { page: () => 1 } });
    yajlib({ ...base, parseSearch: parser, search: { page: 1, q: "a" } });
    // @ts-expect-error
    yajlib({ ...base, parseSearch: parser, search: { page: "x" } });
  });

  it("applies the same rules through extend()", () => {
    const api = yajlib({ ...base, parseSearch: parser });
    api.extend({ search: { page: 1 } });
    api.extend({ search: { page: () => 1 } });
    // @ts-expect-error
    api.extend({ search: { page: "x" } });
  });
});

describe("route params", () => {
  const route = yajlib({ ...base, pathname: "/u/{id}/p/{pid}" });

  it("requires every placeholder at send time", async () => {
    // @ts-expect-error
    await route.send();
    // @ts-expect-error pid missing
    await route.send({ params: { id: 1 } });
    await route.send({ params: { id: 1, pid: 2 } });
    await route.send({ params: { id: "a", pid: () => 2 } });
  });

  it("counts params supplied by earlier layers", async () => {
    await route.extend({ params: { id: 1 } }).send({ params: { pid: 2 } });
    await route.extend({ params: { id: 1, pid: 2 } }).send();
    await yajlib({ ...route.config, params: { id: 1, pid: 2 } }).send();
    // @ts-expect-error pid still missing
    await route.extend({ params: { id: 1 } }).send();
  });

  it("follows pathname segments added by extend()", async () => {
    const api = yajlib({ ...base, pathname: "/u" }).extend({
      pathname: "/{id}",
    });
    // @ts-expect-error
    await api.send();
    await api.send({ params: { id: 3 } });
  });

  it("accepts params alongside optional data, and keeps the rest required", async () => {
    const api = yajlib({
      ...base,
      pathname: "/u/{id}",
      method: "POST",
      parseRequest: z.string().optional(),
      parseSearch: z.object({ q: z.string() }),
    });
    await api.send({ params: { id: 1 }, search: { q: "a" } });
    await api.send({ params: { id: 1 }, search: { q: "a" }, data: "s" });
    // @ts-expect-error
    await api.send();
    // @ts-expect-error
    await api.send({ params: { id: 1 } });
    // @ts-expect-error
    await api.send({ search: { q: "a" } });
  });

  it("rejects params when the route has no placeholders", async () => {
    // @ts-expect-error
    yajlib({ ...base, pathname: "/u", params: { id: 1 } });
    // @ts-expect-error
    yajlib({ ...base, params: { id: 1 } });
    // @ts-expect-error
    await yajlib({ ...base, pathname: "/u" }).send({ params: { id: 1 } });
  });

  it("accepts a placeholder at config level", () => {
    yajlib({ ...base, pathname: "/u/{id}", params: { id: 1 } });
    yajlib({ ...base, pathname: "/u/{id}", params: { id: () => 1 } });
  });

  it("tolerates a non-literal pathname", () => {
    const dynamic: string = `/u/${Math.random()}`;
    yajlib({ ...base, pathname: dynamic });
  });
});

describe("data on bodyless methods", () => {
  it("is forbidden on GET (explicit or default), HEAD and OPTIONS", async () => {
    // @ts-expect-error default method is GET
    await yajlib(base).send({ data: 1 });
    // @ts-expect-error
    yajlib({ ...base, method: "GET", data: 1 });
    // @ts-expect-error
    yajlib({ ...base, method: "HEAD", data: 1 });
    // @ts-expect-error
    yajlib({ ...base, method: "OPTIONS", data: 1 });
  });

  it("is allowed on body methods", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const)
      yajlib({ ...base, method, data: 1 });
  });

  it("follows the method as it is overridden by send() and extend()", async () => {
    await yajlib(base).send({ method: "POST", data: { a: 1 } });
    await yajlib(base).extend({ method: "PUT" }).send({ data: 1 });
    // @ts-expect-error base POST, send switches back to GET
    await yajlib({ ...base, method: "POST" }).send({ method: "GET", data: 1 });
    // @ts-expect-error
    yajlib({ ...base, method: "POST" }).extend({ method: "GET", data: 1 });
  });

  it("never demands data on GET, even with a required request parser", async () => {
    await yajlib({ ...base, parseRequest: z.object({ n: z.number() }) }).send();
  });
});

describe("mergeConfigs result type", () => {
  it("child wins for replaceable fields", () => {
    const merged = mergeConfigs(
      { method: "GET", baseUrl: "https://a" } as const,
      { method: "POST" } as const,
    );
    expectTypeOf(merged.method).toEqualTypeOf<"POST">();
    expectTypeOf(merged.baseUrl).toEqualTypeOf<"https://a">();
  });

  it("concatenates pathnames at the type level", () => {
    const merged = mergeConfigs(
      { pathname: "/api" } as const,
      { pathname: "/users/" } as const,
    );
    expectTypeOf(merged.pathname).toEqualTypeOf<"/api/users">();
  });

  it("merges records key by key", () => {
    const merged = mergeConfigs(
      { headers: { A: "1", B: "2" } } as const,
      { headers: { B: "3", C: "4" } } as const,
    );
    expectTypeOf(merged.headers.A).toEqualTypeOf<"1">();
    expectTypeOf(merged.headers.B).toEqualTypeOf<"3">();
    expectTypeOf(merged.headers.C).toEqualTypeOf<"4">();
  });
});

describe("errors", () => {
  it("narrows by `type` after isYajlibError", () => {
    const handle = (e: unknown) => {
      if (!isYajlibError(e)) return;
      expectTypeOf(e).toEqualTypeOf<AnyYajlibError>();
      switch (e.type) {
        case "SERVER_ERROR":
          expectTypeOf(e.status).toBeNumber();
          break;
        case "PARSE_ERROR":
          expectTypeOf(e.target).toEqualTypeOf<
            "search" | "request" | "response"
          >();
          break;
        case "RUNTIME_ERROR":
          expectTypeOf(e.error).toBeUnknown();
          break;
      }
    };
    void handle;
  });
});

/**
 * KNOWN ISSUES
 * Each block pins today's behaviour. When you fix the issue the pin fails,
 * which is your cue to flip it into the assertion described in the comment.
 */
describe("known issues", () => {
  it("send-time pathname together with its params should compile (it does not)", async () => {
    // FIXME: expected to compile. Remove the directive once fixed.
    // @ts-expect-error KNOWN ISSUE
    await yajlib(base).send({ pathname: "/x/{a}", params: { a: 1 } });
  });

  it("unknown route param keys should be rejected (they are accepted)", async () => {
    // FIXME: both should be `@ts-expect-error`.
    yajlib({ ...base, pathname: "/u/{id}", params: { nope: 1 } });
    await yajlib({ ...base, pathname: "/u/{id}" }).send({
      params: { id: 1, nope: 2 },
    });
  });

  it("a send-time route without its params should be rejected (it is accepted)", async () => {
    // FIXME: should be `@ts-expect-error`.
    await yajlib(base).send({ pathname: "/x/{a}" });
  });

  it("search/data already supplied by the config should satisfy send() (they do not)", async () => {
    // FIXME: both should compile without arguments.
    await yajlib({
      ...base,
      parseSearch: z.object({ page: z.number() }),
      search: { page: 1 },
      // @ts-expect-error KNOWN ISSUE
    }).send();
    await yajlib({
      ...base,
      method: "POST",
      parseRequest: z.object({ n: z.number() }),
      data: { n: 1 },
      // @ts-expect-error KNOWN ISSUE
    }).send();
  });
});
