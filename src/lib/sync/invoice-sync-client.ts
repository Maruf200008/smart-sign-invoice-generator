"use client";

import { getInvoiceClientId, syncTransport } from "@/lib/invoice-cloud-storage";
import { type FlushOutcome, SyncManager } from "@/lib/sync/sync-manager";
import { useInvoiceStore } from "@/store/invoice-store";
import type { SavedInvoice } from "@/types/invoice";

let manager: SyncManager | null = null;

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The one sync queue of this tab, shared by the dashboard (Ctrl+S, auto-save) and sharing. */
export function getInvoiceSyncManager() {
  manager ??= new SyncManager({
    transport: syncTransport,
    getClientId: getInvoiceClientId,
    storage: browserStorage(),
    onSaved: (confirmation) => useInvoiceStore.getState().markInvoiceSynced(confirmation)
  });

  return manager;
}

/** Saves one invoice to the server right now (through the queue) and throws a user-facing error if it didn't land. */
export async function saveInvoiceToServerNow(savedInvoice: SavedInvoice) {
  const syncManager = getInvoiceSyncManager();
  syncManager.track(savedInvoice);

  const outcome: FlushOutcome = await syncManager.flush();

  if (outcome.status === "disabled") {
    throw new Error("Sharing needs the cloud database. Add the Supabase keys to the server environment.");
  }

  if (outcome.status === "failed") {
    throw new Error(outcome.error.message);
  }

  if (outcome.status === "conflict" || syncManager.getStatus().conflict?.documentId === savedInvoice.id) {
    throw new Error("This invoice has a newer version on the server. Choose which copy to keep, then share again.");
  }
}
