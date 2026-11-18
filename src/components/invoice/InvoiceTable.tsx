"use client";

import { GridContextMenu, type GridMenuAction } from "@/components/invoice/GridContextMenu";
import { useRowVisibility } from "@/components/invoice/row-visibility";
import { AutoGrowTextarea } from "@/components/invoice/sheet/AutoGrowTextarea";
import { SheetItemsTable, SheetRows } from "@/components/invoice/sheet/SheetParts";
import { sheetClasses } from "@/components/invoice/sheet/sheet-styles";
import { cn } from "@/lib/cn";
import { formatLineTotal, isBlankItem, plainNumber } from "@/lib/invoice-document";
import {
  type CellPos,
  type CellRange,
  type GridField,
  GRID_COLUMN_COUNT,
  GRID_FIELDS,
  MAX_NAME_LENGTH,
  cellEditText,
  clearCells,
  clearRows,
  committedCellPatch,
  deleteRows,
  duplicateRows,
  inRange,
  insertRows,
  isNumericField,
  isNumericText,
  liveCellPatch,
  normalizeRange,
  parseTsv,
  pasteCells,
  rangeToTsv,
  samePos
} from "@/lib/invoice-grid";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { formatDecimal, lineQuantitySqf } from "@/lib/invoice-utils";
import { MAX_INVOICE_ITEMS, useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceItem } from "@/types/invoice";
import { GripVertical, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

type SheetRow = { key: string; node: ReactNode };
type CellElement = HTMLInputElement | HTMLTextAreaElement;

/**
 * "enter": started by typing over a cell; arrow keys commit and move to the next cell (Excel's Enter mode).
 * "edit": started by double-click, F2 or clicking the selected cell; arrow keys move the caret (Excel's Edit mode).
 */
type EditMode = "enter" | "edit";

interface EditState {
  pos: CellPos;
  mode: EditMode;
  /** Text typed so far; null until the first keystroke (the cell then shows its stored value). */
  draft: string | null;
  /** The row as it was when editing began, restored by Escape. */
  original: InvoiceItem;
}

interface MenuState {
  x: number;
  y: number;
  top: number;
  bottom: number;
  disabled: Partial<Record<GridMenuAction, boolean>>;
}

const LAST_COL = GRID_COLUMN_COUNT - 1;
const WIDTH_COL = GRID_FIELDS.indexOf("width");
const HEIGHT_COL = GRID_FIELDS.indexOf("height");
const QUANTITY_COL = GRID_FIELDS.indexOf("quantity");
const RATE_COL = GRID_FIELDS.indexOf("unitPrice");

const FIELD_LABELS: Record<GridField, string> = {
  name: "Product description",
  width: "Width",
  height: "Height",
  quantity: "Quantity",
  unitPrice: "Rate",
  total: "Total"
};

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1]
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const getItems = () => useInvoiceStore.getState().invoice.items;

function findCell(pos: CellPos) {
  return document.querySelector<CellElement>(`[data-grid-cell][data-grid-row="${pos.row}"][data-grid-col="${pos.col}"]`);
}

function isGridElement(element: Element | null) {
  return Boolean(element?.closest?.("[data-grid-cell], [data-grid-menu]"));
}

/** Text a cell shows while it is not being edited: exactly what the PDF prints. */
function displayText(item: InvoiceItem, field: GridField) {
  if (field === "name") return item.name;
  if (field === "total") return formatLineTotal(item.total);
  return plainNumber(item[field]);
}

function sameItems(a: readonly InvoiceItem[], b: readonly InvoiceItem[]) {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** One page's slice of the editable item table: the same table frame and head on every page. */
export function InvoiceTable({ rows, continued = false }: { rows: SheetRow[]; continued?: boolean }) {
  const labels = getInvoiceLabels();

  return (
    <SheetItemsTable labels={labels} caption={continued ? "Invoice items (continued)" : "Invoice items"}>
      <SheetRows rows={rows} />
    </SheetItemsTable>
  );
}

/**
 * The editable item rows as an Excel-style grid. Selection, editing, clipboard and drag state live here once for
 * the whole invoice, so they keep working when rows are spread over several pages.
 *
 * Every cell is a real input that is read-only until edited, so the layout is identical while selecting, editing
 * and printing. Keyboard focus sits on the active cell; Tab enters the grid at the active cell (roving tabindex).
 *
 * Returns the rows (split into pages by the caller) and an overlay (the context menu) to render once.
 */
export function useInvoiceGrid(): { rows: SheetRow[]; overlay: ReactNode } {
  const items = useInvoiceStore((state) => state.invoice.items);
  const updateItem = useInvoiceStore((state) => state.updateItem);
  const setItems = useInvoiceStore((state) => state.setItems);
  const removeItem = useInvoiceStore((state) => state.removeItem);
  const reorderItem = useInvoiceStore((state) => state.reorderItem);
  const { visibleCount, revealRow, showRows } = useRowVisibility();

  const [active, setActive] = useState<CellPos>({ row: 0, col: 0 });
  const [extent, setExtent] = useState<CellPos>({ row: 0, col: 0 });
  const [editing, setEditingState] = useState<EditState | null>(null);
  const [copiedRange, setCopiedRange] = useState<CellRange | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const lastRow = Math.max(0, visibleCount - 1);
  const range = normalizeRange(active, extent);
  const isMultiCell = range.top !== range.bottom || range.left !== range.right;

  // Latest values for handlers that run outside React's render cycle (document listeners, chained moves).
  const latest = useRef({ active, extent, lastRow, range });
  latest.current = { active, extent, lastRow, range };
  const editingRef = useRef<EditState | null>(null);
  const pendingFocusRef = useRef<{ caretToEnd: boolean } | null>(null);
  const mouseSelectRef = useRef<{ kind: "cells" | "rows"; moved: boolean; clickedActive: boolean } | null>(null);

  const setEditing = (next: EditState | null) => {
    editingRef.current = next;
    setEditingState(next);
  };

  // ---------- selection ----------

  const focusActive = (caretToEnd = false) => {
    pendingFocusRef.current = { caretToEnd };
  };

  const selectCell = (pos: CellPos, extendTo: CellPos = pos) => {
    setActive(pos);
    setExtent(extendTo);
    focusActive();
  };

  const extendTo = (pos: CellPos) => {
    setExtent(pos);
    focusActive();
  };

  /** Commits the edited cell (numbers rounded, an emptied Total back to automatic) and leaves edit mode. */
  const finishEdit = () => {
    const edit = editingRef.current;
    if (!edit) return;

    setEditing(null);
    if (edit.draft === null) return;

    const item = getItems()[edit.pos.row];
    if (!item || item.id !== edit.original.id) return;

    const patch = committedCellPatch(GRID_FIELDS[edit.pos.col], edit.draft);
    const unchanged = Object.entries(patch).every(([key, value]) => item[key as keyof InvoiceItem] === value);
    if (!unchanged) updateItem(item.id, patch);
  };

  /** Escape: puts the row back exactly as it was before this edit. */
  const cancelEdit = () => {
    const edit = editingRef.current;
    if (!edit) return;

    setEditing(null);
    focusActive();
    if (edit.draft === null) return;

    const current = getItems();
    if (current.some((item) => item.id === edit.original.id)) {
      setItems(current.map((item) => (item.id === edit.original.id ? edit.original : item)));
    }
  };

  const startEdit = (pos: CellPos, mode: EditMode, draft: string | null = null) => {
    const item = getItems()[pos.row];
    if (!item) return;

    const current = editingRef.current;
    if (current && samePos(current.pos, pos)) return;
    if (current) finishEdit();

    setCopiedRange(null);
    setEditing({ pos, mode, draft, original: item });
    setActive(pos);
    setExtent(pos);
    focusActive(draft === null);
  };

  /** Moves the active cell (or, with `extend`, the far corner of the selection) by one step. */
  const step = (dRow: number, dCol: number, { extend = false, revealBelow = false } = {}) => {
    const { active: anchor, extent: corner, lastRow: maxRow } = latest.current;
    const from = extend ? corner : anchor;
    let row = from.row + dRow;
    const col = clamp(from.col + dCol, 0, LAST_COL);

    // Moving down from the last shown row opens the next blank row, like a spreadsheet.
    if (row > maxRow) row = !extend && revealBelow && revealRow() ? maxRow + 1 : maxRow;

    const next = { row: Math.max(0, row), col };
    if (extend) extendTo(next);
    else selectCell(next);
  };

  /** Ctrl+Arrow: jump to the edge of the table. */
  const jump = (dRow: number, dCol: number, extend: boolean) => {
    const { active: anchor, extent: corner, lastRow: maxRow } = latest.current;
    const from = extend ? corner : anchor;
    const next = {
      row: dRow < 0 ? 0 : dRow > 0 ? maxRow : from.row,
      col: dCol < 0 ? 0 : dCol > 0 ? LAST_COL : from.col
    };
    if (extend) extendTo(next);
    else selectCell(next);
  };

  /** Tab / Shift+Tab across the row, wrapping to the next / previous row. False = let focus leave the grid. */
  const tab = (backwards: boolean) => {
    const { active: { row, col }, lastRow: maxRow } = latest.current;

    if (backwards) {
      if (col > 0) selectCell({ row, col: col - 1 });
      else if (row > 0) selectCell({ row: row - 1, col: LAST_COL });
      else return false;
      return true;
    }

    if (col < LAST_COL) selectCell({ row, col: col + 1 });
    else if (row < maxRow) selectCell({ row: row + 1, col: 0 });
    else {
      // Past the end of a filled last row a new row opens; past an empty one, focus moves on out of the table.
      const item = getItems()[row];
      if (!item || isBlankItem(item) || !revealRow()) return false;
      selectCell({ row: row + 1, col: 0 });
    }
    return true;
  };

  // ---------- bulk edits (one undo step each) ----------

  const commitItems = (next: InvoiceItem[]) => {
    if (!sameItems(next, getItems())) setItems(next);
  };

  const selectRange = (target: CellRange) => {
    showRows(target.bottom + 1);
    setActive({ row: target.top, col: target.left });
    setExtent({ row: target.bottom, col: target.right });
    focusActive();
  };

  const clearSelection = () => {
    setCopiedRange(null);
    commitItems(clearCells(getItems(), latest.current.range));
  };

  const copySelection = (event: ClipboardEvent, cut: boolean) => {
    const { range: selection } = latest.current;
    event.clipboardData?.setData("text/plain", rangeToTsv(getItems(), selection));
    event.preventDefault();

    if (cut) {
      setCopiedRange(null);
      commitItems(clearCells(getItems(), selection));
    } else {
      setCopiedRange(selection);
    }
  };

  const paste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text === "") return;

    const matrix = parseTsv(text);
    const isBlock = matrix.length > 1 || matrix[0].length > 1;
    const edit = editingRef.current;

    // A single value pasted while editing goes into the text being edited, like any text box.
    if (edit && !isBlock) return;

    event.preventDefault();
    const at = edit ? edit.pos : { row: latest.current.range.top, col: latest.current.range.left };
    finishEdit();

    const result = pasteCells(getItems(), at, matrix, edit ? null : latest.current.range, MAX_INVOICE_ITEMS);
    if (!result) return;

    setCopiedRange(null);
    commitItems(result.items);
    selectRange(result.range);
  };

  // ---------- context menu ----------

  const openMenu = (row: number, x: number, y: number) => {
    finishEdit();
    let { top, bottom } = latest.current.range;

    // Right-clicking outside the selection selects the clicked row's cell first, as in Excel.
    if (row < top || row > bottom) {
      selectCell({ row, col: latest.current.active.col });
      top = row;
      bottom = row;
    }

    const current = getItems();
    const count = bottom - top + 1;
    setMenu({
      x,
      y,
      top,
      bottom,
      disabled: {
        insertAbove: !insertRows(current, top, count, MAX_INVOICE_ITEMS),
        insertBelow: !insertRows(current, bottom + 1, count, MAX_INVOICE_ITEMS),
        duplicate: !duplicateRows(current, top, bottom, MAX_INVOICE_ITEMS)
      }
    });
  };

  const runMenuAction = (action: GridMenuAction) => {
    const target = menu;
    setMenu(null);
    focusActive();
    if (!target) return;

    const current = getItems();
    const { top, bottom } = target;
    const count = bottom - top + 1;
    const col = latest.current.active.col;
    const rowsRange = (first: number) => ({ top: first, bottom: first + count - 1, left: col, right: col });

    setCopiedRange(null);

    switch (action) {
      case "insertAbove": {
        const next = insertRows(current, top, count, MAX_INVOICE_ITEMS);
        if (next) {
          commitItems(next);
          selectRange(rowsRange(top));
        }
        break;
      }
      case "insertBelow": {
        const next = insertRows(current, bottom + 1, count, MAX_INVOICE_ITEMS);
        if (next) {
          commitItems(next);
          selectRange(rowsRange(bottom + 1));
        }
        break;
      }
      case "duplicate": {
        const next = duplicateRows(current, top, bottom, MAX_INVOICE_ITEMS);
        if (next) {
          commitItems(next);
          selectRange(rowsRange(bottom + 1));
        }
        break;
      }
      case "clear":
        commitItems(clearRows(current, top, bottom));
        selectRange(rowsRange(top));
        break;
      case "delete":
        commitItems(deleteRows(current, top, bottom));
        selectCell({ row: top, col });
        break;
    }
  };

  // ---------- keyboard ----------

  const onCellKeyDown = (event: KeyboardEvent<CellElement>, pos: CellPos) => {
    if (event.nativeEvent.isComposing) return;

    const { key, shiftKey, altKey } = event;
    const ctrl = event.ctrlKey || event.metaKey;
    const field = GRID_FIELDS[pos.col];
    const edit = editingRef.current;
    const arrow = ARROWS[key];

    if (edit && samePos(edit.pos, pos)) {
      if (key === "Escape") {
        event.preventDefault();
        cancelEdit();
      } else if (key === "Enter" && !altKey) {
        event.preventDefault();
        finishEdit();
        step(shiftKey ? -1 : 1, 0, { revealBelow: !shiftKey });
      } else if (key === "Tab") {
        finishEdit();
        if (tab(shiftKey)) event.preventDefault();
      } else if (key === "F2") {
        event.preventDefault();
        setEditing({ ...edit, mode: edit.mode === "enter" ? "edit" : "enter" });
      } else if (arrow && edit.mode === "enter" && !shiftKey && !ctrl && !altKey) {
        event.preventDefault();
        finishEdit();
        step(arrow[0], arrow[1], { revealBelow: key === "ArrowDown" });
      }
      return;
    }

    if (ctrl && !altKey) {
      const lower = key.toLowerCase();

      if (lower === "a") {
        event.preventDefault();
        selectCell({ row: 0, col: 0 }, { row: latest.current.lastRow, col: LAST_COL });
      } else if (arrow) {
        event.preventDefault();
        jump(arrow[0], arrow[1], shiftKey);
      } else if (key === "Home") {
        event.preventDefault();
        selectCell({ row: 0, col: 0 });
      } else if (key === "End") {
        event.preventDefault();
        selectCell({ row: latest.current.lastRow, col: LAST_COL });
      } else if (lower === "c" || lower === "x") {
        // Give the copy/cut command a selection so the browser always fires the clipboard event handled below.
        event.currentTarget.select();
      }
      // Ctrl+V reaches the paste listener; Ctrl+Z / Ctrl+Y are handled by the dashboard's undo shortcuts.
      return;
    }

    if (arrow) {
      event.preventDefault();
      step(arrow[0], arrow[1], { extend: shiftKey, revealBelow: key === "ArrowDown" });
      return;
    }

    switch (key) {
      case "Enter":
        event.preventDefault();
        step(shiftKey ? -1 : 1, 0, { revealBelow: !shiftKey });
        return;
      case "Tab":
        if (tab(shiftKey)) event.preventDefault();
        return;
      case "F2":
        event.preventDefault();
        startEdit(pos, "edit");
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        clearSelection();
        return;
      case "Escape":
        event.preventDefault();
        setCopiedRange(null);
        selectCell(latest.current.active);
        return;
      case "Home":
        event.preventDefault();
        selectCell({ row: pos.row, col: 0 });
        return;
      case "End":
        event.preventDefault();
        selectCell({ row: pos.row, col: LAST_COL });
        return;
      case "ContextMenu":
      case "F10": {
        if (key === "F10" && !shiftKey) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        openMenu(pos.row, rect.left, rect.bottom);
        return;
      }
    }

    // Typing over a selected cell replaces its content (Excel's Enter mode). "Process" is an IME (e.g. Bangla) key.
    const isTyping = (key.length === 1 && !altKey) || key === "Process";
    if (!isTyping) return;

    if (isNumericField(field) && key.length === 1 && !isNumericText(key)) {
      event.preventDefault();
      return;
    }

    // Let the browser insert the character itself (keeps IME and dead keys working) into an emptied, editable cell.
    const input = event.currentTarget;
    input.readOnly = false;
    input.select();
    startEdit(pos, "enter", "");
  };

  const onCellChange = (pos: CellPos, text: string) => {
    const edit = editingRef.current;
    if (!edit || !samePos(edit.pos, pos)) return;

    const field = GRID_FIELDS[pos.col];
    if (isNumericField(field) && !isNumericText(text)) return;

    const item = getItems()[pos.row];
    if (!item) return;

    setEditing({ ...edit, draft: text });
    updateItem(item.id, liveCellPatch(field, text));
  };

  const onCellFocus = (pos: CellPos) => {
    // Focus arriving from outside (Tab from the header, the Add Row button) makes that cell the active one.
    if (!samePos(latest.current.active, pos)) {
      finishEdit();
      setActive(pos);
      setExtent(pos);
    }
  };

  // ---------- mouse ----------

  const onCellMouseDown = (event: MouseEvent, pos: CellPos) => {
    const edit = editingRef.current;
    const editingThis = Boolean(edit && samePos(edit.pos, pos));

    if (event.button === 2) {
      if (editingThis) return; // native text menu while editing
      event.preventDefault();
      if (!inRange(latest.current.range, pos.row, pos.col)) {
        finishEdit();
        selectCell(pos);
      }
      return;
    }

    if (event.button !== 0 || editingThis) return; // inside the edited cell the mouse places the caret

    event.preventDefault(); // no native focus / text selection: the grid moves focus itself
    const { active: current, extent: corner } = latest.current;
    const clickedActive =
      !edit && !event.shiftKey && event.detail === 1 && samePos(current, pos) && samePos(corner, pos) && document.activeElement === findCell(pos);

    finishEdit();

    if (event.shiftKey) extendTo(pos);
    else selectCell(pos);

    mouseSelectRef.current = { kind: "cells", moved: false, clickedActive };
  };

  const onCellMouseEnter = (pos: CellPos) => {
    const selecting = mouseSelectRef.current;
    if (!selecting) return;

    if (!samePos(pos, latest.current.active)) selecting.moved = true;
    setExtent(selecting.kind === "rows" ? { row: pos.row, col: LAST_COL } : pos);
  };

  const onCellMouseUp = (pos: CellPos) => {
    const selecting = mouseSelectRef.current;
    // A plain click on the already-selected cell edits it, with the caret at the end.
    if (selecting?.clickedActive && !selecting.moved) startEdit(pos, "edit");
  };

  const onRowHeaderMouseDown = (event: MouseEvent, row: number) => {
    if ((event.target as Element).closest("button")) return; // row tools (drag / remove)
    if (event.button !== 0 && event.button !== 2) return;

    event.preventDefault();
    const { range: selection, active: current } = latest.current;
    const rowSelected = row >= selection.top && row <= selection.bottom && selection.left === 0 && selection.right === LAST_COL;
    if (event.button === 2 && rowSelected) return;

    finishEdit();
    if (event.shiftKey && event.button === 0) {
      selectCell({ row: current.row, col: 0 }, { row, col: LAST_COL });
    } else {
      selectCell({ row, col: 0 }, { row, col: LAST_COL });
    }
    if (event.button === 0) mouseSelectRef.current = { kind: "rows", moved: false, clickedActive: false };
  };

  const onCellContextMenu = (event: MouseEvent, row: number, editingThis = false) => {
    if (editingThis) return;
    event.preventDefault();
    openMenu(row, event.clientX, event.clientY);
  };

  // ---------- effects ----------

  // Moves DOM focus to the active cell after a selection change (the cell may only exist after this render).
  useLayoutEffect(() => {
    const request = pendingFocusRef.current;
    if (!request || menu) return;

    const input = findCell(active);
    if (!input) return;

    pendingFocusRef.current = null;
    if (document.activeElement !== input) input.focus();
    if (request.caretToEnd) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  });

  // Rows removed (delete, undo, another invoice opened): keep the selection on existing rows.
  useEffect(() => {
    if (active.row > lastRow || extent.row > lastRow) {
      setActive((pos) => ({ ...pos, row: Math.min(pos.row, lastRow) }));
      setExtent((pos) => ({ ...pos, row: Math.min(pos.row, lastRow) }));
    }
  }, [active.row, extent.row, lastRow]);

  // The edited value changed underneath the editor (Ctrl+Z / Ctrl+Y, cloud sync): stop editing and show it.
  useEffect(() => {
    const edit = editingRef.current;
    if (!edit) return;

    const item = items[edit.pos.row];
    if (!item || item.id !== edit.original.id) {
      setEditing(null);
      return;
    }

    if (edit.draft === null) return;
    const expected = liveCellPatch(GRID_FIELDS[edit.pos.col], edit.draft);
    if (Object.entries(expected).some(([key, value]) => item[key as keyof InvoiceItem] !== value)) setEditing(null);
  }, [items]);

  // Handlers registered once on the document read the latest closures through this ref.
  const handlersRef = useRef({ copySelection, paste, finishEdit });
  handlersRef.current = { copySelection, paste, finishEdit };

  useEffect(() => {
    const focusedCell = () => (document.activeElement?.matches?.("[data-grid-cell]") ? (document.activeElement as CellElement) : null);

    const onCopyOrCut = (event: ClipboardEvent) => {
      const cell = focusedCell();
      if (!cell || editingRef.current) return; // while editing, copy / cut the selected text as usual
      handlersRef.current.copySelection(event, event.type === "cut");
      const end = cell.value.length;
      cell.setSelectionRange(end, end);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (focusedCell()) handlersRef.current.paste(event);
    };

    const onMouseUp = () => {
      mouseSelectRef.current = null;
    };

    // Grid highlight shows only while the grid (or its menu) has focus; leaving it commits the edit.
    const syncFocus = () => {
      const inside = isGridElement(document.activeElement);
      setHasFocus(inside);
      if (!inside) handlersRef.current.finishEdit();
    };
    const onFocusOut = () => window.setTimeout(syncFocus, 0);

    document.addEventListener("copy", onCopyOrCut);
    document.addEventListener("cut", onCopyOrCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("focusin", syncFocus);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("copy", onCopyOrCut);
      document.removeEventListener("cut", onCopyOrCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("focusin", syncFocus);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // ---------- rendering ----------

  const showSelection = hasFocus || menu !== null;
  const selectedAttr = (row: number, col: number) => (showSelection && isMultiCell && inRange(range, row, col) ? "" : undefined);
  /** The calculated "×" and SQF columns are highlighted when the selection spans both of their neighbours. */
  const betweenSelectedAttr = (row: number, leftCol: number) =>
    showSelection && isMultiCell && row >= range.top && row <= range.bottom && range.left <= leftCol && range.right > leftCol ? "" : undefined;

  const renderCell = (item: InvoiceItem, row: number, col: number, tdClass: string, inputClass = "") => {
    const pos = { row, col };
    const field = GRID_FIELDS[col];
    const isActive = samePos(active, pos);
    const edit = editing && samePos(editing.pos, pos) ? editing : null;
    const copied = copiedRange && inRange(copiedRange, row, col);

    const inputProps = {
      "data-grid-cell": "",
      "data-grid-row": row,
      "data-grid-col": col,
      "data-row-id": item.id,
      "data-field": field,
      "aria-label": `${FIELD_LABELS[field]}, row ${row + 1}`,
      tabIndex: isActive ? 0 : -1,
      readOnly: !edit,
      value: edit ? (edit.draft ?? cellEditText(item, field)) : displayText(item, field),
      onKeyDown: (event: KeyboardEvent<CellElement>) => onCellKeyDown(event, pos),
      onFocus: () => onCellFocus(pos)
    };

    return (
      <td
        className={cn(sheetClasses.td, tdClass, "invoice-grid-td")}
        data-selected={selectedAttr(row, col)}
        data-active={showSelection && isActive ? "" : undefined}
        data-editing={edit ? "" : undefined}
        data-copied={copied ? "" : undefined}
        onMouseDown={(event) => onCellMouseDown(event, pos)}
        onMouseEnter={() => onCellMouseEnter(pos)}
        onMouseUp={() => onCellMouseUp(pos)}
        onDoubleClick={() => startEdit(pos, "edit")}
        onContextMenu={(event) => onCellContextMenu(event, row, Boolean(edit))}
      >
        {field === "name" ? (
          <AutoGrowTextarea
            {...inputProps}
            maxLength={MAX_NAME_LENGTH}
            className={cn("invoice-grid-input", inputClass)}
            onChange={(event) => onCellChange(pos, event.target.value)}
          />
        ) : (
          <input
            {...inputProps}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={cn("invoice-grid-input block h-[1.4em] w-full min-w-0 border-0 bg-transparent p-0", inputClass)}
            onChange={(event) => onCellChange(pos, event.target.value)}
          />
        )}
      </td>
    );
  };

  /** Mouse on a calculated column acts on the editable cell to its left. */
  const calculatedCellMouse = (row: number, col: number) => ({
    onMouseDown: (event: MouseEvent) => onCellMouseDown(event, { row, col }),
    onMouseEnter: () => onCellMouseEnter({ row, col }),
    onContextMenu: (event: MouseEvent) => onCellContextMenu(event, row)
  });

  const rows = items.slice(0, visibleCount).map((item, index) => {
    const quantitySqf = lineQuantitySqf(item);
    const rowSelected = showSelection && index >= range.top && index <= range.bottom;

    return {
      key: item.id,
      node: (
        <tr
          data-sheet-row=""
          className={cn(
            "group",
            dragOverIndex === index && "bg-red-50 shadow-[inset_0_2px_0_#e01b24]",
            draggedIndex === index && "opacity-60"
          )}
          onDragOver={(event) => {
            if (draggedIndex === null) return;
            event.preventDefault();
            setDragOverIndex(index);
          }}
          onDragLeave={() => setDragOverIndex(null)}
          onDrop={(event) => {
            event.preventDefault();
            if (draggedIndex !== null) reorderItem(draggedIndex, index);
            setDraggedIndex(null);
            setDragOverIndex(null);
          }}
        >
          <td
            className={cn(sheetClasses.td, sheetClasses.tdNo, "invoice-grid-row-head relative")}
            data-row-selected={rowSelected ? "" : undefined}
            title="Select row (right-click for row actions)"
            onMouseDown={(event) => onRowHeaderMouseDown(event, index)}
            onMouseEnter={() => onCellMouseEnter({ row: index, col: LAST_COL })}
            onContextMenu={(event) => onCellContextMenu(event, index)}
          >
            {/* Row tools sit in the page margin, outside the printable cell, so they never change the layout. */}
            <div className="no-print absolute right-full top-1/2 mr-[0.6mm] flex -translate-y-1/2 items-center opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                draggable
                aria-label="Drag row"
                title="Drag row"
                className="grid size-[4mm] cursor-grab place-items-center rounded text-[#a1a1aa] hover:bg-red-50 hover:text-[#e01b24] active:cursor-grabbing"
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
                <GripVertical className="size-[3.4mm]" aria-hidden="true" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Remove row"
                title="Remove row"
                className="grid size-[4mm] place-items-center rounded text-[#a1a1aa] hover:bg-red-50 hover:text-[#e01b24]"
                onClick={() => removeItem(item.id)}
              >
                <X className="size-[3.4mm]" aria-hidden="true" />
              </button>
            </div>
            {index + 1}
          </td>
          {renderCell(item, index, 0, sheetClasses.tdName)}
          {renderCell(item, index, WIDTH_COL, sheetClasses.tdSize, "text-center")}
          <td
            className={cn(sheetClasses.td, sheetClasses.tdTimes, "invoice-grid-td")}
            data-selected={betweenSelectedAttr(index, WIDTH_COL)}
            {...calculatedCellMouse(index, WIDTH_COL)}
          >
            {item.width > 0 || item.height > 0 ? "X" : ""}
          </td>
          {renderCell(item, index, HEIGHT_COL, cn(sheetClasses.tdSize, sheetClasses.tdHeight), "text-center")}
          {renderCell(item, index, QUANTITY_COL, sheetClasses.tdNumber, "text-center")}
          <td
            className={cn(sheetClasses.td, sheetClasses.tdSqf, "invoice-grid-td")}
            data-selected={betweenSelectedAttr(index, QUANTITY_COL)}
            {...calculatedCellMouse(index, QUANTITY_COL)}
          >
            <div className={sheetClasses.cellText}>{quantitySqf > 0 ? formatDecimal(quantitySqf) : ""}</div>
          </td>
          {renderCell(item, index, RATE_COL, sheetClasses.tdRate, "text-right")}
          {renderCell(item, index, LAST_COL, sheetClasses.tdTotal, "text-center font-semibold")}
        </tr>
      )
    };
  });

  const overlay = menu ? (
    <GridContextMenu
      x={menu.x}
      y={menu.y}
      rowCount={menu.bottom - menu.top + 1}
      disabled={menu.disabled}
      onAction={runMenuAction}
      onClose={(refocus) => {
        setMenu(null);
        if (refocus) focusActive();
      }}
    />
  ) : null;

  return { rows, overlay };
}
