import { ROWS_PER_PAGE } from "@/lib/invoice-sheet/pagination";
import type { CurrencyCode, InvoiceData, InvoiceItem, InvoiceTotals } from "@/types/invoice";

/** The subset of an item needed for pricing, so shared (id-less) items can reuse the same math. */
export type LineItemInput = Pick<InvoiceItem, "width" | "height" | "quantity" | "unitPrice" | "total" | "totalIsManual">;
type TotalsInput = Pick<InvoiceData, "discount" | "taxRate" | "advance"> & { items: LineItemInput[] };

export const currencySymbols: Record<CurrencyCode, string> = {
  BDT: "৳",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹"
};

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const serial = String(Math.floor(Math.random() * 9000) + 1000);
  return `INV-${year}${month}${day}-${serial}`;
}

export function formatLocalDateInput(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

export function formatInvoiceDate(value: string) {
  const trimmedValue = value.trim();
  const isoDateMatch = trimmedValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dayMonthYearMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }

  if (dayMonthYearMatch) {
    const [, day, month, year] = dayMonthYearMatch;
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
  }

  return value;
}

export function toDateInputValue(value: string) {
  const trimmedValue = value.trim();
  const isoDateMatch = trimmedValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dayMonthYearMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (dayMonthYearMatch) {
    const [, day, month, year] = dayMonthYearMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

/** Pads an invoice's rows with blank ones so it always has at least one full page (12 rows) to type into. */
export function withMinimumRows(items: InvoiceItem[], minimum = ROWS_PER_PAGE): InvoiceItem[] {
  return items.length >= minimum ? items : [...items, ...Array.from({ length: minimum - items.length }, () => createBlankItem())];
}

export function createBlankItem(): InvoiceItem {
  return {
    id: uid("item"),
    name: "",
    width: 0,
    height: 0,
    sqf: 0,
    quantity: 0,
    unitPrice: 0,
    total: 0,
    totalIsManual: false
  };
}

export function lineSqf(item: LineItemInput) {
  if (hasPositiveValue(item.width) && hasPositiveValue(item.height)) {
    return calculateSqf(item.width, item.height) ?? 0;
  }

  return 0;
}

export function lineQuantitySqf(item: LineItemInput) {
  const sqf = lineSqf(item);
  const quantity = safePositiveNumber(item.quantity) || 1;

  return roundToTwo(sqf * quantity);
}

export function lineTotal(item: LineItemInput) {
  if (item.totalIsManual) {
    return roundToInteger(safePositiveNumber(item.total));
  }

  return calculateLineTotal(item) ?? 0;
}

export function calculateSqf(width: unknown, height: unknown) {
  if (!hasPositiveValue(width) || !hasPositiveValue(height)) {
    return 0;
  }

  return roundToTwo(safePositiveNumber(width) * safePositiveNumber(height));
}

export function calculateLineTotal(item: LineItemInput) {
  const rate = safePositiveNumber(item.unitPrice);

  if (!rate) {
    return 0;
  }

  const sqf = lineSqf(item);
  const quantity = safePositiveNumber(item.quantity);

  if (sqf && quantity) {
    return roundToInteger(sqf * quantity * rate);
  }

  if (quantity) {
    return roundToInteger(quantity * rate);
  }

  if (sqf) {
    return roundToInteger(sqf * rate);
  }

  return 0;
}

/**
 * Applies an edit to one row and keeps its derived fields right: a new size recalculates SQF, a new size,
 * quantity or rate recalculates the total (dropping a manual total), a typed total becomes a manual override, and
 * `totalIsManual: false` restores the calculated total.
 */
export function applyItemPatch(item: InvoiceItem, patch: Partial<InvoiceItem>): InvoiceItem {
  const nextItem = { ...item, ...patch };
  const sizeChanged = "width" in patch || "height" in patch;
  const calculationChanged = sizeChanged || "quantity" in patch || "unitPrice" in patch;

  if (sizeChanged) {
    nextItem.sqf = calculateSqf(nextItem.width, nextItem.height);
  }

  if (calculationChanged) {
    nextItem.totalIsManual = false;
    nextItem.total = calculateLineTotal(nextItem);
  }

  if ("total" in patch && !calculationChanged) {
    nextItem.totalIsManual = true;
  }

  if ("totalIsManual" in patch && patch.totalIsManual === false) {
    nextItem.total = calculateLineTotal(nextItem);
  }

  return nextItem;
}

export const MAX_TAX_RATE = 100;

/**
 * Invoice totals. Order: subtotal -> discount (capped at subtotal) -> VAT/tax on the discounted amount ->
 * grand total -> advance (capped at grand total) -> remaining.
 * Negative inputs are treated as 0 and every money value is rounded to 2 decimals, so float noise such as
 * 1150.0000000000002 can never leak into a printed total.
 */
export function calculateTotals(invoice: TotalsInput): InvoiceTotals {
  const subtotal = roundToTwo(invoice.items.reduce((sum, item) => sum + lineTotal(item), 0));
  const discount = roundToTwo(Math.min(safePositiveNumber(invoice.discount), subtotal));
  const taxable = roundToTwo(Math.max(subtotal - discount, 0));
  const taxRate = Math.min(safePositiveNumber(invoice.taxRate), MAX_TAX_RATE);
  const tax = roundToTwo((taxable * taxRate) / 100);
  const grandTotal = roundToTwo(taxable + tax);
  const advance = roundToTwo(Math.min(safePositiveNumber(invoice.advance), grandTotal));

  return {
    subtotal,
    discount,
    taxable,
    tax,
    grandTotal,
    advance,
    remaining: roundToTwo(Math.max(grandTotal - advance, 0))
  };
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

/** "৳1,150" for whole amounts, "৳1,150.50" otherwise (decided on the rounded value, not raw float noise). */
export function formatMoney(value: number, currency: CurrencyCode) {
  const symbol = currencySymbols[currency] ?? "";
  const amount = roundToTwo(value);
  return `${symbol}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2
  }).format(amount)}`;
}

export function safeNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function safePositiveNumber(value: unknown) {
  return Math.max(safeNumber(value), 0);
}

/** Rounds half away from zero to 2 decimals; the EPSILON nudge makes 1.005 round to 1.01 rather than 1.00. */
export function roundToTwo(value: number) {
  const finite = Number.isFinite(value) ? value : 0;
  return (Math.sign(finite) * Math.round(Math.abs(finite) * 100 + Number.EPSILON * 100)) / 100 || 0;
}

export function roundToInteger(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

export function hasPositiveValue(value: unknown) {
  return safePositiveNumber(value) > 0;
}

export function parsePositiveInput(value: string) {
  if (value.trim() === "") {
    return 0;
  }

  return safePositiveNumber(value);
}

export function roundPositiveInput(value: string) {
  if (value.trim() === "") {
    return 0;
  }

  return roundToTwo(safePositiveNumber(value));
}

