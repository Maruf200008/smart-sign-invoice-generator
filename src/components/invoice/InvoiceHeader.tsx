"use client";

import smartSignLogo from "@/assets/smart_sign_logo.png";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceData } from "@/types/invoice";
import Image from "next/image";

export function InvoiceHeader() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const labels = getInvoiceLabels(invoice.settings.language);

  const updateCustomer = (key: keyof InvoiceData["customer"], value: string) =>
    updateInvoice({ customer: { ...invoice.customer, [key]: value } });

  return (
    <header>
      <div className="relative min-h-32 px-4 pb-5 pt-5 sm:min-h-40 sm:px-10 sm:pb-6 sm:pt-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-0">
          <h1 className="mt-28 font-sans text-[34px] font-black uppercase leading-none tracking-normal text-[#e01b24] sm:mt-32 sm:text-[42px]">
            {labels.invoice}
          </h1>

          <div className="mt-2 flex flex-col items-stretch sm:mt-0 sm:items-end">
            <Image
              src={smartSignLogo}
              alt="Smart Sign Color Lab"
              width={300}
              height={101}
              priority
              className="h-auto w-[220px] object-contain sm:w-[300px]"
            />

            <div className="mt-3 grid gap-1.5 sm:w-auto">
              <MetaField
                label={labels.slNo}
                value={invoice.customer.invoiceNumber}
                onChange={(value) => updateCustomer("invoiceNumber", value)}
              />
              <MetaField
                label={labels.date}
                type="date"
                value={invoice.customer.date}
                onChange={(value) => updateCustomer("date", value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-4 pb-4 pt-2 sm:px-10">
        <span className="min-w-7 text-[13px] font-semibold">{labels.to}</span>
        <Editable
          className="flex-1 px-1 py-1 text-[13px] outline-none"
          placeholder={labels.enterTo}
          value={invoice.customer.name}
          onChange={(value) => updateCustomer("name", value)}
        />
      </div>
    </header>
  );
}

function MetaField({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
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
