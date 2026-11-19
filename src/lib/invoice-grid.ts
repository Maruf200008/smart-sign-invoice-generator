import { isBlankItem, plainNumber } from "@/lib/invoice-document";
import { applyItemPatch, calculateLineTotal, createBlankItem, roundToInteger, roundToTwo, safePositiveNumber, uid, withMinimumRows } from "@/lib/invoice-utils";
import { toLatinDigits } from "@/lib/invoice-labels";
import type { InvoiceItem } from "@/types/invoice";

/**
 * Spreadsheet model of the invoice item table: the editable columns, cell ranges, and the pure row/cell operations
 * behind the Excel-style editor (copy / cut / paste as TSV, clear, insert, duplicate, delete). Every operation takes
 * the item list and returns a new one, so the store can commit it as a single undo step.
 */

/** Editable columns, in on-screen order (the "×" and SQF columns are calculated and not part of the grid). */
export const GRID_FIELDS = ["name", "width", "height", "quantity", "unitPrice", "total"] as const;
export type GridField = (typeof GRID_FIELDS)[number];
export const GRID_COLUMN_COUNT = GRID_FIELDS.length;
export const MAX_NAME_LENGTH = 240;

export interface CellPos {
  row: number;
  col: number;
}

/** Inclusive rectangle of cells. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function samePos(a: CellPos | null | undefined, b: CellPos | null | undefined) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

export function normalizeRange(anchor: CellPos, extent: CellPos): CellRange {
  return {
    top: Math.min(anchor.row, extent.row),
    bottom: Math.max(anchor.row, extent.row),
    left: Math.min(anchor.col, extent.col),
    right: Math.max(anchor.col, extent.col)
  };
}

export function inRange(range: CellRange, row: number, col: number) {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export function isNumericField(field: GridField) {
  return field !== "name";
}

/** Characters a number cell accepts while typing: digits (Latin and Bengali), separators and spaces. */
const NUMERIC_TEXT = /^[\d০-৯.,\s]*$/;

export function isNumericText(text: string) {
  return NUMERIC_TEXT.test(text);
}

/** "১,২৫০.৫০ ৳" -> 1250.5: Bengali digits become Latin, grouping, spaces and currency symbols are dropped. */
export function parseNumericText(text: string) {
  const latin = toLatinDigits(text);
  const cleaned = latin.replace(/[,\s৳$€£₹]/g, "");
  return cleaned === "" ? 0 : safePositiveNumber(cleaned);
}

function cleanName(text: string) {
  return text.replace(/\s*[\r\n]+\s*/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** Raw value shown while a cell is edited and written to the clipboard: blank for 0, no grouping. */
export function cellEditText(item: InvoiceItem, field: GridField) {
  if (field === "name") return item.name;
  if (field === "total") return item.total > 0 ? String(roundToInteger(item.total)) : "";
  return plainNumber(item[field]);
}

/** Store patch for text typed into a cell, applied on every keystroke (not rounded yet, so "1." keeps working). */
export function liveCellPatch(field: GridField, text: string): Partial<InvoiceItem> {
  if (field === "name") return { name: cleanName(text) };
  if (field === "total") return { total: roundToInteger(parseNumericText(text)) };
  return { [field]: parseNumericText(text) };
}

/**
 * Final patch when a cell's edit is committed: numbers rounded to 2 decimals, totals to whole units, and an emptied
 * Total cell goes back to the calculated total (like deleting an override).
 */
export function committedCellPatch(field: GridField, text: string): Partial<InvoiceItem> {
  if (field === "name") return { name: cleanName(text) };
  if (field === "total") return text.trim() === "" ? { totalIsManual: false } : { total: roundToInteger(parseNumericText(text)) };
  return { [field]: roundToTwo(parseNumericText(text)) };
}

/**
 * Writes several cells of one row at once. Inputs (size, qty, rate) are applied first; a Total that equals the
 * calculated total keeps the row automatic, any other Total becomes a manual override, a blank Total is automatic.
 */
export function applyCellTexts(item: InvoiceItem, cells: ReadonlyArray<readonly [GridField, string]>): InvoiceItem {
  const patch: Partial<InvoiceItem> = {};
  let totalText: string | undefined;

  for (const [field, text] of cells) {
    if (field === "total") totalText = text;
    else Object.assign(patch, committedCellPatch(field, text));
  }

  let next = Object.keys(patch).length > 0 ? applyItemPatch(item, patch) : item;

  if (totalText !== undefined) {
    if (totalText.trim() === "") {
      next = applyItemPatch(next, { totalIsManual: false });
    } else {
      const total = roundToInteger(parseNumericText(totalText));
      next = total === calculateLineTotal(next) ? applyItemPatch(next, { totalIsManual: false }) : applyItemPatch(next, { total });
    }
  }

  return next;
}

function fieldsIn(range: CellRange) {
  return GRID_FIELDS.slice(range.left, range.right + 1);
}

/** Excel-compatible TSV: cells with tabs, line breaks or quotes are quoted. */
function tsvCell(text: string) {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rangeToTsv(items: readonly InvoiceItem[], range: CellRange) {
  const fields = fieldsIn(range);
  const lines: string[] = [];

  for (let row = range.top; row <= range.bottom; row += 1) {
    const item = items[row];
    lines.push(fields.map((field) => tsvCell(item ? cellEditText(item, field) : "")).join("\t"));
  }

  return lines.join("\n");
}

/** Parses clipboard text from Excel / Google Sheets / plain text into rows of cells (quoted cells supported). */
export function parseTsv(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '"' && cell === "") {
      // Quoted cell: runs to the closing quote; "" is a literal quote.
      let end = index + 1;
      let value = "";
      let closed = false;

      while (end < source.length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          closed = true;
          break;
        }
        value += source[end];
        end += 1;
      }

      const next = source[end + 1];
      if (closed && (next === undefined || next === "\t" || next === "\n")) {
        cell = value;
        index = end + 1;
        continue;
      }
      // Not a well-formed quoted cell: treat the quote literally.
    }

    if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }

    index += 1;
  }

  // A trailing line break (Excel always adds one) does not start another row.
  if (cell !== "" || row.length > 0 || rows.length === 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/**
 * Pastes a block of cells with its top-left at `at`. A single copied value pasted into a larger selection fills the
 * whole selection, as in Excel. Rows are added as needed up to `maxRows`; columns past Total are dropped.
 * Returns the new items and the range that was written.
 */
export function pasteCells(
  items: readonly InvoiceItem[],
  at: CellPos,
  matrix: string[][],
  selection: CellRange | null,
  maxRows: number
): { items: InvoiceItem[]; range: CellRange } | null {
  if (matrix.length === 0 || at.row < 0 || at.row >= maxRows || at.col < 0 || at.col >= GRID_COLUMN_COUNT) return null;

  const isSingleValue = matrix.length === 1 && matrix[0].length === 1;
  const fillSelection = isSingleValue && selection && (selection.bottom > selection.top || selection.right > selection.left);
  const target: CellRange = fillSelection
    ? selection
    : {
        top: at.row,
        left: at.col,
        bottom: Math.min(maxRows - 1, at.row + matrix.length - 1),
        right: Math.min(GRID_COLUMN_COUNT - 1, at.col + Math.max(...matrix.map((cells) => cells.length)) - 1)
      };

  const next = [...items];
  for (let row = target.top; row <= target.bottom; row += 1) {
    while (next.length <= row) next.push(createBlankItem());

    const source = fillSelection ? matrix[0] : (matrix[row - target.top] ?? []);
    const cells: [GridField, string][] = [];

    for (let col = target.left; col <= target.right; col += 1) {
      const text = fillSelection ? source[0] : source[col - target.left];
      if (text !== undefined) cells.push([GRID_FIELDS[col], text]);
    }

    next[row] = applyCellTexts(next[row], cells);
  }

  return { items: next, range: target };
}

/** Empties every cell in the range (an emptied Total goes back to the calculated total). */
export function clearCells(items: readonly InvoiceItem[], range: CellRange): InvoiceItem[] {
  const fields = fieldsIn(range);
  return items.map((item, row) => (row >= range.top && row <= range.bottom ? applyCellTexts(item, fields.map((field) => [field, ""] as const)) : item));
}

/** Drops blank rows from the end until the list fits `maxRows`; null if a row with content would be lost. */
function fitRows(items: InvoiceItem[], maxRows: number) {
  while (items.length > maxRows) {
    const last = items[items.length - 1];
    if (!isBlankItem(last)) return null;
    items.pop();
  }
  return items;
}

export function insertRows(items: readonly InvoiceItem[], index: number, count: number, maxRows: number): InvoiceItem[] | null {
  const at = Math.max(0, Math.min(index, items.length));
  const next = [...items];
  next.splice(at, 0, ...Array.from({ length: Math.max(1, count) }, () => createBlankItem()));
  return fitRows(next, maxRows);
}

export function duplicateRows(items: readonly InvoiceItem[], top: number, bottom: number, maxRows: number): InvoiceItem[] | null {
  const copies = items.slice(top, bottom + 1).map((item) => ({ ...item, id: uid("item") }));
  if (copies.length === 0) return null;

  const next = [...items];
  next.splice(bottom + 1, 0, ...copies);
  return fitRows(next, maxRows);
}

export function clearRows(items: readonly InvoiceItem[], top: number, bottom: number): InvoiceItem[] {
  return items.map((item, row) => (row >= top && row <= bottom ? { ...createBlankItem(), id: item.id } : item));
}

/** Removes the rows; the invoice keeps at least one full page of rows. */
export function deleteRows(items: readonly InvoiceItem[], top: number, bottom: number): InvoiceItem[] {
  return withMinimumRows(items.filter((_, row) => row < top || row > bottom));
}
