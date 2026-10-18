import type { StandardSchemaV1 } from "./lib/index";
import { yajlib } from "./lib/index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const assert = <T extends true>() => {};

// A tiny hand-rolled Standard Schema so no schema library (with its own TS floor) is involved.
function schema<I, O = I>(map: (x: unknown) => O): StandardSchemaV1<I, O> {
  return {
    "~standard": {
      version: 1,
      vendor: "x",
      validate: (v) => ({ value: map(v) }),
    },
  };
}
const base = { baseUrl: "https://x.test" } as const;

export async function matrix() {
  // response inference (schema + function parser)
  const a = await yajlib({
    ...base,
    parseResponse: schema<unknown, { ok: boolean }>((x) => x as any),
  }).send();
  assert<Equal<typeof a, { ok: boolean }>>();
  const b = await yajlib({
    ...base,
    parseResponse: async (raw: unknown) => ({ tag: String(raw) }),
  }).send();
  assert<Equal<typeof b, { tag: string }>>();

  // required / optional request data
  const req = yajlib({
    ...base,
    method: "POST",
    parseRequest: schema<{ n: number }>((x) => x as any),
  });
  const opt = yajlib({
    ...base,
    method: "POST",
    parseRequest: schema<{ n: number } | undefined>((x) => x as any),
  });
  // @ts-expect-error data is required
  await req.send();
  await req.send({ data: { n: 1 } });
  await opt.send();
  // @ts-expect-error wrong type
  await req.send({ data: { n: "x" } });

  // route params across extend + send
  const r = yajlib({ ...base, pathname: "/u/{id}/p/{pid}" });
  // @ts-expect-error
  await r.send({ params: { id: 1 } });
  await r.extend({ params: { id: 1 } }).send({ params: { pid: 2 } });

  // data forbidden on GET
  // @ts-expect-error
  await yajlib(base).send({ data: 1 });
  await yajlib(base).send({ method: "POST", data: 1 });

  // config-level search with partial + function values
  yajlib({
    ...base,
    parseSearch: schema<{ page: number; q: string }>((x) => x as any),
    search: { page: () => 1 },
  });
}
