import { sheetClasses } from "@/components/invoice/sheet/sheet-styles";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import { buildJpegFileNames, type ExportFormat, JPEG_MIME_TYPE, JPEG_QUALITY } from "@/lib/invoice-export";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import type { CapturedPage } from "@/lib/pdf/dom-to-pdf";
import { generateDocumentPdfFile } from "@/lib/share-pdf";

/**
 * One cache for every export of the current invoice.
 *
 * Laying the invoice out and walking its DOM (the capture) is the expensive, DOM-bound step. It runs at most once
 * per version of the invoice, and the PDF, the JPEG pages and the preview thumbnails are all replayed from that
 * same capture. Share and Download use this cache, so switching formats or re-sharing never renders twice.
 * Only the latest invoice is kept; failures are never cached, so a retry starts fresh.
 */

// The output depends on the layout as well as the content. Keying on both means a design change can never hand back
// a file rendered with the previous layout (the renderer is loaded with a dynamic import, which hot reload does not
// reach, so without this a dev session kept serving the old file for an unchanged invoice).
const layoutKey = () => JSON.stringify([sheetClasses, getInvoiceLabels()]);

/** Preview thumbnails: sharp on a 2x screen at ~360 CSS px wide, small enough to render in a blink. */
const PREVIEW_DPI = 90;
const PREVIEW_QUALITY = 0.85;
const MAX_PREVIEW_PAGES = 24;

export interface ExportProgress {
  /** Pages finished so far (0-based count) and the total, while JPEG pages are being encoded. */
  done: number;
  total: number;
}

type ProgressListener = (progress: ExportProgress) => void;

interface Entry {
  key: string;
  document: InvoiceDocumentData;
  capture: Promise<CapturedPage[]> | null;
  pdf: Promise<File> | null;
  jpeg: Promise<File[]> | null;
  previews: Promise<Blob[]> | null;
  jpegListeners: Set<ProgressListener>;
}

let current: Entry | null = null;

function entryFor(document: InvoiceDocumentData): Entry {
  const key = `${layoutKey()}|${JSON.stringify(document)}`;
  if (current?.key !== key) {
    current = { key, document, capture: null, pdf: null, jpeg: null, previews: null, jpegListeners: new Set() };
  }
  return current;
}

/** Stores a promise on the entry, and forgets it again if it fails. */
function remember<K extends "capture" | "pdf" | "jpeg" | "previews">(entry: Entry, field: K, promise: NonNullable<Entry[K]>) {
  entry[field] = promise;
  (promise as Promise<unknown>).catch(() => {
    if (entry[field] === promise) entry[field] = null;
  });
  return promise;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function capture(entry: Entry): Promise<CapturedPage[]> {
  if (entry.capture) return entry.capture;
  return remember(
    entry,
    "capture",
    // Loaded on demand: the engine (HarfBuzz + fonts) is only needed once something is exported.
    import("@/lib/pdf/invoice-pdf").then(({ captureInvoicePages }) => captureInvoicePages(entry.document))
  );
}

/** The captured pages of this invoice (laid out and walked once). */
export function getInvoiceCapture(document: InvoiceDocumentData): Promise<CapturedPage[]> {
  return capture(entryFor(document));
}

/** The A4 PDF, named after the "To" field ("Rahim Ahmed.pdf"). */
export function getInvoicePdfFile(document: InvoiceDocumentData): Promise<File> {
  const entry = entryFor(document);
  if (entry.pdf) return entry.pdf;
  return remember(entry, "pdf", capture(entry).then((pages) => generateDocumentPdfFile(entry.document, pages)));
}

/**
 * One 300 dpi JPEG per page, in page order ("Rahim Ahmed.jpg", or "Rahim Ahmed - Page 1 of 2.jpg", ...).
 * Pages are encoded one at a time, yielding between pages, so the UI stays responsive and only one page's
 * pixels are in memory at once.
 */
export function getInvoiceJpegFiles(document: InvoiceDocumentData, onProgress?: ProgressListener): Promise<File[]> {
  const entry = entryFor(document);
  if (onProgress) entry.jpegListeners.add(onProgress);
  const detach = () => {
    if (onProgress) entry.jpegListeners.delete(onProgress);
  };

  if (!entry.jpeg) {
    const report = (progress: ExportProgress) => entry.jpegListeners.forEach((listener) => listener(progress));
    remember(
      entry,
      "jpeg",
      Promise.all([capture(entry), import("@/lib/pdf/page-raster")]).then(async ([pages, { rasterizePage, JPEG_DPI }]) => {
        const names = buildJpegFileNames(entry.document.customerName, pages.length);
        const files: File[] = [];

        for (const [index, page] of pages.entries()) {
          report({ done: index, total: pages.length });
          await nextTask();
          const { blob } = await rasterizePage(page, { dpi: JPEG_DPI, type: JPEG_MIME_TYPE, quality: JPEG_QUALITY });
          files.push(new File([blob], names[index], { type: JPEG_MIME_TYPE }));
        }

        report({ done: pages.length, total: pages.length });
        return files;
      })
    );
  }

  const promise = entry.jpeg!;
  promise.then(detach, detach);
  return promise;
}

/** Small JPEG thumbnails of each page (first 24), for the preview in the Share dialog. */
export function getInvoicePreviews(document: InvoiceDocumentData): Promise<Blob[]> {
  const entry = entryFor(document);
  if (entry.previews) return entry.previews;

  return remember(
    entry,
    "previews",
    Promise.all([capture(entry), import("@/lib/pdf/page-raster")]).then(async ([pages, { rasterizePage }]) => {
      const previews: Blob[] = [];
      for (const page of pages.slice(0, MAX_PREVIEW_PAGES)) {
        await nextTask();
        previews.push((await rasterizePage(page, { dpi: PREVIEW_DPI, type: JPEG_MIME_TYPE, quality: PREVIEW_QUALITY })).blob);
      }
      return previews;
    })
  );
}

/** The files to share for a format: one PDF, or one JPEG per page. */
export function getInvoiceExportFiles(document: InvoiceDocumentData, format: ExportFormat, onProgress?: ProgressListener): Promise<File[]> {
  return format === "pdf" ? getInvoicePdfFile(document).then((file) => [file]) : getInvoiceJpegFiles(document, onProgress);
}
