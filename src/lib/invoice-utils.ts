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
    width: 0,
    height: 0,
    sqf: 0,
    quantity: 0,
    unitPrice: 0,
    total: 0,
    totalIsManual: false
  };
}

export function lineSqf(item: InvoiceItem) {
  if (item.sqf !== null && item.sqf !== undefined) {
    return roundToTwo(safePositiveNumber(item.sqf));
  }

  if (hasPositiveValue(item.width) && hasPositiveValue(item.height)) {
    return calculateSqf(item.width, item.height) ?? 0;
  }

  return 0;
}

export function lineTotal(item: InvoiceItem) {
  if (item.totalIsManual) {
    return roundToTwo(safePositiveNumber(item.total));
  }

  return calculateLineTotal(item) ?? 0;
}

export function calculateSqf(width: unknown, height: unknown) {
  if (!hasPositiveValue(width) || !hasPositiveValue(height)) {
    return 0;
  }

  return roundToTwo(safePositiveNumber(width) * safePositiveNumber(height));
}

export function calculateLineTotal(item: InvoiceItem) {
  const rate = safePositiveNumber(item.unitPrice);

  if (!rate) {
    return 0;
  }

  const sqf = lineSqf(item);
  const quantity = safePositiveNumber(item.quantity);

  if (sqf && quantity) {
    return roundToTwo(sqf * quantity * rate);
  }

  if (quantity) {
    return roundToTwo(quantity * rate);
  }

  if (sqf) {
    return roundToTwo(sqf * rate);
  }

  return 0;
}

export function calculateTotals(invoice: InvoiceData): InvoiceTotals {
  const totalSqf = roundToTwo(
    invoice.items.reduce((sum, item) => sum + lineSqf(item) * (safePositiveNumber(item.quantity) || 1), 0)
  );
  const subtotal = invoice.items.reduce((sum, item) => sum + lineTotal(item), 0);
  const taxable = subtotal;
  const tax = taxable * (safeNumber(invoice.taxRate) / 100);
  const grandTotal = taxable + tax;
  const advance = Math.min(safeNumber(invoice.advance), grandTotal);

  return {
    totalSqf,
    subtotal,
    taxable,
    tax,
    grandTotal,
    advance,
    remaining: Math.max(grandTotal - advance, 0)
  };
}

export function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatMoney(value: number, currency: CurrencyCode) {
  const symbol = currencySymbols[currency];
  return `${symbol}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2
  }).format(Number.isFinite(value) ? value : 0)}`;
}

export function safeNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function safePositiveNumber(value: unknown) {
  return Math.max(safeNumber(value), 0);
}

export function roundToTwo(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function hasPositiveValue(value: unknown) {
  return safePositiveNumber(value) > 0;
}

export function parsePositiveInput(value: string) {
  if (value.trim() === "") {
    return 0;
  }

  return safePositiveNumber(value);
}

export function roundPositiveInput(value: string) {
  if (value.trim() === "") {
    return 0;
  }

  return roundToTwo(safePositiveNumber(value));
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
