"use client";

import { useCallback } from "react";
import { useInvoiceStore } from "@/store/invoice-store";
import { useShareStore } from "@/store/share-store";

/**
 * Returns a callback that opens the share modal for whichever invoice is currently active.
 * Reads from the stores at call time so it never closes over a stale invoice.
 */
export function useShareInvoice() {
  const open = useShareStore((state) => state.open);

  return useCallback(() => {
    const { invoice, savedInvoices, activeSavedInvoiceId } = useInvoiceStore.getState();
    const savedInvoice = savedInvoices.find((item) => item.id === activeSavedInvoiceId);

    void open(
      savedInvoice ?? {
        id: activeSavedInvoiceId,
        name: invoice.customer.name.trim() || "Untitled Invoice",
        savedAt: invoice.updatedAt,
        invoice
      }
    );
  }, [open]);
}
