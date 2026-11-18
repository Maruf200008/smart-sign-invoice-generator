import { ApiError, assertSameOrigin, jsonResponse, readJsonBody, requireSessionUser } from "@/lib/api-http";
import { SessionConfigError } from "@/lib/auth-session";
import { writableByFilter } from "@/lib/invoice-lock";
import { InvoiceValidationError, sanitizeInvoiceData, SAVED_INVOICE_ID_PATTERN } from "@/lib/invoice-normalize";
import { describeStorageError, isSupabaseServiceConfigured, SupabaseRequestError, supabaseServiceRequest } from "@/lib/supabase-rest";
import type { SavedInvoice } from "@/types/invoice";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "smart_sign_invoices";
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_LIST_ROWS = 1000;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

interface InvoiceRow {
  id: string;
  name: string;
  saved_at: string;
  created_by: string | null;
  version: number | null;
  invoice: unknown;
  lock_client_id: string | null;
  lock_username: string | null;
  lock_touched_at: string | null;
}

function getClientId(request: Request) {
  const clientId = request.headers.get("x-smart-sign-client-id")?.trim() ?? "";

  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new ApiError("Missing or invalid device id.", 400);
  }

  return clientId;
}

function requireInvoiceId(value: unknown) {
  if (typeof value !== "string" || !SAVED_INVOICE_ID_PATTERN.test(value)) {
    throw new ApiError("Missing or invalid invoice id.", 400);
  }

  return value;
}

function rowToSavedInvoice(row: InvoiceRow): SavedInvoice {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.saved_at,
    createdBy: row.created_by ?? undefined,
    ...(typeof row.version === "number" ? { version: row.version } : {}),
    invoice: sanitizeInvoiceData(row.invoice)
  };
}

function lockedResponse(row: Pick<InvoiceRow, "lock_username"> | undefined) {
  const who = row?.lock_username ? ` by ${row.lock_username}` : "";
  return jsonResponse({ configured: true, locked: true, error: `This invoice is open${who} on another device right now.` }, 409);
}

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message }, error.status, error.headers);
  }

  if (error instanceof InvoiceValidationError) {
    return jsonResponse({ error: error.message }, 400);
  }

  if (error instanceof SupabaseRequestError) {
    console.error("Invoice storage request failed.", error.status, error.message);
    return jsonResponse({ error: describeStorageError(error) }, 502);
  }

  if (error instanceof SessionConfigError) {
    console.error("Auth session misconfigured.", error.message);
    return jsonResponse({ error: "Sign-in is not configured on the server (AUTH_SECRET)." }, 500);
  }

  console.error("Invoice request failed.", error);
  return jsonResponse({ error: "Invoice request failed." }, 500);
}

async function findRow(id: string, select: string) {
  const rows = await supabaseServiceRequest<InvoiceRow[]>(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=${select}&limit=1`);
  return rows?.[0];
}

/** GET /api/invoices -> every invoice saved in the last year (the workspace is shared by all signed-in users). */
export async function GET(request: Request) {
  try {
    requireSessionUser(request);

    if (!isSupabaseServiceConfigured()) {
      return jsonResponse({ configured: false, invoices: [] });
    }

    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const rows = await supabaseServiceRequest<InvoiceRow[]>(
      `${TABLE}?saved_at=gte.${encodeURIComponent(cutoff)}&select=id,name,saved_at,created_by,version,invoice&order=saved_at.desc&limit=${MAX_LIST_ROWS}`
    );

    return jsonResponse({ configured: true, invoices: (rows ?? []).map(rowToSavedInvoice) });
  } catch (error) {
    return handleError(error);
  }
}

// Saving goes through POST /api/v1/sync/save (versioned, idempotent, transactional).

/** PATCH /api/invoices {id, release?} -> refresh (or release) this device's edit lock without touching invoice data. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireSessionUser(request);
    const clientId = getClientId(request);

    if (!isSupabaseServiceConfigured()) {
      return jsonResponse({ configured: false });
    }

    const body = await readJsonBody<{ id?: unknown; release?: unknown }>(request, 2048);
    const id = requireInvoiceId(body.id);

    if (body.release === true) {
      await supabaseServiceRequest(`${TABLE}?id=eq.${encodeURIComponent(id)}&lock_client_id=eq.${clientId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ lock_client_id: null, lock_username: null, lock_touched_at: null })
      });
      return jsonResponse({ configured: true, locked: false });
    }

    const touched = await supabaseServiceRequest<Array<{ id: string }>>(
      `${TABLE}?id=eq.${encodeURIComponent(id)}&${writableByFilter(clientId)}&select=id`,
      {
        method: "PATCH",
        body: JSON.stringify({ lock_client_id: clientId, lock_username: user.username, lock_touched_at: new Date().toISOString() })
      }
    );

    if (touched?.length) {
      return jsonResponse({ configured: true, locked: false });
    }

    const row = await findRow(id, "lock_username");
    // A missing row simply hasn't been saved yet; that's not a conflict.
    return row ? jsonResponse({ configured: true, locked: true, lockedBy: row.lock_username ?? null }) : jsonResponse({ configured: true, locked: false });
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/invoices?id=... -> delete one invoice unless another device is editing it. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    requireSessionUser(request);
    const clientId = getClientId(request);

    if (!isSupabaseServiceConfigured()) {
      return jsonResponse({ configured: false });
    }

    const id = requireInvoiceId(new URL(request.url).searchParams.get("id"));
    const deleted = await supabaseServiceRequest<Array<{ id: string }>>(
      `${TABLE}?id=eq.${encodeURIComponent(id)}&${writableByFilter(clientId)}&select=id`,
      { method: "DELETE" }
    );

    if (!deleted?.length) {
      const row = await findRow(id, "lock_username");

      if (row) {
        return lockedResponse(row);
      }
    }

    return jsonResponse({ configured: true });
  } catch (error) {
    return handleError(error);
  }
}
