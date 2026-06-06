import type { SavedInvoice } from "@/types/invoice";

const CLIENT_ID_KEY = "smart-sign-client-id";

export function getInvoiceClientId() {
  if (typeof window === "undefined") {
    return "";
  }

  const existingId = window.localStorage.getItem(CLIENT_ID_KEY);

  if (existingId) {
    return existingId;
  }

  const id = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, id);

  return id;
}

export async function loadCloudInvoices() {
  const response = await fetch(`/api/invoices?t=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      "x-smart-sign-client-id": getInvoiceClientId()
    }
  });

  if (!response.ok) {
    throw new Error("Unable to load cloud invoices.");
  }

  const data = (await response.json()) as { configured: boolean; invoices: SavedInvoice[] };
  return data;
}

export async function saveCloudInvoice(savedInvoice: SavedInvoice, username = "") {
  const response = await fetch("/api/invoices", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-smart-sign-client-id": getInvoiceClientId(),
      "x-smart-sign-username": username
    },
    body: JSON.stringify(savedInvoice)
  });

  if (!response.ok) {
    throw new Error("Unable to save cloud invoice.");
  }

  return response.json() as Promise<{ configured: boolean }>;
}

export function saveCloudInvoiceBeforeUnload(savedInvoice: SavedInvoice, username = "") {
  void fetch("/api/invoices", {
    method: "POST",
    cache: "no-store",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-smart-sign-client-id": getInvoiceClientId(),
      "x-smart-sign-username": username
    },
    body: JSON.stringify(savedInvoice)
  }).catch(() => {
    // The browser may cancel keepalive requests during shutdown.
  });
}

export async function deleteCloudInvoice(id: string) {
  const response = await fetch(`/api/invoices?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      "x-smart-sign-client-id": getInvoiceClientId()
    }
  });

  if (!response.ok) {
    throw new Error("Unable to delete cloud invoice.");
  }

  return response.json() as Promise<{ configured: boolean }>;
}
