"use client";

import Image from "next/image";
import bottomSide from "@/assets/bottom_side.svg";
import topSide from "@/assets/top_side-01.svg";
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
      <Image
        src={topSide.src}
        alt=""
        width={320}
        height={188}
        unoptimized
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-0 w-[190px] select-none sm:w-[320px]"
      />
      <Image
        src={bottomSide.src}
        alt=""
        width={320}
        height={188}
        unoptimized
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 z-0 w-[190px] select-none sm:w-[320px]"
      />
      <div className="relative z-10 flex min-h-[auto] flex-col sm:min-h-[297mm]">
        <InvoiceHeader />
        <InvoiceTable />
        <InvoiceSummary />
        <InvoiceFooter />
      </div>
    </article>
  );
}
