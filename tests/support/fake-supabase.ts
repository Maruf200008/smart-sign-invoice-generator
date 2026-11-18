import { vi } from "vitest";

export interface RecordedRequest {
  method: string;
  path: string;
  url: URL;
  body: unknown;
}

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown } | undefined;

/**
 * Replaces global fetch with a tiny fake of Supabase's REST API. Each test registers handlers; the first
 * handler that returns a response wins. Every request is recorded so tests can assert on filters.
 */
export function installFakeSupabase() {
  const handlers: Handler[] = [];
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const request: RecordedRequest = { method, path: url.pathname.replace("/rest/v1/", ""), url, body };
    requests.push(request);

    for (const handler of handlers) {
      const result = handler(request);

      if (result) {
        const status = result.status ?? 200;
        return new Response(result.body === undefined ? null : JSON.stringify(result.body), { status });
      }
    }

    return new Response("[]", { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    requests,
    on(handler: Handler) {
      handlers.unshift(handler);
    }
  };
}

export const APP_ORIGIN = "http://localhost:3000";

export function apiRequest(path: string, init: RequestInit & { cookie?: string; clientId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3000");

  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.clientId) headers.set("x-smart-sign-client-id", init.clientId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  return new Request(`${APP_ORIGIN}${path}`, { ...init, headers });
}
