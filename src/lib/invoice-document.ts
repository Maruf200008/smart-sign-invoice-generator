import { amountInWords } from "@/lib/amount-in-words";
import { calculateTotals, formatDecimal, formatInvoiceDate, formatMoney, lineQuantitySqf, lineTotal, safePositiveNumber } from "@/lib/invoice-utils";
import { ROWS_PER_PAGE } from "@/lib/invoice-sheet/pagination";
import { DEFAULT_INVOICE_LANGUAGE, localizeDigits } from "@/lib/invoice-labels";
import type { CurrencyCode, InvoiceData, InvoiceLanguage, InvoiceTotals } from "@/types/invoice";
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
  /** Language of every label and of `amountInWords`. Exports render this, so they always match the screen. */
  language: InvoiceLanguage;
  invoiceNumber: string;
  date: string;
  customerName: string;
  items: InvoiceDocumentItem[];
  currency: CurrencyCode;
  totals: InvoiceTotals;
  discount: string;
  taxRate: string;
  advance: string;
  /** Remaining amount (grand total − advance) in words, e.g. "Twenty Six Thousand One Hundred Fifty Taka Only." / "ছাব্বিশ হাজার একশ পঞ্চাশ টাকা মাত্র।" */
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
 * printed beyond the first page, which always shows its full 15 rows (see `buildDocument`).
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

function buildDocument(source: DocumentSource, language: InvoiceLanguage): InvoiceDocumentData {
  const totals = calculateTotals(source);
  const { currency } = source;
  // Numbers are formatted exactly as in English, then written in the language digits (only the glyphs change).
  const n = (text: string) => localizeDigits(text, language);

  return {
    language,
    invoiceNumber: source.customer.invoiceNumber ?? "",
    date: n(formatInvoiceDate(source.customer.date ?? "")),
    customerName: source.customer.name ?? "",
    // The first page always shows all 15 rows, padded with blank ones for invoices saved with fewer rows.
    items: padRows(source.items.slice(0, Math.max(printedItemCount(source.items), ROWS_PER_PAGE))).map((item) => {
      const sqf = lineQuantitySqf(item);

      return {
        name: item.name ?? "",
        width: n(plainNumber(item.width)),
        height: n(plainNumber(item.height)),
        hasSize: item.width > 0 || item.height > 0,
        quantity: n(plainNumber(item.quantity)),
        sqf: sqf > 0 ? n(formatDecimal(sqf)) : "",
        rate: n(plainNumber(item.unitPrice)),
        total: n(formatLineTotal(lineTotal(item)))
      };
    }),
    currency,
    totals,
    discount: n(plainNumber(source.discount)),
    taxRate: n(plainNumber(source.taxRate)),
    advance: n(plainNumber(source.advance)),
    // Same value as the Remaining badge (grand total − advance), so the two always agree.
    amountInWords: amountInWords(totals.remaining, { currency, language }),
    money: {
      subtotal: n(formatMoney(totals.subtotal, currency)),
      tax: n(formatMoney(totals.tax, currency)),
      grandTotal: n(formatMoney(totals.grandTotal, currency)),
      remaining: n(formatMoney(totals.remaining, currency))
    }
  };
}

/**
 * `language` is the viewer's invoice language (see store/invoice-language-store.ts), not part of the invoice data:
 * switching it only relabels the document and never changes a value.
 */
export function toInvoiceDocument(invoice: InvoiceData, language: InvoiceLanguage = DEFAULT_INVOICE_LANGUAGE): InvoiceDocumentData {
  return buildDocument({ ...invoice, currency: invoice.settings.currency }, language);
}

export function sharedToInvoiceDocument(invoice: SharedInvoice, language: InvoiceLanguage = DEFAULT_INVOICE_LANGUAGE): InvoiceDocumentData {
  return buildDocument(invoice, language);
}
