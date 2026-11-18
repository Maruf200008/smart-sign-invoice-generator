"use client";

import { flushSync } from "react-dom";
import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { BUNDLED_FONT_FAMILIES, FONT_WARMUP_TEXT } from "@/lib/fonts/font-registry";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import { PAGE_WIDTH_PX, sheetPageHeightPx } from "@/lib/invoice-sheet/sheet-metrics";
import { type CapturedPage, capturedPagesToPdf, captureDomPages } from "@/lib/pdf/dom-to-pdf";
import { TextShaper } from "@/lib/pdf/text-shaper";

let shaperPromise: Promise<TextShaper> | null = null;

async function loadFontBytes(url: string) {
  // Same URL as the @font-face rule, so the browser serves it from cache when the page already loaded it.
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Font request failed (${response.status}): ${url}`);
  return response.arrayBuffer();
}

function getShaper() {
  shaperPromise ??= import("harfbuzzjs")
    .then((hb) => new TextShaper(hb, loadFontBytes))
    .catch((error) => {
      shaperPromise = null;
      throw error;
    });
  return shaperPromise;
}

/** Loads the shaping engine and the primary font in the background so the first download starts instantly. */
export function preloadInvoicePdfEngine() {
  return getShaper()
    .then((shaper) => shaper.warmUp())
    .catch(() => undefined);
}

/** Makes sure every weight the invoice uses is loaded before anything is measured. */
async function loadScreenFonts() {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const family = `"${BUNDLED_FONT_FAMILIES[0].cssFamily}"`;
  await Promise.allSettled([400, 600, 700, 800, 900].map((weight) => document.fonts.load(`${weight} 16px ${family}`, FONT_WARMUP_TEXT)));
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Lays the invoice out off-screen at its exact print size — A4 pages, 12 rows per page, footer on every page, totals
 * on the last page — and records every page once. The capture feeds both the PDF and the JPEG export. Browser-only.
 */
export async function captureInvoicePages(data: InvoiceDocumentData): Promise<CapturedPage[]> {
  const [{ createRoot }, shaper] = await Promise.all([import("react-dom/client"), getShaper(), loadScreenFonts()]);

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-pdf-host", "");
  // Off-screen but fully laid out at its exact print size.
  host.style.cssText = "position:absolute;left:-20000px;top:0;width:210mm;pointer-events:none";
  document.body.appendChild(host);

  const root = createRoot(host);
  const render = () =>
    flushSync(() => {
      root.render(<InvoiceDocument key="document" data={data} />);
    });

  try {
    // Layout effects measure and size the page synchronously inside flushSync.
    render();
    // A character outside the primary font can make the browser fetch a fallback face; let that settle, then
    // render once more so measurements use the final fonts.
    await document.fonts?.ready;
    await nextTask();
    render();

    const sheets = Array.from(host.querySelectorAll<HTMLElement>("[data-invoice-sheet]"));
    if (sheets.length === 0) throw new Error("Invoice layout is missing.");

    // One page per A4 sheet (12 rows each). A page is exactly as tall as its laid-out sheet: A4, or taller
    // only when its content can't fit A4, so nothing is ever clipped.
    const pages = sheets.map((element) => ({ element, heightPx: sheetPageHeightPx(element.getBoundingClientRect().height) }));

    return await captureDomPages(pages, { pageWidthPx: PAGE_WIDTH_PX, shaper });
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Writes captured invoice pages as a vector PDF. */
export function invoicePagesToPdf(pages: CapturedPage[], meta: { title: string }): Uint8Array {
  return capturedPagesToPdf(pages, { title: meta.title, subject: "Invoice", lang: "en" });
}

/** Renders the invoice to a PDF of A4 pages. Browser-only. */
export async function createInvoicePdfBytes(data: InvoiceDocumentData, meta: { title: string }): Promise<Uint8Array> {
  return invoicePagesToPdf(await captureInvoicePages(data), meta);
}
