import { vi } from "vitest";

export const BASE = "https://api.test";

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}

type Responder = () => Response | Promise<Response>;

/**
 * Replaces global `fetch` with a recorder. Every call returns `respond()`,
 * which defaults to an empty JSON object.
 */
export function mockFetch(respond: Responder = () => json({})) {
  const calls: RecordedCall[] = [];
  let responder = respond;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        method: init.method ?? "GET",
        url,
        body: init.body,
        headers: init.headers as Headers,
        signal: init.signal,
      });
      return responder();
    }),
  );
  return {
    calls,
    last: () => calls[calls.length - 1]!,
    respondWith(next: Responder) {
      responder = next;
    },
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const text = (body: string, status = 200) =>
  new Response(body, { status });

/** Resolves with whatever `promise` throws, or fails the test if it resolves. */
export async function thrown<T = any>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (error) {
    return error as T;
  }
  throw new Error("Expected the promise to reject, but it resolved");
}
