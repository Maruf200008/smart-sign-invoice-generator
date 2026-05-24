"use client";

import { Plus, X } from "lucide-react";
import { formatMoney, lineTotal } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";

export function InvoiceTable() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const addItem = useInvoiceStore((state) => state.addItem);
  const updateItem = useInvoiceStore((state) => state.updateItem);
  const removeItem = useInvoiceStore((state) => state.removeItem);
  const currency = invoice.settings.currency;

  return (
    <section className="px-4 pb-5 sm:px-10">
      <div className="overflow-x-auto">
      <table className="mt-4 min-w-[560px] w-full border-collapse text-left text-[13px] sm:min-w-0">
        <thead>
          <tr className="bg-[#e01b24] text-white">
            <th className="w-10 rounded-l-lg px-2 py-2.5 text-center font-bold">No</th>
            <th className="px-2 py-2.5 font-bold">Item Description</th>
            <th className="w-[70px] px-2 py-2.5 text-center font-bold">Qty</th>
            <th className="w-[90px] px-2 py-2.5 text-right font-bold">Price</th>
            <th className="w-[100px] rounded-r-lg px-3 py-2.5 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={item.id} className="group border-b border-[#ddd] hover:bg-zinc-50">
              <td className="px-2 py-2 text-center text-xs text-zinc-500">{index + 1}</td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-1">
                  <input
                    className="w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                    value={item.name}
                    onChange={(event) => updateItem(item.id, { name: event.target.value })}
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
              <td className="px-2 py-2">
                <input
                  className="w-full rounded bg-transparent px-1 py-0.5 text-center outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                  type="number"
                  min="0"
                  step="1"
                  value={item.quantity}
                  onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })}
                />
              </td>
              <td className="px-2 py-2">
                <input
                  className="w-full rounded bg-transparent px-1 py-0.5 text-right outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value) })}
                />
              </td>
              <td className="px-3 py-2 text-right font-semibold text-[#1a1a1a]">{formatMoney(lineTotal(item), currency)}</td>
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
