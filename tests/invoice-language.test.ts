import { readFileSync } from "fs";
import { join } from "path";
import * as hb from "harfbuzzjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { amountInWords, integerToWords } from "@/lib/amount-in-words";
import { toInvoiceDocument } from "@/lib/invoice-document";
import { getInvoiceLabels, INVOICE_LANGUAGES, invoiceLabels, localizeDigits, nextInvoiceLanguage, toLatinDigits, type InvoiceLabels } from "@/lib/invoice-labels";
import { parseNumericText } from "@/lib/invoice-grid";
import { parsePositiveInput, roundPositiveInput } from "@/lib/invoice-utils";
import { applyItemPatch, createBlankItem } from "@/lib/invoice-utils";
import { TextShaper } from "@/lib/pdf/text-shaper";
import { buildPdfTitle } from "@/lib/share-pdf";
import type { InvoiceData } from "@/types/invoice";

// next/image needs Next's image config; a plain <img> is all the static markup needs.
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => createElement("img", { alt })
}));

const invoice = {
  customer: { name: "রহিম আহমেদ", invoiceNumber: "INV-7", date: "2026-11-18", address: "", phone: "" },
  items: [
    applyItemPatch(createBlankItem(), { name: "Vinyl Banner", width: 10, height: 5, quantity: 2, unitPrice: 25 }),
    applyItemPatch(createBlankItem(), { name: "ফ্লেক্স প্রিন্ট", quantity: 3, unitPrice: 8000 })
  ],
  discount: 100,
  taxRate: 5,
  advance: 1000,
  settings: { currency: "BDT" }
} as unknown as InvoiceData;

// The PDF engine's own shaper and fonts: its widths are the widths the browser lays out with.
const shaper = new TextShaper(hb, async (url: string) => {
  const bytes = readFileSync(join(process.cwd(), "public", url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
});

async function textWidth(text: string, size: number, weight: number) {
  const runs = await shaper.shape(text, weight);
  return runs.reduce((sum, run) => sum + (run.kind === "glyphs" ? (run.advance / run.upem) * size : 0), 0);
}

/** Visible text of rendered markup (tags and attribute values removed). */
const visibleText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("Bangla amount in words", () => {
  it("writes the remaining amount in Bangla words with the Lakh / Crore system", () => {
    expect(amountInWords(26150, { language: "bangla" })).toBe("ছাব্বিশ হাজার একশ পঞ্চাশ টাকা মাত্র।");
    expect(amountInWords(125000, { language: "bangla" })).toBe("এক লক্ষ পঁচিশ হাজার টাকা মাত্র।");
    expect(amountInWords(10000000, { language: "bangla" })).toBe("এক কোটি টাকা মাত্র।");
    expect(amountInWords(123456789, { language: "bangla" })).toBe("বারো কোটি চৌত্রিশ লক্ষ ছাপ্পান্ন হাজার সাতশ উননব্বই টাকা মাত্র।");
    expect(amountInWords(1_000_000_000, { language: "bangla" })).toBe("একশ কোটি টাকা মাত্র।");
    expect(amountInWords(999, { language: "bangla" })).toBe("নয়শ নিরানব্বই টাকা মাত্র।");
  });

  it("handles paisa, zero and invalid input like the English text", () => {
    expect(amountInWords(1250.5, { language: "bangla" })).toBe("এক হাজার দুইশ পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র।");
    expect(amountInWords(0.1 + 0.2, { language: "bangla" })).toBe("শূন্য টাকা ত্রিশ পয়সা মাত্র।");
    expect(amountInWords(0, { language: "bangla" })).toBe("শূন্য টাকা মাত্র।");
    expect(amountInWords(Number.NaN, { language: "bangla" })).toBe("শূন্য টাকা মাত্র।");
    expect(amountInWords(-50, { language: "bangla" })).toBe("শূন্য টাকা মাত্র।");
  });

  it("has a distinct word for every number from 1 to 99", () => {
    const words = Array.from({ length: 99 }, (_, index) => integerToWords(index + 1, "south-asian", "bangla"));
    expect(new Set(words).size).toBe(99);
    expect(words.every((word) => /^[ঀ-৿]+$/.test(word))).toBe(true);
  });

  it("never contains a Latin letter, for any amount or currency", () => {
    const amounts = [1, 7.07, 19.99, 100, 101, 1001, 99_999, 100_000.01, 4_567_890.5, 98_765_432_100];
    for (const currency of ["BDT", "USD", "EUR", "GBP", "INR"] as const) {
      for (const amount of amounts) expect(amountInWords(amount, { currency, language: "bangla" })).not.toMatch(/[A-Za-z]/);
    }
    expect(amountInWords(1_000_000, { system: "international", language: "bangla" })).toBe("এক মিলিয়ন টাকা মাত্র।");
  });

  it("leaves the English text unchanged", () => {
    expect(amountInWords(26150)).toBe("Twenty Six Thousand One Hundred Fifty Taka Only.");
    expect(amountInWords(26150, { language: "english" })).toBe("Twenty Six Thousand One Hundred Fifty Taka Only.");
  });
});

describe("invoice document language", () => {
  it("changes only the language, the words and the digit glyphs, never a value", () => {
    const english = toInvoiceDocument(invoice);
    const bangla = toInvoiceDocument(invoice, "bangla");

    expect(english.language).toBe("english");
    expect(bangla.language).toBe("bangla");
    expect(english.amountInWords).toMatch(/Taka Only\.$/);
    expect(bangla.amountInWords).toMatch(/টাকা মাত্র।$/);

    // The numeric totals are identical, and every formatted number reads back to exactly the English text.
    expect(bangla.totals).toEqual(english.totals);
    const latin = JSON.parse(toLatinDigits(JSON.stringify({ ...bangla, language: english.language, amountInWords: english.amountInWords })));
    expect(latin).toEqual(english);
    expect(bangla.money.remaining).toBe("৳২৬,৭২০");
    expect(bangla.items[0]).toMatchObject({ width: "১০", height: "৫", quantity: "২", sqf: "১০০", rate: "২৫", total: "২,৫০০" });
    expect(bangla.taxRate).toBe("৫");
    expect(bangla.date).toBe("১৮/১১/২০২৬");
    // User text keeps its own digits.
    expect(bangla.invoiceNumber).toBe("INV-7");
    expect(bangla.amountInWords).toBe("ছাব্বিশ হাজার সাতশ বিশ টাকা মাত্র।");
  });

  it("writes digits in Bangla and reads typed Bengali or Latin digits back as the same number", () => {
    expect(localizeDigits("৳1,234,567.89", "bangla")).toBe("৳১,২৩৪,৫৬৭.৮৯");
    expect(localizeDigits("৳1,234.50", "english")).toBe("৳1,234.50");
    expect(toLatinDigits("১২৩৪৫৬৭৮৯০")).toBe("1234567890");
    // Grid cells (size, qty, rate, total) and the summary inputs (discount, VAT %, advance).
    for (const text of ["১২.৫", "12.5"]) {
      expect(parseNumericText(text)).toBe(12.5);
      expect(parsePositiveInput(text)).toBe(12.5);
      expect(roundPositiveInput(text)).toBe(12.5);
    }
    expect(parseNumericText("১,২৫০")).toBe(1250);
    expect(roundPositiveInput("০.১২৩")).toBe(0.12);
  });

  it("titles the PDF in the invoice language", () => {
    expect(buildPdfTitle(toInvoiceDocument(invoice))).toBe("Invoice INV-7 — রহিম আহমেদ");
    expect(buildPdfTitle(toInvoiceDocument(invoice, "bangla"))).toBe("ইনভয়েস INV-7 — রহিম আহমেদ");
  });
});

describe("invoice labels", () => {
  it("defines every label in every language", () => {
    const keys = (labels: InvoiceLabels) => Object.keys(labels).sort();
    for (const language of INVOICE_LANGUAGES) expect(keys(invoiceLabels[language])).toEqual(keys(invoiceLabels.english));
  });

  it("has no English left in the Bangla labels (apart from the phone number and email address)", () => {
    const bangla = getInvoiceLabels("bangla");
    const strings: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push(String((value as (...args: unknown[]) => string)("", 2, 3)));
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    // Skipped: the language tag and English name (toolbar accessibility), and the phone number / email address.
    const skipped = new Set(["htmlLang", "englishName", "contact"]);
    collect(Object.fromEntries(Object.entries(bangla).filter(([key]) => !skipped.has(key))));
    collect({ user: bangla.contact.user, pin: bangla.contact.pin });

    for (const text of strings) expect(text, text).not.toMatch(/[A-Za-z]/);
  });

  it("toggles English <-> Bangla", () => {
    expect(nextInvoiceLanguage("english")).toBe("bangla");
    expect(nextInvoiceLanguage("bangla")).toBe("english");
    expect(getInvoiceLabels(nextInvoiceLanguage("english")).languageName).toBe("বাংলা");
    expect(getInvoiceLabels(nextInvoiceLanguage("bangla")).languageName).toBe("English");
  });

  it("shapes every Bangla label with the bundled PDF fonts, without a missing glyph", async () => {
    const bangla = getInvoiceLabels("bangla");
    const printed = [
      bangla.invoice, bangla.slNo, bangla.date, bangla.to, bangla.no, bangla.productDescription, bangla.size, bangla.qty, bangla.sqf,
      bangla.rate, bangla.total, bangla.subtotal, bangla.discount, bangla.vatTax, bangla.grandTotal, bangla.advance, bangla.remaining,
      bangla.inWords, bangla.signature, bangla.contact.user, bangla.contact.pin, amountInWords(123456789.75, { language: "bangla" })
    ];

    for (const weight of [400, 600, 700, 800]) {
      const runs = await shaper.shape(printed.join(" ").replace(/\n/g, " "), weight);
      expect(runs.filter((run) => run.kind === "missing")).toEqual([]);
    }
  });

  it("fits every label into its fixed-width box on the sheet, in every language", async () => {
    // Content widths in CSS px, from sheet-styles.ts. The table spans the A4 width minus its 40px side padding.
    const table = (210 / 25.4) * 96 - 80;
    const boxes: { key: keyof InvoiceLabels; size: number; weight: number; width: number }[] = [
      // metaLabel: w-[56px] px-[10px], no wrapping
      { key: "slNo", size: 12, weight: 600, width: 36 },
      { key: "date", size: 12, weight: 600, width: 36 },
      // th: column % of the table minus its horizontal padding (single words can't wrap)
      { key: "no", size: 13, weight: 700, width: 0.07 * table - 12 },
      { key: "qty", size: 15, weight: 700, width: 0.07 * table - 8 },
      { key: "sqf", size: 15, weight: 700, width: 0.1 * table - 8 },
      { key: "rate", size: 15, weight: 700, width: 0.09 * table - 8 },
      { key: "total", size: 15, weight: 700, width: 0.13 * table },
      { key: "size", size: 15, weight: 700, width: 0.15 * table },
      // vatRow: 320px box, grid [1fr | 60px | 140px], label px-[14px] + 1px border: stays on one line
      { key: "vatTax", size: 16, weight: 600, width: 320 - 60 - 140 - 28 - 1 }
    ];

    for (const language of INVOICE_LANGUAGES) {
      for (const { key, size, weight, width } of boxes) {
        const text = invoiceLabels[language][key] as string;
        const measured = await textWidth(text, size, weight);
        expect(measured, `${language} "${text}" is ${measured.toFixed(1)}px, box is ${width.toFixed(1)}px`).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("rendered invoice (the markup the PDF, JPEG and print are made from)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  // Layout effects can't run in static rendering; React says so on the console. That's expected here.
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  const render = (language: "english" | "bangla") =>
    renderToStaticMarkup(createElement(InvoiceDocument, { data: toInvoiceDocument(invoice, language) }));

  it("prints every label in Bangla, keeping user text and numbers as they are", () => {
    const text = visibleText(render("bangla"));

    for (const label of ["ইনভয়েস", "ক্রঃ নং", "তারিখ", "প্রাপক:", "পণ্যের বিবরণ", "সাইজ", "সংখ্যা", "বর্গফুট", "রেট", "মোট", "সাবটোটাল", "ছাড়", "ভ্যাট / কর %", "সর্বমোট", "অগ্রিম", "বাকি:", "কথায়:", "স্বাক্ষর", "মোঃ মাহবুবুর রহমান"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("কথায়: ছাব্বিশ হাজার সাতশ বিশ টাকা মাত্র।");
    // User-entered content is never translated.
    expect(text).toContain("Vinyl Banner");
    expect(text).toContain("ফ্লেক্স প্রিন্ট");
    expect(text).toContain("INV-7");
    // Numbers in Bengali digits: money, date, row numbers, phone.
    expect(text).toContain("৳২৬,৭২০");
    expect(text).toContain("১৮/১১/২০২৬");
    expect(text).toContain("+৮৮০১৬৭৭-২০৬৯৬৪");

    // Apart from what the user typed, the email address and the size separator, no Latin letter or digit is left.
    const systemText = text.replace("Vinyl Banner", "").replace("INV-7", "").replace("smartsign2024@gmail.com", "").replace(/\bX\b/g, "");
    expect(systemText).not.toMatch(/[A-Za-z0-9]/);
  });

  it("prints the same English invoice as before", () => {
    const text = visibleText(render("english"));
    for (const label of ["INVOICE", "SL No", "Date", "To:", "Product Description", "Subtotal", "Discount", "Grand Total", "Advance", "Remaining:", "In Words:", "Signature", "Md. Mahabubur Rahman"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("In Words: Twenty Six Thousand Seven Hundred Twenty Taka Only.");
    expect(text).toContain("৳26,720");
    expect(text).toContain("+8801677-206964");
    expect(text).not.toMatch(/[০-৯]/);
    expect(text).not.toMatch(/[ঀ-৿]{2,} টাকা/);
  });
});

describe("invoice language preference", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    // zustand persist reads window.localStorage.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key)
      }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const loadStores = async () => ({
    ...(await import("@/store/invoice-language-store")),
    ...(await import("@/store/invoice-store"))
  });

  it("starts in English, toggles without touching the invoice, and is remembered", async () => {
    const { useInvoiceLanguageStore, useInvoiceStore, getCurrentInvoiceDocument } = await loadStores();
    expect(useInvoiceLanguageStore.getState().language).toBe("english");

    const before = useInvoiceStore.getState();
    useInvoiceLanguageStore.getState().toggleLanguage();
    expect(useInvoiceLanguageStore.getState().language).toBe("bangla");
    // The invoice (and so its saved state, totals and sync) is untouched.
    expect(useInvoiceStore.getState().invoice).toBe(before.invoice);
    expect(useInvoiceStore.getState().savedInvoices).toBe(before.savedInvoices);
    // Download / Share export the visible language.
    expect(getCurrentInvoiceDocument().language).toBe("bangla");

    expect(JSON.parse(storage.get("smart-invoice:invoice-language")!).state).toEqual({ language: "bangla" });

    // Next visit (or a new invoice): the language is restored.
    vi.resetModules();
    const reloaded = await loadStores();
    expect(reloaded.useInvoiceLanguageStore.getState().language).toBe("bangla");
    reloaded.useInvoiceStore.getState().resetDraft();
    expect(reloaded.useInvoiceLanguageStore.getState().language).toBe("bangla");
  });

  it("ignores an unknown stored language", async () => {
    storage.set("smart-invoice:invoice-language", JSON.stringify({ state: { language: "klingon" }, version: 1 }));
    const { useInvoiceLanguageStore } = await loadStores();
    expect(useInvoiceLanguageStore.getState().language).toBe("english");
  });
});
