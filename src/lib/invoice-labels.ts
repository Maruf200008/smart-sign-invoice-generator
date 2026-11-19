import type { ContactIconKind } from "@/lib/invoice-contact";
import type { InvoiceLanguage } from "@/types/invoice";

/** The digits 0-9 of each language. */
const DIGITS: Record<InvoiceLanguage, string> = { english: "0123456789", bangla: "০১২৩৪৫৬৭৮৯" };

/**
 * Writes the digits of already-formatted text in the language's numerals ("৳26,720.50" -> "৳২৬,৭২০.৫০").
 * Only the glyphs change: grouping, decimals and values are exactly what the English invoice shows.
 */
export function localizeDigits(text: string, language: InvoiceLanguage = DEFAULT_INVOICE_LANGUAGE): string {
  const digits = DIGITS[language];
  if (!digits || language === "english") return text;
  return text.replace(/[0-9]/g, (digit) => digits[Number(digit)]);
}

const NON_LATIN_DIGIT = new RegExp(`[${Object.values(DIGITS).filter((digits) => digits !== DIGITS.english).join("")}]`, "g");

/** Any language's digits back to 0-9, so typed or pasted "১২.৫" parses as 12.5. */
export function toLatinDigits(text: string): string {
  return text.replace(NON_LATIN_DIGIT, (digit) => {
    for (const digits of Object.values(DIGITS)) {
      const index = digits.indexOf(digit);
      if (index >= 0) return String(index);
    }
    return digit;
  });
}

/**
 * Every piece of system text the invoice shows, per language: the printed sheet (editor, share page, PDF and JPEG
 * all render from these), the editor controls inside the invoice, and the language toggle itself.
 *
 * User-entered text (customer name, item descriptions, invoice number) is never translated; only these labels change.
 * Numbers keep their values and formatting but are shown in the language's digits (see `localizeDigits`).
 *
 * Adding a language: add it to `InvoiceLanguage`, give it a full `InvoiceLabels` entry here and a vocabulary in
 * amount-in-words.ts. TypeScript flags anything that's missing.
 */
export interface InvoiceLabels {
  /** BCP 47 tag, used for PDF metadata and the toggle button's `lang`. */
  htmlLang: string;
  /** Name of this language in itself, shown on the toolbar button that switches *to* it. */
  languageName: string;
  /** Name of this language in English, for the toolbar's (English) accessible text. */
  englishName: string;

  // Printed sheet
  invoice: string;
  to: string;
  enterTo: string;
  slNo: string;
  date: string;
  no: string;
  productDescription: string;
  size: string;
  sqf: string;
  qty: string;
  rate: string;
  total: string;
  discount: string;
  subtotal: string;
  vatTax: string;
  grandTotal: string;
  advance: string;
  remaining: string;
  inWords: string;
  signature: string;
  /** Company contact lines in the footer, by icon. The email address is the same in every language. */
  contact: Record<ContactIconKind, string>;

  // Screen-reader text of the sheet
  invoiceAria: (invoiceNumber: string) => string;
  pageAria: (title: string, page: number, pageCount: number) => string;
  itemsCaption: string;
  itemsCaptionContinued: (page?: number) => string;
  logoAlt: string;

  // Editor controls inside the invoice (never printed)
  customerNameAria: string;
  dateAria: (label: string) => string;
  chooseDate: string;
  taxRateAria: string;
  addRow: string;
  addRowTitle: string;
  maxRowsTitle: (max: number) => string;
  selectRowTitle: string;
  dragRow: string;
  removeRow: string;
  cellAria: (column: string, row: number) => string;
  columns: { name: string; width: string; height: string; quantity: string; unitPrice: string; total: string };
  rowActions: string;
  rowMenu: {
    insertAbove: (rows: number) => string;
    insertBelow: (rows: number) => string;
    duplicate: (rows: number) => string;
    clear: (rows: number) => string;
    delete: (rows: number) => string;
  };
}

const englishRows = (rows: number) => (rows > 1 ? `${rows} Rows` : "Row");
const bn = (value: number | string) => localizeDigits(String(value), "bangla");
const banglaRows = (rows: number) => (rows > 1 ? `${bn(rows)}টি সারি` : "সারি");

const english: InvoiceLabels = {
  htmlLang: "en",
  languageName: "English",
  englishName: "English",

  invoice: "Invoice",
  to: "To:",
  enterTo: "Enter To",
  slNo: "SL No",
  date: "Date",
  no: "No",
  productDescription: "Product Description",
  size: "Size",
  sqf: "SQF",
  qty: "Qty",
  rate: "Rate",
  total: "Total",
  discount: "Discount",
  subtotal: "Subtotal",
  vatTax: "VAT / Tax %",
  grandTotal: "Grand Total",
  advance: "Advance",
  remaining: "Remaining:",
  inWords: "In Words:",
  signature: "Signature",
  contact: {
    user: "Md. Mahabubur Rahman",
    phone: "+8801677-206964",
    mail: "smartsign2024@gmail.com",
    pin: "Appolo Akbari Complex, Opposite Of Chandpur Govt. College,\nChandpur Sadar, Chandpur."
  },

  invoiceAria: (invoiceNumber) => `Invoice ${invoiceNumber}`.trim(),
  pageAria: (title, page, pageCount) => `${title}, page ${page} of ${pageCount}`,
  itemsCaption: "Invoice items",
  itemsCaptionContinued: (page) => (page ? `Invoice items (continued, page ${page})` : "Invoice items (continued)"),
  logoAlt: "Smart Sign Color Lab",

  customerNameAria: "Customer name",
  dateAria: (label) => `${label} (click to choose)`,
  chooseDate: "Choose invoice date",
  taxRateAria: "VAT / Tax rate",
  addRow: "Add Row",
  addRowTitle: "Add a row (empty rows at the end are not printed)",
  maxRowsTitle: (max) => `An invoice can have up to ${max} rows`,
  selectRowTitle: "Select row (right-click for row actions)",
  dragRow: "Drag row",
  removeRow: "Remove row",
  cellAria: (column, row) => `${column}, row ${row}`,
  columns: { name: "Product description", width: "Width", height: "Height", quantity: "Quantity", unitPrice: "Rate", total: "Total" },
  rowActions: "Row actions",
  rowMenu: {
    insertAbove: (rows) => `Insert ${englishRows(rows)} Above`,
    insertBelow: (rows) => `Insert ${englishRows(rows)} Below`,
    duplicate: (rows) => `Duplicate ${englishRows(rows)}`,
    clear: (rows) => `Clear ${englishRows(rows)}`,
    delete: (rows) => `Delete ${englishRows(rows)}`
  }
};

const bangla: InvoiceLabels = {
  htmlLang: "bn",
  languageName: "বাংলা",
  englishName: "Bangla",

  invoice: "ইনভয়েস",
  to: "প্রাপক:",
  enterTo: "প্রাপকের নাম লিখুন",
  // Short forms where the sheet has a fixed-width box: "ক্রঃ নং" (ক্রমিক নং) fits the 36px SL No label, "সংখ্যা" the
  // Qty column and "ভ্যাট / কর %" one line of the VAT row (measured with the invoice font; see invoice-language.test).
  slNo: "ক্রঃ নং",
  date: "তারিখ",
  no: "নং",
  productDescription: "পণ্যের বিবরণ",
  size: "সাইজ",
  sqf: "বর্গফুট",
  qty: "সংখ্যা",
  rate: "রেট",
  total: "মোট",
  discount: "ছাড়",
  subtotal: "সাবটোটাল",
  vatTax: "ভ্যাট / কর %",
  grandTotal: "সর্বমোট",
  advance: "অগ্রিম",
  remaining: "বাকি:",
  inWords: "কথায়:",
  signature: "স্বাক্ষর",
  contact: {
    user: "মোঃ মাহবুবুর রহমান",
    phone: "+৮৮০১৬৭৭-২০৬৯৬৪",
    mail: "smartsign2024@gmail.com",
    pin: "অ্যাপোলো আকবরী কমপ্লেক্স, চাঁদপুর সরকারি কলেজের বিপরীতে,\nচাঁদপুর সদর, চাঁদপুর।"
  },

  invoiceAria: (invoiceNumber) => `ইনভয়েস ${invoiceNumber}`.trim(),
  pageAria: (title, page, pageCount) => `${title}, পৃষ্ঠা ${bn(page)} / ${bn(pageCount)}`,
  itemsCaption: "ইনভয়েসের পণ্যসমূহ",
  itemsCaptionContinued: (page) => (page ? `ইনভয়েসের পণ্যসমূহ (চলমান, পৃষ্ঠা ${bn(page)})` : "ইনভয়েসের পণ্যসমূহ (চলমান)"),
  logoAlt: "স্মার্ট সাইন কালার ল্যাব",

  customerNameAria: "প্রাপকের নাম",
  dateAria: (label) => `${label} (বেছে নিতে ক্লিক করুন)`,
  chooseDate: "ইনভয়েসের তারিখ বেছে নিন",
  taxRateAria: "ভ্যাট / করের হার",
  addRow: "সারি যোগ করুন",
  addRowTitle: "একটি সারি যোগ করুন (শেষের খালি সারি প্রিন্ট হয় না)",
  maxRowsTitle: (max) => `একটি ইনভয়েসে সর্বোচ্চ ${bn(max)}টি সারি থাকতে পারে`,
  selectRowTitle: "সারি নির্বাচন করুন (সারির অপশনের জন্য রাইট-ক্লিক করুন)",
  dragRow: "সারি টেনে সরান",
  removeRow: "সারি মুছুন",
  cellAria: (column, row) => `${column}, সারি ${bn(row)}`,
  columns: { name: "পণ্যের বিবরণ", width: "প্রস্থ", height: "উচ্চতা", quantity: "সংখ্যা", unitPrice: "রেট", total: "মোট" },
  rowActions: "সারির অপশন",
  rowMenu: {
    insertAbove: (rows) => `উপরে ${banglaRows(rows)} যোগ করুন`,
    insertBelow: (rows) => `নিচে ${banglaRows(rows)} যোগ করুন`,
    duplicate: (rows) => `${banglaRows(rows)} ডুপ্লিকেট করুন`,
    clear: (rows) => `${banglaRows(rows)} খালি করুন`,
    delete: (rows) => `${banglaRows(rows)} মুছুন`
  }
};

export const invoiceLabels: Readonly<Record<InvoiceLanguage, InvoiceLabels>> = { english, bangla };

export const INVOICE_LANGUAGES = Object.keys(invoiceLabels) as InvoiceLanguage[];
export const DEFAULT_INVOICE_LANGUAGE: InvoiceLanguage = "english";

export function isInvoiceLanguage(value: unknown): value is InvoiceLanguage {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(invoiceLabels, value);
}

/** The language the toggle switches to (cycles through all languages, so a third one needs no toggle changes). */
export function nextInvoiceLanguage(language: InvoiceLanguage): InvoiceLanguage {
  const index = INVOICE_LANGUAGES.indexOf(language);
  return INVOICE_LANGUAGES[(index + 1) % INVOICE_LANGUAGES.length];
}

export function getInvoiceLabels(language: InvoiceLanguage = DEFAULT_INVOICE_LANGUAGE): InvoiceLabels {
  return invoiceLabels[language] ?? invoiceLabels[DEFAULT_INVOICE_LANGUAGE];
}
