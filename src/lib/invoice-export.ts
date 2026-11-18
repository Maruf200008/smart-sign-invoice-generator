import { buildFileBaseName, isShareCancelled, SharePdfError } from "@/lib/share-pdf";

/** The formats the Share dialog offers. */
export type ExportFormat = "pdf" | "jpeg";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "jpeg"];
export const JPEG_MIME_TYPE = "image/jpeg";
export const ZIP_MIME_TYPE = "application/zip";
/** High enough that text edges show no visible artefacts; JPEG beyond ~0.95 mostly grows the file. */
export const JPEG_QUALITY = 0.95;

export function isExportFormat(value: unknown): value is ExportFormat {
  return value === "pdf" || value === "jpeg";
}

export type InvoiceExportErrorCode = "fonts-failed" | "render-failed" | "out-of-memory" | "empty" | "unsupported" | "share-failed";

export class InvoiceExportError extends Error {
  constructor(
    public readonly code: InvoiceExportErrorCode,
    message: string
  ) {
    super(message);
    this.name = "InvoiceExportError";
  }
}

/**
 * "Rahim Ahmed", 1 page  -> ["Rahim Ahmed.jpg"]
 * "Rahim Ahmed", 3 pages -> ["Rahim Ahmed - Page 1 of 3.jpg", ...]
 * Page numbers are zero-padded from 10 pages on, so every file browser lists them in page order.
 */
export function buildJpegFileNames(recipientName: string | null | undefined, pageCount: number): string[] {
  const base = buildFileBaseName(recipientName);
  const count = Math.max(1, Math.floor(pageCount));
  if (count === 1) return [`${base}.jpg`];

  const width = String(count).length;
  return Array.from({ length: count }, (_, index) => `${base} - Page ${String(index + 1).padStart(width, "0")} of ${count}.jpg`);
}

export function buildZipFileName(recipientName: string | null | undefined) {
  return `${buildFileBaseName(recipientName)} (JPEG).zip`;
}

/** Bundles files (in order) into a ZIP. JPEGs are already compressed, so they're stored, which is instant. */
export async function zipFiles(files: File[], name: string): Promise<File> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const file of files) {
    entries[file.name] = [new Uint8Array(await file.arrayBuffer()), { level: 0 }];
  }
  return new File([zipSync(entries) as BlobPart], name, { type: ZIP_MIME_TYPE });
}

/** Whether the native share sheet can take these files (Web Share Level 2). */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return files.length > 0 && navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Opens the native share sheet with the files as the ONLY payload (no title/text/url), so targets such as
 * WhatsApp, Messenger and Mail show just the attachments, in page order.
 */
export async function shareFiles(files: File[]): Promise<"shared" | "cancelled"> {
  if (files.length === 0 || files.some((file) => file.size === 0)) {
    throw new InvoiceExportError("empty", "The exported file is empty. Please try again.");
  }
  if (!canShareFiles(files)) {
    throw new InvoiceExportError("unsupported", "This device or browser can't share these files directly.");
  }

  try {
    await navigator.share({ files });
    return "shared";
  } catch (error) {
    if (isShareCancelled(error)) return "cancelled";

    // The tap's user activation expired while the file was being built. The file is cached by now, so the next tap
    // opens the sheet instantly.
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new InvoiceExportError("share-failed", "Your file is ready. Tap Share once more to send it.");
    }
    throw new InvoiceExportError("share-failed", "The share sheet couldn't be opened. Please try again.");
  }
}

/** Saves a file under its name without opening a print dialog or a new tab. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One download per export: the PDF, the single JPEG, or a ZIP of every page image. */
export async function downloadableFile(files: File[], recipientName: string): Promise<File> {
  if (files.length === 1) return files[0];
  return zipFiles(files, buildZipFileName(recipientName));
}

function isMemoryError(error: unknown) {
  if (error instanceof RangeError) return true;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /out of memory|memory|allocation|too large/i.test(text);
}

/** A short, actionable message for any failure in the export pipeline. */
export function describeExportError(error: unknown, format: ExportFormat): string {
  const kind = format === "pdf" ? "PDF" : "image";

  if (error instanceof InvoiceExportError || error instanceof SharePdfError) return error.message;
  if (error instanceof Error && error.name === "RasterError") {
    return (error as Error & { code?: string }).code === "out-of-memory"
      ? "This device ran out of memory while creating the image. Close other tabs or apps and try again, or share as PDF."
      : "The image couldn't be encoded on this device. Please try again, or share as PDF.";
  }
  if (isMemoryError(error)) {
    return `This invoice is too large for this device to export as ${format === "pdf" ? "a PDF" : "an image"}. Close other tabs or apps and try again.`;
  }
  if (error instanceof Error && /font/i.test(error.message)) {
    return "The invoice fonts couldn't be loaded. Check your connection and try again.";
  }
  return `Couldn't create the invoice ${kind}. Please try again.`;
}
