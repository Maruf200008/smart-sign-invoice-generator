"use client";

import { parsePositiveInput, roundPositiveInput } from "@/lib/invoice-utils";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import { GripVertical, Plus, X } from "lucide-react";
import { useState } from "react";

export function InvoiceTable() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const addItem = useInvoiceStore((state) => state.addItem);
  const updateItem = useInvoiceStore((state) => state.updateItem);
  const removeItem = useInvoiceStore((state) => state.removeItem);
  const reorderItem = useInvoiceStore((state) => state.reorderItem);
  const compact = invoice.items.length > 8;
  const labels = getInvoiceLabels();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <section className={`px-4 sm:px-10 ${compact ? "pb-3" : "pb-5"}`}>
      <div className="overflow-x-auto">
        <table className={`min-w-[660px] w-full border-separate border-spacing-0 text-left sm:min-w-0 ${compact ? "mt-2 text-[12px]" : "mt-4 text-[13px]"}`}>
          <thead className="relative z-10">
            <tr className="bg-[#e01b24] text-white">
              <th className={`w-12 rounded-l-lg px-1.5 text-center align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.no}
              </th>
              <th className={`min-w-[300px] px-2 align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.productDescription}
              </th>
              <th colSpan={3} className={`w-[86px] border-x border-white/35 px-0 text-center align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.size}
              </th>
              <th className={`w-[48px] px-1 text-center align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.sqf}
              </th>
              <th className={`w-[42px] px-1 text-center align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.qty}
              </th>
              <th className={`w-[58px] px-1 text-right align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.rate}
              </th>
              <th className={`w-[86px] rounded-r-lg px-1.5 text-right align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                {labels.total}
              </th>
            </tr>
          </thead>
          <tbody className="relative z-0">
            {invoice.items.map((item, index) => {
              return (
                <tr
                  key={item.id}
                  className={`group transition-all duration-200 hover:bg-zinc-50 [&>td]:border-b [&>td]:border-[#ddd] ${
                    dragOverIndex === index ? "translate-y-0.5 bg-red-50 shadow-[inset_0_2px_0_#e01b24]" : ""
                  } ${draggedIndex === index ? "scale-[0.99] bg-white opacity-60 shadow-md" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverIndex(index);
                  }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={(event) => {
                    event.preventDefault();

                    if (draggedIndex !== null) {
                      reorderItem(draggedIndex, index);
                    }

                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                >
                <td className={`px-2 text-center text-xs text-zinc-500 ${compact ? "py-1" : "py-2"}`}>
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      draggable
                      aria-label="Drag row"
                      title="Drag row"
                      className="no-print grid size-6 cursor-grab place-items-center rounded text-zinc-400 transition-all duration-200 hover:scale-110 hover:bg-red-50 hover:text-[#e01b24] active:cursor-grabbing active:scale-95"
                      onDragStart={(event) => {
                        setDraggedIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                      }}
                    >
                      <GripVertical className="size-3.5" />
                    </button>
                    <span className="min-w-4">{index + 1}</span>
                  </div>
                </td>
                <td className={`bg-zinc-50 px-2 ${compact ? "py-1" : "py-2"}`}>
                  <div className="flex items-center gap-1">
                    <input
                      className="w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                      value={item.name}
                      onChange={(event) =>
                        updateItem(item.id, { name: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      aria-label="Remove row"
                      title="Remove row"
                      className="no-print grid size-7 shrink-0 place-items-center rounded text-zinc-400 transition hover:bg-red-50 hover:text-[#e01b24] sm:size-6 sm:opacity-0 sm:group-hover:opacity-100"
                      onClick={() => removeItem(item.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </td>
                <td className={`px-1 ${compact ? "py-1" : "py-2"}`}>
                  <SizeInput
                    ariaLabel="Width"
                    value={item.width}
                    onChange={(value) => updateItem(item.id, { width: value })}
                  />
                </td>
                <td className={`px-0 text-center text-xs font-bold text-zinc-400 ${compact ? "py-1" : "py-2"}`}>
                  {item.width > 0 || item.height > 0 ? "X" : ""}
                </td>
                <td className={`border-r border-[#ddd] px-1 ${compact ? "py-1" : "py-2"}`}>
                  <SizeInput
                    ariaLabel="Height"
                    value={item.height}
                    onChange={(value) => updateItem(item.id, { height: value })}
                  />
                </td>
                <td className={`bg-zinc-50 px-1 ${compact ? "py-1" : "py-2"}`}>
                  <NumberInput
                    ariaLabel="SQF"
                    className="text-center font-semibold"
                    value={item.sqf}
                    onChange={(value) => updateItem(item.id, { sqf: value })}
                  />
                </td>
                <td className={`px-1 ${compact ? "py-1" : "py-2"}`}>
                  <NumberInput
                    ariaLabel="Quantity"
                    className="text-center"
                    step="1"
                    value={item.quantity}
                    onChange={(value) => updateItem(item.id, { quantity: value })}
                  />
                </td>
                <td className={`bg-zinc-50 px-1 ${compact ? "py-1" : "py-2"}`}>
                  <NumberInput
                    ariaLabel="Rate"
                    className="text-right"
                    value={item.unitPrice}
                    onChange={(value) => updateItem(item.id, { unitPrice: value })}
                  />
                </td>
                <td className={`px-1.5 ${compact ? "py-1" : "py-2"}`}>
                  <TotalInput
                    ariaLabel="Total"
                    className="text-right font-semibold"
                    value={item.total}
                    onChange={(value) => updateItem(item.id, { total: value })}
                  />
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="no-print mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border-[1.5px] border-dashed border-[#ddd] px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-400 transition hover:border-[#e01b24] hover:text-[#e01b24]"
        onClick={addItem}
      >
        <Plus className="size-3.5" />
        Add Row
      </button>
    </section>
  );
}

function SizeInput({
  ariaLabel,
  value,
  onChange
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return <NumberInput ariaLabel={ariaLabel} className="text-center" value={value} onChange={onChange} />;
}

function NumberInput({
  ariaLabel,
  value,
  onChange,
  className = "",
  step = "0.01"
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  step?: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="number"
      min="0"
      step={step}
      inputMode="decimal"
      value={value === 0 ? "" : value}
      onChange={(event) => onChange(parsePositiveInput(event.target.value))}
      onBlur={(event) => onChange(roundPositiveInput(event.target.value))}
    />
  );
}

function TotalInput({
  ariaLabel,
  value,
  onChange,
  className = ""
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : formatAmountInput(value)}
      onChange={(event) => onChange(parseAmountInput(event.target.value))}
      onBlur={(event) => onChange(roundPositiveInput(stripAmountFormatting(event.target.value)))}
    />
  );
}

function formatAmountInput(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function parseAmountInput(value: string) {
  return parsePositiveInput(stripAmountFormatting(value));
}

function stripAmountFormatting(value: string) {
  return value.replace(/,/g, "");
}
