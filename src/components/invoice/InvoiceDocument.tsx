"use client";

import { InvoicePages } from "@/components/invoice/sheet/InvoiceSheet";
import {
  SheetBanner,
  SheetItemsTable,
  SheetMetaRow,
  SheetPageFooter,
  SheetRemaining,
  SheetRows,
  SheetSummaryRow,
  SheetTail,
  SheetTitleRow,
  SheetToRow,
  SheetVatRow
} from "@/components/invoice/sheet/SheetParts";
import { sheetClasses } from "@/components/invoice/sheet/sheet-styles";
import { cn } from "@/lib/cn";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { paginateInvoiceRows } from "@/lib/invoice-sheet/pagination";

/**
 * Read-only A4 invoice. It is built from the same sheet parts and class tokens as the editable preview, so it is
 * pixel-identical to it; the public share page shows it and the PDF engine draws it. Rows are split 12 per page
 * (numbering continues across pages); the signature and contact footer is on every page, the totals on the last
 * page only.
 */
export function InvoiceDocument({ data, printable = false }: { data: InvoiceDocumentData; printable?: boolean }) {
  const labels = getInvoiceLabels();
  const cell = (extra: string) => cn(sheetClasses.td, extra);

  const rows = data.items.map((item, index) => ({
    key: String(index),
    node: (
      <tr data-sheet-row="">
        <td className={cell(sheetClasses.tdNo)}>{index + 1}</td>
        <td className={cell(sheetClasses.tdName)}>
          <div className={sheetClasses.cellText}>{item.name}</div>
        </td>
        <td className={cell(sheetClasses.tdSize)}>
          <div className={sheetClasses.cellText}>{item.width}</div>
        </td>
        <td className={cell(sheetClasses.tdTimes)}>{item.hasSize ? "X" : ""}</td>
        <td className={cell(cn(sheetClasses.tdSize, sheetClasses.tdHeight))}>
          <div className={sheetClasses.cellText}>{item.height}</div>
        </td>
        <td className={cell(sheetClasses.tdNumber)}>
          <div className={sheetClasses.cellText}>{item.quantity}</div>
        </td>
        <td className={cell(sheetClasses.tdSqf)}>
          <div className={sheetClasses.cellText}>{item.sqf}</div>
        </td>
        <td className={cell(sheetClasses.tdRate)}>
          <div className={sheetClasses.cellText}>{item.rate}</div>
        </td>
        <td className={cell(sheetClasses.tdTotal)}>
          <div className={sheetClasses.cellText}>{item.total}</div>
        </td>
      </tr>
    )
  }));

  const header = (
    <header>
      <SheetBanner />
      <SheetTitleRow title={labels.invoice}>
        <SheetMetaRow label={labels.slNo}>{data.invoiceNumber}</SheetMetaRow>
        <SheetMetaRow label={labels.date}>{data.date}</SheetMetaRow>
      </SheetTitleRow>
      <SheetToRow label={labels.to}>{data.customerName}</SheetToRow>
    </header>
  );

  const tail = (
    <SheetTail
      labels={labels}
      amountInWords={data.amountInWords}
      summary={
        <>
          <SheetSummaryRow label={labels.subtotal} attached={false}>{data.money.subtotal}</SheetSummaryRow>
          <SheetSummaryRow label={labels.discount}>{data.discount}</SheetSummaryRow>
          <SheetVatRow
            label={labels.vatTax}
            amount={data.money.tax}
            rate={
              // Same boxes as the editor: a 28px right-aligned number followed by "%".
              <>
                <span className="block min-h-[1.4em] w-[28px] text-right">{data.taxRate}</span>
                {data.taxRate && <span>%</span>}
              </>
            }
          />
          <SheetSummaryRow label={labels.grandTotal} emphasis>{data.money.grandTotal}</SheetSummaryRow>
          <SheetSummaryRow label={labels.advance}>{data.advance}</SheetSummaryRow>
        </>
      }
      remaining={<SheetRemaining label={labels.remaining} value={data.money.remaining} />}
    />
  );

  const pages = paginateInvoiceRows(rows.length).map((page) => ({
    key: String(page.index),
    content: (
      <>
        {header}
        <SheetItemsTable labels={labels} caption={page.isFirst ? "Invoice items" : `Invoice items (continued, page ${page.index + 1})`}>
          <SheetRows rows={rows.slice(page.start, page.end)} />
        </SheetItemsTable>
        {page.isLast ? tail : <SheetPageFooter labels={labels} />}
      </>
    )
  }));

  return <InvoicePages ariaLabel={`Invoice ${data.invoiceNumber}`} printable={printable} pages={pages} />;
}
