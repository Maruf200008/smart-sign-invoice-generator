import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "@/lib/auth-session";
import { createSampleInvoice } from "@/lib/sample-invoice";
import { parseSyncSaveRequest } from "@/lib/sync/sync-protocol";
import * as syncSaveRoute from "@/app/api/v1/sync/save/route";
import { apiRequest, installFakeSupabase } from "./support/fake-supabase";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "rahim@example.com", username: "rahim" };
const SESSION = sessionCookieHeader(USER).split(";")[0];
const RPC = "rpc/smart_sign_save_invoice";

let supabase: ReturnType<typeof installFakeSupabase>;

beforeEach(() => {
  supabase = installFakeSupabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function requestBody(overrides: Record<string, unknown> = {}) {
  const invoice = createSampleInvoice();
  invoice.customer.name = "Rahim Traders";

  return {
    documentId: "saved-invoice-abc-123",
    changes: { name: "Rahim Traders", invoice },
    updatedAt: "2026-11-19T10:00:00.000Z",
    clientId: "device-aaaa-1111",
    syncId: "11111111-2222-4333-8444-555555555555",
    baseVersion: 3,
    ...overrides
  };
}

function save(body: unknown, init: { cookie?: string; headers?: Record<string, string> } = { cookie: SESSION }) {
  return syncSaveRoute.POST(apiRequest("/api/v1/sync/save", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init }));
}

function rpcCalls() {
  return supabase.requests.filter((request) => request.method === "POST" && request.path === RPC);
}

describe("POST /api/v1/sync/save", () => {
  it("saves through the transactional database function and returns the new server version", async () => {
    supabase.on((request) =>
      request.path === RPC ? { body: { status: "saved", version: 4, server_updated_at: "2026-11-19T10:00:01.123+00:00", created_by: "karim" } } : undefined
    );

    const response = await save(requestBody());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      serverUpdatedAt: "2026-11-19T10:00:01.123Z",
      version: 4,
      createdBy: "karim",
      duplicate: false,
      message: "Saved successfully"
    });

    const [call] = rpcCalls();
    expect(call.body).toMatchObject({
      p_sync_id: "11111111-2222-4333-8444-555555555555",
      p_invoice_id: "saved-invoice-abc-123",
      p_client_id: "device-aaaa-1111",
      p_username: "rahim",
      p_base_version: 3,
      p_prior_sync_ids: []
    });
    // The edit time the client sent is what gets stored.
    expect((call.body as { p_invoice: { updatedAt: string } }).p_invoice.updatedAt).toBe("2026-11-19T10:00:00.000Z");
  });

  it("takes the username from the session, never from the request", async () => {
    supabase.on((request) => (request.path === RPC ? { body: { status: "saved", version: 1, server_updated_at: new Date().toISOString(), created_by: "rahim" } } : undefined));

    await save({ ...requestBody(), username: "mallory" }, { cookie: SESSION, headers: { "x-smart-sign-username": "mallory" } });

    expect(rpcCalls()[0].body).toMatchObject({ p_username: "rahim" });
  });

  it("answers a replayed syncId as a duplicate success (idempotent retry)", async () => {
    supabase.on((request) => (request.path === RPC ? { body: { status: "duplicate", version: 4, server_updated_at: "2026-11-19T10:00:01.000Z", created_by: "rahim" } } : undefined));

    const data = await (await save(requestBody())).json();

    expect(data).toMatchObject({ success: true, duplicate: true, version: 4 });
  });

  it("returns 409 with the newer server copy when the client's version is stale", async () => {
    const serverInvoice = createSampleInvoice();
    serverInvoice.customer.name = "Edited elsewhere";
    supabase.on((request) =>
      request.path === RPC
        ? {
            body: {
              status: "conflict",
              reason: "stale",
              version: 5,
              server: { id: "saved-invoice-abc-123", name: "Edited elsewhere", savedAt: "2026-11-19T09:00:00+00:00", createdBy: "karim", invoice: serverInvoice, version: 5 }
            }
          }
        : undefined
    );

    const response = await save(requestBody());
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toMatchObject({ success: false, conflict: true, reason: "stale", serverVersion: 5, message: "Newer version exists on server" });
    expect(data.server).toMatchObject({ id: "saved-invoice-abc-123", version: 5, savedAt: "2026-11-19T09:00:00.000Z" });
    expect(data.server.invoice.customer.name).toBe("Edited elsewhere");
  });

  it("reports an invoice deleted elsewhere as a conflict", async () => {
    supabase.on((request) => (request.path === RPC ? { body: { status: "conflict", reason: "deleted", version: null } } : undefined));

    const response = await save(requestBody());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ conflict: true, reason: "deleted", serverVersion: null });
  });

  it("returns 423 while another device holds the edit lock", async () => {
    supabase.on((request) => (request.path === RPC ? { body: { status: "locked", locked_by: "karim" } } : undefined));

    const response = await save(requestBody());
    const data = await response.json();

    expect(response.status).toBe(423);
    expect(data).toMatchObject({ success: false, locked: true, lockedBy: "karim" });
    expect(data.message).toContain("karim");
  });

  it("passes unconfirmed earlier syncIds through so the server can recognise its own versions", async () => {
    supabase.on((request) => (request.path === RPC ? { body: { status: "saved", version: 6, server_updated_at: new Date().toISOString(), created_by: "rahim" } } : undefined));
    const prior = ["aaaaaaaa-1111-4111-8111-111111111111"];

    await save(requestBody({ priorSyncIds: prior }));

    expect(rpcCalls()[0].body).toMatchObject({ p_prior_sync_ids: prior });
  });

  it.each([
    ["missing syncId", { syncId: undefined }],
    ["bad syncId", { syncId: "x" }],
    ["bad clientId", { clientId: "no spaces allowed" }],
    ["bad document id", { documentId: "bad,id" }],
    ["negative baseVersion", { baseVersion: -1 }],
    ["fractional baseVersion", { baseVersion: 1.5 }],
    ["bad updatedAt", { updatedAt: "yesterday" }],
    ["missing changes", { changes: undefined }],
    ["too many prior ids", { priorSyncIds: Array.from({ length: 21 }, (_, i) => `prior-sync-id-${i}`) }]
  ])("rejects a request with %s (400) without touching the database", async (_label, overrides) => {
    const response = await save(requestBody(overrides));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.message).toBeTruthy();
    expect(supabase.requests).toHaveLength(0);
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    const notJson = await save("{oops");
    const huge = await save(requestBody({ changes: { name: "x", invoice: { notes: "x".repeat(1_100_000) } } }));

    expect(notJson.status).toBe(400);
    expect(huge.status).toBe(413);
  });

  it("requires a session and blocks cross-site requests", async () => {
    const anonymous = await save(requestBody(), {});
    const crossSite = await save(requestBody(), { cookie: SESSION, headers: { origin: "https://evil.example" } });

    expect(anonymous.status).toBe(401);
    expect(crossSite.status).toBe(403);
    expect(supabase.requests).toHaveLength(0);
  });

  it("maps storage failures to a retryable 502 with a safe message", async () => {
    supabase.on((request) => (request.path === RPC ? { status: 500, body: { code: "XX000", message: "internal secret detail" } } : undefined));

    const response = await save(requestBody());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.success).toBe(false);
    expect(data.message).not.toContain("secret");
  });

  it("tells the operator to run the schema when the save function is missing", async () => {
    supabase.on((request) => (request.path === RPC ? { status: 404, body: { code: "PGRST202", message: "Could not find the function" } } : undefined));

    const data = await (await save(requestBody())).json();

    expect(data.message).toContain("supabase-schema.sql");
  });

  it("reports an unconfigured server explicitly", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");

    const response = await save(requestBody());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, configured: false });
  });
});

describe("parseSyncSaveRequest", () => {
  it("sanitizes the invoice and treats a missing baseVersion as a new document", () => {
    const parsed = parseSyncSaveRequest(requestBody({ baseVersion: undefined, changes: { name: "", invoice: { discount: -5, activeLock: {} } } }));

    expect(parsed.baseVersion).toBeNull();
    expect(parsed.changes.invoice.discount).toBe(0);
    expect(parsed.changes.invoice).not.toHaveProperty("activeLock");
    expect(parsed.changes.name).toBe("Untitled Invoice");
    expect(parsed.priorSyncIds).toEqual([]);
  });
});
