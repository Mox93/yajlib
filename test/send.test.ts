import * as v from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { yajlib } from "../src/builder";
import {
  isYajlibError,
  YajlibParseError,
  YajlibRuntimeError,
  YajlibServerError,
} from "../src/errors";
import { BASE, json, mockFetch, text, thrown } from "./shared";

let net: ReturnType<typeof mockFetch>;
beforeEach(() => {
  net = mockFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("request basics", () => {
  it("defaults to GET and returns the JSON body", async () => {
    net.respondWith(() => json({ hello: "world" }));
    const result = await yajlib({ baseUrl: BASE }).send();
    expect(net.last().method).toBe("GET");
    expect(net.last().url).toBe(`${BASE}/`);
    expect(result).toEqual({ hello: "world" });
  });

  it("accepts a URL object as baseUrl", async () => {
    await yajlib({ baseUrl: new URL(`${BASE}/v1`) }).send();
    expect(net.last().url).toBe(`${BASE}/v1`);
  });

  it("joins baseUrl path and pathname", async () => {
    await yajlib({ baseUrl: `${BASE}/v1/`, pathname: "/users/" }).send();
    expect(net.last().url).toBe(`${BASE}/v1/users`);
  });

  it("forwards method and abort signal", async () => {
    const controller = new AbortController();
    await yajlib({
      baseUrl: BASE,
      method: "DELETE",
      signal: controller.signal,
    }).send();
    expect(net.last().method).toBe("DELETE");
    expect(net.last().signal).toBe(controller.signal);
  });
});

describe("route params", () => {
  it("substitutes and encodes", async () => {
    await yajlib({ baseUrl: BASE, pathname: "/u/{id}" }).send({
      params: { id: "a b/c" },
    });
    expect(net.last().url).toBe(`${BASE}/u/a%20b%2Fc`);
  });

  it("accepts numbers and resolves functions", async () => {
    await yajlib({ baseUrl: BASE, pathname: "/u/{id}/p/{pid}" }).send({
      params: { id: 7, pid: () => 9 },
    });
    expect(net.last().url).toBe(`${BASE}/u/7/p/9`);
  });

  it("leaves a placeholder in place when its param is empty", async () => {
    await (yajlib({ baseUrl: BASE, pathname: "/u/{id}" }) as any).send({
      params: { id: null },
    });
    expect(decodeURIComponent(net.last().url)).toBe(`${BASE}/u/{id}`);
  });

  it("fills params from base config, extend and send, each layer adding keys", async () => {
    const api = yajlib({
      baseUrl: BASE,
      pathname: "/a/{a}/b/{b}/c/{c}",
      params: { a: 1 },
    }).extend({
      params: { b: 2 },
    });
    await api.send({ params: { c: 3 } });
    expect(net.last().url).toBe(`${BASE}/a/1/b/2/c/3`);
  });

  it("supports a pathname contributed by extend()", async () => {
    await yajlib({ baseUrl: `${BASE}/v1`, pathname: "/u" })
      .extend({ pathname: "/{id}", params: { id: 3 } })
      .send();
    expect(net.last().url).toBe(`${BASE}/v1/u/3`);
  });

  it("supports a pathname contributed at send time", async () => {
    await (yajlib({ baseUrl: BASE }) as any).send({
      pathname: "/x/{a}",
      params: { a: 1 },
    });
    expect(net.last().url).toBe(`${BASE}/x/1`);
  });
});

describe("search params", () => {
  it("serialises arrays, resolves functions and skips empty values", async () => {
    await yajlib({
      baseUrl: BASE,
      search: {
        a: [1, 2],
        b: () => "z",
        c: "",
        d: null,
        e: undefined,
        f: 0,
        g: false,
      },
    }).send();
    expect(new URL(net.last().url).searchParams.toString()).toBe(
      "a=1&a=2&b=z&f=0&g=false",
    );
  });

  it("merges base, extend and send layers", async () => {
    await yajlib({ baseUrl: BASE, search: { a: 1, b: 1 } })
      .extend({ search: { b: 2, c: 2 } })
      .send({ search: { c: 3, d: 3 } });
    expect(new URL(net.last().url).searchParams.toString()).toBe(
      "a=1&b=2&c=3&d=3",
    );
  });

  it("runs parseSearch and uses its output", async () => {
    await yajlib({
      baseUrl: BASE,
      parseSearch: z.object({ page: z.number().transform((n) => n + 1) }),
    }).send({ search: { page: 1 } });
    expect(net.last().url).toBe(`${BASE}/?page=2`);
  });

  it("applies parser defaults when search is omitted", async () => {
    await yajlib({
      baseUrl: BASE,
      parseSearch: z
        .object({ page: z.number().default(1) })
        .default({ page: 1 }),
    }).send();
    expect(net.last().url).toBe(`${BASE}/?page=1`);
  });

  it("does not add a query for an optional parser given nothing", async () => {
    await yajlib({
      baseUrl: BASE,
      parseSearch: z.object({ q: z.string() }).optional(),
    }).send();
    expect(net.last().url).toBe(`${BASE}/`);
  });

  it("resolves function values before handing them to the parser", async () => {
    // `as any`: send() still demands `search` even though the config supplies it
    // (see "known issues" in types.test-d.ts).
    const api: any = yajlib({
      baseUrl: BASE,
      parseSearch: z.object({ page: z.number() }),
      search: { page: () => 4 },
    });
    await api.send();
    expect(net.last().url).toBe(`${BASE}/?page=4`);
  });

  it("works with a plain function parser", async () => {
    await yajlib({
      baseUrl: BASE,
      parseSearch: (i: { page: number }) => ({ page: String(i.page * 2) }),
    }).send({ search: { page: 5 } });
    expect(net.last().url).toBe(`${BASE}/?page=10`);
  });

  it("throws a search PARSE_ERROR and never calls fetch", async () => {
    const api: any = yajlib({
      baseUrl: BASE,
      parseSearch: z.object({ q: z.string() }),
    });
    const error = await thrown<YajlibParseError>(
      api.send({ search: { q: 1 } }),
    );
    expect(error).toBeInstanceOf(YajlibParseError);
    expect(error.target).toBe("search");
    expect(error.error.issues.length).toBeGreaterThan(0);
    expect(net.calls).toHaveLength(0);
  });

  it("treats missing input as a parse failure when the parser requires it", async () => {
    const api: any = yajlib({
      baseUrl: BASE,
      parseSearch: z.object({ q: z.string() }),
    });
    expect((await thrown<YajlibParseError>(api.send())).target).toBe("search");
  });
});

describe("headers", () => {
  it("resolves functions and skips empty values", async () => {
    await yajlib({
      baseUrl: BASE,
      headers: {
        A: "1",
        B: () => "2",
        C: "",
        D: null,
        E: undefined,
        F: () => null,
      },
    }).send();
    const h = net.last().headers;
    expect([h.get("A"), h.get("B")]).toEqual(["1", "2"]);
    for (const k of ["C", "D", "E", "F"]) expect(h.has(k)).toBe(false);
  });

  it("merges layers, child wins, and an empty child value keeps the parent's", async () => {
    await yajlib({ baseUrl: BASE, headers: { A: "base", B: "base" } })
      .extend({ headers: { B: "ext", C: "ext" } })
      .send({ headers: { C: "send", A: null as any } });
    const h = net.last().headers;
    expect([h.get("A"), h.get("B"), h.get("C")]).toEqual([
      "base",
      "ext",
      "send",
    ]);
  });
});

describe("request body", () => {
  it("sends JSON for objects and sets Content-Type", async () => {
    await yajlib({ baseUrl: BASE, method: "POST" }).send({ data: { a: 1 } });
    expect(net.last().body).toBe('{"a":1}');
    expect(net.last().headers.get("Content-Type")).toBe("application/json");
  });

  it("sends text/plain for strings", async () => {
    await yajlib({ baseUrl: BASE, method: "POST" }).send({ data: "hi" });
    expect(net.last().body).toBe("hi");
    expect(net.last().headers.get("Content-Type")).toBe("text/plain");
  });

  it("respects an explicit Content-Type", async () => {
    await yajlib({
      baseUrl: BASE,
      method: "PUT",
      headers: { "Content-Type": "application/vnd.x+json" },
    }).send({
      data: { a: 1 },
    });
    expect(net.last().headers.get("Content-Type")).toBe(
      "application/vnd.x+json",
    );
  });

  it("passes FormData through and drops Content-Type so the boundary is generated", async () => {
    const fd = new FormData();
    fd.set("a", "1");
    await yajlib({
      baseUrl: BASE,
      method: "POST",
      headers: { "Content-Type": "x/y" },
    }).send({ data: fd });
    expect(net.last().body).toBe(fd);
    expect(net.last().headers.has("Content-Type")).toBe(false);
  });

  it("uses data from config, and lets send() replace it", async () => {
    const api = yajlib({
      baseUrl: BASE,
      method: "POST",
      data: { from: "config" },
    });
    await api.send();
    expect(net.last().body).toBe('{"from":"config"}');
    await api.send({ data: { from: "send" } });
    expect(net.last().body).toBe('{"from":"send"}');
  });

  it("runs parseRequest and sends its output", async () => {
    await yajlib({
      baseUrl: BASE,
      method: "POST",
      parseRequest: z.object({ n: z.string().transform(Number) }),
    }).send({ data: { n: "5" } });
    expect(net.last().body).toBe('{"n":5}');
  });

  it("allows a parser to transform into a non-JSON body", async () => {
    await yajlib({
      baseUrl: BASE,
      method: "POST",
      parseRequest: (s: string) => `<doc>${s}</doc>`,
    }).send({ data: "x" });
    expect(net.last().body).toBe("<doc>x</doc>");
    expect(net.last().headers.get("Content-Type")).toBe("text/plain");
  });

  it("throws a request PARSE_ERROR and never calls fetch", async () => {
    const api: any = yajlib({
      baseUrl: BASE,
      method: "POST",
      parseRequest: z.object({ n: z.number() }),
    });
    const error = await thrown<YajlibParseError>(
      api.send({ data: { n: "x" } }),
    );
    expect(error).toBeInstanceOf(YajlibParseError);
    expect(error.target).toBe("request");
    expect(net.calls).toHaveLength(0);
  });

  it.each(["GET", "HEAD", "OPTIONS"] as const)(
    "logs and drops data on %s",
    async (method) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await (yajlib({ baseUrl: BASE, method }) as any).send({ data: { a: 1 } });
      expect(net.last().body).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String((log.mock.calls[0]![0] as Error).message)).toContain(
        "do not accept a body",
      );
    },
  );

  it("does not log when a bodyless method has no data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await yajlib({ baseUrl: BASE }).send();
    expect(log).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("runs parseResponse (schemas of several libraries) and returns its output", async () => {
    net.respondWith(() => json({ n: "5" }));
    const viaZod = await yajlib({
      baseUrl: BASE,
      parseResponse: z.object({ n: z.string().transform(Number) }),
    }).send();
    const viaValibot = await yajlib({
      baseUrl: BASE,
      parseResponse: v.object({ n: v.pipe(v.string(), v.transform(Number)) }),
    }).send();
    expect(viaZod).toEqual({ n: 5 });
    expect(viaValibot).toEqual({ n: 5 });
  });

  it("supports async custom parsers", async () => {
    net.respondWith(() => json({ tag: "a" }));
    const result = await yajlib({
      baseUrl: BASE,
      parseResponse: async (raw: any) => ({
        upper: String(raw.tag).toUpperCase(),
      }),
    }).send();
    expect(result).toEqual({ upper: "A" });
  });

  it("lets extend() and send() override the response parser", async () => {
    net.respondWith(() => json({ n: 1 }));
    const base = yajlib({
      baseUrl: BASE,
      parseResponse: z.object({ n: z.number() }),
    });
    expect(
      await base.extend({ parseResponse: (r: any) => r.n + 1 }).send(),
    ).toBe(2);
    expect(await base.send({ parseResponse: (r: any) => r.n + 2 })).toBe(3);
  });

  it("throws a response PARSE_ERROR when the body does not match", async () => {
    net.respondWith(() => json({ nope: 1 }));
    const api = yajlib({
      baseUrl: BASE,
      parseResponse: z.object({ ok: z.boolean() }),
    });
    const error = await thrown<YajlibParseError>(api.send());
    expect(error).toBeInstanceOf(YajlibParseError);
    expect(error.target).toBe("response");
    expect(error.error.issues.length).toBeGreaterThan(0);
  });

  it("wraps an unreadable 200 body as a runtime error", async () => {
    net.respondWith(() => text("not json"));
    const error = await thrown<YajlibRuntimeError>(
      yajlib({ baseUrl: BASE }).send(),
    );
    expect(error).toBeInstanceOf(YajlibRuntimeError);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });
});

describe("failures", () => {
  it("throws YajlibServerError with the parsed JSON body", async () => {
    net.respondWith(() => json({ code: "E1" }, 400));
    const error = await thrown<YajlibServerError>(
      yajlib({ baseUrl: BASE }).send(),
    );
    expect(error).toBeInstanceOf(YajlibServerError);
    expect(error.status).toBe(400);
    expect(error.error).toEqual({ code: "E1" });
    expect(error.parseError).toBeUndefined();
  });

  it("keeps non-JSON error bodies as text", async () => {
    net.respondWith(() => text("Bad Gateway", 502));
    const error = await thrown<YajlibServerError>(
      yajlib({ baseUrl: BASE }).send(),
    );
    expect(error.status).toBe(502);
    expect(error.error).toBe("Bad Gateway");
  });

  it("applies parseError and returns its output", async () => {
    net.respondWith(() => json({ code: "E1" }, 400));
    const error = await thrown<YajlibServerError>(
      yajlib({
        baseUrl: BASE,
        parseError: z.object({
          code: z.string().transform((c) => c.toLowerCase()),
        }),
      }).send(),
    );
    expect(error.error).toEqual({ code: "e1" });
    expect(error.parseError).toBeUndefined();
  });

  it("falls back to the raw body and reports parseError when it does not match", async () => {
    net.respondWith(() => json({ code: 5 }, 400));
    const error = await thrown<YajlibServerError>(
      yajlib({
        baseUrl: BASE,
        parseError: z.object({ code: z.string() }),
      }).send(),
    );
    expect(error.error).toEqual({ code: 5 });
    expect(error.parseError?.issues.length).toBeGreaterThan(0);
  });

  it("does not throw for non-2xx when silent, and still parses the body", async () => {
    net.respondWith(() => json({ n: 1 }, 500));
    expect(await yajlib({ baseUrl: BASE, silent: true }).send()).toEqual({
      n: 1,
    });
  });

  it("wraps network failures as YajlibRuntimeError with the cause", async () => {
    const down = new TypeError("network down");
    net.respondWith(() => {
      throw down;
    });
    const error = await thrown<YajlibRuntimeError>(
      yajlib({ baseUrl: BASE }).send(),
    );
    expect(error).toBeInstanceOf(YajlibRuntimeError);
    expect(error.message).toBe("network down");
    expect(error.cause).toBe(down);
  });

  it("only ever throws Yajlib errors", async () => {
    net.respondWith(() => json({}, 500));
    expect(isYajlibError(await thrown(yajlib({ baseUrl: BASE }).send()))).toBe(
      true,
    );
  });

  it("surfaces a custom parser's throw as a PARSE_ERROR with the cause", async () => {
    const boom = new Error("boom");
    const api: any = yajlib({
      baseUrl: BASE,
      parseSearch: () => {
        throw boom;
      },
    });
    const error = await thrown<YajlibParseError>(api.send());
    expect(error.target).toBe("search");
    expect(error.cause).toBe(boom);
    expect(error.error.issues).toEqual([{ message: "boom" }]);
  });
});

describe("builder composition", () => {
  it("exposes the config", () => {
    const config = { baseUrl: BASE, pathname: "/a" } as const;
    expect(yajlib(config).config).toBe(config);
  });

  it("extend() returns a new builder and leaves the parent untouched", async () => {
    const parent = yajlib({ baseUrl: BASE, headers: { A: "1" } });
    const child = parent.extend({ headers: { B: "2" }, method: "POST" });
    expect(child).not.toBe(parent);
    await parent.send();
    expect(net.last().headers.has("B")).toBe(false);
    expect(net.last().method).toBe("GET");
    await child.send();
    expect(net.last().headers.get("B")).toBe("2");
    expect(net.last().method).toBe("POST");
  });

  it("send() config overrides base config without mutating the builder", async () => {
    const api = yajlib({
      baseUrl: BASE,
      method: "GET",
      headers: { A: "base" },
    });
    await api.send({ method: "POST", headers: { A: "send" } });
    expect([net.last().method, net.last().headers.get("A")]).toEqual([
      "POST",
      "send",
    ]);
    await api.send();
    expect([net.last().method, net.last().headers.get("A")]).toEqual([
      "GET",
      "base",
    ]);
  });

  it("chains several extends", async () => {
    await yajlib({ baseUrl: BASE })
      .extend({ pathname: "/v1" })
      .extend({ pathname: "/users" })
      .extend({ pathname: "/{id}", params: { id: 1 } })
      .send();
    expect(net.last().url).toBe(`${BASE}/v1/users/1`);
  });
});

/**
 * KNOWN ISSUES
 * These describe the behaviour we want but the library does not have yet.
 * `it.fails` keeps the suite green while the bug exists and turns RED the moment
 * it is fixed, which is your cue to change `it.fails` into `it`.
 */
describe("known issues", () => {
  it.fails(
    "runs a request parser on omitted data so defaults apply",
    async () => {
      await yajlib({
        baseUrl: BASE,
        method: "POST",
        parseRequest: z.object({ n: z.number() }).default({ n: 9 }),
      }).send();
      expect(net.last().body).toBe('{"n":9}');
    },
  );

  it.fails("parses falsy-but-valid data such as 0", async () => {
    await yajlib({
      baseUrl: BASE,
      method: "POST",
      parseRequest: z.number().transform((n) => n + 1),
    }).send({ data: 0 });
    expect(net.last().body).toBe(1);
  });

  it.fails(
    "reports a missing body as a request PARSE_ERROR when the parser requires one",
    async () => {
      const api: any = yajlib({
        baseUrl: BASE,
        method: "POST",
        parseRequest: z.object({ n: z.number() }),
      });
      expect((await thrown<YajlibParseError>(api.send())).target).toBe(
        "request",
      );
    },
  );
});
