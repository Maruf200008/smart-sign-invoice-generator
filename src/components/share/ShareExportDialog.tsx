"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Download, FileText, ImageIcon, Loader2, Share2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { ShareExportState } from "@/hooks/use-share-export";
import { cn } from "@/lib/cn";
import { canShareFiles, type ExportFormat } from "@/lib/invoice-export";

interface ShareExportDialogProps {
  state: ShareExportState;
  onClose: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onGenerate: () => void;
  onBack: () => void;
  onShare: () => void;
  onDownload: () => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; title: string; detail: string; icon: typeof FileText }[] = [
  { value: "pdf", title: "PDF Document", detail: "A4 pages with crisp, selectable text. Best for printing and email.", icon: FileText },
  { value: "jpeg", title: "JPEG Image", detail: "High-resolution 300 DPI image, one per page. Best for WhatsApp and Messenger.", icon: ImageIcon }
];

const primaryButton =
  "inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-sm font-bold text-zinc-900 transition hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sysdark:border-zinc-700 sysdark:bg-zinc-900 sysdark:text-zinc-50";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Share invoice: pick PDF or JPEG, generate it, preview it, then open the share sheet (or download). */
export function ShareExportDialog(props: ShareExportDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Portalled to <body>: the toolbar is animated with transforms, which would trap a fixed overlay inside it.
  return createPortal(<AnimatePresence>{props.state.phase !== "closed" && <Dialog key="share-export" {...props} />}</AnimatePresence>, document.body);
}

function Dialog({ state, onClose, onFormatChange, onGenerate, onBack, onShare, onDownload }: ShareExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleEscape = useCallback(() => onClose(), [onClose]);
  useFocusTrap(dialogRef, true, handleEscape);

  const { phase, format, files, previews, progress, pageCount, error, notice } = state;
  const canShare = files ? canShareFiles(files) : true;
  const formatLabel = format === "pdf" ? "PDF" : "JPEG";
  const totalSize = files?.reduce((sum, file) => sum + file.size, 0) ?? 0;

  return (
    <motion.div
      className="no-print fixed inset-0 z-[9999] grid place-items-end bg-black/40 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && phase !== "generating") onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-export-title"
        aria-describedby="share-export-description"
        tabIndex={-1}
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-white/50 bg-white/90 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] outline-none backdrop-blur-xl sm:max-w-md sm:rounded-3xl sm:p-6 sysdark:border-white/10 sysdark:bg-zinc-900/90"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-lg shadow-red-600/30">
              <Share2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="share-export-title" className="text-lg font-black text-zinc-950 sysdark:text-white">
                Share Invoice
              </h2>
              <p id="share-export-description" className="truncate text-xs font-semibold text-zinc-500 sysdark:text-zinc-400">
                {phase === "choose" ? "Choose a format to share" : `${formatLabel} export`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close share dialog"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sysdark:text-zinc-400 sysdark:hover:bg-white/10 sysdark:hover:text-white"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        {phase === "choose" && (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              onGenerate();
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="sr-only">Export format</legend>
              {FORMAT_OPTIONS.map(({ value, title, detail, icon: Icon }) => {
                const selected = format === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                      selected
                        ? "border-accent bg-red-50/80 sysdark:bg-red-950/30"
                        : "border-zinc-200 bg-white/70 hover:border-zinc-300 sysdark:border-zinc-700 sysdark:bg-zinc-900/60 sysdark:hover:border-zinc-600"
                    )}
                  >
                    <input
                      type="radio"
                      name="share-format"
                      value={value}
                      checked={selected}
                      onChange={() => onFormatChange(value)}
                      className="mt-1 size-4 shrink-0 accent-accent"
                    />
                    <Icon className={cn("mt-0.5 size-5 shrink-0", selected ? "text-accent" : "text-zinc-500 sysdark:text-zinc-400")} aria-hidden="true" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-bold text-zinc-950 sysdark:text-white">{title}</span>
                      <span className="text-xs font-medium text-zinc-500 sysdark:text-zinc-400">{detail}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={secondaryButton}>
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                <Share2 className="size-4" aria-hidden="true" />
                Share
              </button>
            </div>
          </form>
        )}

        {phase === "generating" && (
          <div role="status" aria-live="polite" className="grid place-items-center gap-3 py-12 text-center text-sm font-semibold text-zinc-600 sysdark:text-zinc-300">
            <Loader2 className="size-8 animate-spin text-accent" aria-hidden="true" />
            <span>
              {format === "jpeg" && progress && progress.total > 1
                ? `Rendering page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : `Creating ${format === "pdf" ? "PDF" : "high-resolution image"}…`}
            </span>
            {format === "jpeg" && progress && progress.total > 1 && (
              <span className="h-1.5 w-48 overflow-hidden rounded-full bg-zinc-200 sysdark:bg-zinc-700" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </span>
            )}
            <button type="button" onClick={onBack} className="mt-2 text-xs font-bold text-zinc-500 underline-offset-4 hover:text-accent hover:underline sysdark:text-zinc-400">
              Cancel
            </button>
          </div>
        )}

        {phase === "error" && (
          <div role="alert" className="grid gap-4 rounded-2xl border border-red-200 bg-red-50/80 p-5 text-center sysdark:border-red-900 sysdark:bg-red-950/50">
            <AlertTriangle className="mx-auto size-8 text-red-600" aria-hidden="true" />
            <p className="text-sm font-semibold text-red-800 sysdark:text-red-100">{error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onBack} className={secondaryButton}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Change format
              </button>
              <button type="button" onClick={onGenerate} className={primaryButton}>
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === "ready" && files && (
          <div className="grid gap-4">
            <PreviewStrip previews={previews} pageCount={pageCount ?? files.length} />

            <p className="text-center text-xs font-semibold text-zinc-500 sysdark:text-zinc-400">
              {format === "pdf"
                ? `${files[0].name} · ${pageCount ?? 1} ${pageCount === 1 ? "page" : "pages"} · ${formatBytes(totalSize)}`
                : `${files.length === 1 ? files[0].name : `${files.length} JPEG images`} · 300 DPI · ${formatBytes(totalSize)}`}
            </p>

            {notice && (
              <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-center text-xs font-semibold text-amber-900 sysdark:border-amber-900 sysdark:bg-amber-950/60 sysdark:text-amber-100">
                {notice}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-accent sysdark:text-zinc-400">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Change format
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onDownload} className={secondaryButton}>
                  <Download className="size-4" aria-hidden="true" />
                  {format === "jpeg" && files.length > 1 ? "Download ZIP" : "Download"}
                </button>
                {canShare && (
                  <button type="button" onClick={onShare} className={primaryButton}>
                    <Share2 className="size-4" aria-hidden="true" />
                    Share
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function PreviewStrip({ previews, pageCount }: { previews: string[] | null; pageCount: number }) {
  const shown = Math.max(1, previews?.length ?? Math.min(pageCount, 3));

  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1" aria-label="Invoice preview">
      {Array.from({ length: shown }, (_, index) => (
        <figure key={index} className={cn("grid shrink-0 snap-start gap-1", shown === 1 ? "mx-auto w-48" : "w-36")}>
          {previews?.[index] ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimisable asset
            <img
              src={previews[index]}
              alt={`Page ${index + 1} of ${pageCount}`}
              className="aspect-[210/297] w-full rounded-lg border border-zinc-200 bg-white object-contain object-top shadow-sm sysdark:border-zinc-700"
            />
          ) : (
            <div className="grid aspect-[210/297] w-full animate-pulse place-items-center rounded-lg border border-zinc-200 bg-zinc-100 sysdark:border-zinc-700 sysdark:bg-zinc-800">
              <span className="sr-only">Loading preview</span>
            </div>
          )}
          {pageCount > 1 && <figcaption className="text-center text-[11px] font-semibold text-zinc-500 sysdark:text-zinc-400">Page {index + 1}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
