import { type InvoiceDocumentData, toInvoiceDocument } from "@/lib/invoice-document";
import type { CapturedPage } from "@/lib/pdf/dom-to-pdf";
import type { InvoiceData } from "@/types/invoice";

export const PDF_MIME_TYPE = "application/pdf";
const FALLBACK_BASE_NAME = "Invoice";
const MAX_BASE_NAME_LENGTH = 100;
// Characters that are illegal in Windows/macOS/Android/iOS file names, plus ASCII control characters.
// Note the escaped backslash: Windows rejects "\" in file names just like "/".
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type SharePdfErrorCode = "pdf-generation-failed" | "file-not-found" | "unsupported" | "share-failed";

export class SharePdfError extends Error {
  constructor(public readonly code: SharePdfErrorCode, message: string) {
    super(message);
    this.name = "SharePdfError";
  }
}

/** "Rahim Ahmed" -> "Rahim Ahmed": a file-system-safe base name. Empty or fully-invalid names fall back to "Invoice". */
export function buildFileBaseName(recipientName: string | null | undefined): string {
  let base = (recipientName ?? "")
    .normalize("NFC")
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BASE_NAME_LENGTH)
    // Windows strips trailing dots/spaces, so "Name." would silently become "Name".
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/, "")
    .trim();

  if (!base || WINDOWS_RESERVED_NAMES.test(base)) {
    base = FALLBACK_BASE_NAME;
  }

  return base;
}

/** "Rahim Ahmed" -> "Rahim Ahmed.pdf". Empty or fully-invalid names fall back to "Invoice.pdf". */
export function buildPdfFileName(recipientName: string | null | undefined): string {
  return `${buildFileBaseName(recipientName)}.pdf`;
}

export function isShareCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Title stored inside the PDF (shown by viewers instead of the file name). */
export function buildPdfTitle(document: Pick<InvoiceDocumentData, "customerName" | "invoiceNumber">) {
  const name = document.customerName.replace(/\s+/g, " ").trim();
  const number = document.invoiceNumber.trim();
  return ["Invoice", number, name && `— ${name}`].filter(Boolean).join(" ");
}

/**
 * Builds the A4 invoice PDF, named after the "To" field ("Rahim Ahmed.pdf"). Pass already-captured pages to reuse
 * a capture made for another format; otherwise the invoice is laid out and captured here.
 */
export async function generateDocumentPdfFile(document: InvoiceDocumentData, pages?: CapturedPage[]): Promise<File> {
  const fileName = buildPdfFileName(document.customerName);
  let bytes: Uint8Array;

  try {
    // Loaded on demand: the PDF engine (HarfBuzz + fonts) is only needed when a PDF is requested.
    const { captureInvoicePages, invoicePagesToPdf } = await import("@/lib/pdf/invoice-pdf");
    bytes = invoicePagesToPdf(pages ?? (await captureInvoicePages(document)), { title: buildPdfTitle(document) });
  } catch (error) {
    console.error("Invoice PDF generation failed", error);
    throw new SharePdfError("pdf-generation-failed", "Couldn't generate the invoice PDF. Please try again.");
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new SharePdfError("file-not-found", "The invoice PDF is empty or missing. Please try again.");
  }

  return new File([bytes as BlobPart], fileName, { type: PDF_MIME_TYPE });
}

export function generateInvoicePdfFile(invoice: InvoiceData): Promise<File> {
  return generateDocumentPdfFile(toInvoiceDocument(invoice));
}
