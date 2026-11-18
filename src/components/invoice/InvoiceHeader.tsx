"use client";

import { CalendarDays } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";
import { AutoGrowTextarea } from "@/components/invoice/sheet/AutoGrowTextarea";
import { SheetBanner, SheetMetaRow, SheetTitleRow, SheetToRow } from "@/components/invoice/sheet/SheetParts";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { formatInvoiceDate, toDateInputValue } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceData } from "@/types/invoice";

const fieldClass = "outline-none focus:bg-[#fff8f8]";

export function InvoiceHeader() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const labels = getInvoiceLabels();

  const updateCustomer = (key: keyof InvoiceData["customer"], value: string) =>
    updateInvoice({ customer: { ...invoice.customer, [key]: value } });

  return (
    <header>
      <SheetBanner />

      <SheetTitleRow title={labels.invoice}>
        <SheetMetaRow as="label" label={labels.slNo}>
          <AutoGrowTextarea
            aria-label={labels.slNo}
            className={fieldClass}
            value={invoice.customer.invoiceNumber}
            onKeyDown={blurOnEnter}
            onChange={(event) => updateCustomer("invoiceNumber", event.target.value)}
          />
        </SheetMetaRow>
        <DateMetaField
          label={labels.date}
          value={formatInvoiceDate(invoice.customer.date)}
          onChange={(value) => updateCustomer("date", value)}
        />
      </SheetTitleRow>

      <SheetToRow label={labels.to}>
        <AutoGrowTextarea
          aria-label="Customer name"
          className={fieldClass}
          placeholder={labels.enterTo}
          value={invoice.customer.name}
          onKeyDown={blurOnEnter}
          onChange={(event) => updateCustomer("name", event.target.value)}
        />
      </SheetToRow>
    </header>
  );
}

function blurOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

function DateMetaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const dateInputRef = useRef<HTMLInputElement>(null);

  function openDatePicker() {
    const pickerInput = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!pickerInput) return;

    try {
      if (pickerInput.showPicker) {
        pickerInput.showPicker();
        return;
      }
    } catch {
      // showPicker throws without a user gesture in some browsers; fall back to a click.
    }

    pickerInput.click();
  }

  return (
    <SheetMetaRow label={label}>
      <input
        aria-label={`${label} (click to choose)`}
        className={`block h-[1.4em] w-full cursor-pointer border-0 bg-transparent p-0 ${fieldClass}`}
        value={value}
        readOnly
        onClick={openDatePicker}
      />
      {/* Positioned over the cell edge so it takes no layout space: the cell is the same size as in the PDF. */}
      <button
        type="button"
        aria-label="Choose invoice date"
        className="no-print absolute inset-y-0 right-0 grid w-[40px] cursor-pointer place-items-center border-l-[1.5px] border-[#1a1a1a] text-[#1a1a1a] hover:text-[#e01b24]"
        onClick={openDatePicker}
      >
        <CalendarDays className="size-[14px]" aria-hidden="true" />
      </button>
      <input
        ref={dateInputRef}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
        type="date"
        value={toDateInputValue(value)}
        onChange={(event) => onChange(formatInvoiceDate(event.target.value))}
      />
    </SheetMetaRow>
  );
}
