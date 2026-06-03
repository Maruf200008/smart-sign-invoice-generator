export type CurrencyCode = "BDT" | "USD" | "EUR" | "GBP" | "INR";

export type InvoiceStatus = "draft" | "paid" | "unpaid" | "partial";

export type InvoiceTheme = "red-black" | "minimal" | "executive";
export type InvoiceLanguage = "english" | "bangla";

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
  width: number;
  height: number;
  sqf: number;
  quantity: number;
  unitPrice: number;
  total: number;
  totalIsManual: boolean;
}

export interface InvoiceSettings {
  currency: CurrencyCode;
  status: InvoiceStatus;
  theme: InvoiceTheme;
  language: InvoiceLanguage;
  darkMode: boolean;
  watermark: string;
}

export interface InvoiceData {
  company: CompanyInfo;
  customer: CustomerInfo;
  items: InvoiceItem[];
  advance: number;
  taxRate: number;
  notes: string;
  terms: string;
  signature: string;
  settings: InvoiceSettings;
  updatedAt: string;
}

export interface SavedInvoice {
  id: string;
  name: string;
  savedAt: string;
  invoice: InvoiceData;
}

export interface InvoiceTotals {
  totalSqf: number;
  subtotal: number;
  taxable: number;
  tax: number;
  grandTotal: number;
  advance: number;
  remaining: number;
}
