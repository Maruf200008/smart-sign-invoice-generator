"use client";

import { InvoiceFooter } from "@/components/invoice/InvoiceFooter";
import { InvoiceHeader } from "@/components/invoice/InvoiceHeader";
import { InvoiceSummary } from "@/components/invoice/InvoiceSummary";
import { InvoiceTable } from "@/components/invoice/InvoiceTable";

export function InvoicePreview() {
  return (
    <article
      id="invoice-paper"
      className="invoice-paper relative mx-auto flex min-h-[auto] w-full max-w-[210mm] flex-col overflow-hidden rounded bg-white text-[#222] shadow-[0_8px_40px_rgba(0,0,0,0.18)] sm:min-h-[297mm] sm:w-[210mm] sm:shrink-0"
    >
      <div className="relative z-10 flex min-h-[auto] flex-col sm:min-h-[297mm]">
        <InvoiceHeader />
        <InvoiceTable />
        <InvoiceSummary />
        <InvoiceFooter />
      </div>
    </article>
  );
}
