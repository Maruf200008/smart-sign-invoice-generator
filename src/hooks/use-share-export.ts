"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import {
  canShareFiles,
  describeExportError,
  downloadableFile,
  downloadFile,
  type ExportFormat,
  InvoiceExportError,
  isExportFormat,
  shareFiles
} from "@/lib/invoice-export";
import { type ExportProgress, getInvoiceCapture, getInvoiceExportFiles, getInvoicePdfFile, getInvoicePreviews } from "@/lib/pdf/export-cache";
import { getCurrentInvoiceDocument, useInvoiceLanguageStore } from "@/store/invoice-language-store";
import { useInvoiceStore } from "@/store/invoice-store";
import { toast } from "@/store/toast-store";

const PREWARM_DELAY_MS = 1200;
const FORMAT_STORAGE_KEY = "smart-invoice:share-format";

export type ShareExportPhase = "closed" | "choose" | "generating" | "ready" | "error";

export interface ShareExportState {
  phase: ShareExportPhase;
  format: ExportFormat;
  progress: ExportProgress | null;
  files: File[] | null;
  /** Object URLs of the page thumbnails, once rendered. */
  previews: string[] | null;
  pageCount: number | null;
  error: string | null;
  /** A hint shown on the ready step (e.g. "tap Share to send it"). */
  notice: string | null;
}

const initialState = (format: ExportFormat): ShareExportState => ({
  phase: "closed",
  format,
  progress: null,
  files: null,
  previews: null,
  pageCount: null,
  error: null,
  notice: null
});

function readSavedFormat(): ExportFormat {
  try {
    const saved = window.localStorage.getItem(FORMAT_STORAGE_KEY);
    return isExportFormat(saved) ? saved : "pdf";
  } catch {
    return "pdf";
  }
}

function saveFormat(format: ExportFormat) {
  try {
    window.localStorage.setItem(FORMAT_STORAGE_KEY, format);
  } catch {
    // Private mode / blocked storage: the choice just isn't remembered.
  }
}

/** True while the click that started the export still counts as a user gesture (needed by navigator.share). */
function hasUserActivation() {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  // Browsers without the API: try anyway; a rejection just asks for one more tap.
  return activation ? activation.isActive : true;
}

/**
 * Drives the Share dialog: choose a format -> generate -> preview -> native share sheet (or download).
 *
 * The invoice is captured once (see export-cache) and both formats are replayed from that capture. On devices with
 * a native share sheet the PDF is pre-built in the background after edits settle, so the common case opens the
 * sheet straight from the Share tap.
 */
export function useShareExport() {
  const [state, setState] = useState<ShareExportState>(() => initialState("pdf"));
  const runRef = useRef(0);
  // Changes on every open/close, so late thumbnails from a closed dialog are discarded (and never leak URLs).
  const sessionRef = useRef(0);
  const documentRef = useRef<InvoiceDocumentData | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  const patch = useCallback((update: Partial<ShareExportState>) => setState((previous) => ({ ...previous, ...update })), []);

  const releasePreviews = useCallback(() => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
  }, []);

  useEffect(() => releasePreviews, [releasePreviews]);

  // Pre-build in the background only where the share sheet needs a fresh tap (mobile and other share-capable
  // browsers). Elsewhere sharing falls back to a download, which has no such time limit.
  useEffect(() => {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return;

    let timer: number | undefined;
    const prewarm = () => void getInvoicePdfFile(getCurrentInvoiceDocument()).catch(() => undefined);
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(prewarm, PREWARM_DELAY_MS);
    };
    const unsubscribeInvoice = useInvoiceStore.subscribe((current, previous) => {
      if (current.invoice !== previous.invoice) schedule();
    });
    // A language switch changes the document too, so the pre-built file is rebuilt in the new language.
    const unsubscribeLanguage = useInvoiceLanguageStore.subscribe((current, previous) => {
      if (current.language !== previous.language) schedule();
    });
    schedule();

    return () => {
      unsubscribeInvoice();
      unsubscribeLanguage();
      window.clearTimeout(timer);
    };
  }, []);

  const open = useCallback(() => {
    runRef.current += 1;
    sessionRef.current += 1;
    releasePreviews();
    const document = getCurrentInvoiceDocument();
    documentRef.current = document;
    setState({ ...initialState(readSavedFormat()), phase: "choose" });
    // Start laying out while the user picks a format; both formats need it.
    void getInvoiceCapture(document).catch(() => undefined);
  }, [releasePreviews]);

  const close = useCallback(() => {
    runRef.current += 1;
    sessionRef.current += 1;
    releasePreviews();
    setState((previous) => initialState(previous.format));
  }, [releasePreviews]);

  const setFormat = useCallback(
    (format: ExportFormat) => {
      saveFormat(format);
      patch({ format });
    },
    [patch]
  );

  const backToFormats = useCallback(() => {
    runRef.current += 1;
    patch({ phase: "choose", error: null, notice: null, progress: null, files: null });
  }, [patch]);

  const download = useCallback(async (files: File[], { fallback }: { fallback: boolean }) => {
    const document = documentRef.current;
    const file = await downloadableFile(files, document?.customerName ?? "");
    downloadFile(file);
    toast.success(fallback ? `Sharing isn't available here, so ${file.name} was downloaded instead.` : `Downloaded ${file.name}`);
  }, []);

  /** Opens the share sheet, or downloads when this browser can't share these files. */
  const deliver = useCallback(
    async (files: File[], run: number) => {
      if (!canShareFiles(files)) {
        await download(files, { fallback: true });
        if (runRef.current === run) close();
        return;
      }

      try {
        const result = await shareFiles(files);
        if (runRef.current !== run) return;
        if (result === "shared") {
          toast.success(files.length > 1 ? `Shared ${files.length} images` : `Shared ${files[0].name}`);
          close();
        }
      } catch (error) {
        if (runRef.current !== run) return;
        if (error instanceof InvoiceExportError && error.code === "share-failed" && /once more/.test(error.message)) {
          patch({ notice: "Your file is ready. Tap Share to send it." });
          return;
        }
        toast.error(describeExportError(error, state.format));
      }
    },
    [close, download, patch, state.format]
  );

  const generate = useCallback(async () => {
    const document = documentRef.current;
    if (!document) return;
    const run = ++runRef.current;
    const format = state.format;
    saveFormat(format);
    patch({ phase: "generating", error: null, notice: null, progress: null, files: null });

    // Thumbnails are rendered from the same capture, alongside the export, and never block it.
    if (previewUrlsRef.current.length === 0) {
      const session = sessionRef.current;
      void getInvoicePreviews(document)
        .then((blobs) => {
          if (sessionRef.current !== session || previewUrlsRef.current.length) return;
          previewUrlsRef.current = blobs.map((blob) => URL.createObjectURL(blob));
          patch({ previews: previewUrlsRef.current });
        })
        .catch(() => undefined);
    }

    let files: File[];
    try {
      files = await getInvoiceExportFiles(document, format, (progress) => {
        if (runRef.current === run) patch({ progress });
      });
      const pages = format === "jpeg" ? files.length : (await getInvoiceCapture(document)).length;
      if (runRef.current !== run) return;
      patch({ phase: "ready", files, pageCount: pages, progress: null });
    } catch (error) {
      console.error(`Invoice ${format} export failed`, error);
      if (runRef.current === run) patch({ phase: "error", error: describeExportError(error, format), progress: null });
      return;
    }

    if (hasUserActivation() || !canShareFiles(files)) {
      await deliver(files, run);
    } else {
      patch({ notice: "Your file is ready. Tap Share to send it." });
    }
  }, [deliver, patch, state.format]);

  const shareAgain = useCallback(async () => {
    if (!state.files) return;
    patch({ notice: null });
    await deliver(state.files, runRef.current);
  }, [deliver, patch, state.files]);

  const downloadNow = useCallback(async () => {
    if (!state.files) return;
    try {
      await download(state.files, { fallback: false });
    } catch (error) {
      toast.error(describeExportError(error, state.format));
    }
  }, [download, state.files, state.format]);

  return { state, open, close, setFormat, generate, backToFormats, shareAgain, downloadNow };
}
