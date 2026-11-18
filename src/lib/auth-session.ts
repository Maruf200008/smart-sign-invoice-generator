import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import type { AuthUser } from "@/types/auth";

/**
 * Stateless, HMAC-signed session cookie.
 *
 * The browser never sees or sends its own identity any more: every API route derives the user from this
 * HttpOnly cookie, which JavaScript cannot read and which cannot be forged without AUTH_SECRET.
 */
export const SESSION_COOKIE_NAME = "smart_sign_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_VERSION = 1;
const MIN_SECRET_LENGTH = 32;

interface SessionPayload {
  v: number;
  sub: string;
  usr: string;
  eml: string;
  iat: number;
  exp: number;
}

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}

function sessionSecret() {
  const explicit = process.env.AUTH_SECRET?.trim();

  if (explicit) {
    if (explicit.length < MIN_SECRET_LENGTH) {
      throw new SessionConfigError(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    }

    return explicit;
  }

  // Fallback so existing deployments keep working: derive a stable secret from the (server-only) service key.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (serviceKey) {
    return createHmac("sha256", serviceKey).update("smart-sign-session-secret-v1").digest("hex");
  }

  throw new SessionConfigError("AUTH_SECRET is not configured.");
}

function sign(data: string, secret = sessionSecret()) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(user: AuthUser, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: user.id,
    usr: user.username,
    eml: user.email,
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${encoded}.${sign(encoded)}`;
}

/** Returns the session's user, or null when the token is missing, tampered with, malformed or expired. */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): (AuthUser & { issuedAt: number }) | null {
  if (!token || token.length > 2048) {
    return null;
  }

  const [encoded, signature, extra] = token.split(".");

  if (!encoded || !signature || extra !== undefined) {
    return null;
  }

  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;

    if (
      payload.v !== SESSION_VERSION ||
      typeof payload.sub !== "string" ||
      typeof payload.usr !== "string" ||
      typeof payload.eml !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.exp * 1000 <= now
    ) {
      return null;
    }

    return { id: payload.sub, username: payload.usr, email: payload.eml, issuedAt: payload.iat * 1000 };
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie");

  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

export function getSessionUser(request: Request) {
  return verifySessionToken(readCookie(request, SESSION_COOKIE_NAME));
}

function cookieAttributes(maxAgeSeconds: number) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])
  ].join("; ");
}

export function sessionCookieHeader(user: AuthUser) {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(user)}; ${cookieAttributes(SESSION_MAX_AGE_SECONDS)}`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0)}`;
}
