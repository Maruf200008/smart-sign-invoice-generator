import "server-only";

/**
 * Minimal Supabase REST (PostgREST) client shared by every API route.
 *
 * It deliberately uses ONLY the service-role key. All tables have RLS enabled with no anon policies,
 * so the anon/publishable key must never be able to read users, OTPs, invoices or share tokens.
 * The service-role key exists only on the server.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function supabaseUrl() {
  return (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
}

export function isSupabaseServiceConfigured() {
  return Boolean(supabaseUrl() && serviceKey());
}

export class SupabaseRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SupabaseRequestError";
  }

  /** Postgres error code embedded in a PostgREST error body (e.g. "23505" unique violation). */
  hasCode(code: string) {
    return this.message.includes(`"${code}"`) || this.message.includes(code);
  }
}

export async function supabaseServiceRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!isSupabaseServiceConfigured()) {
    throw new SupabaseRequestError("Supabase service role key is not configured.", 503);
  }

  const key = serviceKey();

  if (key.startsWith("sb_publishable_")) {
    throw new SupabaseRequestError("SUPABASE_SERVICE_ROLE_KEY is a publishable key, not a secret/service_role key.", 403);
  }

  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {})
    },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new SupabaseRequestError(message || "Supabase request failed.", response.status);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

/** Maps a storage failure to a message that is safe to send to the browser (never the raw PostgREST body). */
export function describeStorageError(error: SupabaseRequestError) {
  if (error.status === 503) {
    return "Cloud storage is not configured on the server.";
  }

  if (error.status === 401 || error.status === 403 || error.hasCode("42501") || error.message.includes("row-level security")) {
    return "Cloud storage is not authorized. Set SUPABASE_SERVICE_ROLE_KEY to your Supabase secret (service_role) key.";
  }

  if (error.hasCode("PGRST202") || error.hasCode("PGRST205") || error.hasCode("PGRST204") || error.hasCode("42703")) {
    return "Database schema is out of date. Run supabase-schema.sql in the Supabase SQL Editor.";
  }

  return "Cloud storage is unavailable right now. Please try again.";
}
