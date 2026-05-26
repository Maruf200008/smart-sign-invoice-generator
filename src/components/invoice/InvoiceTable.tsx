"use client";

import { formatMoney, lineTotal } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import { GripVertical, Plus, X } from "lucide-react";
import { useState } from "react";

export function InvoiceTable() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const addItem = useInvoiceStore((state) => state.addItem);
  const updateItem = useInvoiceStore((state) => state.updateItem);
  const removeItem = useInvoiceStore((state) => state.removeItem);
  const reorderItem = useInvoiceStore((state) => state.reorderItem);
  const currency = invoice.settings.currency;
  const compact = invoice.items.length > 8;
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <section className={`px-4 sm:px-10 ${compact ? "pb-3" : "pb-5"}`}>
      <div className="overflow-x-auto">
        <table className={`min-w-[560px] w-full border-collapse text-left sm:min-w-0 ${compact ? "mt-2 text-[12px]" : "mt-4 text-[13px]"}`}>
          <thead>
            <tr className="bg-[#e01b24] text-white">
              <th className={`w-16 rounded-l-lg px-2 text-center font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                No
              </th>
              <th className={`px-2 font-bold ${compact ? "py-1.5" : "py-2.5"}`}>Item Description</th>
              <th className={`w-[70px] px-2 text-center font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                Qty
              </th>
              <th className={`w-[90px] px-2 text-right font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                Price
              </th>
              <th className={`w-[100px] rounded-r-lg px-3 text-right font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              <tr
                key={item.id}
                className={`group border-b border-[#ddd] transition-all duration-200 hover:bg-zinc-50 ${
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
                <td className={`px-2 ${compact ? "py-1" : "py-2"}`}>
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
                <td className={`px-2 ${compact ? "py-1" : "py-2"}`}>
                  <input
                    className="w-full rounded bg-transparent px-1 py-0.5 text-center outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                    type="number"
                    min="0"
                    step="1"
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(item.id, {
                        quantity: Number(event.target.value),
                      })
                    }
                  />
                </td>
                <td className={`px-2 ${compact ? "py-1" : "py-2"}`}>
                  <input
                    className="w-full rounded bg-transparent px-1 py-0.5 text-right outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(event) =>
                      updateItem(item.id, {
                        unitPrice: Number(event.target.value),
                      })
                    }
                  />
                </td>
                <td className={`px-3 text-right font-semibold text-[#1a1a1a] ${compact ? "py-1" : "py-2"}`}>
                  {formatMoney(lineTotal(item), currency)}
                </td>
              </tr>
            ))}
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
