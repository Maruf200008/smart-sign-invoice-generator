"use client";

import { Download, Loader2 } from "lucide-react";
import { ActionButton } from "@/components/controls/ActionButton";
import { useDownloadPdf } from "@/hooks/use-download-pdf";
import type { InvoiceDocumentData } from "@/lib/invoice-document";

/** Replaces the old Print button: builds the A4 PDF and downloads it, named after the "To" field. */
export function DownloadPdfButton({ getDocument }: { getDocument: () => InvoiceDocumentData }) {
  const { download, isDownloading } = useDownloadPdf(getDocument);

  return (
    <ActionButton
      icon={isDownloading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      aria-busy={isDownloading}
      disabled={isDownloading}
      onClick={() => void download()}
    >
      {isDownloading ? "Preparing PDF…" : "Download PDF"}
    </ActionButton>
  );
}
