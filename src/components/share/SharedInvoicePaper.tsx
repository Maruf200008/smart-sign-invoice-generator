"use client";

import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { SheetViewport } from "@/components/invoice/sheet/InvoiceSheet";
import type { InvoiceDocumentData } from "@/lib/invoice-document";

/**
 * The public, read-only invoice. It is the exact component the PDF is generated from, so the shared page,
 * the editor and the downloaded PDF look the same. It only ever receives the sanitised, pre-formatted document.
 */
export function SharedInvoicePaper({ document }: { document: InvoiceDocumentData }) {
  return (
    <SheetViewport>
      <div id="invoice-paper" className="invoice-paper">
        <InvoiceDocument data={document} printable />
      </div>
    </SheetViewport>
  );
}
