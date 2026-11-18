import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCellTexts,
  clearCells,
  clearRows,
  committedCellPatch,
  deleteRows,
  duplicateRows,
  insertRows,
  normalizeRange,
  parseNumericText,
  parseTsv,
  pasteCells,
  rangeToTsv
} from "@/lib/invoice-grid";
import { applyItemPatch, createBlankItem, withMinimumRows } from "@/lib/invoice-utils";
import { toInvoiceDocument } from "@/lib/invoice-document";
import { useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceItem } from "@/types/invoice";

function row(patch: Partial<InvoiceItem> = {}): InvoiceItem {
  return applyItemPatch(createBlankItem(), patch);
}

describe("clipboard text", () => {
  it("parses Excel TSV, ignoring the trailing line break", () => {
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv("single")).toEqual([["single"]]);
    expect(parseTsv("x\t\ty")).toEqual([["x", "", "y"]]);
  });

  it("parses quoted cells with tabs, quotes and line breaks", () => {
    expect(parseTsv('"Banner\n2 sides"\t5\n"He said ""hi"""\t6')).toEqual([["Banner\n2 sides", "5"], ['He said "hi"', "6"]]);
  });

  it("reads grouped, Bengali and currency-formatted numbers", () => {
    expect(parseNumericText("1,250.50")).toBe(1250.5);
    expect(parseNumericText("১২৫০")).toBe(1250);
    expect(parseNumericText("৳ 1,150")).toBe(1150);
    expect(parseNumericText("")).toBe(0);
  });

  it("copies a range as TSV and pastes it back unchanged", () => {
    const items = [row({ name: "Banner", width: 4, height: 2.5, quantity: 3, unitPrice: 45 }), row({ name: 'Sign "A"', quantity: 2, unitPrice: 100 })];
    const tsv = rangeToTsv(items, normalizeRange({ row: 0, col: 0 }, { row: 1, col: 5 }));
    expect(tsv).toBe('Banner\t4\t2.5\t3\t45\t1350\n"Sign ""A"""\t\t\t2\t100\t200');

    const pasted = pasteCells(withMinimumRows([]), { row: 0, col: 0 }, parseTsv(tsv), null, 50)!;
    expect(pasted.range).toEqual({ top: 0, left: 0, bottom: 1, right: 5 });
    expect(pasted.items[0]).toMatchObject({ name: "Banner", width: 4, height: 2.5, quantity: 3, unitPrice: 45, total: 1350, totalIsManual: false });
    expect(pasted.items[1]).toMatchObject({ name: 'Sign "A"', quantity: 2, unitPrice: 100, total: 200, totalIsManual: false });
  });
});

describe("pasting", () => {
  it("recalculates totals and keeps a differing pasted total as a manual override", () => {
    const [item] = pasteCells([row()], { row: 0, col: 3 }, [["2", "100", "150"]], null, 50)!.items;
    expect(item).toMatchObject({ quantity: 2, unitPrice: 100, total: 150, totalIsManual: true });
  });

  it("fills a multi-cell selection with a single copied value", () => {
    const items = withMinimumRows([]);
    const selection = normalizeRange({ row: 1, col: 3 }, { row: 3, col: 4 });
    const result = pasteCells(items, { row: 1, col: 3 }, [["7"]], selection, 50)!;
    expect(result.range).toEqual(selection);
    for (const index of [1, 2, 3]) expect(result.items[index]).toMatchObject({ quantity: 7, unitPrice: 7, total: 49 });
    expect(result.items[0].quantity).toBe(0);
  });

  it("adds rows when needed, up to the row limit, and drops columns past Total", () => {
    const result = pasteCells([row()], { row: 0, col: 4 }, [["10", "20", "extra"], ["30"], ["40"]], null, 2)!;
    expect(result.items).toHaveLength(2);
    expect(result.range).toEqual({ top: 0, left: 4, bottom: 1, right: 5 });
    expect(result.items[1].unitPrice).toBe(30);
  });

  it("ignores non-numeric text in number columns", () => {
    const [item] = pasteCells([row({ quantity: 5 })], { row: 0, col: 3 }, [["abc"]], null, 50)!.items;
    expect(item.quantity).toBe(0);
  });
});

describe("cell and row operations", () => {
  const items = [row({ name: "A", quantity: 1, unitPrice: 10 }), row({ name: "B", quantity: 2, unitPrice: 10 }), row({ name: "C", quantity: 3, unitPrice: 10 })];

  it("clears a range of cells and returns emptied manual totals to automatic", () => {
    const manual = applyItemPatch(items[0], { total: 999 });
    const [cleared] = clearCells([manual], normalizeRange({ row: 0, col: 5 }, { row: 0, col: 5 }));
    expect(cleared).toMatchObject({ total: 10, totalIsManual: false, name: "A" });

    const [blank] = clearCells([manual], normalizeRange({ row: 0, col: 0 }, { row: 0, col: 5 }));
    expect(blank).toMatchObject({ name: "", quantity: 0, unitPrice: 0, total: 0, totalIsManual: false });
  });

  it("commits typed totals as whole units and an empty total as automatic", () => {
    expect(committedCellPatch("total", "1,250.6")).toEqual({ total: 1251 });
    expect(committedCellPatch("total", "")).toEqual({ totalIsManual: false });
    expect(committedCellPatch("width", "2.345")).toEqual({ width: 2.35 });
    expect(applyCellTexts(items[0], [["total", "10"]])).toMatchObject({ total: 10, totalIsManual: false });
  });

  it("inserts blank rows above or below", () => {
    const above = insertRows(items, 1, 1, 50)!;
    expect(above.map((item) => item.name)).toEqual(["A", "", "B", "C"]);
    const below = insertRows(items, 3, 2, 50)!;
    expect(below.map((item) => item.name)).toEqual(["A", "B", "C", "", ""]);
  });

  it("only inserts at the row limit when a blank trailing row can make room", () => {
    expect(insertRows(items, 0, 1, 3)).toBeNull();
    const withBlank = [...items, row()];
    expect(insertRows(withBlank, 0, 1, 4)!.map((item) => item.name)).toEqual(["", "A", "B", "C"]);
  });

  it("duplicates rows with new ids directly below", () => {
    const next = duplicateRows(items, 0, 1, 50)!;
    expect(next.map((item) => item.name)).toEqual(["A", "B", "A", "B", "C"]);
    expect(next[2].id).not.toBe(items[0].id);
    expect(next[2]).toMatchObject({ quantity: 1, total: 10 });
  });

  it("clears rows in place and deletes rows keeping a full page", () => {
    const cleared = clearRows(items, 1, 1);
    expect(cleared[1]).toMatchObject({ id: items[1].id, name: "", total: 0 });
    const deleted = deleteRows(items, 0, 1);
    expect(deleted[0].name).toBe("C");
    expect(deleted).toHaveLength(12);
  });
});

describe("store undo / redo for grid edits", () => {
  beforeEach(() => {
    useInvoiceStore.getState().resetDraft();
  });

  it("undoes and redoes a bulk edit as one step, and a new edit clears redo", () => {
    const store = useInvoiceStore.getState;
    const before = store().invoice.items;
    store().setItems(insertRows(before, 0, 1, 50)!);
    const after = store().invoice.items;
    expect(after).toHaveLength(before.length + 1);

    store().undoLastChange();
    expect(store().invoice.items.map((item) => item.id)).toEqual(before.map((item) => item.id));

    store().redoLastChange();
    expect(store().invoice.items.map((item) => item.id)).toEqual(after.map((item) => item.id));

    store().undoLastChange();
    store().updateItem(before[0].id, { name: "new" });
    expect(store().redoHistory).toHaveLength(0);
  });

  it("puts the grand total in words on the printable document", () => {
    const store = useInvoiceStore.getState;
    const [first] = store().invoice.items;
    store().updateItem(first.id, { quantity: 1, unitPrice: 1250.5 });
    expect(toInvoiceDocument(store().invoice).amountInWords).toBe("One Thousand Two Hundred Fifty One Taka Only.");
    store().updateItem(first.id, { total: 1250 });
    expect(toInvoiceDocument(store().invoice).amountInWords).toBe("One Thousand Two Hundred Fifty Taka Only.");
  });
});
