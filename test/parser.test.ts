import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isStandardSchema, runParser } from "../src/parser";

describe("isStandardSchema", () => {
  it("recognises schemas from different libraries", () => {
    expect(isStandardSchema(z.string())).toBe(true);
    expect(isStandardSchema(v.string())).toBe(true);
    expect(isStandardSchema(type("string"))).toBe(true);
  });

  it("rejects plain functions and non-objects", () => {
    expect(isStandardSchema((x: unknown) => x)).toBe(false);
    for (const x of [null, undefined, 1, "s", {}])
      expect(isStandardSchema(x)).toBe(false);
  });
});

describe("runParser with Standard Schema libraries", () => {
  const cases = {
    zod: z.object({ n: z.string().transform(Number) }),
    valibot: v.object({ n: v.pipe(v.string(), v.transform(Number)) }),
    arktype: type({ n: "string" }).pipe((o) => ({ n: Number(o.n) })),
  };

  for (const [name, schema] of Object.entries(cases)) {
    describe(name, () => {
      it("returns transformed data on success", async () => {
        expect(await runParser(schema as any, { n: "5" })).toEqual({
          success: true,
          data: { n: 5 },
        });
      });

      it("returns library-neutral issues on failure", async () => {
        const result = await runParser(schema as any, { n: 5 });
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.issues.length).toBeGreaterThan(0);
        for (const issue of result.error.issues)
          expect(typeof issue.message).toBe("string");
      });
    });
  }

  it("supports async schemas", async () => {
    const schema = z.string().refine(async (s) => s.length > 2);
    expect((await runParser(schema, "abc")).success).toBe(true);
    expect((await runParser(schema, "a")).success).toBe(false);
  });

  it("reports issue paths", async () => {
    const result = await runParser(
      z.object({ a: z.object({ b: z.number() }) }),
      {
        a: { b: "x" },
      },
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]!.path).toEqual(["a", "b"]);
  });
});

describe("runParser with custom functions", () => {
  it("accepts sync functions", async () => {
    expect(await runParser((x) => String(x).toUpperCase(), "a")).toEqual({
      success: true,
      data: "A",
    });
  });

  it("accepts async functions", async () => {
    expect(await runParser(async (x) => ({ wrapped: x }), 1)).toEqual({
      success: true,
      data: { wrapped: 1 },
    });
  });

  it("passes undefined through to the function", async () => {
    expect(await runParser((x) => x === undefined, undefined)).toEqual({
      success: true,
      data: true,
    });
  });

  it("converts a thrown Error into issues and keeps it as the cause", async () => {
    const boom = new Error("boom");
    const result = await runParser(() => {
      throw boom;
    }, 1);
    expect(result).toEqual({
      success: false,
      error: { issues: [{ message: "boom" }], cause: boom },
    });
  });

  it("converts a rejected promise the same way", async () => {
    const result = await runParser(async () => {
      throw new Error("later");
    }, 1);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([{ message: "later" }]);
  });

  it("stringifies non-Error throws", async () => {
    const result = await runParser(() => {
      throw "plain string";
    }, 1);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual([{ message: "plain string" }]);
  });

  it("reuses `issues` from a thrown schema error (e.g. zod.parse inside a custom parser)", async () => {
    const result = await runParser((x) => z.number().parse(x), "nope");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeGreaterThan(0);
    expect(result.error.cause).toBeInstanceOf(z.ZodError);
  });
});
