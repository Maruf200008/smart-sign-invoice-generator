"use client";

import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fitsA4, PAGE_HEIGHT_MM, PAGE_HEIGHT_PX, PAGE_WIDTH_MM, sheetPageHeightPx } from "@/lib/invoice-sheet/sheet-metrics";

/**
 * Spacing tiers of the original A4 design. Fuller pages tighten the vertical spacing so they still fit on a
 * standard A4 page; the values live in globals.css (`.invoice-sheet[data-density]`). Font sizes never change.
 */
export type SheetDensity = "normal" | "compact" | "dense";
const DENSITIES: readonly SheetDensity[] = ["normal", "compact", "dense"];

interface SheetLayout {
  /** One spacing tier for every page, so rows and headers look identical from page to page. */
  density: SheetDensity;
  /** Height of each page on screen and in the PDF (CSS px). A4, or taller only if a page's content can't fit. */
  heights: number[];
  /** Same, without editor-only parts that are hidden when printing. */
  printHeights: number[];
}

const INITIAL_LAYOUT: SheetLayout = { density: "normal", heights: [], printHeights: [] };

/** CSS length for a page height: exact `297mm` for A4 (so A4 prints as A4), whole px for an extended page. */
function pageHeightCss(heightPx: number) {
  return heightPx === PAGE_HEIGHT_PX ? `${PAGE_HEIGHT_MM}mm` : `${heightPx}px`;
}

/**
 * Natural height of one page's content (CSS px), i.e. without the sheet's own minimum height stretching it.
 * Measured on the live DOM; the editor scales the sheet with a CSS transform, so rects are unscaled first.
 */
function measureContent(sheet: HTMLElement) {
  const scale = sheet.offsetWidth > 0 ? sheet.getBoundingClientRect().width / sheet.offsetWidth : 1;
  const previous = sheet.style.minHeight;
  sheet.style.minHeight = "0px";

  try {
    const natural = sheet.getBoundingClientRect().height / scale;
    const editorOnly = Array.from(sheet.querySelectorAll("[data-sheet-tail-part].no-print")).reduce(
      (sum, element) => sum + element.getBoundingClientRect().height / scale,
      0
    );
    return { natural, printed: natural - editorOnly };
  } finally {
    sheet.style.minHeight = previous;
  }
}

/**
 * Picks the loosest spacing tier that keeps every page on a standard A4 sheet. When even the densest tier is
 * taller than A4 on some page (e.g. very long descriptions), the original (normal) spacing is kept and only that
 * page grows to fit, so nothing is ever clipped. Each tier is applied to the live DOM and measured synchronously
 * (inside a layout effect, before paint), so the result is deterministic and nothing flickers.
 */
function chooseLayout(sheets: HTMLElement[]): SheetLayout {
  const rendered = sheets.map((sheet) => sheet.dataset.density);
  const measureAll = (density: SheetDensity) =>
    sheets.map((sheet) => {
      sheet.dataset.density = density;
      return measureContent(sheet);
    });

  try {
    for (const density of DENSITIES) {
      const sizes = measureAll(density);
      if (sizes.every(({ natural }) => fitsA4(natural))) {
        return { density, heights: sizes.map(() => PAGE_HEIGHT_PX), printHeights: sizes.map(({ printed }) => sheetPageHeightPx(printed)) };
      }
    }

    const sizes = measureAll("normal");
    return {
      density: "normal",
      heights: sizes.map(({ natural }) => sheetPageHeightPx(natural)),
      printHeights: sizes.map(({ printed }) => sheetPageHeightPx(printed))
    };
  } finally {
    sheets.forEach((sheet, index) => {
      const density = rendered[index];
      if (density === undefined) delete sheet.dataset.density;
      else sheet.dataset.density = density;
    });
  }
}

const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

function sameLayout(a: SheetLayout, b: SheetLayout) {
  return a.density === b.density && sameNumbers(a.heights, b.heights) && sameNumbers(a.printHeights, b.printHeights);
}

const OBSERVED_PARTS = "[data-sheet-row], [data-sheet-head], [data-sheet-tail-part]";

function pageSheets(container: HTMLElement | null) {
  return Array.from(container?.querySelectorAll<HTMLElement>(":scope > [data-invoice-sheet]") ?? []);
}

export interface InvoicePage {
  key: string;
  content: ReactNode;
}

/**
 * The invoice as a stack of A4 pages (see `paginateInvoiceRows`): every page repeats the header and the table
 * head and the signature/contact footer, and only the last one carries the totals. The same component renders the editor,
 * the share page and the PDF source; each `[data-invoice-sheet]` is one printed / PDF page. `printable` marks the
 * pages that Ctrl+P prints.
 */
export function InvoicePages({
  pages,
  ariaLabel,
  printable = false,
  pageAriaLabel = (title, page, pageCount) => `${title}, page ${page} of ${pageCount}`
}: {
  pages: InvoicePage[];
  ariaLabel?: string;
  printable?: boolean;
  /** Screen-reader name of one page of several, in the invoice's language. */
  pageAriaLabel?: (title: string, page: number, pageCount: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [layout, setLayout] = useState<SheetLayout>(INITIAL_LAYOUT);
  const { density } = layout;

  const remeasure = useCallback(() => {
    const sheets = pageSheets(containerRef.current);
    if (sheets.length === 0) return;

    const next = chooseLayout(sheets);
    setLayout((current) => (sameLayout(current, next) ? current : next));
  }, []);

  // Re-measure after every render (rows added, pages added, text edited) and watch every part for size changes
  // caused by wrapping text or fonts finishing loading.
  useLayoutEffect(() => {
    remeasure();

    const observer = observerRef.current;
    containerRef.current?.querySelectorAll(OBSERVED_PARTS).forEach((element) => observer?.observe(element));
  });

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => remeasure());
    observerRef.current = observer;
    containerRef.current?.querySelectorAll(OBSERVED_PARTS).forEach((element) => observer.observe(element));
    document.fonts?.addEventListener?.("loadingdone", remeasure);

    return () => {
      observer.disconnect();
      observerRef.current = null;
      document.fonts?.removeEventListener?.("loadingdone", remeasure);
    };
  }, [remeasure]);

  const pageCount = pages.length;
  // Until it is first measured, a page is A4.
  const heightOf = (list: number[], index: number) => list[index] ?? PAGE_HEIGHT_PX;
  const tallestPrint = Math.max(PAGE_HEIGHT_PX, ...pages.map((_, index) => heightOf(layout.printHeights, index)));

  return (
    <div ref={containerRef} data-invoice-pages="" className="invoice-pages flex flex-col">
      {pages.map((page, index) => {
        const height = heightOf(layout.heights, index);
        const style = {
          minHeight: pageHeightCss(height),
          "--sheet-print-height": pageHeightCss(heightOf(layout.printHeights, index))
        } as CSSProperties;

        return (
          <div
            key={page.key}
            role="document"
            aria-label={pageCount > 1 ? pageAriaLabel(ariaLabel ?? "Invoice", index + 1, pageCount) : ariaLabel}
            data-invoice-sheet=""
            data-page-number={index + 1}
            data-last-page={index === pageCount - 1 ? "" : undefined}
            data-density={density}
            data-extended={height > PAGE_HEIGHT_PX ? "" : undefined}
            className="invoice-sheet relative flex w-[210mm] flex-col font-invoice text-[#222]"
            style={style}
          >
            {/* One sheet of paper behind the content, as tall as the page. */}
            <div aria-hidden="true" data-sheet-paper="" className="invoice-sheet-paper absolute inset-0 bg-white" />

            <div className="relative flex flex-1 flex-col">{page.content}</div>
          </div>
        );
      })}

      {/* Ctrl+P prints A4 pages (globals.css); only if a page had to grow past A4 is the printed page size enlarged. */}
      {printable && tallestPrint > PAGE_HEIGHT_PX && <style>{`@page{size:${PAGE_WIDTH_MM}mm ${pageHeightCss(tallestPrint)};margin:0}`}</style>}
    </div>
  );
}

/**
 * Fits the fixed-size A4 pages to the available width on screen (shrinks on phones, never grows past real size)
 * with a transform, so layout inside the pages never changes with the viewport.
 */
export function SheetViewport({ children, maxScale = 1 }: { children: ReactNode; maxScale?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const update = () => {
      const available = outer.clientWidth;
      const width = inner.offsetWidth;
      if (!available || !width) return;

      const scale = Math.min(maxScale, available / width);
      const next = { scale, width: width * scale, height: inner.offsetHeight * scale };
      setBox((current) =>
        current && Math.abs(current.scale - next.scale) < 0.001 && Math.abs(current.height - next.height) < 0.5 ? current : next
      );
    };

    update();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [maxScale]);

  return (
    <div ref={outerRef} className="sheet-viewport w-full">
      <div className="sheet-viewport-frame mx-auto" style={box ? { width: box.width, height: box.height } : undefined}>
        <div
          ref={innerRef}
          className="sheet-viewport-inner w-[210mm] origin-top-left"
          style={box ? { transform: `scale(${box.scale})` } : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
