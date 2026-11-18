"use client";

import { Link2 } from "lucide-react";
import { useCallback } from "react";
import { ActionButton } from "@/components/controls/ActionButton";
import { DownloadPdfButton } from "@/components/controls/DownloadPdfButton";
import type { InvoiceDocumentData } from "@/lib/invoice-document";
import { copyTextToClipboard } from "@/lib/share-utils";
import { toast } from "@/store/toast-store";

/** Download / copy actions for the public viewer. Read-only: nothing here can modify the invoice. */
export function SharedInvoiceToolbar({ document }: { document: InvoiceDocumentData }) {
  const getDocument = useCallback(() => document, [document]);

  async function copyLink() {
    const copied = await copyTextToClipboard(window.location.href);

    if (copied) {
      toast.success("Invoice link copied successfully.");
    } else {
      toast.error("Couldn't copy the link. Copy it from the address bar instead.");
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      <DownloadPdfButton getDocument={getDocument} />
      <ActionButton icon={<Link2 className="size-4" />} onClick={() => void copyLink()}>
        Copy link
      </ActionButton>
    </div>
  );
}
