import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, rateLimit, resetRateLimits } from "@/lib/api-http";
import { clearSessionCookieHeader, createSessionToken, getSessionUser, SESSION_COOKIE_NAME, sessionCookieHeader, verifySessionToken } from "@/lib/auth-session";
import { isSignupAllowed, validateNewAccount } from "@/lib/auth-validation";
import { generateOtp, hashSecret, verifySecret } from "@/lib/password";

const user = { id: "6a1c0b5e-0000-4000-8000-000000000001", email: "rahim@example.com", username: "rahim" };

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimits();
});

describe("session tokens", () => {
  it("round-trips a signed session", () => {
    expect(verifySessionToken(createSessionToken(user))).toMatchObject(user);
  });

  it("rejects tampered payloads and signatures", () => {
    const token = createSessionToken(user);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), usr: "admin" })).toString("base64url");

    expect(verifySessionToken(`${forged}.${signature}`)).toBeNull();
    expect(verifySessionToken(`${payload}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(verifySessionToken(`${payload}.${signature}.extra`)).toBeNull();
    expect(verifySessionToken("garbage")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it("rejects expired sessions", () => {
    const issuedLongAgo = createSessionToken(user, Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(verifySessionToken(issuedLongAgo)).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createSessionToken(user);
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-of-sufficient-length");
    expect(verifySessionToken(token)).toBeNull();
  });

  it("refuses a too-short AUTH_SECRET", () => {
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => createSessionToken(user)).toThrow(/at least 32/);
  });

  it("reads the session from the HttpOnly cookie only", () => {
    const cookie = sessionCookieHeader(user).split(";")[0];
    const request = new Request("http://localhost/api", { headers: { cookie: `other=1; ${cookie}`, "x-smart-sign-username": "admin" } });

    expect(sessionCookieHeader(user)).toMatch(/HttpOnly/);
    expect(sessionCookieHeader(user)).toMatch(/SameSite=Lax/);
    expect(getSessionUser(request)?.username).toBe("rahim");
    expect(getSessionUser(new Request("http://localhost/api", { headers: { "x-smart-sign-username": "admin" } }))).toBeNull();
    expect(clearSessionCookieHeader()).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;.*Max-Age=0`));
  });
});

describe("passwords and OTPs", () => {
  it("hashes with a random salt and verifies", async () => {
    const first = await hashSecret("correct horse");
    const second = await hashSecret("correct horse");

    expect(first).not.toBe(second);
    expect(await verifySecret("correct horse", first)).toBe(true);
    expect(await verifySecret("wrong", first)).toBe(false);
  });

  it("still verifies hashes created by the previous version (120k iterations)", async () => {
    const { pbkdf2Sync } = await import("crypto");
    const legacy = `120000:abcd:${pbkdf2Sync("legacy-pass", "abcd", 120000, 32, "sha256").toString("hex")}`;

    expect(await verifySecret("legacy-pass", legacy)).toBe(true);
  });

  it("fails closed for missing or malformed hashes", async () => {
    expect(await verifySecret("anything", undefined)).toBe(false);
    expect(await verifySecret("anything", "not-a-hash")).toBe(false);
    expect(await verifySecret("anything", "99999999999:salt:abcd")).toBe(false);
  });

  it("generates 6-digit OTPs, including leading zeros", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });
});

describe("sign-up validation", () => {
  it("accepts a valid account", () => {
    expect(validateNewAccount({ email: "a@b.co", username: "rahim_01", password: "longenough" })).toBeNull();
  });

  it.each([
    [{ email: "nope", username: "rahim", password: "longenough" }, /email/],
    [{ email: "a@b.co", username: "ab", password: "longenough" }, /Username/],
    [{ email: "a@b.co", username: "x,or=(id.neq.0)", password: "longenough" }, /Username/],
    [{ email: "a@b.co", username: "rahim", password: "short" }, /Password/]
  ])("rejects %o", (input, message) => {
    expect(validateNewAccount(input)).toMatch(message);
  });

  it("honours the SIGNUP_ALLOWED_EMAILS allowlist and SIGNUP_DISABLED", () => {
    expect(isSignupAllowed("anyone@example.com", {})).toBe(true);
    expect(isSignupAllowed("staff@smartsign.com", { SIGNUP_ALLOWED_EMAILS: "@smartsign.com, owner@gmail.com" })).toBe(true);
    expect(isSignupAllowed("owner@gmail.com", { SIGNUP_ALLOWED_EMAILS: "@smartsign.com, owner@gmail.com" })).toBe(true);
    expect(isSignupAllowed("stranger@gmail.com", { SIGNUP_ALLOWED_EMAILS: "@smartsign.com, owner@gmail.com" })).toBe(false);
    expect(isSignupAllowed("x@evil-smartsign.com", { SIGNUP_ALLOWED_EMAILS: "@smartsign.com" })).toBe(false);
    expect(isSignupAllowed("owner@gmail.com", { SIGNUP_DISABLED: "true" })).toBe(false);
  });
});

describe("rate limiting", () => {
  it("blocks after the limit and resets after the window", () => {
    const now = 1_000_000;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      rateLimit("login:1.2.3.4", 3, 60_000, now);
    }

    expect(() => rateLimit("login:1.2.3.4", 3, 60_000, now)).toThrow(ApiError);
    expect(() => rateLimit("login:5.6.7.8", 3, 60_000, now)).not.toThrow();
    expect(() => rateLimit("login:1.2.3.4", 3, 60_000, now + 60_001)).not.toThrow();
  });
});
