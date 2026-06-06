"use client";

import { getInvoiceLabels } from "@/lib/invoice-labels";
import {
  formatDecimal,
  lineQuantitySqf,
  parsePositiveInput,
  roundPositiveInput,
} from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import { GripVertical, Plus, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";

type EditableField =
  | "name"
  | "width"
  | "height"
  | "quantity"
  | "unitPrice"
  | "total";
type SelectedCell = { rowId: string; field: EditableField } | null;
const EDITABLE_FIELDS: EditableField[] = [
  "name",
  "width",
  "height",
  "quantity",
  "unitPrice",
  "total",
];
const SINGLE_CLICK_DELAY_MS = 180;
const MAX_INVOICE_ROWS = 15;

export function InvoiceTable() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const addItem = useInvoiceStore((state) => state.addItem);
  const updateItem = useInvoiceStore((state) => state.updateItem);
  const removeItem = useInvoiceStore((state) => state.removeItem);
  const reorderItem = useInvoiceStore((state) => state.reorderItem);
  const compact = invoice.items.length > 8;
  const dense = invoice.items.length > 12;
  const canAddRow = invoice.items.length < MAX_INVOICE_ROWS;
  const labels = getInvoiceLabels();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [editingCell, setEditingCell] = useState<SelectedCell>(null);
  const pointerFocusRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const replaceOnTypeCellRef = useRef<SelectedCell>(null);

  const isSelected = (rowId: string, field: EditableField) =>
    selectedCell?.rowId === rowId && selectedCell.field === field;
  const isEditing = (rowId: string, field: EditableField) =>
    editingCell?.rowId === rowId && editingCell.field === field;
  const editCell = (
    rowId: string,
    field: EditableField,
    input: HTMLInputElement,
    options: { moveCursorToEnd?: boolean; replaceOnType?: boolean } = {},
  ) => {
    setSelectedCell({ rowId, field });
    setEditingCell({ rowId, field });
    replaceOnTypeCellRef.current = options.replaceOnType ? { rowId, field } : null;
    input.readOnly = false;

    if (options.moveCursorToEnd ?? true) {
      window.setTimeout(() => moveCursorToEnd(input), 0);
    }
  };
  const stopEditingCell = (rowId: string, field: EditableField) => {
    setEditingCell((currentCell) => {
      if (currentCell?.rowId === rowId && currentCell.field === field) {
        return null;
      }

      return currentCell;
    });
    replaceOnTypeCellRef.current = null;
  };
  const markPointerFocus = () => {
    pointerFocusRef.current = true;
    window.setTimeout(() => {
      pointerFocusRef.current = false;
    }, 0);
  };
  const runSingleClick = (callback: () => void) => {
    cancelSingleClick(clickTimerRef);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      callback();
    }, SINGLE_CLICK_DELAY_MS);
  };
  const clearSelectedCell = (
    event: KeyboardEvent<HTMLInputElement>,
    rowId: string,
    field: EditableField,
    onClear: () => void,
  ) => {
    if (
      !isSelected(rowId, field) ||
      isEditing(rowId, field) ||
      (event.key !== "Delete" && event.key !== "Backspace")
    ) {
      return;
    }

    event.preventDefault();
    onClear();
  };
  const replaceSelectedCellValue = (
    event: KeyboardEvent<HTMLInputElement>,
    rowId: string,
    field: EditableField,
    onReplace: (value: string) => void,
  ) => {
    if (
      !isSelected(rowId, field) ||
      isEditing(rowId, field) ||
      !isTextEntryKey(event)
    ) {
      return false;
    }

    event.preventDefault();
    event.currentTarget.readOnly = false;
    setEditingCell({ rowId, field });
    onReplace(event.key);
    window.setTimeout(() => activateInput(event.currentTarget), 0);
    return true;
  };
  const replaceArmedCellValue = (
    event: KeyboardEvent<HTMLInputElement>,
    rowId: string,
    field: EditableField,
    onReplace: (value: string) => void,
  ) => {
    if (
      replaceOnTypeCellRef.current?.rowId !== rowId ||
      replaceOnTypeCellRef.current.field !== field ||
      !isEditing(rowId, field) ||
      !isTextEntryKey(event)
    ) {
      return false;
    }

    event.preventDefault();
    replaceOnTypeCellRef.current = null;
    onReplace(event.key);
    window.setTimeout(() => activateInput(event.currentTarget), 0);
    return true;
  };
  const focusInput = (rowId: string, field: EditableField) => {
    setSelectedCell({ rowId, field });
    setEditingCell({ rowId, field });
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-row-id="${rowId}"][data-field="${field}"]`,
      );
      if (input) {
        activateInput(input);
        setSelectedCell({ rowId, field });
        setEditingCell({ rowId, field });
      }
    }, 0);
  };
  const focusRowInput = (
    currentRowId: string,
    field: EditableField,
    direction: -1 | 1,
  ) => {
    const currentIndex = invoice.items.findIndex(
      (item) => item.id === currentRowId,
    );
    const nextItem = invoice.items[currentIndex + direction];

    if (!nextItem) {
      return;
    }

    focusInput(nextItem.id, field);
  };
  const focusSideInput = (
    rowId: string,
    field: EditableField,
    direction: -1 | 1,
  ) => {
    const currentFieldIndex = EDITABLE_FIELDS.indexOf(field);
    const nextField = EDITABLE_FIELDS[currentFieldIndex + direction];

    if (!nextField) {
      return;
    }

    focusInput(rowId, nextField);
  };
  const handleInputNavigation = (
    event: KeyboardEvent<HTMLInputElement>,
    rowId: string,
    field: EditableField,
  ) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Enter"
    ) {
      return;
    }

    event.preventDefault();

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      focusSideInput(rowId, field, event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    focusRowInput(rowId, field, event.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <section className={`px-4 sm:px-10 ${dense ? "pb-2" : compact ? "pb-3" : "pb-5"}`}>
      <div className="overflow-x-auto">
        <table
          className={`min-w-[660px] w-full border-separate border-spacing-0 text-left sm:min-w-0 ${compact ? "mt-2 text-[12px]" : "mt-4 text-[13px]"}`}
        >
          <thead className="relative z-10">
            <tr className="bg-[#e01b24] text-white">
              <th
                className={`w-12 rounded-l-lg px-1.5 text-center align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.no}
              </th>
              <th
                className={`min-w-[300px] px-2 align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.productDescription}
              </th>
              <th
                colSpan={3}
                className={`w-[72px] border-x border-white/35 px-0 text-center align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.size}
              </th>
              <th
                className={`w-[42px] px-1 text-center align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.qty}
              </th>
              <th
                className={`w-[48px] px-1 text-center align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.sqf}
              </th>
              <th
                className={`w-[58px] px-1 text-right align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.rate}
              </th>
              <th
                className={`w-[86px] rounded-r-lg px-1.5 text-right align-middle font-bold ${dense ? "py-1" : compact ? "py-1.5" : "py-2.5"}`}
              >
                {labels.total}
              </th>
            </tr>
          </thead>
          <tbody className="relative z-0">
            {invoice.items.map((item, index) => {
              const quantitySqf = lineQuantitySqf(item);

              return (
                <tr
                  key={item.id}
                  className={`group transition-all duration-200 hover:bg-zinc-50 [&>td]:border-b [&>td]:border-[#ddd] [&>td]:transition-colors ${
                    dragOverIndex === index
                      ? "translate-y-0.5 bg-red-50 shadow-[inset_0_2px_0_#e01b24]"
                      : ""
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
                  <td
                    className={`px-2 text-center text-xs text-zinc-500 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
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
                  <td
                    className={`bg-zinc-50 px-2 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    <div className="flex items-center gap-1">
                      <input
                        data-row-id={item.id}
                        data-field="name"
                        className="w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24]"
                        value={item.name}
                        readOnly={!isEditing(item.id, "name")}
                        onMouseDown={(event) => {
                          markPointerFocus();

                          if (event.detail > 1) {
                            editCell(item.id, "name", event.currentTarget, {
                              moveCursorToEnd: false,
                              replaceOnType: true,
                            });
                          }
                        }}
                        onClick={(event) => {
                          if (event.detail > 1) {
                            cancelSingleClick(clickTimerRef);
                            editCell(item.id, "name", event.currentTarget, {
                              moveCursorToEnd: false,
                              replaceOnType: true,
                            });
                            return;
                          }

                          const input = event.currentTarget;
                          runSingleClick(() =>
                            editCell(item.id, "name", input, {
                              moveCursorToEnd: false,
                            }),
                          );
                        }}
                        onDoubleClick={(event) => {
                          cancelSingleClick(clickTimerRef);
                          editCell(item.id, "name", event.currentTarget, {
                            moveCursorToEnd: false,
                            replaceOnType: true,
                          });
                        }}
                        onFocus={(event) => {
                          if (
                            !pointerFocusRef.current &&
                            !isEditing(item.id, "name")
                          ) {
                            editCell(item.id, "name", event.currentTarget);
                          }
                        }}
                        onKeyDown={(event) => {
                          handleInputNavigation(event, item.id, "name");
                          if (event.defaultPrevented) {
                            return;
                          }

                          if (
                            replaceArmedCellValue(
                              event,
                              item.id,
                              "name",
                              (value) => updateItem(item.id, { name: value }),
                            )
                          ) {
                            return;
                          }

                          if (
                            replaceSelectedCellValue(
                              event,
                              item.id,
                              "name",
                              (value) => updateItem(item.id, { name: value }),
                            )
                          ) {
                            return;
                          }

                          clearSelectedCell(event, item.id, "name", () =>
                            updateItem(item.id, { name: "" }),
                          );
                        }}
                        onBlur={() => stopEditingCell(item.id, "name")}
                        onChange={(event) =>
                          updateItem(item.id, { name: event.target.value })
                        }
                      />
                    </div>
                  </td>
                  <td
                    className={`w-[30px] px-0.5 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    <SizeInput
                      ariaLabel="Width"
                      value={item.width}
                      isSelected={isSelected(item.id, "width")}
                      isEditing={isEditing(item.id, "width")}
                      onEdit={(input, options) =>
                        editCell(item.id, "width", input, options)
                      }
                      onStopEdit={() => stopEditingCell(item.id, "width")}
                      onNavigate={(event) =>
                        handleInputNavigation(event, item.id, "width")
                      }
                      rowId={item.id}
                      field="width"
                      onChange={(value) =>
                        updateItem(item.id, { width: value })
                      }
                    />
                  </td>
                  <td
                    className={`w-[10px] px-0 text-center text-xs font-bold text-zinc-400 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    {item.width > 0 || item.height > 0 ? "X" : ""}
                  </td>
                  <td
                    className={`w-[30px] border-r border-[#ddd] px-0.5 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    <SizeInput
                      ariaLabel="Height"
                      value={item.height}
                      isSelected={isSelected(item.id, "height")}
                      isEditing={isEditing(item.id, "height")}
                      onEdit={(input, options) =>
                        editCell(item.id, "height", input, options)
                      }
                      onStopEdit={() => stopEditingCell(item.id, "height")}
                      onNavigate={(event) =>
                        handleInputNavigation(event, item.id, "height")
                      }
                      rowId={item.id}
                      field="height"
                      onChange={(value) =>
                        updateItem(item.id, { height: value })
                      }
                    />
                  </td>
                  <td
                    className={`px-1 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    <NumberInput
                      ariaLabel="Quantity"
                      className="text-center"
                      step="1"
                      value={item.quantity}
                      isSelected={isSelected(item.id, "quantity")}
                      isEditing={isEditing(item.id, "quantity")}
                      onEdit={(input, options) =>
                        editCell(item.id, "quantity", input, options)
                      }
                      onStopEdit={() => stopEditingCell(item.id, "quantity")}
                      onNavigate={(event) =>
                        handleInputNavigation(event, item.id, "quantity")
                      }
                      rowId={item.id}
                      field="quantity"
                      onChange={(value) =>
                        updateItem(item.id, { quantity: value })
                      }
                    />
                  </td>
                  <td className={`bg-zinc-50 px-1 text-center font-semibold text-[#1a1a1a] ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}>
                    {quantitySqf > 0 ? formatDecimal(quantitySqf) : ""}
                  </td>
                  <td
                    className={`px-1 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}
                  >
                    <NumberInput
                      ariaLabel="Rate"
                      className="text-right"
                      value={item.unitPrice}
                      isSelected={isSelected(item.id, "unitPrice")}
                      isEditing={isEditing(item.id, "unitPrice")}
                      onEdit={(input, options) =>
                        editCell(item.id, "unitPrice", input, options)
                      }
                      onStopEdit={() => stopEditingCell(item.id, "unitPrice")}
                      onNavigate={(event) =>
                        handleInputNavigation(event, item.id, "unitPrice")
                      }
                      rowId={item.id}
                      field="unitPrice"
                      onChange={(value) =>
                        updateItem(item.id, { unitPrice: value })
                      }
                    />
                  </td>
                  <td className={`bg-zinc-50 px-1.5 ${dense ? "py-0.5" : compact ? "py-1" : "py-2"}`}>
                    <div className="flex items-center gap-1">
                      <TotalInput
                        ariaLabel="Total"
                        className="text-right font-semibold"
                        value={item.total}
                        isSelected={isSelected(item.id, "total")}
                        isEditing={isEditing(item.id, "total")}
                        onEdit={(input, options) =>
                          editCell(item.id, "total", input, options)
                        }
                        onStopEdit={() => stopEditingCell(item.id, "total")}
                        onNavigate={(event) =>
                          handleInputNavigation(event, item.id, "total")
                        }
                        rowId={item.id}
                        field="total"
                        onChange={(value) =>
                          updateItem(item.id, { total: value })
                        }
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Remove row"
                        title="Remove row"
                        className="no-print grid size-7 shrink-0 place-items-center rounded text-zinc-400 transition hover:bg-red-50 hover:text-[#e01b24] sm:size-6 sm:opacity-0 sm:group-hover:opacity-100"
                        onClick={() => removeItem(item.id)}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="no-print mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border-[1.5px] border-dashed border-[#ddd] px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-400 transition hover:border-[#e01b24] hover:text-[#e01b24] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#ddd] disabled:hover:text-zinc-400"
        disabled={!canAddRow}
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
  onEdit,
  onStopEdit,
  onNavigate,
  rowId,
  field,
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isSelected: boolean;
  isEditing: boolean;
  onEdit: (
    input: HTMLInputElement,
    options?: { moveCursorToEnd?: boolean; replaceOnType?: boolean },
  ) => void;
  onStopEdit: () => void;
  onNavigate: (event: KeyboardEvent<HTMLInputElement>) => void;
  rowId: string;
  field: EditableField;
}) {
  return (
    <NumberInput
      ariaLabel={ariaLabel}
      className="text-center"
      value={value}
      isSelected={isSelected}
      isEditing={isEditing}
      onEdit={onEdit}
      onStopEdit={onStopEdit}
      onNavigate={onNavigate}
      rowId={rowId}
      field={field}
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
  onEdit,
  onStopEdit,
  onNavigate,
  rowId,
  field,
  className = "",
  step = "0.01",
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isSelected: boolean;
  isEditing: boolean;
  onEdit: (
    input: HTMLInputElement,
    options?: { moveCursorToEnd?: boolean; replaceOnType?: boolean },
  ) => void;
  onStopEdit: () => void;
  onNavigate: (event: KeyboardEvent<HTMLInputElement>) => void;
  rowId: string;
  field: EditableField;
  className?: string;
  step?: string;
}) {
  const pointerFocusRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const replaceOnTypeRef = useRef(false);
  const markPointerFocus = () => {
    pointerFocusRef.current = true;
    window.setTimeout(() => {
      pointerFocusRef.current = false;
    }, 0);
  };

  return (
    <input
      data-row-id={rowId}
      data-field={field}
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="text"
      min="0"
      step={step}
      inputMode="decimal"
      value={value === 0 ? "" : value}
      readOnly={!isEditing}
      onMouseDown={(event) => {
        markPointerFocus();

        if (event.detail > 1) {
          replaceOnTypeRef.current = true;
          onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
        }
      }}
      onClick={(event) => {
        if (event.detail > 1) {
          cancelSingleClick(clickTimerRef);
          replaceOnTypeRef.current = true;
          onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
          return;
        }

        const input = event.currentTarget;
        scheduleSingleClick(clickTimerRef, () => {
          replaceOnTypeRef.current = false;
          onEdit(input, { moveCursorToEnd: false });
        });
      }}
      onFocus={(event) => {
        if (!pointerFocusRef.current && !isEditing) {
          replaceOnTypeRef.current = false;
          onEdit(event.currentTarget);
        }
      }}
      onDoubleClick={(event) => {
        cancelSingleClick(clickTimerRef);
        replaceOnTypeRef.current = true;
        onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
      }}
      onKeyDown={(event) => {
        onNavigate(event);
        if (event.defaultPrevented) {
          return;
        }

        if (replaceOnTypeRef.current && isEditing && isNumericEntryKey(event)) {
          event.preventDefault();
          replaceOnTypeRef.current = false;
          onChange(parsePositiveInput(event.key));
          window.setTimeout(() => activateInput(event.currentTarget), 0);
          return;
        }

        if (shouldReplaceSelectedInput(event, isSelected, isEditing)) {
          event.preventDefault();
          event.currentTarget.readOnly = false;
          replaceOnTypeRef.current = false;
          onEdit(event.currentTarget);
          onChange(parsePositiveInput(event.key));
          window.setTimeout(() => activateInput(event.currentTarget), 0);
          return;
        }

        if (
          !isSelected ||
          isEditing ||
          (event.key !== "Delete" && event.key !== "Backspace")
        ) {
          return;
        }

        event.preventDefault();
        onChange(0);
      }}
      onChange={(event) => onChange(parsePositiveInput(event.target.value))}
      onBlur={(event) => {
        replaceOnTypeRef.current = false;
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
  isSelected,
  isEditing,
  onEdit,
  onStopEdit,
  onNavigate,
  rowId,
  field,
  className = "",
}: {
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
  isSelected: boolean;
  isEditing: boolean;
  onEdit: (
    input: HTMLInputElement,
    options?: { moveCursorToEnd?: boolean; replaceOnType?: boolean },
  ) => void;
  onStopEdit: () => void;
  onNavigate: (event: KeyboardEvent<HTMLInputElement>) => void;
  rowId: string;
  field: EditableField;
  className?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(
    value === 0 ? "" : formatAmountInput(value),
  );
  const pointerFocusRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const replaceOnTypeRef = useRef(false);
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
      data-row-id={rowId}
      data-field={field}
      aria-label={ariaLabel}
      className={`w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-[#fff8f8] focus:outline focus:outline-1 focus:outline-[#e01b24] ${className}`}
      type="text"
      inputMode="decimal"
      value={displayValue}
      readOnly={!isEditing}
      onMouseDown={(event) => {
        markPointerFocus();

        if (event.detail > 1) {
          replaceOnTypeRef.current = true;
          onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
        }
      }}
      onClick={(event) => {
        if (event.detail > 1) {
          cancelSingleClick(clickTimerRef);
          replaceOnTypeRef.current = true;
          onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
          return;
        }

        const input = event.currentTarget;
        scheduleSingleClick(clickTimerRef, () => {
          replaceOnTypeRef.current = false;
          setIsFocused(true);
          setDisplayValue(value === 0 ? "" : String(value));
          onEdit(input, { moveCursorToEnd: false });
        });
      }}
      onFocus={(event) => {
        if (pointerFocusRef.current) {
          return;
        }

        setIsFocused(true);
        setDisplayValue(value === 0 ? "" : String(value));
        replaceOnTypeRef.current = false;
        onEdit(event.currentTarget, { moveCursorToEnd: false });
      }}
      onDoubleClick={(event) => {
        cancelSingleClick(clickTimerRef);
        replaceOnTypeRef.current = true;
        onEdit(event.currentTarget, { moveCursorToEnd: false, replaceOnType: true });
      }}
      onKeyDown={(event) => {
        onNavigate(event);
        if (event.defaultPrevented) {
          return;
        }

        if (replaceOnTypeRef.current && isEditing && isNumericEntryKey(event)) {
          event.preventDefault();
          replaceOnTypeRef.current = false;
          setDisplayValue(event.key);
          onChange(parseAmountInput(event.key));
          window.setTimeout(() => activateInput(event.currentTarget), 0);
          return;
        }

        if (shouldReplaceSelectedInput(event, isSelected, isEditing)) {
          event.preventDefault();
          event.currentTarget.readOnly = false;
          replaceOnTypeRef.current = false;
          setIsFocused(true);
          setDisplayValue(event.key);
          onEdit(event.currentTarget);
          onChange(parseAmountInput(event.key));
          window.setTimeout(() => activateInput(event.currentTarget), 0);
        }
      }}
      onChange={(event) => {
        setDisplayValue(event.target.value);
        onChange(parseAmountInput(event.target.value));
      }}
      onBlur={(event) => {
        const roundedValue = roundPositiveInput(
          stripAmountFormatting(event.target.value),
        );
        replaceOnTypeRef.current = false;
        setIsFocused(false);
        onStopEdit();
        setDisplayValue(
          roundedValue === 0 ? "" : formatAmountInput(roundedValue),
        );
        onChange(roundedValue);
      }}
    />
  );
}

function formatAmountInput(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function parseAmountInput(value: string) {
  return parsePositiveInput(stripAmountFormatting(value));
}

function stripAmountFormatting(value: string) {
  return value.replace(/,/g, "");
}

function isTextEntryKey(event: KeyboardEvent<HTMLInputElement>) {
  return (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

function isNumericEntryKey(event: KeyboardEvent<HTMLInputElement>) {
  return isTextEntryKey(event) && /^[\d.,]$/.test(event.key);
}

function shouldReplaceSelectedInput(
  event: KeyboardEvent<HTMLInputElement>,
  isSelected: boolean,
  isEditing: boolean,
) {
  return isSelected && !isEditing && isNumericEntryKey(event);
}

function scheduleSingleClick(
  timerRef: MutableRefObject<number | null>,
  callback: () => void,
) {
  cancelSingleClick(timerRef);
  timerRef.current = window.setTimeout(() => {
    timerRef.current = null;
    callback();
  }, SINGLE_CLICK_DELAY_MS);
}

function cancelSingleClick(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function moveCursorToEnd(input: HTMLInputElement) {
  const cursorPosition = input.value.length;

  try {
    input.setSelectionRange(cursorPosition, cursorPosition);
  } catch {
    // Number inputs do not support text selection APIs in every browser.
  }
}

function activateInput(input: HTMLInputElement) {
  input.readOnly = false;
  input.focus();
  moveCursorToEnd(input);
}
