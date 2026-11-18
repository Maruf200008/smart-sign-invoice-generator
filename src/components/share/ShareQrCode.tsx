"use client";

import { Download, Loader2, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/store/toast-store";

const QR_SIZE = 640;

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
}

/** Prints just the QR image + caption using a throwaway iframe, so the invoice page's print CSS is not involved. */
function printQrImage(dataUrl: string, invoiceNumber: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;

  if (!frameDocument) {
    frame.remove();
    toast.error("Unable to open the print dialog.");
    return;
  }

  const cleanup = () => window.setTimeout(() => frame.remove(), 1000);

  // Built with DOM APIs (not string HTML) so the invoice number can never inject markup.
  frameDocument.title = `QR - ${invoiceNumber}`;
  const style = frameDocument.createElement("style");
  style.textContent =
    "@page{margin:15mm}body{margin:0;font-family:Arial,sans-serif;text-align:center;color:#111}" +
    "img{width:90mm;height:90mm;display:block;margin:20mm auto 6mm}h1{font-size:18pt;margin:0 0 2mm}p{font-size:11pt;margin:0;color:#555}";
  frameDocument.head.appendChild(style);

  const heading = frameDocument.createElement("h1");
  heading.textContent = "Smart Sign Invoice";
  const caption = frameDocument.createElement("p");
  caption.textContent = `Scan to view invoice #${invoiceNumber}`;
  const image = frameDocument.createElement("img");
  image.alt = "QR code for the shared invoice";

  image.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    cleanup();
  };
  image.onerror = () => {
    toast.error("Unable to print the QR code.");
    cleanup();
  };
  frameDocument.body.append(heading, image, caption);
  image.src = dataUrl;
}

export function ShareQrCode({ url, invoiceNumber }: { url: string; invoiceNumber: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    setDataUrl(null);
    setHasFailed(false);

    // qrcode is loaded on demand so it never weighs on the main invoice editor bundle.
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, { width: QR_SIZE, margin: 2, errorCorrectionLevel: "M", color: { dark: "#141414", light: "#ffffff" } })
      )
      .then((result) => {
        if (!isCancelled) {
          setDataUrl(result);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setHasFailed(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [url]);

  function downloadQr() {
    if (!dataUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `invoice-qr-${safeFilePart(invoiceNumber)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/60 p-4 sysdark:border-white/10 sysdark:bg-white/5 sm:flex-row sm:items-center">
      <div className="grid size-32 shrink-0 place-items-center rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-zinc-200">
        {dataUrl ? (
          // A data URL can't use next/image optimisation, and the QR must stay crisp, so a plain img is correct here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="QR code that opens the shared invoice" width={116} height={116} className="size-full" />
        ) : hasFailed ? (
          <span className="px-2 text-center text-xs font-semibold text-red-600">QR unavailable</span>
        ) : (
          <Loader2 className="size-6 animate-spin text-zinc-400" aria-label="Generating QR code" />
        )}
      </div>

      <div className="grid w-full min-w-0 gap-2 text-center sm:text-left">
        <p className="text-sm font-bold text-zinc-900 sysdark:text-zinc-50">Scan to open</p>
        <p className="text-xs font-medium text-zinc-500 sysdark:text-zinc-400">Print it on a delivery slip or show it on a phone.</p>
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <button type="button" disabled={!dataUrl} onClick={downloadQr} className={qrButtonClass}>
            <Download className="size-4" aria-hidden="true" />
            Download QR
          </button>
          <button type="button" disabled={!dataUrl} onClick={() => dataUrl && printQrImage(dataUrl, invoiceNumber)} className={qrButtonClass}>
            <Printer className="size-4" aria-hidden="true" />
            Print QR
          </button>
        </div>
      </div>
    </div>
  );
}

const qrButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 text-xs font-bold text-zinc-800 transition hover:-translate-y-0.5 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sysdark:border-white/15 sysdark:bg-white/10 sysdark:text-zinc-100";
