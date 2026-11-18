import { amountInWords } from "@/lib/amount-in-words";
import { calculateTotals, formatDecimal, formatInvoiceDate, formatMoney, lineQuantitySqf, lineTotal, safePositiveNumber } from "@/lib/invoice-utils";
import { ROWS_PER_PAGE } from "@/lib/invoice-sheet/pagination";
import type { CurrencyCode, InvoiceData, InvoiceTotals } from "@/types/invoice";
import type { SharedInvoice, SharedInvoiceItem } from "@/types/share";

/**
 * Everything the printable invoice shows, already formatted. The editor, the public share page and the PDF all
 * display these exact strings, so a value can never look different in the PDF than on screen.
 */
export interface InvoiceDocumentItem {
  name: string;
  width: string;
  height: string;
  hasSize: boolean;
  quantity: string;
  sqf: string;
  rate: string;
  total: string;
}

export interface InvoiceDocumentData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  items: InvoiceDocumentItem[];
  currency: CurrencyCode;
  totals: InvoiceTotals;
  discount: string;
  taxRate: string;
  advance: string;
  /** Grand total in words, e.g. "One Thousand Two Hundred Fifty Taka and Fifty Paisa Only." */
  amountInWords: string;
  money: {
    subtotal: string;
    tax: string;
    grandTotal: string;
    remaining: string;
  };
}

/** Editable numbers are shown exactly as typed (no grouping) and zero is shown as blank, same as the editor inputs. */
export function plainNumber(value: number) {
  const number = safePositiveNumber(value);
  return number > 0 ? String(number) : "";
}

/** Whole-number line totals with thousands separators, matching the editor's Total cell. */
export function formatLineTotal(value: number) {
  const number = Math.round(safePositiveNumber(value));
  return number > 0 ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number) : "";
}

type RowLike = { name?: string; width: number; height: number; quantity: number; unitPrice: number; total: number };

export function isBlankItem(item: RowLike) {
  return !(item.name ?? "").trim() && !item.width && !item.height && !item.quantity && !item.unitPrice && !item.total;
}

/**
 * Rows up to the last one with content (blank rows in between stay, as on screen). Unused rows past that are not
 * printed beyond the first page, which always shows its full 12 rows (see `buildDocument`).
 * At least one row is kept so an empty invoice still shows its table.
 */
export function printedItemCount(items: readonly RowLike[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!isBlankItem(items[index])) return index + 1;
  }
  return Math.min(1, items.length);
}

const BLANK_ROW: SharedInvoiceItem = { name: "", width: 0, height: 0, quantity: 0, unitPrice: 0, total: 0, totalIsManual: false };

function padRows(items: readonly SharedInvoiceItem[]): SharedInvoiceItem[] {
  return [...items, ...Array.from({ length: Math.max(0, ROWS_PER_PAGE - items.length) }, () => BLANK_ROW)];
}

type DocumentSource = Pick<SharedInvoice, "customer" | "items" | "advance" | "discount" | "taxRate"> & { currency: CurrencyCode };

function buildDocument(source: DocumentSource): InvoiceDocumentData {
  const totals = calculateTotals(source);
  const { currency } = source;

  return {
    invoiceNumber: source.customer.invoiceNumber ?? "",
    date: formatInvoiceDate(source.customer.date ?? ""),
    customerName: source.customer.name ?? "",
    // The first page always shows all 12 rows, padded with blank ones for invoices saved with fewer rows.
    items: padRows(source.items.slice(0, Math.max(printedItemCount(source.items), ROWS_PER_PAGE))).map((item) => {
      const sqf = lineQuantitySqf(item);

      return {
        name: item.name ?? "",
        width: plainNumber(item.width),
        height: plainNumber(item.height),
        hasSize: item.width > 0 || item.height > 0,
        quantity: plainNumber(item.quantity),
        sqf: sqf > 0 ? formatDecimal(sqf) : "",
        rate: plainNumber(item.unitPrice),
        total: formatLineTotal(lineTotal(item))
      };
    }),
    currency,
    totals,
    discount: plainNumber(source.discount),
    taxRate: plainNumber(source.taxRate),
    advance: plainNumber(source.advance),
    amountInWords: amountInWords(totals.grandTotal, { currency }),
    money: {
      subtotal: formatMoney(totals.subtotal, currency),
      tax: formatMoney(totals.tax, currency),
      grandTotal: formatMoney(totals.grandTotal, currency),
      remaining: formatMoney(totals.remaining, currency)
    }
  };
}

export function toInvoiceDocument(invoice: InvoiceData): InvoiceDocumentData {
  return buildDocument({ ...invoice, currency: invoice.settings.currency });
}

export function sharedToInvoiceDocument(invoice: SharedInvoice): InvoiceDocumentData {
  return buildDocument(invoice);
}
