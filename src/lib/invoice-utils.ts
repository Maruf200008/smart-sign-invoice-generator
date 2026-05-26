import type { CurrencyCode, InvoiceData, InvoiceItem, InvoiceTotals } from "@/types/invoice";

export const currencySymbols: Record<CurrencyCode, string> = {
  BDT: "৳",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹"
};

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const serial = String(Math.floor(Math.random() * 9000) + 1000);
  return `INV-${year}${month}${day}-${serial}`;
}

export function createBlankItem(): InvoiceItem {
  return {
    id: uid("item"),
    name: "",
    quantity: 0,
    unitPrice: 0
  };
}

export function lineTotal(item: InvoiceItem) {
  return safeNumber(item.quantity) * safeNumber(item.unitPrice);
}

export function calculateTotals(invoice: InvoiceData): InvoiceTotals {
  const subtotal = invoice.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const discount = Math.min(safeNumber(invoice.discount), subtotal);
  const taxable = Math.max(subtotal - discount, 0);
  const tax = taxable * (safeNumber(invoice.taxRate) / 100);
  const grandTotal = taxable + tax;
  const advance = Math.min(safeNumber(invoice.advance), grandTotal);

  return {
    subtotal,
    discount,
    taxable,
    tax,
    grandTotal,
    advance,
    remaining: Math.max(grandTotal - advance, 0)
  };
}

export function formatMoney(value: number, currency: CurrencyCode) {
  const symbol = currencySymbols[currency];
  return `${symbol}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2
  }).format(Number.isFinite(value) ? value : 0)}`;
}

export function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
