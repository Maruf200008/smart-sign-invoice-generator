import { describe, expect, it } from "vitest";
import {
  calculateLineTotal,
  calculateSqf,
  calculateTotals,
  formatInvoiceDate,
  formatMoney,
  lineQuantitySqf,
  lineTotal,
  roundToTwo,
  toDateInputValue,
  type LineItemInput
} from "@/lib/invoice-utils";

function item(patch: Partial<LineItemInput>): LineItemInput {
  return { width: 0, height: 0, quantity: 0, unitPrice: 0, total: 0, totalIsManual: false, ...patch };
}

describe("line items", () => {
  it("prices by area x quantity x rate when a size is given", () => {
    expect(calculateSqf(4, 2.5)).toBe(10);
    expect(calculateLineTotal(item({ width: 4, height: 2.5, quantity: 3, unitPrice: 45 }))).toBe(1350);
    expect(lineQuantitySqf(item({ width: 4, height: 2.5, quantity: 3 }))).toBe(30);
  });

  it("prices by quantity x rate when there is no size", () => {
    expect(calculateLineTotal(item({ quantity: 4, unitPrice: 250 }))).toBe(1000);
  });

  it("prices by area x rate when there is no quantity", () => {
    expect(calculateLineTotal(item({ width: 2, height: 3, unitPrice: 10 }))).toBe(60);
  });

  it("is zero without a rate and ignores negative or garbage input", () => {
    expect(calculateLineTotal(item({ width: 2, height: 3, quantity: 2 }))).toBe(0);
    expect(calculateLineTotal(item({ quantity: -5, unitPrice: 100 }))).toBe(0);
    expect(calculateLineTotal(item({ quantity: Number.NaN, unitPrice: 100 }))).toBe(0);
    expect(calculateSqf("abc", 3)).toBe(0);
  });

  it("rounds SQF to 2 decimals (as displayed) and line totals to whole currency units", () => {
    // 1.25 x 1.25 = 1.5625 -> 1.56 SQF (what the invoice shows); 1.56 x 33 = 51.48 -> 51.
    expect(calculateSqf(1.25, 1.25)).toBe(1.56);
    expect(calculateLineTotal(item({ width: 1.25, height: 1.25, quantity: 1, unitPrice: 33 }))).toBe(51);
  });

  it("uses the manual total when one was entered", () => {
    expect(lineTotal(item({ quantity: 2, unitPrice: 100, total: 175, totalIsManual: true }))).toBe(175);
    expect(lineTotal(item({ quantity: 2, unitPrice: 100, total: 175, totalIsManual: false }))).toBe(200);
  });
});

describe("invoice totals", () => {
  const items = [item({ quantity: 2, unitPrice: 500 }), item({ width: 3, height: 2, quantity: 1, unitPrice: 50 })];

  it("applies discount, then tax on the discounted amount, then the advance", () => {
    const totals = calculateTotals({ items, discount: 100, taxRate: 15, advance: 500 });

    expect(totals.subtotal).toBe(1300);
    expect(totals.discount).toBe(100);
    expect(totals.taxable).toBe(1200);
    expect(totals.tax).toBe(180);
    expect(totals.grandTotal).toBe(1380);
    expect(totals.advance).toBe(500);
    expect(totals.remaining).toBe(880);
  });

  it("caps the discount at the subtotal and the advance at the grand total", () => {
    const totals = calculateTotals({ items, discount: 5000, taxRate: 0, advance: 9999 });

    expect(totals.discount).toBe(1300);
    expect(totals.grandTotal).toBe(0);
    expect(totals.advance).toBe(0);
    expect(totals.remaining).toBe(0);
  });

  it("treats negative discount, tax and advance as zero (they can never increase what is owed)", () => {
    const totals = calculateTotals({ items, discount: -500, taxRate: -10, advance: -200 });

    expect(totals.grandTotal).toBe(1300);
    expect(totals.remaining).toBe(1300);
  });

  it("caps the tax rate at 100%", () => {
    expect(calculateTotals({ items, discount: 0, taxRate: 250, advance: 0 }).tax).toBe(1300);
  });

  it("never leaks floating point noise into money values", () => {
    const totals = calculateTotals({ items: [item({ quantity: 1, unitPrice: 333 })], discount: 0.1, taxRate: 7.5, advance: 0.2 });

    for (const value of Object.values(totals)) {
      expect(Number.isInteger(Math.round(value * 100))).toBe(true);
      expect(roundToTwo(value)).toBe(value);
    }

    expect(totals.tax).toBe(24.97);
    expect(totals.grandTotal).toBe(357.87);
    expect(totals.remaining).toBe(357.67);
  });

  it("is zero for an invoice with no priced items", () => {
    expect(calculateTotals({ items: [item({})], discount: 0, taxRate: 15, advance: 0 })).toMatchObject({ grandTotal: 0, remaining: 0 });
  });
});

describe("rounding and formatting", () => {
  it("rounds half up at 2 decimals, including binary edge cases", () => {
    expect(roundToTwo(1.005)).toBe(1.01);
    expect(roundToTwo(2.675)).toBe(2.68);
    expect(roundToTwo(-1.005)).toBe(-1.01);
    expect(roundToTwo(Number.NaN)).toBe(0);
  });

  it("formats money with the currency symbol and no float noise", () => {
    expect(formatMoney(52500, "BDT")).toBe("৳52,500");
    expect(formatMoney(1150.0000000000002, "BDT")).toBe("৳1,150");
    expect(formatMoney(10.5, "USD")).toBe("$10.50");
    expect(formatMoney(Number.POSITIVE_INFINITY, "EUR")).toBe("€0");
  });

  it("normalizes invoice dates to dd/mm/yyyy and back", () => {
    expect(formatInvoiceDate("2026-1-5")).toBe("05/01/2026");
    expect(formatInvoiceDate("5/1/2026")).toBe("05/01/2026");
    expect(toDateInputValue("05/01/2026")).toBe("2026-01-05");
    expect(toDateInputValue("not a date")).toBe("");
  });
});
