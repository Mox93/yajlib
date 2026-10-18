import { describe, expect, it } from "vitest";
import {
  concatPathname,
  isEmpty,
  isVoid,
  mergeConfigs,
  VOID_METHODS,
} from "../src/core";

describe("isEmpty / isVoid", () => {
  it("treats undefined, null and empty string as empty", () => {
    for (const v of [undefined, null, ""]) expect(isEmpty(v)).toBe(true);
  });

  it("does not treat falsy-but-meaningful values as empty", () => {
    for (const v of [0, false, "0", [], {}]) expect(isEmpty(v)).toBe(false);
  });

  it("knows which methods carry no body", () => {
    expect(VOID_METHODS).toEqual(["GET", "HEAD", "OPTIONS"]);
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(isVoid(m)).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"])
      expect(isVoid(m)).toBe(false);
  });
});

describe("concatPathname", () => {
  it.each([
    [["/api", "/users"], "/api/users"],
    [["api", "users"], "/api/users"],
    [["/api/", "/users/"], "/api/users"],
    [["//api//", "///users///"], "/api/users"],
    [[undefined, "/users"], "/users"],
    [["/api", undefined], "/api"],
    [[undefined, undefined], ""],
    [["", "/x"], "/x"],
    [["/a/{id}", "/b/{pid}"], "/a/{id}/b/{pid}"],
  ])("%j -> %j", (parts, expected) => {
    expect(concatPathname(...(parts as (string | undefined)[]))).toBe(expected);
  });
});

describe("mergeConfigs", () => {
  const parent = {
    baseUrl: "https://x.test",
    pathname: "/api",
    headers: { Authorization: "Bearer a", "X-Keep": "1" },
    search: { page: 1, q: "a" },
    params: { id: 1 },
  };

  describe("replaceable fields", () => {
    it("lets the child replace the parent", () => {
      const merged: any = mergeConfigs(
        { method: "GET", baseUrl: "https://a.test", silent: false },
        { method: "POST", baseUrl: "https://b.test", silent: true },
      );
      expect(merged).toMatchObject({
        method: "POST",
        baseUrl: "https://b.test",
        silent: true,
      });
    });

    it("falls back to the parent when the child value is empty", () => {
      const merged: any = mergeConfigs(
        { baseUrl: "https://a.test", method: "GET" },
        { baseUrl: "", method: undefined },
      );
      expect(merged.baseUrl).toBe("https://a.test");
      expect(merged.method).toBe("GET");
    });

    it("keeps falsy-but-meaningful child values", () => {
      const merged: any = mergeConfigs({ silent: true }, { silent: false });
      expect(merged.silent).toBe(false);
    });

    it("carries parsers and data through", () => {
      const parseResponse = (x: unknown) => x;
      const merged: any = mergeConfigs({ parseResponse }, { data: { a: 1 } });
      expect(merged.parseResponse).toBe(parseResponse);
      expect(merged.data).toEqual({ a: 1 });
    });
  });

  describe("mergeable records (params, search, headers)", () => {
    it("merges key by key, child wins", () => {
      const merged: any = mergeConfigs(parent, {
        headers: { Authorization: "Bearer b", "X-New": "2" },
        search: { q: "b", extra: true },
        params: { pid: 2 },
      });
      expect(merged.headers).toEqual({
        Authorization: "Bearer b",
        "X-Keep": "1",
        "X-New": "2",
      });
      expect(merged.search).toEqual({ page: 1, q: "b", extra: true });
      expect(merged.params).toEqual({ id: 1, pid: 2 });
    });

    it.each([null, "", undefined])(
      "an empty child value (%j) does not override the parent",
      (empty) => {
        const merged: any = mergeConfigs(parent, {
          headers: { Authorization: empty as any },
        });
        expect(merged.headers.Authorization).toBe("Bearer a");
      },
    );

    it("skips empty child-only keys", () => {
      const merged: any = mergeConfigs(parent, {
        headers: { C: null, D: "" },
      });
      expect(merged.headers).toEqual(parent.headers);
    });

    it("skips empty values when only one side has the record", () => {
      const a: any = mergeConfigs({}, { headers: { A: "1", B: null } });
      const b: any = mergeConfigs({ headers: { A: "1", B: null } }, {});
      expect(a.headers).toEqual({ A: "1" });
      expect(b.headers).toEqual({ A: "1" });
    });

    it("omits a record neither side has", () => {
      const merged: any = mergeConfigs({ baseUrl: "x" }, { method: "GET" });
      expect("headers" in merged).toBe(false);
      expect("search" in merged).toBe(false);
      expect("params" in merged).toBe(false);
    });

    it("keeps function values untouched", () => {
      const token = () => "t";
      const merged: any = mergeConfigs(
        {},
        { headers: { Authorization: token } },
      );
      expect(merged.headers.Authorization).toBe(token);
    });

    it("never mutates its inputs", () => {
      const h = { A: "1" };
      const s = { A: "2" };
      const merged: any = mergeConfigs({ headers: h }, { headers: s });
      merged.headers.Z = "z";
      expect(h).toEqual({ A: "1" });
      expect(s).toEqual({ A: "2" });
    });
  });

  describe("pathname", () => {
    it("concatenates and normalises", () => {
      expect(
        (mergeConfigs(parent, { pathname: "/users/" }) as any).pathname,
      ).toBe("/api/users");
    });

    it("is an empty string when neither side has one", () => {
      expect((mergeConfigs({}, {}) as any).pathname).toBe("");
    });
  });

  it("drops keys outside RequestConfig", () => {
    const merged: any = mergeConfigs(
      { baseUrl: "x", tag: 1 } as any,
      { other: 2 } as any,
    );
    expect("tag" in merged).toBe(false);
    expect("other" in merged).toBe(false);
  });
});
