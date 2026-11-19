import { readFileSync } from "fs";
import { join } from "path";
import { unzlibSync } from "fflate";
import * as hb from "harfbuzzjs";
import { describe, expect, it } from "vitest";
import { BUNDLED_FONT_FAMILIES, buildInvoiceFontCss, INVOICE_FONT_STACK, pickFontFile } from "@/lib/fonts/font-registry";
import { formatLineTotal, plainNumber, printedItemCount, sharedToInvoiceDocument, toInvoiceDocument } from "@/lib/invoice-document";
import { paginateInvoiceRows, ROWS_PER_PAGE } from "@/lib/invoice-sheet/pagination";
import { PAGE_HEIGHT_PT, PAGE_WIDTH_PT } from "@/lib/invoice-sheet/sheet-metrics";
import { num, PdfDocument, utf16Hex } from "@/lib/pdf/pdf-writer";
import { arcToCubics, parseSvgPath } from "@/lib/pdf/svg-path";
import { TextShaper } from "@/lib/pdf/text-shaper";
import { buildPdfFileName, buildPdfTitle } from "@/lib/share-pdf";
import { createBlankItem } from "@/lib/invoice-utils";
import type { InvoiceData } from "@/types/invoice";

const loadFont = async (url: string) => {
  const bytes = readFileSync(join(process.cwd(), "public", url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const shaper = new TextShaper(hb, loadFont);

async function shapeAll(text: string, weight = 400) {
  const runs = await shaper.shape(text, weight);
  return {
    runs,
    missing: runs.filter((run) => run.kind === "missing"),
    glyphs: runs.flatMap((run) => (run.kind === "glyphs" ? run.glyphs : []))
  };
}

describe("Bengali shaping with the bundled fonts", () => {
  // Every case must shape without a single missing glyph (gid 0 = .notdef = the "tofu" box).
  const cases: [string, string][] = [
    ["vowel signs (kar)", "কা কি কী কু কূ কৃ কে কৈ কো কৌ"],
    ["conjuncts (juktakkhor)", "ক্ষ জ্ঞ ত্র শ্র ন্ত্র স্ত্র ঙ্ক ক্ক দ্ধ ন্দ্ব"],
    ["reph", "র্ক কর্ম ধর্ম সর্বমোট অর্থ"],
    ["ra-phala and ya-phala", "প্র ক্র ব্য ত্য"],
    ["hasanta, khanda ta, chandrabindu, visarga, anusvara", "ক্ ৎ চাঁদ দুঃখ বাংলা"],
    ["Bengali digits", "০১২৩৪৫৬৭৮৯"],
    ["Bengali punctuation and currency", "দাড়ি। দুই দাড়ি॥ ৳১,২৫০"],
    ["mixed Bengali and English", "Invoice ইনভয়েস #123 — মোট: ৳1,250.50 (VAT 5%)"],
    ["ZWJ / ZWNJ sequences", "র‍্যাব ক্‌ষ"]
  ];

  it.each(cases)("%s", async (_name, text) => {
    const { missing, glyphs } = await shapeAll(text);
    expect(missing).toEqual([]);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.filter((glyph) => glyph.glyphId === 0)).toEqual([]);
  });

  it("forms conjuncts as single glyphs (no visible hasanta)", async () => {
    const { glyphs } = await shapeAll("ক্ষ");
    expect(glyphs).toHaveLength(1);
  });

  it("reorders pre-base vowel signs before the consonant", async () => {
    const { glyphs } = await shapeAll("কি");
    // The i-kar glyph comes first visually; copy/paste text is handed out in logical order.
    expect(glyphs).toHaveLength(2);
    expect(glyphs.map((glyph) => glyph.unicode)).toEqual(["ক", "ি"]);
    expect(glyphs[0].x).toBeLessThan(glyphs[1].x);
  });

  it("keeps every character of the text in the copy/paste mapping", async () => {
    const text = "সর্বমোট ৳১,২৫০ Grand Total";
    const { glyphs } = await shapeAll(text);
    expect(glyphs.map((glyph) => glyph.unicode).join("").replace(/⁠/g, "")).toBe(text);
    expect(glyphs.every((glyph) => glyph.unicode.length > 0)).toBe(true);
  });

  it("uses one font for Bengali and Latin, so mixed text shares metrics", async () => {
    const { runs } = await shapeAll("Rahim রহিম 123 ১২৩");
    expect(runs).toHaveLength(1);
    expect(runs[0].kind === "glyphs" && runs[0].fontKey).toContain("AnekBangla");
  });

  it("applies real weights from the Anek Bangla variable font, capped at its 800 maximum", async () => {
    const [regular] = await shaper.shape("সর্বমোট Total", 400);
    const [bold] = await shaper.shape("সর্বমোট Total", 700);
    const [black] = await shaper.shape("সর্বমোট Total", 900);
    expect(regular.kind === "glyphs" && regular.fontKey).toContain("AnekBangla-Variable.ttf#wght=400");
    expect(bold.kind === "glyphs" && bold.fontKey).toContain("#wght=700");
    expect(black.kind === "glyphs" && black.fontKey).toContain("#wght=800");
    expect(regular.kind === "glyphs" && bold.kind === "glyphs" && bold.advance > regular.advance).toBe(true);
  });

  it("covers € £ ₹ itself and falls back to Noto Sans Bengali only for rare signs", async () => {
    const { runs: currencies } = await shapeAll("মোট € £ ₹ ৳");
    expect(currencies.every((run) => run.kind === "glyphs" && run.fontKey.includes("AnekBangla"))).toBe(true);

    const { runs } = await shapeAll("মোট ৴");
    const fonts = runs.map((run) => (run.kind === "glyphs" ? run.fontKey : "missing"));
    expect(fonts[0]).toContain("AnekBangla");
    expect(fonts.some((key) => key.includes("NotoSansBengali"))).toBe(true);
  });

  it("reports characters no bundled font has, instead of drawing tofu", async () => {
    const { missing } = await shapeAll("OK 😀");
    expect(missing.map((run) => run.text.trim())).toEqual(["😀"]);
  });
});

describe("font registry", () => {
  it("bundles the requested families and lists system fallbacks", () => {
    expect(BUNDLED_FONT_FAMILIES.map((family) => family.displayName)).toEqual(["Anek Bangla", "Noto Sans Bengali", "Hind Siliguri", "Noto Serif Bengali"]);
    for (const name of ["Kalpurush", "SolaimanLipi", "Siyam Rupali", "AdorshoLipi", "Nikosh", "Vrinda"]) {
      expect(INVOICE_FONT_STACK).toContain(`"${name}"`);
    }
    expect(INVOICE_FONT_STACK.indexOf("SSI Anek Bangla")).toBe(1);
  });

  it("every bundled font file exists and the chain covers the full Bengali block", async () => {
    const assigned = Array.from({ length: 0x80 }, (_, index) => 0x980 + index).filter((codepoint) => /\p{Assigned}/u.test(String.fromCodePoint(codepoint)));
    const coverage = async (url: string) => new Set(new hb.Face(new hb.Blob(await loadFont(url))).collectUnicodes());
    const primary = await coverage(BUNDLED_FONT_FAMILIES[0].files[0].url);
    const fallback = await coverage(BUNDLED_FONT_FAMILIES[1].files[0].url);
    // Anek Bangla lacks only rare signs (old currency numerators, ganda, abbreviation, sandhi), which Noto supplies.
    expect(assigned.filter((codepoint) => !primary.has(codepoint))).toEqual([0x9f4, 0x9f5, 0x9f6, 0x9fb, 0x9fd, 0x9fe]);
    expect(assigned.filter((codepoint) => !primary.has(codepoint) && !fallback.has(codepoint))).toEqual([]);

    for (const family of BUNDLED_FONT_FAMILIES) {
      for (const file of family.files) await expect(loadFont(file.url)).resolves.toBeInstanceOf(ArrayBuffer);
    }
  });

  it("generates @font-face rules for every file", () => {
    const css = buildInvoiceFontCss();
    expect(css.match(/@font-face/g)).toHaveLength(6);
    expect(css).toContain("font-weight:100 800");
    expect(css).toContain("font-weight:100 900");
    expect(css).toContain("--invoice-font:");
  });

  it("matches weights like the browser (CSS Fonts 4)", () => {
    const hind = BUNDLED_FONT_FAMILIES[2].files;
    expect(pickFontFile(hind, 400).weight).toBe(400);
    expect(pickFontFile(hind, 500).weight).toBe(400);
    expect(pickFontFile(hind, 600).weight).toBe(600);
    expect(pickFontFile(hind, 800).weight).toBe(700);
    expect(pickFontFile(hind, 300).weight).toBe(400);
    expect(pickFontFile(BUNDLED_FONT_FAMILIES[1].files, 650)).toMatchObject({ weight: 650 });
    const anek = BUNDLED_FONT_FAMILIES[0].files;
    expect(pickFontFile(anek, 600)).toMatchObject({ weight: 600 });
    expect(pickFontFile(anek, 900)).toMatchObject({ weight: 800 });
  });
});

describe("A4 pagination (15 rows per page)", () => {
  const ranges = (rowCount: number) => paginateInvoiceRows(rowCount).map(({ start, end, isLast }) => ({ rows: [start + 1, end], isLast }));

  it("is 15 rows per page", () => {
    expect(ROWS_PER_PAGE).toBe(15);
  });

  it("keeps 5 rows on one page with the totals", () => {
    expect(ranges(5)).toEqual([{ rows: [1, 5], isLast: true }]);
  });

  it("keeps exactly 15 rows on one page with the totals", () => {
    expect(ranges(15)).toEqual([{ rows: [1, 15], isLast: true }]);
  });

  it("moves row 16 to a second page that carries the totals", () => {
    expect(ranges(16)).toEqual([
      { rows: [1, 15], isLast: false },
      { rows: [16, 16], isLast: true }
    ]);
  });

  it("numbers 40 rows continuously over three pages", () => {
    expect(ranges(40)).toEqual([
      { rows: [1, 15], isLast: false },
      { rows: [16, 30], isLast: false },
      { rows: [31, 40], isLast: true }
    ]);
  });

  it("starts a new page only after a full one", () => {
    expect(ranges(30)).toEqual([
      { rows: [1, 15], isLast: false },
      { rows: [16, 30], isLast: true }
    ]);
  });

  it("always has one page, even with no rows", () => {
    expect(paginateInvoiceRows(0)).toEqual([{ index: 0, start: 0, end: 0, isFirst: true, isLast: true }]);
  });

  it("covers every row exactly once, in order", () => {
    for (let count = 0; count <= 50; count += 1) {
      const pages = paginateInvoiceRows(count);
      expect(pages.flatMap(({ start, end }) => Array.from({ length: end - start }, (_, offset) => start + offset))).toEqual(
        Array.from({ length: count }, (_, index) => index)
      );
      expect(pages.every(({ start, end }) => end - start <= ROWS_PER_PAGE)).toBe(true);
      expect(pages.filter(({ isLast }) => isLast)).toHaveLength(1);
    }
  });

  it("totals include rows from every page", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ ...createBlankItem(), name: `Item ${index + 1}`, total: 100, totalIsManual: true }));
    const document = toInvoiceDocument({
      customer: { name: "", invoiceNumber: "1", date: "", phone: "", address: "" },
      items,
      discount: 300,
      taxRate: 10,
      advance: 1000,
      settings: { currency: "BDT" }
    } as unknown as InvoiceData);

    expect(document.items).toHaveLength(30);
    expect(document.totals).toMatchObject({ subtotal: 3000, discount: 300, tax: 270, grandTotal: 2970, advance: 1000, remaining: 1970 });
  });
});

describe("SVG path parsing", () => {
  it("handles relative commands, H/V and close", () => {
    expect(parseSvgPath("m10 10 h5 v5 h-5 z")).toEqual([
      { op: "M", x: 10, y: 10 },
      { op: "L", x: 15, y: 10 },
      { op: "L", x: 15, y: 15 },
      { op: "L", x: 10, y: 15 },
      { op: "Z" }
    ]);
  });

  it("parses compact numbers and implicit linetos", () => {
    expect(parseSvgPath("M.5.5 1-1")).toEqual([
      { op: "M", x: 0.5, y: 0.5 },
      { op: "L", x: 1, y: -1 }
    ]);
  });

  it("converts arcs (with compact flags) into curves ending on the target point", () => {
    const path = parseSvgPath("M0 0a5 5 0 01 10 0");
    const last = path[path.length - 1];
    expect(last).toMatchObject({ op: "C", x: 10, y: 0 });
    // A semicircle of radius 5 bulges 5 units out.
    const ys = path.flatMap((segment) => (segment.op === "C" ? [segment.y1, segment.y2] : []));
    expect(Math.max(...ys.map(Math.abs))).toBeGreaterThan(5);
  });

  it("converts quarter arcs accurately", () => {
    const [segment] = arcToCubics(1, 0, 1, 1, 0, 0, 1, 0, 1);
    expect(segment).toMatchObject({ op: "C", x: 0, y: 1 });
  });
});

describe("PDF writer", () => {
  async function buildSamplePdf() {
    const pdf = new PdfDocument({ title: "Invoice INV-1 — রহিম", lang: "en" });
    const page = pdf.addPage(PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
    page.fillColor({ r: 224, g: 27, b: 36 });
    page.rect(10, 10, 100, 20);
    page.push("f");
    page.alpha(0.35);

    const runs = await shaper.shape("সর্বমোট ৳১,২৫০ Total", 700);
    const placements = runs.flatMap((run) =>
      run.kind === "glyphs"
        ? run.glyphs.map((glyph) => ({
            fontKey: run.fontKey,
            upem: run.upem,
            glyphId: glyph.glyphId,
            unicode: glyph.unicode,
            outline: () => run.outline(glyph.glyphId),
            x: 20 + glyph.x / 50,
            y: 40
          }))
        : []
    );
    page.glyphs(placements, 20, "সর্বমোট ৳১,২৫০ Total", 40);
    pdf.addImage(2, 1, new Uint8Array([255, 0, 0, 0, 0, 255]), new Uint8Array([255, 128]));
    pdf.addPage(PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
    return pdf.save();
  }

  it("writes a structurally valid PDF with a correct cross-reference table", async () => {
    const bytes = await buildSamplePdf();
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = Array.from(text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm), (match) => Number(match[1]));
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("uses A4 pages, Type 3 vector glyphs with ToUnicode, and no-scaling print preferences", async () => {
    const text = new TextDecoder("latin1").decode(await buildSamplePdf());
    expect(text).toContain("/MediaBox[0 0 595.276 841.89]");
    expect(text.match(/\/Type\/Page\//g)).toHaveLength(2);
    expect(text).toContain("/Subtype/Type3");
    expect(text).toContain("/ToUnicode");
    expect(text).toContain("/PrintScaling/None");
    expect(text).toContain(`/Title<${utf16Hex("Invoice INV-1 — রহিম")}>`);
  });

  it("compresses streams and wraps text in ActualText for copy/search", async () => {
    const bytes = await buildSamplePdf();
    const text = new TextDecoder("latin1").decode(bytes);
    const streams = Array.from(text.matchAll(/<<([^]*?)\/Filter\/FlateDecode\/Length (\d+)>>\nstream\n/g));
    expect(streams.length).toBeGreaterThan(3);

    const contents = streams
      .map((match) => {
        const start = (match.index ?? 0) + match[0].length;
        return new TextDecoder().decode(unzlibSync(bytes.subarray(start, start + Number(match[2]))));
      })
      .join("\n");
    expect(contents).toContain(`/ActualText <${utf16Hex("সর্বমোট ৳১,২৫০ Total")}>`);
    expect(contents).toMatch(/ d1\n/);
    expect(contents).toContain("beginbfchar");
  });

  it("formats numbers compactly", () => {
    expect(num(1)).toBe("1");
    expect(num(-0.0001)).toBe("0");
    expect(num(12.3456)).toBe("12.346");
    expect(num(1e-9)).toBe("0");
  });
});

describe("invoice document model", () => {
  const invoice = {
    customer: { name: "রহিম আহমেদ", invoiceNumber: "INV-7", date: "2026-11-18", phone: "", address: "" },
    items: [
      { ...createBlankItem(), name: "ভিনাইল ব্যানার", width: 10, height: 5, quantity: 2, unitPrice: 25, total: 2500 },
      createBlankItem()
    ],
    discount: 100,
    taxRate: 5,
    advance: 0,
    settings: { currency: "BDT" }
  } as unknown as InvoiceData;

  it("formats exactly what the editor shows", () => {
    const document = toInvoiceDocument(invoice);
    expect(document.date).toBe("18/11/2026");
    expect(document.items[0]).toEqual({ name: "ভিনাইল ব্যানার", width: "10", height: "5", hasSize: true, quantity: "2", sqf: "100", rate: "25", total: "2,500" });
    // The first page always shows its 15 rows, blank or not.
    expect(document.items).toHaveLength(ROWS_PER_PAGE);
    expect(document.items.slice(1).every((item) => !item.name && !item.total && !item.hasSize)).toBe(true);
    expect(document.money.grandTotal).toBe("৳2,520");
    expect(document.discount).toBe("100");
    expect(document.advance).toBe("");
  });

  it("continues on a second page from row 16, without printing unused rows past it", () => {
    const filled = { ...createBlankItem(), name: "Banner", quantity: 1, unitPrice: 10 };
    const long = { ...invoice, items: [...Array.from({ length: 17 }, () => ({ ...filled })), createBlankItem(), createBlankItem()] } as InvoiceData;
    const document = toInvoiceDocument(long);
    expect(document.items).toHaveLength(17);
    expect(paginateInvoiceRows(document.items.length).map(({ start, end }) => [start + 1, end])).toEqual([[1, 15], [16, 17]]);
  });

  it("produces the same document from a shared invoice", () => {
    const { settings, ...rest } = invoice;
    const shared = { ...rest, currency: settings.currency, items: invoice.items.map((item) => ({ name: item.name, width: item.width, height: item.height, quantity: item.quantity, unitPrice: item.unitPrice, total: item.total, totalIsManual: item.totalIsManual })) };
    expect(sharedToInvoiceDocument(shared)).toEqual(toInvoiceDocument(invoice));
  });

  it("names the file after the To field and titles the PDF", () => {
    const document = toInvoiceDocument(invoice);
    expect(buildPdfFileName(document.customerName)).toBe("রহিম আহমেদ.pdf");
    expect(buildPdfTitle(document)).toBe("Invoice INV-7 — রহিম আহমেদ");
    expect(buildPdfTitle({ customerName: "  ", invoiceNumber: "" })).toBe("Invoice");
  });

  it("prints rows up to the last one with content, keeping blank rows in between", () => {
    const blank = createBlankItem();
    const filled = { ...createBlankItem(), quantity: 1 };
    expect(printedItemCount([])).toBe(0);
    expect(printedItemCount(Array(15).fill(blank))).toBe(1);
    expect(printedItemCount([filled, blank, filled, blank, blank])).toBe(3);
    expect(printedItemCount([blank, blank, { ...blank, name: "Banner" }])).toBe(3);
    expect(printedItemCount([{ ...blank, name: "   " }])).toBe(1);
  });

  it("formats numbers like the inputs", () => {
    expect(plainNumber(0)).toBe("");
    expect(plainNumber(12.5)).toBe("12.5");
    expect(formatLineTotal(1250000)).toBe("1,250,000");
    expect(formatLineTotal(0)).toBe("");
  });
});
