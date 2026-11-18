"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, ShieldOff, Share2, X } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { ShareLinkField, ShareTargets } from "@/components/share/ShareTargets";
import { ShareQrCode } from "@/components/share/ShareQrCode";
import { ShareSettingsPanel } from "@/components/share/ShareSettingsPanel";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useShareInvoice } from "@/hooks/use-share-invoice";
import { buildShareUrl, formatShareAmount, isShareExpired } from "@/lib/share-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import { useShareStore } from "@/store/share-store";

export function ShareModal() {
  const isOpen = useShareStore((state) => state.isOpen);

  return <AnimatePresence>{isOpen && <ShareDialog key="share-dialog" />}</AnimatePresence>;
}

function ShareDialog() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const phase = useShareStore((state) => state.phase);
  const share = useShareStore((state) => state.share);
  const error = useShareStore((state) => state.error);
  const close = useShareStore((state) => state.close);
  const invoice = useInvoiceStore((state) => state.invoice);
  const openShare = useShareInvoice();
  const handleEscape = useCallback(() => close(), [close]);

  useFocusTrap(dialogRef, true, handleEscape);

  const url = share ? buildShareUrl(share.token) : "";
  const expired = share ? isShareExpired(share.expiresAt) : false;
  const isLive = Boolean(share?.isEnabled) && !expired;
  const grandTotal = formatShareAmount(invoice);
  const customerName = invoice.customer.name.trim();
  const message = useMemo(
    () => ({ invoiceNumber: invoice.customer.invoiceNumber, customerName, grandTotal, url }),
    [invoice.customer.invoiceNumber, customerName, grandTotal, url]
  );
  const nativeText = `Invoice #${invoice.customer.invoiceNumber}${customerName ? ` for ${customerName}` : ""}. Grand Total: ${grandTotal}`;

  return (
    <motion.div
      className="no-print fixed inset-0 z-[9999] grid place-items-end bg-black/40 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(event) => {
        // Only a press that starts on the backdrop itself counts, so dragging a text selection out of the card doesn't close it.
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-description"
        tabIndex={-1}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-white/50 bg-white/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] outline-none backdrop-blur-xl sm:max-w-xl sm:rounded-3xl sm:p-6 sysdark:border-white/10 sysdark:bg-zinc-900/80"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-lg shadow-red-600/30">
              <Share2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="share-dialog-title" className="text-lg font-black text-zinc-950 sysdark:text-white">Share invoice</h2>
              <p id="share-dialog-description" className="truncate text-xs font-semibold text-zinc-500 sysdark:text-zinc-400">
                #{invoice.customer.invoiceNumber}
                {customerName && ` · ${customerName}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={close}
            className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sysdark:text-zinc-400 sysdark:hover:bg-white/10 sysdark:hover:text-white"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {phase === "loading" && (
          <div role="status" className="grid place-items-center gap-3 py-16 text-sm font-semibold text-zinc-500 sysdark:text-zinc-400">
            <Loader2 className="size-8 animate-spin text-accent" aria-hidden="true" />
            Preparing your share link…
          </div>
        )}

        {phase === "error" && (
          <div role="alert" className="grid gap-4 rounded-2xl border border-red-200 bg-red-50/80 p-5 text-center sysdark:border-red-900 sysdark:bg-red-950/50">
            <AlertTriangle className="mx-auto size-8 text-red-600" aria-hidden="true" />
            <p className="text-sm font-semibold text-red-800 sysdark:text-red-100">{error}</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={openShare}
                className="inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-bold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === "ready" && share && (
          <div className="grid gap-4">
            {!isLive && (
              <div
                role="status"
                className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-xs font-semibold text-amber-900 sysdark:border-amber-900 sysdark:bg-amber-950/60 sysdark:text-amber-100"
              >
                <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {expired
                  ? "This link has expired and nobody can open it. Choose a new expiry below to reactivate it."
                  : "Sharing is turned off. Turn it on below to share this invoice again."}
              </div>
            )}

            <ShareLinkField url={url} disabled={!isLive} />
            <ShareTargets message={message} nativeText={nativeText} disabled={!isLive} />
            <ShareSettingsPanel share={share} />
            {isLive && <ShareQrCode url={url} invoiceNumber={invoice.customer.invoiceNumber} />}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
