"use client";

import smartSignLogo from "@/assets/smart_sign_logo.svg";
import { CalendarDays } from "lucide-react";
import { formatInvoiceDate, toDateInputValue } from "@/lib/invoice-utils";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceData } from "@/types/invoice";
import Image from "next/image";
import { useRef } from "react";

export function InvoiceHeader() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const labels = getInvoiceLabels();

  const updateCustomer = (key: keyof InvoiceData["customer"], value: string) =>
    updateInvoice({ customer: { ...invoice.customer, [key]: value } });

  return (
    <header>
      <div className="bg-[#231f20] px-4 pb-4 pt-8 sm:px-12 sm:pb-6 sm:pt-12">
        <div className="flex min-h-[88px] items-end justify-end sm:min-h-[130px]">
          <Image
            src={smartSignLogo}
            alt="Smart Sign Color Lab"
            width={430}
            height={122}
            priority
            className="h-auto w-[300px] object-contain sm:w-[430px]"
          />
        </div>
      </div>

      <div className="px-4 pb-4 pt-5 sm:px-10 sm:pb-5 sm:pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="font-sans text-[34px] font-black uppercase leading-none tracking-normal text-[#e01b24] sm:text-[42px]">
            {labels.invoice}
          </h1>

          <div className="grid gap-1.5 sm:w-auto">
            <MetaField
              label={labels.slNo}
              value={invoice.customer.invoiceNumber}
              onChange={(value) => updateCustomer("invoiceNumber", value)}
            />
            <DateMetaField
              label={labels.date}
              value={formatInvoiceDate(invoice.customer.date)}
              onChange={(value) => updateCustomer("date", value)}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-4 pb-4 sm:px-10">
        <span className="min-w-8 text-[15px] font-bold">{labels.to}</span>
        <Editable
          className="flex-1 px-1 py-1 text-[15px] font-bold outline-none"
          placeholder={labels.enterTo}
          value={invoice.customer.name}
          onChange={(value) => updateCustomer("name", value)}
        />
      </div>
    </header>
  );
}

function DateMetaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const dateInputRef = useRef<HTMLInputElement>(null);

  function openDatePicker() {
    const dateInput = dateInputRef.current;

    if (!dateInput) {
      return;
    }

    const pickerInput = dateInput as HTMLInputElement & { showPicker?: () => void };

    if (pickerInput.showPicker) {
      pickerInput.showPicker();
      return;
    }

    pickerInput.click();
  }

  return (
    <div className="flex items-center border-[1.5px] border-[#1a1a1a] bg-white">
      <span className="min-w-14 border-r-[1.5px] border-[#1a1a1a] px-2.5 py-1 text-xs font-semibold">
        {label}
      </span>
      <input
        className="min-w-0 flex-1 cursor-pointer border-0 bg-white px-2.5 py-1 text-xs outline-none sm:w-32 sm:flex-none"
        value={value}
        readOnly
        onClick={openDatePicker}
      />
      <button
        type="button"
        aria-label="Choose invoice date"
        className="relative grid min-w-10 cursor-pointer place-items-center border-l-[1.5px] border-[#1a1a1a] px-2 py-1 text-[#1a1a1a]"
        onClick={openDatePicker}
      >
        <CalendarDays className="size-3.5" aria-hidden="true" />
      </button>
      <input
        ref={dateInputRef}
        aria-label={label}
        className="pointer-events-none absolute size-px opacity-0"
        type="date"
        value={toDateInputValue(value)}
        onChange={(event) => onChange(formatInvoiceDate(event.target.value))}
      />
    </div>
  );
}

function MetaField({
  label,
  value,
  type = "text",
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center border-[1.5px] border-[#1a1a1a] bg-white">
      <span className="min-w-14 border-r-[1.5px] border-[#1a1a1a] px-2.5 py-1 text-xs font-semibold">
        {label}
      </span>
      <input
        className="min-w-0 flex-1 border-0 bg-white px-2.5 py-1 text-xs outline-none sm:w-40 sm:flex-none"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Editable({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      className={`border-0 bg-transparent outline-none ${className ?? ""}`}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
