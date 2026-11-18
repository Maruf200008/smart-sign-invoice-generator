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
 * The cloud list wins for every invoice except the one open in the editor: if the local copy of that invoice
 * is newer (edits not uploaded yet) or doesn't exist in the cloud yet, the local copy is kept. Previously the
 * poll replaced the whole list, which reverted in-flight edits and could then upload the stale cloud copy.
 */
export function mergeCloudInvoices(local: SavedInvoice[], cloud: SavedInvoice[], activeId: string, now = Date.now()) {
  const merged = cloud.map(normalizeSavedInvoice);
  const localActive = local.find((savedInvoice) => savedInvoice.id === activeId);

  if (localActive) {
    const index = merged.findIndex((savedInvoice) => savedInvoice.id === activeId);

    if (index === -1) {
      merged.push(localActive);
    } else if (timeOf(localActive.invoice.updatedAt) > timeOf(merged[index].invoice.updatedAt)) {
      merged[index] = { ...localActive, createdBy: localActive.createdBy ?? merged[index].createdBy };
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
        invoice.invoice.updatedAt === other.invoice.updatedAt
      );
    })
  );
}
