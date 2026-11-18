"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { printedItemCount } from "@/lib/invoice-document";
import { ROWS_PER_PAGE } from "@/lib/invoice-sheet/pagination";
import { MAX_INVOICE_ITEMS, useInvoiceStore } from "@/store/invoice-store";

interface RowVisibility {
  /** Rows shown in the editor: the printed rows, plus blank rows the user has just added. */
  visibleCount: number;
  canAddRow: boolean;
  /** Shows the next blank row (creating it if needed) and returns its id. */
  revealRow: () => string | null;
  /** Keeps at least `count` rows shown (e.g. a blank row inserted below the last visible one). */
  showRows: (count: number) => void;
}

const RowVisibilityContext = createContext<RowVisibility>({ visibleCount: 0, canAddRow: false, revealRow: () => null, showRows: () => {} });

export function useRowVisibility() {
  return useContext(RowVisibilityContext);
}

/**
 * Invoices keep up to MAX_INVOICE_ITEMS rows. The first page always shows its 12 rows (blank or not); past that, unused
 * rows at the end are not printed. The editor shows the same rows as the PDF, and reveals one more blank row on
 * "Add Row" (or Enter on the last row), so row 13 onwards continues on a new page.
 */
export function RowVisibilityProvider({ children }: { children: ReactNode }) {
  const items = useInvoiceStore((state) => state.invoice.items);
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);

  const visibleCount = Math.min(items.length, Math.max(printedItemCount(items), revealed, ROWS_PER_PAGE));

  const revealRow = useCallback(() => {
    const store = useInvoiceStore.getState();
    const current = Math.min(store.invoice.items.length, Math.max(printedItemCount(store.invoice.items), revealedRef.current, ROWS_PER_PAGE));
    if (current >= MAX_INVOICE_ITEMS) return null;

    if (store.invoice.items.length <= current) store.addItem();
    const next = useInvoiceStore.getState().invoice.items[current];
    if (!next) return null;

    revealedRef.current = current + 1;
    setRevealed(current + 1);
    return next.id;
  }, []);

  const showRows = useCallback((count: number) => {
    const next = Math.min(MAX_INVOICE_ITEMS, Math.max(revealedRef.current, Math.floor(count)));
    if (next === revealedRef.current) return;
    revealedRef.current = next;
    setRevealed(next);
  }, []);

  const value = useMemo(
    () => ({ visibleCount, canAddRow: visibleCount < MAX_INVOICE_ITEMS, revealRow, showRows }),
    [visibleCount, revealRow, showRows]
  );

  return <RowVisibilityContext.Provider value={value}>{children}</RowVisibilityContext.Provider>;
}
