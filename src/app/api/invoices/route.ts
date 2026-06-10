import { NextResponse } from "next/server";
import type { SavedInvoice } from "@/types/invoice";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_REST_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TABLE_NAME = "smart_sign_invoices";
const SHARED_CLIENT_ID = "smart-sign-shared-database";
const ACTIVE_LOCK_MS = 30_000;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store"
    }
  });
}

function getClientId(request: Request) {
  return request.headers.get("x-smart-sign-client-id")?.trim() || "";
}

function getUsername(request: Request) {
  return request.headers.get("x-smart-sign-username")?.trim().toLowerCase() || "unknown";
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_REST_KEY);
}

async function supabaseRequest(path: string, init: RequestInit = {}, clientId = "") {
  if (!isConfigured()) {
    return null;
  }

  const supabaseUrl = SUPABASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_REST_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_REST_KEY}`,
      "Content-Type": "application/json",
      ...(clientId ? { "x-smart-sign-client-id": clientId } : {}),
      Prefer: "return=representation",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    const rlsHint = message.includes("row-level security")
      ? " Supabase RLS blocked this request. Add SUPABASE_SERVICE_ROLE_KEY to .env.local, or run the RLS policies from supabase-schema.sql."
      : "";

    throw new Error(`${message || "Supabase request failed."}${rlsHint}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function GET() {
  if (!isConfigured()) {
    return jsonResponse({ configured: false, invoices: [] });
  }

  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRequest(
    `${TABLE_NAME}?saved_at=gte.${encodeURIComponent(cutoff)}&order=saved_at.desc`
  );

  return jsonResponse({
    configured: true,
    invoices: Array.isArray(rows) ? rows.map(rowToSavedInvoice) : []
  });
}

export async function POST(request: Request) {
  const clientId = getClientId(request) || SHARED_CLIENT_ID;
  const username = getUsername(request);

  if (!isConfigured()) {
    return jsonResponse({ configured: false });
  }

  const savedInvoice = (await request.json()) as SavedInvoice;
  const createdBy = await resolveCreatedBy(savedInvoice.id, username);
  const activeLock = await resolveActiveLockForSave(savedInvoice.id, savedInvoice.invoice, clientId, username);

  await supabaseRequest(`${TABLE_NAME}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(savedInvoiceToRow(savedInvoice, clientId, createdBy, activeLock))
  }, clientId);

  return jsonResponse({ configured: true });
}

export async function PATCH(request: Request) {
  const clientId = getClientId(request) || SHARED_CLIENT_ID;
  const username = getUsername(request);

  if (!isConfigured()) {
    return jsonResponse({ configured: false });
  }

  const { id } = (await request.json()) as { id?: string };

  if (!id) {
    return jsonResponse({ error: "Missing invoice id." }, 400);
  }

  const rows = await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=invoice&limit=1`);
  const existingRow = Array.isArray(rows) ? rows[0] as { invoice?: SavedInvoice["invoice"] } | undefined : undefined;
  const invoice = existingRow?.invoice;

  if (!invoice) {
    return jsonResponse({ configured: true });
  }

  const activeLock = getActiveLock(invoice);

  if (isFreshLock(activeLock) && activeLock.clientId !== clientId) {
    return jsonResponse({ configured: true, locked: true });
  }

  await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      invoice: withActiveLock(invoice, {
        clientId,
        username,
        touchedAt: new Date().toISOString()
      })
    })
  }, clientId);

  return jsonResponse({ configured: true, locked: false });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const clientId = getClientId(request) || SHARED_CLIENT_ID;

  if (!isConfigured()) {
    return jsonResponse({ configured: false });
  }

  if (!id) {
    return jsonResponse({ error: "Missing invoice id." }, 400);
  }

  const rows = await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=invoice&limit=1`);
  const existingRow = Array.isArray(rows) ? rows[0] as { invoice?: SavedInvoice["invoice"] } | undefined : undefined;
  const activeLock = existingRow?.invoice ? getActiveLock(existingRow.invoice) : null;

  if (isFreshLock(activeLock) && activeLock.clientId !== clientId) {
    return jsonResponse({ error: "This invoice is currently open on another device." }, 409);
  }

  await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });

  return jsonResponse({ configured: true });
}

function rowToSavedInvoice(row: {
  id: string;
  name: string;
  saved_at: string;
  created_by?: string;
  invoice: SavedInvoice["invoice"];
}): SavedInvoice {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.saved_at,
    createdBy: row.created_by,
    invoice: row.invoice
  };
}

function savedInvoiceToRow(savedInvoice: SavedInvoice, clientId: string, username: string, activeLock: ActiveInvoiceLock) {
  return {
    id: savedInvoice.id,
    client_id: clientId,
    name: savedInvoice.name,
    saved_at: savedInvoice.savedAt,
    created_by: username,
    invoice: withActiveLock(savedInvoice.invoice, activeLock)
  };
}

async function resolveCreatedBy(invoiceId: string, username: string) {
  const rows = await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(invoiceId)}&select=created_by&limit=1`);
  const existingRow = Array.isArray(rows) ? rows[0] as { created_by?: string } | undefined : undefined;

  return existingRow?.created_by || username || "unknown";
}

async function resolveActiveLockForSave(
  invoiceId: string,
  invoice: SavedInvoice["invoice"],
  clientId: string,
  username: string
) {
  const rows = await supabaseRequest(`${TABLE_NAME}?id=eq.${encodeURIComponent(invoiceId)}&select=invoice&limit=1`);
  const existingRow = Array.isArray(rows) ? rows[0] as { invoice?: SavedInvoice["invoice"] } | undefined : undefined;
  const existingLock = existingRow?.invoice ? getActiveLock(existingRow.invoice) : getActiveLock(invoice);

  if (isFreshLock(existingLock) && existingLock.clientId !== clientId) {
    return existingLock;
  }

  return {
    clientId,
    username,
    touchedAt: new Date().toISOString()
  };
}

type ActiveInvoiceLock = {
  clientId: string;
  username: string;
  touchedAt: string;
};

function getActiveLock(invoice: SavedInvoice["invoice"]) {
  const lock = (invoice as SavedInvoice["invoice"] & { activeLock?: Partial<ActiveInvoiceLock> }).activeLock;

  if (!lock?.clientId || !lock.touchedAt) {
    return null;
  }

  return {
    clientId: lock.clientId,
    username: lock.username || "unknown",
    touchedAt: lock.touchedAt
  };
}

function isFreshLock(lock: ActiveInvoiceLock | null): lock is ActiveInvoiceLock {
  if (!lock) {
    return false;
  }

  const touchedAt = new Date(lock.touchedAt).getTime();

  return Number.isFinite(touchedAt) && Date.now() - touchedAt < ACTIVE_LOCK_MS;
}

function withActiveLock(invoice: SavedInvoice["invoice"], activeLock: ActiveInvoiceLock) {
  return {
    ...invoice,
    activeLock
  };
}
