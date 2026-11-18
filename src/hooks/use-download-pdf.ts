"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import { getInvoicePdfFile } from "@/lib/pdf/export-cache";
import { downloadFile } from "@/lib/invoice-export";
import { SharePdfError } from "@/lib/share-pdf";
import { toast } from "@/store/toast-store";

/** Warms up the PDF engine (shaper + fonts) once the page is idle, so the first click downloads right away. */
export function usePdfEnginePreload() {
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (!cancelled) void import("@/lib/pdf/invoice-pdf").then(({ preloadInvoicePdfEngine }) => preloadInvoicePdfEngine());
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }

    const timer = window.setTimeout(start, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
}

/** Generates the A4 PDF and saves it as "<To name>.pdf". Never opens the print dialog. */
export function useDownloadPdf(getDocument: () => InvoiceDocumentData) {
  const [isDownloading, setIsDownloading] = useState(false);
  const busyRef = useRef(false);
  usePdfEnginePreload();

  const download = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsDownloading(true);

    try {
      const file = await getInvoicePdfFile(getDocument());
      downloadFile(file);
      toast.success(`Downloaded ${file.name}`);
    } catch (error) {
      toast.error(error instanceof SharePdfError ? error.message : "Couldn't download the PDF. Please try again.");
    } finally {
      busyRef.current = false;
      setIsDownloading(false);
    }
  }, [getDocument]);

  return { download, isDownloading };
}
