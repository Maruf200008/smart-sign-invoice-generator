"use client";

import { formatDecimal, lineSqf, parsePositiveInput, roundPositiveInput } from "@/lib/invoice-utils";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import { GripVertical, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

type EditableField = "name" | "width" | "height" | "quantity" | "unitPrice" | "total";
type SelectedCell = { rowId: string; field: EditableField } | null;

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
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [editingCell, setEditingCell] = useState<SelectedCell>(null);
  const pointerFocusRef = useRef(false);

  const isSelected = (rowId: string, field: EditableField) => selectedCell?.rowId === rowId && selectedCell.field === field;
  const isEditing = (rowId: string, field: EditableField) => editingCell?.rowId === rowId && editingCell.field === field;
  const selectCell = (rowId: string, field: EditableField) => {
    setSelectedCell({ rowId, field });
    setEditingCell(null);
  };
  const editCell = (rowId: string, field: EditableField, input: HTMLInputElement) => {
    setSelectedCell({ rowId, field });
    setEditingCell({ rowId, field });
    window.setTimeout(() => moveCursorToEnd(input), 0);
  };
  const markPointerFocus = () => {
    pointerFocusRef.current = true;
    window.setTimeout(() => {
      pointerFocusRef.current = false;
    }, 0);
  };
  const clearSelectedCell = (event: KeyboardEvent<HTMLInputElement>, rowId: string, field: EditableField, onClear: () => void) => {
    if (!isSelected(rowId, field) || isEditing(rowId, field) || (event.key !== "Delete" && event.key !== "Backspace")) {
      return;
    }

    event.preventDefault();
    onClear();
  };

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
              <th colSpan={3} className={`w-[72px] border-x border-white/35 px-0 text-center align-middle font-bold ${compact ? "py-1.5" : "py-2.5"}`}>
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
              const sqf = lineSqf(item);

              return (
                <tr
                  key={item.id}
                  className={`group transition-all duration-200 hover:bg-zinc-50 [&>td]:border-b [&>td]:border-[#ddd] [&>td]:transition-colors ${
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
                      readOnly={!isEditing(item.id, "name")}
                      onMouseDown={markPointerFocus}
                      onClick={() => selectCell(item.id, "name")}
                      onDoubleClick={(event) => editCell(item.id, "name", event.currentTarget)}
                      onFocus={(event) => {
                        if (!pointerFocusRef.current && !isEditing(item.id, "name")) {
                          editCell(item.id, "name", event.currentTarget);
                        }
                      }}
                      onKeyDown={(event) => clearSelectedCell(event, item.id, "name", () => updateItem(item.id, { name: "" }))}
                      onBlur={() => setEditingCell(null)}
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
                <td className={`w-[30px] px-0.5 ${compact ? "py-1" : "py-2"}`}>
                  <SizeInput
                    ariaLabel="Width"
                    value={item.width}
                    isSelected={isSelected(item.id, "width")}
                    isEditing={isEditing(item.id, "width")}
                    onSelect={() => selectCell(item.id, "width")}
                    onEdit={(input) => editCell(item.id, "width", input)}
                    onStopEdit={() => setEditingCell(null)}
                    onChange={(value) => updateItem(item.id, { width: value })}
                  />
                </td>
                <td className={`w-[10px] px-0 text-center text-xs font-bold text-zinc-400 ${compact ? "py-1" : "py-2"}`}>
                  {item.width > 0 || item.height > 0 ? "X" : ""}
                </td>
                <td className={`w-[30px] border-r border-[#ddd] px-0.5 ${compact ? "py-1" : "py-2"}`}>
                  <SizeInput
                    ariaLabel="Height"
                    value={item.height}
                    isSelected={isSelected(item.id, "height")}
                    isEditing={isEditing(item.id, "height")}
                    onSelect={() => selectCell(item.id, "height")}
                    onEdit={(input) => editCell(item.id, "height", input)}
                    onStopEdit={() => setEditingCell(null)}
                    onChange={(value) => updateItem(item.id, { height: value })}
                  />
                </td>
                <td className={`bg-zinc-50 px-1 text-center font-semibold text-[#1a1a1a] ${compact ? "py-1" : "py-2"}`}>
                  {sqf > 0 ? formatDecimal(sqf) : ""}
                </td>
                <td className={`px-1 ${compact ? "py-1" : "py-2"}`}>
                  <NumberInput
                    ariaLabel="Quantity"
                    className="text-center"
                    step="1"
                    value={item.quantity}
                    isSelected={isSelected(item.id, "quantity")}
                    isEditing={isEditing(item.id, "quantity")}
                    onSelect={() => selectCell(item.id, "quantity")}
                    onEdit={(input) => editCell(item.id, "quantity", input)}
                    onStopEdit={() => setEditingCell(null)}
                    onChange={(value) => updateItem(item.id, { quantity: value })}
                  />
                </td>
                <td className={`bg-zinc-50 px-1 ${compact ? "py-1" : "py-2"}`}>
                  <NumberInput
                    ariaLabel="Rate"
                    className="text-right"
                    value={item.unitPrice}
                    isSelected={isSelected(item.id, "unitPrice")}
                    isEditing={isEditing(item.id, "unitPrice")}
                    onSelect={() => selectCell(item.id, "unitPrice")}
                    onEdit={(input) => editCell(item.id, "unitPrice", input)}
                    onStopEdit={() => setEditingCell(null)}
                    onChange={(value) => updateItem(item.id, { unitPrice: value })}
                  />
                </td>
                <td className={`px-1.5 ${compact ? "py-1" : "py-2"}`}>
                  <TotalInput
                    ariaLabel="Total"
                    className="text-right font-semibold"
                    value={item.total}
                    isEditing={isEditing(item.id, "total")}
                    onSelect={() => selectCell(item.id, "total")}
                    onEdit={(input) => editCell(item.id, "total", input)}
                    onStopEdit={() => setEditingCell(null)}
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
  onChange,
  isSelected,
  isEditing,
  onSelect,
  onEdit,
  onStopEdit
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (input: HTMLInputElement) => void;
  onEdit: (input: HTMLInputElement) => void;
  onStopEdit: () => void;
}) {
  return (
    <NumberInput
      ariaLabel={ariaLabel}
      className="text-center"
      value={value}
      isSelected={isSelected}
      isEditing={isEditing}
      onSelect={onSelect}
      onEdit={onEdit}
      onStopEdit={onStopEdit}
      onChange={onChange}
    />
  );
}

function NumberInput({
  ariaLabel,
  value,
  onChange,
  isSelected,
  isEditing,
  onSelect,
  onEdit,
  onStopEdit,
  className = "",
  step = "0.01"
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: (input: HTMLInputElement) => void;
  onEdit: (input: HTMLInputElement) => void;
  onStopEdit: () => void;
  className?: string;
  step?: string;
}) {
  const pointerFocusRef = useRef(false);
  const markPointerFocus = () => {
    pointerFocusRef.current = true;
    window.setTimeout(() => {
      pointerFocusRef.current = false;
    }, 0);
  };

  return (
    <input
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="number"
      min="0"
      step={step}
      inputMode="decimal"
      value={value === 0 ? "" : value}
      readOnly={!isEditing}
      onMouseDown={markPointerFocus}
      onClick={(event) => onSelect(event.currentTarget)}
      onFocus={(event) => {
        if (!pointerFocusRef.current && !isEditing) {
          onEdit(event.currentTarget);
        }
      }}
      onDoubleClick={(event) => onEdit(event.currentTarget)}
      onKeyDown={(event) => {
        if (!isSelected || isEditing || (event.key !== "Delete" && event.key !== "Backspace")) {
          return;
        }

        event.preventDefault();
        onChange(0);
      }}
      onChange={(event) => onChange(parsePositiveInput(event.target.value))}
      onBlur={(event) => {
        onStopEdit();
        onChange(roundPositiveInput(event.target.value));
      }}
    />
  );
}

function TotalInput({
  ariaLabel,
  value,
  onChange,
  isEditing,
  onSelect,
  onEdit,
  onStopEdit,
  className = ""
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isEditing: boolean;
  onSelect: (input: HTMLInputElement) => void;
  onEdit: (input: HTMLInputElement) => void;
  onStopEdit: () => void;
  className?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(value === 0 ? "" : formatAmountInput(value));
  const pointerFocusRef = useRef(false);
  const markPointerFocus = () => {
    pointerFocusRef.current = true;
    window.setTimeout(() => {
      pointerFocusRef.current = false;
    }, 0);
  };

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(value === 0 ? "" : formatAmountInput(value));
    }
  }, [isFocused, value]);

  return (
    <input
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="text"
      inputMode="decimal"
      value={displayValue}
      readOnly={!isEditing}
      onMouseDown={markPointerFocus}
      onClick={(event) => onSelect(event.currentTarget)}
      onFocus={(event) => {
        if (pointerFocusRef.current) {
          return;
        }

        setIsFocused(true);
        setDisplayValue(value === 0 ? "" : String(value));
        onEdit(event.currentTarget);
      }}
      onDoubleClick={(event) => {
        setIsFocused(true);
        setDisplayValue(value === 0 ? "" : String(value));
        onEdit(event.currentTarget);
      }}
      onChange={(event) => {
        setDisplayValue(event.target.value);
        onChange(parseAmountInput(event.target.value));
      }}
      onBlur={(event) => {
        const roundedValue = roundPositiveInput(stripAmountFormatting(event.target.value));
        setIsFocused(false);
        onStopEdit();
        setDisplayValue(roundedValue === 0 ? "" : formatAmountInput(roundedValue));
        onChange(roundedValue);
      }}
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

function moveCursorToEnd(input: HTMLInputElement) {
  const cursorPosition = input.value.length;

  try {
    input.setSelectionRange(cursorPosition, cursorPosition);
  } catch {
    // Number inputs do not support text selection APIs in every browser.
  }
}
