"use client";

import { calculateTotals, formatDecimal, formatMoney } from "@/lib/invoice-utils";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";

export function InvoiceSummary() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const totals = calculateTotals(invoice);
  const currency = invoice.settings.currency;
  const compact = invoice.items.length > 8;
  const labels = getInvoiceLabels(invoice.settings.language);

  return (
    <>
      <section className={`flex justify-end px-4 sm:px-10 ${compact ? "pb-3" : "pb-5"}`}>
        <div className="w-full sm:w-[280px]">
          <SummaryRow compact={compact} label={labels.totalSqf} value={formatDecimal(totals.totalSqf)} />
          <SummaryRow compact={compact} label={labels.subtotal} value={formatMoney(totals.subtotal, currency)} />
          <EditableSummaryRow compact={compact} label={labels.vatTax} value={invoice.taxRate} onChange={(value) => updateInvoice({ taxRate: value })} />
          <div className={`grid grid-cols-[1fr_120px] items-center border border-t-0 border-[#ddd] bg-zinc-50 px-3.5 text-[13px] font-bold ${compact ? "py-1" : "py-2"}`}>
            <span>{labels.grandTotal}</span>
            <span className="text-right">{formatMoney(totals.grandTotal, currency)}</span>
          </div>
          <EditableSummaryRow compact={compact} label={labels.advance} value={invoice.advance} onChange={(value) => updateInvoice({ advance: value })} />
        </div>
      </section>

      <section className={`invoice-remaining-section flex justify-end px-4 sm:px-10 ${compact ? "pb-4" : "pb-7"}`}>
        <div className={`flex w-full min-w-0 items-center justify-end gap-3 rounded-full border-2 border-[#1a1a1a] px-5 font-sans text-[15px] font-extrabold sm:w-auto sm:min-w-60 sm:px-9 ${compact ? "py-1.5" : "py-2.5"}`}>
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
      <input
        className="w-full rounded bg-transparent text-right font-semibold outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
