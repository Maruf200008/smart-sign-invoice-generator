import { NextResponse } from "next/server";
import type { SavedInvoice } from "@/types/invoice";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = "smart_sign_invoices";

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function getClientId(request: Request) {
  return request.headers.get("x-smart-sign-client-id")?.trim() || "";
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  if (!isConfigured()) {
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Supabase request failed.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function GET(request: Request) {
  const clientId = getClientId(request);

  if (!isConfigured()) {
    return jsonResponse({ configured: false, invoices: [] });
  }

  if (!clientId) {
    return jsonResponse({ error: "Missing client id." }, 400);
  }

  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabaseRequest(
    `${TABLE_NAME}?client_id=eq.${encodeURIComponent(clientId)}&saved_at=gte.${encodeURIComponent(cutoff)}&order=saved_at.desc`
  );

  return jsonResponse({
    configured: true,
    invoices: Array.isArray(rows) ? rows.map(rowToSavedInvoice) : []
  });
}

export async function POST(request: Request) {
  const clientId = getClientId(request);

  if (!isConfigured()) {
    return jsonResponse({ configured: false });
  }

  if (!clientId) {
    return jsonResponse({ error: "Missing client id." }, 400);
  }

  const savedInvoice = (await request.json()) as SavedInvoice;

  await supabaseRequest(`${TABLE_NAME}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(savedInvoiceToRow(savedInvoice, clientId))
  });

  return jsonResponse({ configured: true });
}

export async function DELETE(request: Request) {
  const clientId = getClientId(request);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!isConfigured()) {
    return jsonResponse({ configured: false });
  }

  if (!clientId || !id) {
    return jsonResponse({ error: "Missing client id or invoice id." }, 400);
  }

  await supabaseRequest(`${TABLE_NAME}?client_id=eq.${encodeURIComponent(clientId)}&id=eq.${encodeURIComponent(id)}`, {
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
  invoice: SavedInvoice["invoice"];
}): SavedInvoice {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.saved_at,
    invoice: row.invoice
  };
}

function savedInvoiceToRow(savedInvoice: SavedInvoice, clientId: string) {
  return {
    id: savedInvoice.id,
    client_id: clientId,
    name: savedInvoice.name,
    saved_at: savedInvoice.savedAt,
    invoice: savedInvoice.invoice
  };
}
