import { sanitizeInvoiceData } from "@/lib/invoice-normalize";
import type { InvoiceData, SavedInvoice } from "@/types/invoice";

export const SAVED_INVOICE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export function timeOf(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

export function savedInvoiceName(invoice: InvoiceData) {
  return invoice.customer.name.trim() || "Untitled Invoice";
}

/** Drops invoices older than the retention window and sorts newest first. */
export function pruneSavedInvoices(savedInvoices: SavedInvoice[], now = Date.now()) {
  const cutoff = now - SAVED_INVOICE_RETENTION_MS;

  return savedInvoices
    .filter((savedInvoice) => timeOf(savedInvoice.savedAt) >= cutoff)
    .sort((a, b) => timeOf(b.savedAt) - timeOf(a.savedAt));
}

export function normalizeSavedInvoice(savedInvoice: SavedInvoice): SavedInvoice {
  const invoice = sanitizeInvoiceData(savedInvoice.invoice);
  return { ...savedInvoice, name: savedInvoice.name || savedInvoiceName(invoice), invoice };
}

/**
 * Reconciles the cloud list with local state.
 *
 * The cloud list wins, except for:
 *   - invoices with edits queued for upload (`pendingIds`): the local copy is always kept, so a poll never
 *     reverts unsaved work. If the cloud copy moved on meanwhile, the save reports a version conflict.
 *   - the invoice open in the editor: kept when its local copy is newer or not in the cloud yet.
 */
export function mergeCloudInvoices(
  local: SavedInvoice[],
  cloud: SavedInvoice[],
  activeId: string,
  now = Date.now(),
  pendingIds: ReadonlySet<string> = new Set()
) {
  const merged = cloud.map(normalizeSavedInvoice);

  for (const localInvoice of local) {
    const isPending = pendingIds.has(localInvoice.id);

    if (!isPending && localInvoice.id !== activeId) continue;

    const index = merged.findIndex((savedInvoice) => savedInvoice.id === localInvoice.id);

    if (index === -1) {
      merged.push(localInvoice);
    } else if (isPending || timeOf(localInvoice.invoice.updatedAt) > timeOf(merged[index].invoice.updatedAt)) {
      const cloudCopy = merged[index];
      merged[index] = { ...localInvoice, createdBy: localInvoice.createdBy ?? cloudCopy.createdBy, version: localInvoice.version ?? cloudCopy.version };
    }
  }

  return pruneSavedInvoices(merged, now);
}

export function savedInvoiceListsAreEqual(first: SavedInvoice[], second: SavedInvoice[]) {
  return (
    first.length === second.length &&
    first.every((invoice, index) => {
      const other = second[index];
      return (
        other &&
        invoice.id === other.id &&
        invoice.name === other.name &&
        invoice.savedAt === other.savedAt &&
        invoice.createdBy === other.createdBy &&
        invoice.version === other.version &&
        invoice.invoice.updatedAt === other.invoice.updatedAt
      );
    })
  );
}
