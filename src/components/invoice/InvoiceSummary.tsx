"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useRowVisibility } from "@/components/invoice/row-visibility";
import { SheetRemaining, SheetSummaryRow, SheetTail, SheetVatRow } from "@/components/invoice/sheet/SheetParts";
import { toInvoiceDocument } from "@/lib/invoice-document";
import { getInvoiceLabels, localizeDigits } from "@/lib/invoice-labels";
import { parsePositiveInput, roundPositiveInput } from "@/lib/invoice-utils";
import { useInvoiceLanguage } from "@/store/invoice-language-store";
import { MAX_INVOICE_ITEMS, useInvoiceStore } from "@/store/invoice-store";

/** Summary, signature and contact footer of the editable invoice. Values are formatted exactly like the PDF. */
export function InvoiceSummary() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const updateInvoice = useInvoiceStore((state) => state.updateInvoice);
  const { canAddRow, revealRow } = useRowVisibility();
  const language = useInvoiceLanguage();
  const printable = toInvoiceDocument(invoice, language);
  const labels = getInvoiceLabels(language);

  const addRow = () => {
    const id = revealRow();
    if (!id) return;
    // Put the cursor straight into the new row's description.
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-row-id="${id}"][data-field="name"]`)?.focus(), 0);
  };

  return (
    <SheetTail
      labels={labels}
      amountInWords={printable.amountInWords}
      beforeSummary={
        <button
          type="button"
          className="flex w-full items-center justify-center gap-[8px] rounded-[6px] border-[1.5px] border-dashed border-[#ddd] px-[12px] py-[8px] text-[12px] font-bold uppercase leading-none tracking-wide text-[#a1a1aa] transition hover:border-[#e01b24] hover:text-[#e01b24] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#ddd] disabled:hover:text-[#a1a1aa]"
          disabled={!canAddRow}
          title={canAddRow ? labels.addRowTitle : labels.maxRowsTitle(MAX_INVOICE_ITEMS)}
          onClick={addRow}
        >
          <Plus className="size-[14px]" aria-hidden="true" />
          {labels.addRow}
        </button>
      }
      summary={
        <>
          <SheetSummaryRow label={labels.subtotal} attached={false}>{printable.money.subtotal}</SheetSummaryRow>
          <SheetSummaryRow as="label" label={labels.discount}>
            <SummaryNumberInput ariaLabel={labels.discount} className="text-right" value={invoice.discount} onChange={(value) => updateInvoice({ discount: value })} />
          </SheetSummaryRow>
          <SheetVatRow
            as="label"
            label={labels.vatTax}
            amount={printable.money.tax}
            rate={
              <>
                <SummaryNumberInput
                  ariaLabel={labels.taxRateAria}
                  className="w-[28px] text-right"
                  value={invoice.taxRate}
                  onChange={(value) => updateInvoice({ taxRate: value })}
                />
                {invoice.taxRate > 0 && <span>%</span>}
              </>
            }
          />
          <SheetSummaryRow label={labels.grandTotal} emphasis>{printable.money.grandTotal}</SheetSummaryRow>
          <SheetSummaryRow as="label" label={labels.advance}>
            <SummaryNumberInput ariaLabel={labels.advance} className="text-right" value={invoice.advance} onChange={(value) => updateInvoice({ advance: value })} />
          </SheetSummaryRow>
        </>
      }
      remaining={<SheetRemaining label={labels.remaining} value={printable.money.remaining} />}
    />
  );
}

function SummaryNumberInput({
  ariaLabel,
  value,
  onChange,
  className
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  className: string;
}) {
  // Shown in the invoice digits; Bengali or Latin digits can be typed (parsePositiveInput reads both).
  const language = useInvoiceLanguage();
  const show = (number: number) => (number === 0 ? "" : localizeDigits(String(number), language));
  const [displayValue, setDisplayValue] = useState(() => show(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(show(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` only depends on `language`, listed here.
  }, [isFocused, value, language]);

  return (
    <input
      aria-label={ariaLabel}
      className={cn("block h-[1.4em] w-full min-w-0 border-0 bg-transparent p-0 font-semibold outline-none focus:bg-[#fff8f8]", className)}
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
        setDisplayValue(show(roundedValue));
        onChange(roundedValue);
      }}
    />
  );
}
