import "server-only";

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-session";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

/** An error whose message is safe to show to the caller. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly headers: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Defense in depth against CSRF on top of SameSite=Lax cookies: a browser always sends Origin on
 * cross-origin POST/PATCH/DELETE, so a mismatch means another site is trying to act as the user.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  try {
    if (host && new URL(origin).host === host) {
      return;
    }
  } catch {
    // Malformed Origin header: fall through and reject.
  }

  throw new ApiError("Cross-site request blocked.", 403);
}

export function requireSessionUser(request: Request) {
  const user = getSessionUser(request);

  if (!user) {
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }

  return user;
}

/** Reads a JSON body with a hard size cap so a single request can't exhaust memory or bloat the database. */
export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > maxBytes) {
    throw new ApiError("Request is too large.", 413);
  }

  const text = await request.text();

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError("Request is too large.", 413);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Invalid JSON body.", 400);
  }
}

export function getClientIp(request: Request) {
  return (
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * Fixed-window, in-memory rate limiter. It is per server instance, so on serverless hosting it is a
 * speed bump rather than a hard guarantee; OTP brute force is additionally capped in the database.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }

      if (buckets.size >= MAX_BUCKETS) buckets.clear();
    }

    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new ApiError("Too many attempts. Please wait a moment and try again.", 429, { "Retry-After": String(retryAfterSeconds) });
  }
}

export function resetRateLimits() {
  buckets.clear();
}
