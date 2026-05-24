"use client";

import bottomSide from "@/assets/bottom_side.svg";
import smartSignLogo from "@/assets/smart_sign_logo.png";
import topSide from "@/assets/top_side-01.svg";
import { ActionButton } from "@/components/controls/ActionButton";
import { calculateTotals, formatMoney, lineTotal } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";
import { Download } from "lucide-react";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const PAGE_PADDING_MM = 10;
const PX_PER_MM = 8;

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
  ctx.font = `${options.weight ?? "400"} ${options.size ?? 9}px NirmalaInvoice, "Nirmala UI", Arial, sans-serif`;
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
  ctx.lineWidth = 0.35;

  if (type === "user") {
    ctx.beginPath();
    ctx.arc(x + 2.2, y + 1.7, 1.15, 0, Math.PI * 2);
    ctx.stroke();
    strokeRoundedRect(ctx, x + 0.45, y + 3.4, 3.5, 2.2, 1.1);
  }

  if (type === "phone") {
    strokeRoundedRect(ctx, x + 0.8, y + 0.4, 3, 5.4, 0.8);
    ctx.beginPath();
    ctx.moveTo(x + 1.55, y + 1.15);
    ctx.lineTo(x + 3, y + 5);
    ctx.stroke();
  }

  if (type === "mail") {
    ctx.strokeRect(x, y + 1.1, 4.8, 3.6);
    ctx.beginPath();
    ctx.moveTo(x, y + 1.1);
    ctx.lineTo(x + 2.4, y + 3.1);
    ctx.lineTo(x + 4.8, y + 1.1);
    ctx.stroke();
  }

  if (type === "pin") {
    ctx.beginPath();
    ctx.arc(x + 2.4, y + 2.1, 1.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 2.4, y + 2.1, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 2.4, y + 3.85);
    ctx.lineTo(x + 2.4, y + 6);
    ctx.stroke();
  }

  ctx.restore();
}

export function PDFExportButton() {
  const invoice = useInvoiceStore((state) => state.invoice);

  async function exportPdf() {
    const [{ jsPDF }, topSideImage, bottomSideImage, logoImage] = await Promise.all([
      import("jspdf"),
      loadImage(topSide.src),
      loadImage(bottomSide.src),
      loadImage(smartSignLogo.src),
      loadCanvasFonts()
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = A4_WIDTH_MM * PX_PER_MM;
    canvas.height = A4_HEIGHT_MM * PX_PER_MM;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(PX_PER_MM, PX_PER_MM);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);

    const totals = calculateTotals(invoice);
    const currency = invoice.settings.currency;

    ctx.drawImage(topSideImage, 0, 0, 86, 50.6);
    ctx.drawImage(bottomSideImage, A4_WIDTH_MM - 86, A4_HEIGHT_MM - 50.6, 86, 50.6);
    ctx.drawImage(logoImage, 118, 14, 82, 27.4);

    drawText(ctx, "Invoice", PAGE_PADDING_MM, 51, { color: "#e01b24", size: 34, weight: "700" });

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.45;
    const metaX = 144;
    const drawMeta = (label: string, value: string, y: number) => {
      ctx.strokeRect(metaX, y, 17, 7);
      ctx.strokeRect(metaX + 17, y, 39, 7);
      drawText(ctx, label, metaX + 2, y + 4.8, { size: 9, weight: "700" });
      drawText(ctx, value || "", metaX + 19, y + 4.8, { size: 9 });
    };
    drawMeta("SL No", invoice.customer.invoiceNumber, 46);
    drawMeta("Date", invoice.customer.date, 55);

    drawText(ctx, "To:", PAGE_PADDING_MM, 76, { size: 10, weight: "700" });
    drawText(ctx, invoice.customer.name || "", PAGE_PADDING_MM + 9, 76, { size: 10 });

    const tableX = PAGE_PADDING_MM;
    const tableY = 86;
    const rowHeight = 8.5;
    const widths = [10, 104, 18, 28, 30];
    const headers = ["No", "Item Description", "Qty", "Price", "Total"];
    let x = tableX;

    ctx.fillStyle = "#e01b24";
    fillRoundedRect(ctx, tableX, tableY, 190, rowHeight, 2);
    headers.forEach((header, index) => {
      const align = index === 1 ? "left" : index === 2 ? "center" : "right";
      const textX = align === "left" ? x + 3 : align === "center" ? x + widths[index] / 2 : x + widths[index] - 3;
      drawText(ctx, header, textX, tableY + 5.7, { align, color: "#ffffff", size: 9, weight: "700" });
      x += widths[index];
    });

    invoice.items.forEach((item, index) => {
      const y = tableY + rowHeight * (index + 1);
      let cellX = tableX;
      ctx.strokeStyle = "#dddddd";
      ctx.beginPath();
      ctx.moveTo(tableX, y + rowHeight);
      ctx.lineTo(tableX + 190, y + rowHeight);
      ctx.stroke();
      drawText(ctx, String(index + 1), cellX + widths[0] / 2, y + 5.6, { align: "center", color: "#71717a", size: 8.5 });
      cellX += widths[0];
      drawText(ctx, item.name || "", cellX + 3, y + 5.6, { size: 8.5, maxWidth: widths[1] - 6 });
      cellX += widths[1];
      drawText(ctx, String(item.quantity || 0), cellX + widths[2] / 2, y + 5.6, { align: "center", size: 8.5 });
      cellX += widths[2];
      drawText(ctx, formatMoney(item.unitPrice || 0, currency), cellX + widths[3] - 3, y + 5.6, { align: "right", size: 8.5 });
      cellX += widths[3];
      drawText(ctx, formatMoney(lineTotal(item), currency), cellX + widths[4] - 3, y + 5.6, { align: "right", size: 8.5, weight: "700" });
    });

    const summaryX = 130;
    let summaryY = Math.max(tableY + rowHeight * (invoice.items.length + 1) + 12, 126);
    const summaryRow = (label: string, value: string, bold = false) => {
      ctx.strokeStyle = "#dddddd";
      ctx.strokeRect(summaryX, summaryY, 70, 8);
      drawText(ctx, label, summaryX + 3, summaryY + 5.4, { color: "#5a5a5a", size: 8.8, weight: bold ? "700" : "400" });
      drawText(ctx, value, summaryX + 67, summaryY + 5.4, { align: "right", size: 8.8, weight: bold ? "700" : "400" });
      summaryY += 8;
    };

    summaryRow("Subtotal", formatMoney(totals.subtotal, currency));
    summaryRow("Discount", String(invoice.discount || 0));
    summaryRow("VAT / Tax %", String(invoice.taxRate || 0));
    summaryRow("Grand Total", formatMoney(totals.grandTotal, currency), true);
    summaryRow("Advance", String(invoice.advance || 0));

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.6;
    strokeRoundedRect(ctx, 140, summaryY + 8, 60, 10, 5);
    drawText(ctx, "Remaining:", 147, summaryY + 14.5, { size: 9.5, weight: "700" });
    drawText(ctx, formatMoney(totals.remaining, currency), 197, summaryY + 14.5, { align: "right", color: "#e01b24", size: 9.5, weight: "700" });

    const footerY = 230;
    drawText(ctx, "Signature", PAGE_PADDING_MM, footerY, { color: "#5a5a5a", size: 8 });
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(PAGE_PADDING_MM, footerY + 8);
    ctx.lineTo(66, footerY + 8);
    ctx.stroke();

    let contactY = footerY + 22;
    contactInfo.forEach(({ icon, text }) => {
      drawContactIcon(ctx, icon, PAGE_PADDING_MM, contactY - 4.2);
      ctx.font = "400 8.5px NirmalaInvoice, 'Nirmala UI', Arial, sans-serif";
      ctx.fillStyle = "#222222";
      ctx.textAlign = "left";
      contactY = wrapText(ctx, text, PAGE_PADDING_MM + 7, contactY, 118, 4.6) + 0.9;
    });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.98), "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
    pdf.save(getCurrentDateFilename());
  }

  return <ActionButton icon={<Download className="size-4" />} variant="primary" onClick={exportPdf}>Download PDF</ActionButton>;
}
