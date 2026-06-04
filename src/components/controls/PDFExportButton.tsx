"use client";

import smartSignLogo from "@/assets/smart_sign_logo.svg";
import { BrandLoaderOverlay } from "@/components/brand/BrandLoader";
import { ActionButton } from "@/components/controls/ActionButton";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { calculateTotals, formatDecimal, formatMoney, lineSqf, lineTotal } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_PADDING_MM = 10;
const PX_PER_MM = 8;
const CSS_PX_TO_MM = 25.4 / 96;
const TOP_BANNER_HEIGHT_MM = 50;

const contactInfo = [
  { icon: "user", text: "Md. Mahabubur Rahmn" },
  { icon: "phone", text: "+8801677-206964" },
  { icon: "mail", text: "smartsign2024@gmail.com" },
  { icon: "pin", text: "Appolo Akbari Complex, Oposite Of Chandpur Govt. College,\nChandpur Sadar, Chandpur." }
] as const;

function getCurrentDateFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `invoice-${year}-${month}-${day}.pdf`;
}

async function loadCanvasFonts() {
  if (!("fonts" in document)) return;

  const regular = new FontFace("NirmalaInvoice", "url(/fonts/Nirmala.ttf)");
  const bold = new FontFace("NirmalaInvoice", "url(/fonts/NirmalaB.ttf)", { weight: "700" });
  document.fonts.add(regular);
  document.fonts.add(bold);
  await Promise.all([regular.load(), bold.load(), document.fonts.ready]);
}

async function loadImage(src: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;

  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });

  return image;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function strokeRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.stroke();
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, options: {
  align?: CanvasTextAlign;
  color?: string;
  size?: number;
  weight?: "400" | "700";
  maxWidth?: number;
} = {}) {
  ctx.fillStyle = options.color ?? "#222222";
  const fontSize = (options.size ?? 9) * CSS_PX_TO_MM;
  ctx.font = `${options.weight ?? "400"} ${fontSize}px NirmalaInvoice, "Nirmala UI", Arial, sans-serif`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y, options.maxWidth);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const paragraphs = text.split("\n");
  let currentY = y;

  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(" ");
    let line = "";

    words.forEach((word) => {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, currentY);
        currentY += lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    });

    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  });

  return currentY;
}

function drawContactIcon(ctx: CanvasRenderingContext2D, type: "user" | "phone" | "mail" | "pin", x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = 0.32;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (type === "user") {
    ctx.beginPath();
    ctx.arc(x + 1.8, y + 1, 0.65, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 1.8, y + 3.05, 1.3, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  if (type === "phone") {
    ctx.beginPath();
    ctx.moveTo(x + 0.9, y + 0.55);
    ctx.bezierCurveTo(x + 0.35, y + 1.2, x + 0.6, y + 2.65, x + 1.7, y + 3.45);
    ctx.bezierCurveTo(x + 2.8, y + 4.25, x + 3.65, y + 3.9, x + 3.8, y + 3.25);
    ctx.lineTo(x + 2.85, y + 2.55);
    ctx.lineTo(x + 2.25, y + 3.05);
    ctx.bezierCurveTo(x + 1.65, y + 2.6, x + 1.35, y + 2.05, x + 1.2, y + 1.4);
    ctx.lineTo(x + 1.75, y + 0.9);
    ctx.closePath();
    ctx.stroke();
  }

  if (type === "mail") {
    ctx.strokeRect(x + 0.25, y + 0.7, 3.7, 2.7);
    ctx.beginPath();
    ctx.moveTo(x + 0.25, y + 0.7);
    ctx.lineTo(x + 2.1, y + 2.25);
    ctx.lineTo(x + 3.95, y + 0.7);
    ctx.stroke();
  }

  if (type === "pin") {
    ctx.beginPath();
    ctx.moveTo(x + 2.1, y + 3.9);
    ctx.bezierCurveTo(x + 0.65, y + 2.25, x + 0.65, y + 0.65, x + 2.1, y + 0.35);
    ctx.bezierCurveTo(x + 3.55, y + 0.65, x + 3.55, y + 2.25, x + 2.1, y + 3.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 2.1, y + 1.65, 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function ShareInvoiceButton() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const [isSharing, setIsSharing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function closeOnOutsideClick(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  async function createInvoiceCanvas() {
    const [logoImage] = await Promise.all([
      loadImage(smartSignLogo.src),
      loadCanvasFonts()
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = A4_WIDTH_MM * PX_PER_MM;
    canvas.height = A4_HEIGHT_MM * PX_PER_MM;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to create invoice PDF.");
    }

    ctx.scale(PX_PER_MM, PX_PER_MM);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);

    const totals = calculateTotals(invoice);
    const currency = invoice.settings.currency;
    const isCompact = invoice.items.length > 8;
    const labels = getInvoiceLabels();

    ctx.fillStyle = "#231f20";
    ctx.fillRect(0, 0, A4_WIDTH_MM, TOP_BANNER_HEIGHT_MM);
    ctx.drawImage(logoImage, 84, 16, 112, 31.7);

    drawText(ctx, labels.invoice, PAGE_PADDING_MM, 67, { color: "#e01b24", size: 34, weight: "700" });

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.45;
    const metaX = 144;
    const drawMeta = (label: string, value: string, y: number) => {
      ctx.strokeRect(metaX, y, 17, 7);
      ctx.strokeRect(metaX + 17, y, 39, 7);
      drawText(ctx, label, metaX + 2, y + 4.8, { size: 12, weight: "700" });
      drawText(ctx, value || "", metaX + 19, y + 4.8, { size: 12 });
    };
    drawMeta(labels.slNo, invoice.customer.invoiceNumber, 62);
    drawMeta(labels.date, invoice.customer.date, 71);

    drawText(ctx, labels.to, PAGE_PADDING_MM, 90, { size: 13, weight: "700" });
    drawText(ctx, invoice.customer.name || "", PAGE_PADDING_MM + 9, 90, { size: 13 });

    const tableX = PAGE_PADDING_MM;
    const tableY = isCompact ? 96 : 100;
    const rowHeight = isCompact ? Math.max(5.2, Math.min(7.4, 74 / Math.max(invoice.items.length, 1))) : 8.5;
    const tableFontSize = isCompact ? 10.2 : 12.4;
    const headerFontSize = isCompact ? 11 : 13;
    const widths = [9, 90, 9, 3, 9, 12, 10, 18, 30];
    let x = tableX;

    ctx.fillStyle = "#e01b24";
    fillRoundedRect(ctx, tableX, tableY, 190, rowHeight, 2);
    drawText(ctx, labels.no, x + widths[0] / 2, tableY + rowHeight * 0.67, { align: "center", color: "#ffffff", size: headerFontSize, weight: "700" });
    x += widths[0];
    drawText(ctx, labels.productDescription, x + 3, tableY + rowHeight * 0.67, { color: "#ffffff", size: headerFontSize, weight: "700", maxWidth: widths[1] - 6 });
    x += widths[1];
    drawText(ctx, labels.size, x + (widths[2] + widths[3] + widths[4]) / 2, tableY + rowHeight * 0.67, { align: "center", color: "#ffffff", size: headerFontSize, weight: "700" });
    x += widths[2] + widths[3] + widths[4];
    drawText(ctx, labels.sqf, x + widths[5] / 2, tableY + rowHeight * 0.67, { align: "center", color: "#ffffff", size: headerFontSize, weight: "700" });
    x += widths[5];
    drawText(ctx, labels.qty, x + widths[6] / 2, tableY + rowHeight * 0.67, { align: "center", color: "#ffffff", size: headerFontSize, weight: "700" });
    x += widths[6];
    drawText(ctx, labels.rate, x + widths[7] - 3, tableY + rowHeight * 0.67, { align: "right", color: "#ffffff", size: headerFontSize, weight: "700" });
    x += widths[7];
    drawText(ctx, labels.total, x + widths[8] - 3, tableY + rowHeight * 0.67, { align: "right", color: "#ffffff", size: headerFontSize, weight: "700" });

    invoice.items.forEach((item, index) => {
      const y = tableY + rowHeight * (index + 1);
      const textY = y + rowHeight * 0.66;
      let cellX = tableX;
      const sqf = lineSqf(item);
      ctx.strokeStyle = "#dddddd";
      ctx.beginPath();
      ctx.moveTo(tableX, y + rowHeight);
      ctx.lineTo(tableX + 190, y + rowHeight);
      ctx.stroke();
      drawText(ctx, String(index + 1), cellX + widths[0] / 2, textY, { align: "center", color: "#71717a", size: tableFontSize });
      cellX += widths[0];
      drawText(ctx, item.name || "", cellX + 3, textY, { size: tableFontSize, maxWidth: widths[1] - 6 });
      cellX += widths[1];
      drawText(ctx, formatDecimal(item.width || 0), cellX + widths[2] / 2, textY, { align: "center", size: tableFontSize });
      cellX += widths[2];
      drawText(ctx, item.width > 0 || item.height > 0 ? "X" : "", cellX + widths[3] / 2, textY, { align: "center", color: "#71717a", size: tableFontSize, weight: "700" });
      cellX += widths[3];
      drawText(ctx, formatDecimal(item.height || 0), cellX + widths[4] / 2, textY, { align: "center", size: tableFontSize });
      cellX += widths[4];
      drawText(ctx, formatDecimal(sqf), cellX + widths[5] / 2, textY, { align: "center", size: tableFontSize, weight: "700" });
      cellX += widths[5];
      drawText(ctx, formatDecimal(item.quantity || 0), cellX + widths[6] / 2, textY, { align: "center", size: tableFontSize });
      cellX += widths[6];
      drawText(ctx, formatMoney(item.unitPrice || 0, currency), cellX + widths[7] - 3, textY, { align: "right", size: tableFontSize });
      cellX += widths[7];
      drawText(ctx, formatMoney(lineTotal(item), currency), cellX + widths[8] - 3, textY, { align: "right", size: tableFontSize, weight: "700" });
    });

    const summaryX = 130;
    let summaryY = Math.max(tableY + rowHeight * (invoice.items.length + 1) + (isCompact ? 7 : 12), isCompact ? 132 : 140);
    const summaryRowHeight = isCompact ? 6.6 : 8;
    const summaryFontSize = isCompact ? 10.4 : 12.2;
    const summaryRow = (label: string, value: string, bold = false) => {
      ctx.strokeStyle = "#dddddd";
      ctx.strokeRect(summaryX, summaryY, 70, summaryRowHeight);
      drawText(ctx, label, summaryX + 3, summaryY + summaryRowHeight * 0.68, { color: "#5a5a5a", size: summaryFontSize, weight: bold ? "700" : "400" });
      drawText(ctx, value, summaryX + 67, summaryY + summaryRowHeight * 0.68, { align: "right", size: summaryFontSize, weight: bold ? "700" : "400" });
      summaryY += summaryRowHeight;
    };

    summaryRow(labels.totalSqf, formatDecimal(totals.totalSqf));
    summaryRow(labels.subtotal, formatMoney(totals.subtotal, currency));
    summaryRow(labels.vatTax, String(invoice.taxRate || 0));
    summaryRow(labels.grandTotal, formatMoney(totals.grandTotal, currency), true);
    summaryRow(labels.advance, String(invoice.advance || 0));

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.6;
    const remainingY = summaryY + (isCompact ? 5 : 8);
    strokeRoundedRect(ctx, 140, remainingY, 60, 10, 5);
    drawText(ctx, labels.remaining, 147, remainingY + 6.5, { size: 12.5, weight: "700" });
    drawText(ctx, formatMoney(totals.remaining, currency), 197, remainingY + 6.5, { align: "right", color: "#e01b24", size: 12.5, weight: "700" });

    const footerY = Math.min(226, Math.max(isCompact ? 214 : 218, remainingY + 18));
    drawText(ctx, labels.signature, PAGE_PADDING_MM, footerY, { color: "#5a5a5a", size: 11 });
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(PAGE_PADDING_MM, footerY + 8);
    ctx.lineTo(66, footerY + 8);
    ctx.stroke();

    let contactY = footerY + 22;
    contactInfo.forEach(({ icon, text }) => {
      drawContactIcon(ctx, icon, PAGE_PADDING_MM, contactY - 3.4);
      ctx.font = `400 ${12 * CSS_PX_TO_MM}px NirmalaInvoice, 'Nirmala UI', Arial, sans-serif`;
      ctx.fillStyle = "#222222";
      ctx.textAlign = "left";
      contactY = wrapText(ctx, text, PAGE_PADDING_MM + 7, contactY, 118, 5.8) + 1.25;
    });

    return canvas;
  }

  async function createPdfFile() {
    const { jsPDF } = await import("jspdf");
    const canvas = await createInvoiceCanvas();
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.98), "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
    const blob = pdf.output("blob");

    return new File([blob], getCurrentDateFilename(), { type: "application/pdf" });
  }

  async function createInvoicePngBlob() {
    const canvas = await createInvoiceCanvas();

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Unable to copy invoice image."));
      }, "image/png");
    });
  }

  async function sharePdfFile() {
    if (isSharing) return;

    setIsSharing(true);

    try {
      const file = await createPdfFile();
      const title = `Invoice ${invoice.customer.invoiceNumber}`;
      const shareData = {
        title,
        text: title,
        files: [file]
      };

      if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share(shareData);
        return;
      }

      window.alert("This browser does not support direct PDF file sharing. Please use a mobile browser or the Print option.");
    } finally {
      setIsSharing(false);
      setIsMenuOpen(false);
    }
  }

  async function copyPdfFile() {
    if (isSharing) return;

    setIsSharing(true);

    try {
      if (navigator.clipboard && "ClipboardItem" in window) {
        const ClipboardItemCtor = window.ClipboardItem;

        if (!ClipboardItemCtor.supports || ClipboardItemCtor.supports("application/pdf")) {
          try {
            const file = await createPdfFile();
            await navigator.clipboard.write([
              new ClipboardItemCtor({
                [file.type]: file
              })
            ]);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
            return;
          } catch {
            // Most browsers do not allow application/pdf clipboard writes. Fall back to PNG.
          }
        }

        const imageBlob = await createInvoicePngBlob();
        await navigator.clipboard.write([
          new ClipboardItemCtor({
            [imageBlob.type]: imageBlob
          })
        ]);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
        return;
      }

      window.alert("This browser does not support copying invoice files to clipboard.");
    } finally {
      setIsSharing(false);
      setIsMenuOpen(false);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <ActionButton
        icon={<Share2 className="size-4" />}
        variant="primary"
        onClick={() => setIsMenuOpen((open) => !open)}
        disabled={isSharing}
      >
        {isSharing ? "Working..." : "Share"}
      </ActionButton>

      {isSharing && <BrandLoaderOverlay label="Preparing invoice" />}

      {isMenuOpen && (
        <div className="absolute right-0 top-12 z-50 grid w-44 overflow-hidden rounded-md border border-zinc-200 bg-white p-1 text-sm font-semibold text-zinc-800 shadow-xl">
          <button
            type="button"
            className="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-zinc-100"
            onClick={sharePdfFile}
          >
            <Share2 className="size-4 text-zinc-600" />
            Share PDF
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-zinc-100"
            onClick={copyPdfFile}
          >
            {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4 text-zinc-600" />}
            {copied ? "Copied" : "Copy Invoice"}
          </button>
        </div>
      )}
    </div>
  );
}
