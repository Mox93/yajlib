# Yajlib

A typed HTTP client with composable, mergeable request configs. Path parameters are enforced at compile time — if your URL template requires a param you haven't supplied, TypeScript will tell you before the code runs.

---

## Quick Start

```ts
import { yajlib } from "yajlib";

const api = yajlib({ baseUrl: "https://api.example.com" });

// GET https://api.example.com/users
const users = await api.send({ pathname: "/users" });

// GET https://api.example.com/users/42
const user = await api.send({
  pathname: "/users/{id}",
  params: { id: 42 },
});
```

---

## Core Concepts

### `yajlib(config)`

Creates a `Yajlib` from a base config. Everything in the config is optional — you can start with just a `baseUrl` and add the rest later.

```ts
const api = yajlib({
  baseUrl: "https://api.example.com",
  headers: { "X-App-Version": "1.0" },
});
```

---

### `handler.extend(config)`

Returns a new `Yajlib` that merges the new config on top of the existing one. The original handler is not mutated.

- Scalar fields (`method`, `baseUrl`, `data`, etc.) — new value wins.
- Record fields (`headers`, `params`, `search`) — merged key-by-key, new value wins on collision.
- `pathname` — concatenated.

```ts
const usersApi = api.extend({ pathname: "/users" });
const userApi = usersApi.extend({ pathname: "/{id}" });
// effective pathname: /users/{id}
```

---

### `handler.send(config?)`

Executes the request. Accepts an optional config that is merged on top of everything accumulated so far. Returns a `Promise` of the response data.

```ts
await api.send({
  method: "POST",
  pathname: "/users",
  data: { name: "Mohamed" },
});
```

**Path param enforcement** — if the merged pathname contains `{param}` placeholders not covered by any `params` object in the chain, TypeScript will require you to supply them in `send`:

```ts
const userApi = api.extend({ pathname: "/users/{id}" });

await userApi.send(); // TS error: params.id is missing
await userApi.send({ params: { id: 1 } }); // OK
```

---

## Config Reference

| Field              | Type                                           | Description                                                                         |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `baseUrl`          | `string \| URL`                                | Base URL for all requests                                                           |
| `pathname`         | `string`                                       | Path appended to `baseUrl`. Supports `{param}` placeholders                         |
| `params`           | `Record<string, Resolvable<string \| number>>` | Values substituted into `{param}` placeholders                                      |
| `method`           | `GET \| POST \| PUT \| PATCH \| DELETE`        | HTTP method. Defaults to `GET`                                                      |
| `headers`          | `Record<string, Resolvable<string>>`           | Request headers                                                                     |
| `search`           | `Record<string, Resolvable<any>>`              | URL search params                                                                   |
| `validateSearch`   | `ZodType`                                      | Zod schema to validate/transform `search` before appending to the URL               |
| `data`             | `unknown \| FormData`                          | Request body. Plain objects are JSON-serialised automatically                       |
| `validateRequest`  | `ZodType`                                      | Zod schema to validate and transform `data` before serialisation. Throws on failure |
| `validateResponse` | `ZodType`                                      | Zod schema to parse the response. Inferred as the return type of `send`             |
| `validateError`    | `ZodType`                                      | Zod schema to parse the `error` field of non-2xx responses                          |
| `signal`           | `AbortSignal`                                  | Passed directly to `fetch` for cancellation                                         |
| `silent`           | `boolean`                                      | If `true`, non-2xx responses do not throw                                           |

---

## Dynamic Values (`Resolvable`)

Any value inside `headers`, `params`, or `search` can be a plain value or a **getter function** `() => T`. The function is called at request time, not at config construction time. This is the correct way to supply values that may change between requests, such as auth tokens or locale.

```ts
const api = yajlib({
  baseUrl: "https://api.example.com",
  headers: {
    Authorization: () => `Bearer ${getToken()}`, // resolved per request
    "Accept-Language": () => i18n.language,
  },
});
```

Getter functions compose safely through `extend` — they are preserved as-is during merging and only called inside `send`.

---

## Response Typing

If `validateResponse` is present in the merged config, the return type of `send` is inferred as `z.infer<typeof validateResponse>`. Without a schema, it falls back to `any`.

```ts
import { z } from "zod";

const validateUser = z.object({ id: z.number(), name: z.string() });

const userApi = api.extend({
  pathname: "/users/{id}",
  validateResponse: validateUser,
});

const user = await userApi.send({ params: { id: 1 } });
//    ^? { id: number; name: string }
```

---

## Error Handling

All errors thrown by `send` carry a `type` symbol that lets you distinguish between failure modes without relying on `instanceof` checks. Import `RequestErrors` for the symbols and `ErrorTypes` for the discriminated union.

```ts
import { yajlib, RequestErrors } from "./index";
import type { ErrorTypes } from "./index";

const { SERVER_ERROR, PARSE_ERROR, RUNTIME_ERROR } = RequestErrors;
```

| `type`          | When it's thrown                                            | Extra fields                                      |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `SERVER_ERROR`  | Response status is not 2xx (and `silent` is not `true`)     | `status: number`, `error: unknown`, `parseError?` |
| `PARSE_ERROR`   | `validateSearch` or `validateRequest` validation fails      | `error: ZodError`, `target: "search" \| "data"`   |
| `RUNTIME_ERROR` | Network failure or any other unexpected throw inside `send` | `error: Error`                                    |

```ts
try {
  await api.send({ pathname: "/protected" });
} catch (e) {
  const err = e as ErrorTypes;

  if (err.type === SERVER_ERROR) {
    console.error(err.status, err.error);
  } else if (err.type === PARSE_ERROR) {
    console.error(`Validation failed on ${err.target}`, err.error);
  } else if (err.type === RUNTIME_ERROR) {
    console.error("Network or unexpected error", err.error);
  }
}
```

If `validateError` is configured, the `error` field of a `SERVER_ERROR` is parsed through it before throwing.

To suppress throwing on non-2xx responses and handle them manually, set `silent: true`.

---

## Recipes

### Base instance with auth

```ts
const api = yajlib({
  baseUrl: "https://api.example.com",
  headers: {
    Authorization: () => `Bearer ${authStore.token}`,
    "Content-Type": "application/json",
  },
});
```

### Resource-scoped handlers

```ts
const usersApi = api.extend({ pathname: "/users" });

const getUser = usersApi.extend({ pathname: "/{id}" });
const createUser = usersApi.extend({ method: "POST" });
const deleteUser = usersApi.extend({ method: "DELETE", pathname: "/{id}" });

await getUser.send({ params: { id: 1 } });
await createUser.send({ data: { name: "Mohamed" } });
await deleteUser.send({ params: { id: 1 } });
```

### Validated request and response

```ts
const CreateUserBody = z.object({ name: z.string().min(1) });

const PaginatedUsers = z.object({
  data: z.array(z.object({ id: z.number(), name: z.string() })),
  total: z.number(),
});

const listUsers = api.extend({
  pathname: "/users",
  validateResponse: PaginatedUsers,
});

const createUser = api.extend({
  method: "POST",
  pathname: "/users",
  validateRequest: CreateUserBody, // validated before the body is sent
  validateResponse: z.object({ id: z.number() }),
});

const { data, total } = await listUsers.send({
  search: { page: 1, limit: 20 },
});
const { id } = await createUser.send({ data: { name: "Mohamed" } });
```

### Request cancellation

```ts
const controller = new AbortController();

api.send({
  pathname: "/slow-endpoint",
  signal: controller.signal,
});

controller.abort();
```
