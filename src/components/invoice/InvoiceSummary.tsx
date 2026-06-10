"use client";

import { useEffect, useState } from "react";
import { calculateTotals, formatMoney, parsePositiveInput, roundPositiveInput } from "@/lib/invoice-utils";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import type { CurrencyCode } from "@/types/invoice";

export function InvoiceSummary() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const totals = calculateTotals(invoice);
  const currency = invoice.settings.currency;
  const compact = invoice.items.length > 8;
  const dense = invoice.items.length > 12;
  const labels = getInvoiceLabels();

  return (
    <>
      <section className={`flex justify-end px-4 sm:px-10 ${dense ? "pb-2" : compact ? "pb-3" : "pb-5"}`}>
        <div className="w-full sm:w-[280px]">
          <SummaryRow compact={compact} label={labels.subtotal} value={formatMoney(totals.subtotal, currency)} />
          <EditableSummaryRow compact={compact} label={labels.discount} value={invoice.discount} onChange={(value) => updateInvoice({ discount: value })} />
          <VatTaxRow
            compact={compact}
            currency={currency}
            label={labels.vatTax}
            taxAmount={totals.tax}
            value={invoice.taxRate}
            onChange={(value) => updateInvoice({ taxRate: value })}
          />
          <div className={`grid grid-cols-[1fr_120px] items-center border border-t-0 border-[#ddd] bg-zinc-50 px-3.5 text-[13px] font-bold ${compact ? "py-1" : "py-2"}`}>
            <span>{labels.grandTotal}</span>
            <span className="text-right">{formatMoney(totals.grandTotal, currency)}</span>
          </div>
          <EditableSummaryRow compact={compact} label={labels.advance} value={invoice.advance} onChange={(value) => updateInvoice({ advance: value })} />
        </div>
      </section>

      <section className={`invoice-remaining-section flex justify-end px-4 sm:px-10 ${dense ? "pb-2" : compact ? "pb-4" : "pb-7"}`}>
        <div className={`flex w-full min-w-0 items-center justify-end gap-3 rounded-full border-2 border-[#1a1a1a] px-5 font-sans text-[15px] font-extrabold sm:w-auto sm:min-w-60 sm:px-9 ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}>
          <span>{labels.remaining}</span>
          <span className="text-[#e01b24]">{formatMoney(totals.remaining, currency)}</span>
        </div>
      </section>
    </>
  );
}

function SummaryRow({ label, value, compact }: { label: string; value: string; compact: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_120px] items-center border border-[#ddd] px-3.5 text-[13px] ${compact ? "py-1" : "py-2"}`}>
      <span className="font-semibold text-zinc-600">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function VatTaxRow({
  label,
  value,
  taxAmount,
  currency,
  onChange,
  compact
}: {
  label: string;
  value: number;
  taxAmount: number;
  currency: CurrencyCode;
  onChange: (value: number) => void;
  compact: boolean;
}) {
  return (
    <label className={`grid grid-cols-[minmax(0,1fr)_56px_120px] items-center border border-t-0 border-[#ddd] text-[13px] ${compact ? "py-1" : "py-2"}`}>
      <span className="whitespace-nowrap border-r border-[#ddd] px-3.5 font-semibold text-zinc-600">{label}</span>
      <span className="flex items-center justify-center border-r border-[#ddd] px-1.5">
        <SummaryNumberInput
          className="w-7 text-right"
          value={value}
          onChange={onChange}
        />
        {value > 0 && <span className="font-semibold text-zinc-600">%</span>}
      </span>
      <span className="px-3.5 text-right font-semibold text-zinc-800">{formatMoney(taxAmount, currency)}</span>
    </label>
  );
}

function EditableSummaryRow({
  label,
  value,
  onChange,
  compact
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact: boolean;
}) {
  return (
    <label className={`grid grid-cols-[1fr_120px] items-center border border-t-0 border-[#ddd] px-3.5 text-[13px] ${compact ? "py-1" : "py-2"}`}>
      <span className="font-semibold text-zinc-600">{label}</span>
      <SummaryNumberInput className="w-full text-right" value={value} onChange={onChange} />
    </label>
  );
}

function SummaryNumberInput({
  value,
  onChange,
  className
}: {
  value: number;
  onChange: (value: number) => void;
  className: string;
}) {
  const [displayValue, setDisplayValue] = useState(value === 0 ? "" : String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(value === 0 ? "" : String(value));
    }
  }, [isFocused, value]);

  return (
    <input
      className={`rounded bg-transparent font-semibold outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={() => setIsFocused(true)}
      onChange={(event) => {
        setDisplayValue(event.target.value);
        onChange(parsePositiveInput(event.target.value));
      }}
      onBlur={(event) => {
        const roundedValue = roundPositiveInput(event.target.value);
        setIsFocused(false);
        setDisplayValue(roundedValue === 0 ? "" : String(roundedValue));
        onChange(roundedValue);
      }}
    />
  );
}
