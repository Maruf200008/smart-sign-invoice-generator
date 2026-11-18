import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/api-http";
import { sessionCookieHeader } from "@/lib/auth-session";
import { hashSecret } from "@/lib/password";
import { createSampleInvoice } from "@/lib/sample-invoice";
import * as authRoute from "@/app/api/auth/route";
import * as invoicesRoute from "@/app/api/invoices/route";
import * as sharesRoute from "@/app/api/shares/route";
import { apiRequest, installFakeSupabase, type RecordedRequest } from "./support/fake-supabase";

vi.mock("@/lib/mailer", () => ({ sendOtpEmail: vi.fn(async () => undefined), isMailerConfigured: () => true }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "rahim@example.com", username: "rahim" };
const SESSION = sessionCookieHeader(USER).split(";")[0];
const CLIENT_ID = "device-aaaa-1111";
const OTHER_CLIENT = "device-bbbb-2222";

let supabase: ReturnType<typeof installFakeSupabase>;

beforeEach(() => {
  supabase = installFakeSupabase();
  resetRateLimits();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function writes(method: string, table: string) {
  return supabase.requests.filter((request: RecordedRequest) => request.method === method && request.path === table);
}

function savedInvoiceBody(id = "saved-invoice-abc-123") {
  return JSON.stringify({ id, name: "Rahim", savedAt: new Date().toISOString(), invoice: createSampleInvoice() });
}

describe("authentication is required", () => {
  it.each([
    ["GET /api/invoices", () => invoicesRoute.GET(apiRequest("/api/invoices"))],
    ["POST /api/invoices", () => invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", body: savedInvoiceBody(), clientId: CLIENT_ID }))],
    ["PATCH /api/invoices", () => invoicesRoute.PATCH(apiRequest("/api/invoices", { method: "PATCH", body: JSON.stringify({ id: "x" }), clientId: CLIENT_ID }))],
    ["DELETE /api/invoices", () => invoicesRoute.DELETE(apiRequest("/api/invoices?id=x", { method: "DELETE", clientId: CLIENT_ID }))],
    ["GET /api/shares", () => sharesRoute.GET(apiRequest("/api/shares?invoiceId=x"))],
    ["POST /api/shares", () => sharesRoute.POST(apiRequest("/api/shares", { method: "POST", body: JSON.stringify({ invoiceId: "x" }) }))]
  ])("%s returns 401 without a session and never touches the database", async (_label, call) => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(supabase.requests).toHaveLength(0);
  });

  it("ignores a forged x-smart-sign-username header", async () => {
    const response = await invoicesRoute.GET(apiRequest("/api/invoices", { headers: { "x-smart-sign-username": "admin" } }));
    expect(response.status).toBe(401);
  });

  it("rejects a forged session cookie", async () => {
    const response = await invoicesRoute.GET(apiRequest("/api/invoices", { cookie: "smart_sign_session=eyJ2IjoxfQ.forged" }));
    expect(response.status).toBe(401);
  });
});

describe("/api/invoices", () => {
  it("lists invoices for a signed-in user with sanitized data and no-store caching", async () => {
    supabase.on((request) =>
      request.method === "GET" && request.path === "smart_sign_invoices"
        ? { body: [{ id: "a", name: "A", saved_at: "2026-01-01T00:00:00.000Z", created_by: "rahim", invoice: { activeLock: {}, discount: -5 } }] }
        : undefined
    );

    const response = await invoicesRoute.GET(apiRequest("/api/invoices", { cookie: SESSION }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(data.invoices[0].invoice.discount).toBe(0);
    expect(data.invoices[0].invoice).not.toHaveProperty("activeLock");
  });

  it("creates a new invoice with created_by taken from the session", async () => {
    const response = await invoicesRoute.POST(
      apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: savedInvoiceBody(), headers: { "x-smart-sign-username": "mallory" } })
    );

    expect(response.status).toBe(200);
    const [insert] = writes("POST", "smart_sign_invoices");
    expect(insert.body).toMatchObject({ created_by: "rahim", lock_client_id: CLIENT_ID, lock_username: "rahim" });
  });

  it("refuses to overwrite an invoice another device is editing", async () => {
    supabase.on((request) =>
      request.method === "GET" && request.path === "smart_sign_invoices"
        ? { body: [{ created_by: "karim", lock_client_id: OTHER_CLIENT, lock_username: "karim", lock_touched_at: new Date().toISOString() }] }
        : undefined
    );

    const response = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: savedInvoiceBody() }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toMatchObject({ locked: true });
    expect(data.error).toContain("karim");
    expect(writes("PATCH", "smart_sign_invoices")).toHaveLength(0);
  });

  it("updates an existing invoice with a conditional (lock-aware) write and keeps the original creator", async () => {
    supabase.on((request) => {
      if (request.method === "GET" && request.path === "smart_sign_invoices") return { body: [{ created_by: "karim", lock_client_id: null, lock_touched_at: null }] };
      if (request.method === "PATCH" && request.path === "smart_sign_invoices") return { body: [{ id: "saved-invoice-abc-123" }] };
      return undefined;
    });

    const response = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: savedInvoiceBody() }));

    expect(response.status).toBe(200);
    const [update] = writes("PATCH", "smart_sign_invoices");
    expect(update.url.searchParams.get("or")).toContain(`lock_client_id.eq.${CLIENT_ID}`);
    expect(update.body).toMatchObject({ created_by: "karim" });
  });

  it("rejects invalid bodies, bad ids and missing device ids", async () => {
    const badId = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: savedInvoiceBody("bad,id") }));
    const notJson = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: "{oops" }));
    const noDevice = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, body: savedInvoiceBody() }));

    expect([badId.status, notJson.status, noDevice.status]).toEqual([400, 400, 400]);
    expect(writes("POST", "smart_sign_invoices")).toHaveLength(0);
  });

  it("rejects oversized bodies", async () => {
    const huge = JSON.stringify({ id: "x", invoice: { notes: "x".repeat(1_100_000) } });
    const response = await invoicesRoute.POST(apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: huge }));

    expect(response.status).toBe(413);
  });

  it("blocks cross-site writes (CSRF)", async () => {
    const response = await invoicesRoute.POST(
      apiRequest("/api/invoices", { method: "POST", cookie: SESSION, clientId: CLIENT_ID, body: savedInvoiceBody(), headers: { origin: "https://evil.example" } })
    );

    expect(response.status).toBe(403);
    expect(supabase.requests).toHaveLength(0);
  });

  it("refreshes only the lock columns, never the invoice JSON", async () => {
    supabase.on((request) => (request.method === "PATCH" ? { body: [{ id: "a" }] } : undefined));

    const response = await invoicesRoute.PATCH(apiRequest("/api/invoices", { method: "PATCH", cookie: SESSION, clientId: CLIENT_ID, body: JSON.stringify({ id: "a" }) }));

    expect(await response.json()).toMatchObject({ locked: false });
    const [patch] = writes("PATCH", "smart_sign_invoices");
    expect(Object.keys(patch.body as object).sort()).toEqual(["lock_client_id", "lock_touched_at", "lock_username"]);
  });

  it("does not delete an invoice locked by another device", async () => {
    supabase.on((request) => {
      if (request.method === "DELETE") return { body: [] };
      if (request.method === "GET") return { body: [{ lock_username: "karim" }] };
      return undefined;
    });

    const response = await invoicesRoute.DELETE(apiRequest("/api/invoices?id=a", { method: "DELETE", cookie: SESSION, clientId: CLIENT_ID }));

    expect(response.status).toBe(409);
  });
});

describe("/api/auth", () => {
  async function userRow(password: string) {
    return { ...USER, password_hash: await hashSecret(password) };
  }

  function post(body: object, headers: Record<string, string> = {}) {
    return authRoute.POST(apiRequest("/api/auth", { method: "POST", body: JSON.stringify(body), headers }));
  }

  it("signs in with a correct password and sets an HttpOnly session cookie", async () => {
    const row = await userRow("correct-password");
    supabase.on((request) => (request.path === "smart_sign_users" ? { body: [row] } : undefined));

    const response = await post({ action: "login", identifier: "Rahim", password: "correct-password" });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user).toEqual(USER);
    expect(data.user).not.toHaveProperty("password_hash");
    expect(response.headers.get("set-cookie")).toMatch(/smart_sign_session=.+HttpOnly/);
  });

  it("rejects a wrong password, and an unknown user, with the same message", async () => {
    const row = await userRow("correct-password");
    supabase.on((request) => (request.path === "smart_sign_users" && request.url.search.includes("rahim") ? { body: [row] } : undefined));

    const wrong = await post({ action: "login", identifier: "rahim", password: "nope" });
    const unknown = await post({ action: "login", identifier: "ghost", password: "nope" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toBe((await unknown.json()).error);
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("rate limits repeated login attempts", async () => {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      lastStatus = (await post({ action: "login", identifier: "rahim", password: "guess" })).status;
    }

    expect(lastStatus).toBe(429);
  });

  it("validates sign-up input and stores only a password hash", async () => {
    supabase.on((request) =>
      request.method === "POST" && request.path === "smart_sign_users" ? { status: 201, body: [{ ...USER, password_hash: "x" }] } : undefined
    );

    const weak = await post({ action: "signup", email: "rahim@example.com", username: "rahim", password: "123" });
    const ok = await post({ action: "signup", email: "Rahim@Example.com", username: "Rahim", password: "long-enough-password" });

    expect(weak.status).toBe(400);
    expect(ok.status).toBe(201);
    const [insert] = writes("POST", "smart_sign_users");
    expect(insert.body).toMatchObject({ email: "rahim@example.com", username: "rahim" });
    expect(JSON.stringify(insert.body)).not.toContain("long-enough-password");
  });

  it("does not reveal whether an account exists when requesting an OTP", async () => {
    const { sendOtpEmail } = await import("@/lib/mailer");
    const response = await post({ action: "request-otp", email: "ghost@example.com", username: "ghost" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("counts wrong OTP guesses and burns the code after the limit", async () => {
    const otpRow = { id: "otp-1", otp_hash: await hashSecret("123456"), attempts: 4 };
    supabase.on((request) => {
      if (request.path === "smart_sign_users") return { body: [{ ...USER, password_hash: "x" }] };
      if (request.path === "smart_sign_login_otps" && request.method === "GET") return { body: [otpRow] };
      return undefined;
    });

    const response = await post({ action: "verify-otp", email: USER.email, username: USER.username, otp: "000000" });

    expect(response.status).toBe(401);
    const [patch] = writes("PATCH", "smart_sign_login_otps");
    expect(patch.body).toMatchObject({ attempts: 5 });
    expect(patch.body).toHaveProperty("used_at");
  });

  it("signs in with a valid OTP and consumes it atomically", async () => {
    const otpRow = { id: "otp-1", otp_hash: await hashSecret("123456"), attempts: 0 };
    supabase.on((request) => {
      if (request.path === "smart_sign_users") return { body: [{ ...USER, password_hash: "x" }] };
      if (request.path === "smart_sign_login_otps" && request.method === "GET") return { body: [otpRow] };
      if (request.path === "smart_sign_login_otps" && request.method === "PATCH") return { body: [{ id: "otp-1" }] };
      return undefined;
    });

    const response = await post({ action: "verify-otp", email: USER.email, username: USER.username, otp: "123456" });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/smart_sign_session=/);
    expect(writes("PATCH", "smart_sign_login_otps")[0].url.searchParams.get("used_at")).toBe("is.null");
  });

  it("returns the current user for a valid session and 401 otherwise", async () => {
    supabase.on((request) => (request.path === "smart_sign_users" ? { body: [USER] } : undefined));

    const signedIn = await authRoute.GET(apiRequest("/api/auth", { cookie: SESSION }));
    const signedOut = await authRoute.GET(apiRequest("/api/auth"));

    expect(signedIn.status).toBe(200);
    expect((await signedIn.json()).user).toEqual(USER);
    expect(signedOut.status).toBe(401);
  });

  it("signs out by expiring the cookie", async () => {
    const response = await authRoute.DELETE(apiRequest("/api/auth", { method: "DELETE", cookie: SESSION }));
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("never leaks raw database errors", async () => {
    supabase.on(() => ({ status: 500, body: { code: "XX000", message: "relation smart_sign_users secret detail" } }));

    const response = await post({ action: "login", identifier: "rahim", password: "whatever" });
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).not.toContain("smart_sign_users");
  });
});

describe("/api/shares", () => {
  it("uses the session user as the share owner", async () => {
    supabase.on((request) => {
      if (request.path === "smart_sign_invoice_shares" && request.method === "GET") return { body: [] };
      if (request.path === "smart_sign_invoices") return { body: [{ id: "a" }] };
      if (request.path === "smart_sign_invoice_shares" && request.method === "POST")
        return { status: 201, body: [{ id: "s", share_token: "t".repeat(22), invoice_id: "a", created_by: "rahim", is_enabled: true, expires_at: null, created_at: "2026-01-01T00:00:00Z" }] };
      return undefined;
    });

    const response = await sharesRoute.POST(
      apiRequest("/api/shares", { method: "POST", cookie: SESSION, body: JSON.stringify({ invoiceId: "a" }), headers: { "x-smart-sign-username": "mallory" } })
    );

    expect(response.status).toBe(200);
    expect(writes("POST", "smart_sign_invoice_shares")[0].body).toMatchObject({ created_by: "rahim" });
  });

  it("does not let another user manage someone else's share", async () => {
    supabase.on((request) =>
      request.path === "smart_sign_invoice_shares"
        ? { body: [{ id: "s", share_token: "t".repeat(22), invoice_id: "a", created_by: "karim", is_enabled: true, expires_at: null, created_at: "2026-01-01T00:00:00Z" }] }
        : undefined
    );

    const response = await sharesRoute.PATCH(apiRequest("/api/shares", { method: "PATCH", cookie: SESSION, body: JSON.stringify({ invoiceId: "a", isEnabled: false }) }));

    expect(response.status).toBe(403);
  });
});
