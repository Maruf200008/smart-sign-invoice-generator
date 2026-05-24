export type CurrencyCode = "BDT" | "USD" | "EUR" | "GBP" | "INR";

export type InvoiceStatus = "draft" | "paid" | "unpaid" | "partial";

export type InvoiceTheme = "red-black" | "minimal" | "executive";

export interface CompanyInfo {
  name: string;
  logo: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export interface CustomerInfo {
  name: string;
  address: string;
  phone: string;
  invoiceNumber: string;
  date: string;
}

export interface InvoiceItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceSettings {
  currency: CurrencyCode;
  status: InvoiceStatus;
  theme: InvoiceTheme;
  darkMode: boolean;
  watermark: string;
}

export interface InvoiceData {
  company: CompanyInfo;
  customer: CustomerInfo;
  items: InvoiceItem[];
  advance: number;
  discount: number;
  taxRate: number;
  notes: string;
  terms: string;
  signature: string;
  settings: InvoiceSettings;
  updatedAt: string;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  grandTotal: number;
  advance: number;
  remaining: number;
}
