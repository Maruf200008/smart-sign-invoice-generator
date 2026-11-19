"use client";

import { InvoiceHeader } from "@/components/invoice/InvoiceHeader";
import { InvoiceSummary } from "@/components/invoice/InvoiceSummary";
import { InvoiceTable, useInvoiceGrid } from "@/components/invoice/InvoiceTable";
import { RowVisibilityProvider } from "@/components/invoice/row-visibility";
import { InvoicePages, SheetViewport } from "@/components/invoice/sheet/InvoiceSheet";
import { SheetPageFooter } from "@/components/invoice/sheet/SheetParts";
import { paginateInvoiceRows } from "@/lib/invoice-sheet/pagination";
import { useInvoiceLabels } from "@/store/invoice-language-store";

/**
 * The editable A4 invoice. Same pages, parts and page heights as the PDF, so what you edit is what you download:
 * 15 rows per page, header, table head and signature/contact footer on every page, totals on the last page only.
 */
export function InvoicePreview() {
  return (
    <RowVisibilityProvider>
      <SheetViewport>
        <div id="invoice-paper" className="invoice-paper">
          <EditablePages />
        </div>
      </SheetViewport>
    </RowVisibilityProvider>
  );
}

function EditablePages() {
  const { rows, overlay } = useInvoiceGrid();
  const labels = useInvoiceLabels();

  const pages = paginateInvoiceRows(rows.length).map((page) => ({
    key: String(page.index),
    content: (
      <>
        <InvoiceHeader />
        <InvoiceTable rows={rows.slice(page.start, page.end)} continued={!page.isFirst} />
        {page.isLast ? <InvoiceSummary /> : <SheetPageFooter labels={labels} />}
      </>
    )
  }));

  return (
    <>
      <InvoicePages ariaLabel={labels.invoiceAria("")} pageAriaLabel={labels.pageAria} printable pages={pages} />
      {overlay}
    </>
  );
}
