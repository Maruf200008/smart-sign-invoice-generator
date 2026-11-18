import { calculateLineTotal, calculateSqf, currencySymbols, formatInvoiceDate, roundToInteger, roundToTwo, safePositiveNumber, uid } from "@/lib/invoice-utils";
import type { CurrencyCode, InvoiceData, InvoiceItem, InvoiceLanguage, InvoiceStatus, InvoiceTheme, SavedInvoice } from "@/types/invoice";

/** Hard cap for stored rows; the editor allows the same number. */
export const MAX_STORED_ITEMS = 50;
export const SAVED_INVOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_TEXT = 500;
const MAX_LONG_TEXT = 4000;
const MAX_IMAGE_DATA_URL = 700_000;
const MAX_AMOUNT = 1_000_000_000_000;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

const STATUSES: InvoiceStatus[] = ["draft", "paid", "unpaid", "partial"];
const THEMES: InvoiceTheme[] = ["red-black", "minimal", "executive"];
const LANGUAGES: InvoiceLanguage[] = ["english", "bangla"];

type Loose = Record<string, unknown>;

function record(value: unknown): Loose {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
}

function text(value: unknown, max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** Only inline PNG/JPEG/WebP images are kept: no remote URLs (tracking, mixed content) and no SVG (script). */
function imageDataUrl(value: unknown) {
  return typeof value === "string" && value.length <= MAX_IMAGE_DATA_URL && IMAGE_DATA_URL.test(value) ? value : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Non-negative, finite, capped, rounded to 2 decimals. */
export function cleanAmount(value: unknown) {
  return roundToTwo(Math.min(safePositiveNumber(value), MAX_AMOUNT));
}

export function sanitizeItem(raw: unknown): InvoiceItem {
  const item = record(raw);
  const width = cleanAmount(item.width);
  const height = cleanAmount(item.height);
  const quantity = cleanAmount(item.quantity);
  const unitPrice = cleanAmount(item.unitPrice);
  const totalIsManual = item.totalIsManual === true;
  const base = {
    id: typeof item.id === "string" && item.id.length > 0 && item.id.length <= 100 ? item.id : uid("item"),
    name: text(item.name),
    width,
    height,
    sqf: calculateSqf(width, height),
    quantity,
    unitPrice,
    total: roundToInteger(cleanAmount(item.total)),
    totalIsManual
  };

  return { ...base, total: totalIsManual ? base.total : calculateLineTotal(base) };
}

/**
 * Coerces anything (old localStorage data, a cloud row, a request body) into a well-formed InvoiceData:
 * unknown keys are dropped, strings are capped, numbers are made finite and non-negative, and line totals
 * are recomputed unless they were entered manually.
 */
export function sanitizeInvoiceData(raw: unknown): InvoiceData {
  const invoice = record(raw);
  const company = record(invoice.company);
  const customer = record(invoice.customer);
  const settings = record(invoice.settings);
  const items = Array.isArray(invoice.items) ? invoice.items.slice(0, MAX_STORED_ITEMS).map(sanitizeItem) : [];
  const updatedAt = typeof invoice.updatedAt === "string" && Number.isFinite(Date.parse(invoice.updatedAt)) ? invoice.updatedAt : new Date(0).toISOString();

  return {
    company: {
      name: text(company.name),
      logo: imageDataUrl(company.logo),
      address: text(company.address),
      phone: text(company.phone),
      email: text(company.email),
      website: text(company.website)
    },
    customer: {
      name: text(customer.name),
      address: text(customer.address),
      phone: text(customer.phone),
      invoiceNumber: text(customer.invoiceNumber, 100),
      date: formatInvoiceDate(text(customer.date, 40))
    },
    items,
    advance: cleanAmount(invoice.advance),
    discount: cleanAmount(invoice.discount),
    taxRate: Math.min(cleanAmount(invoice.taxRate), 100),
    notes: text(invoice.notes, MAX_LONG_TEXT),
    terms: text(invoice.terms, MAX_LONG_TEXT),
    signature: imageDataUrl(invoice.signature),
    settings: {
      currency: (typeof settings.currency === "string" && settings.currency in currencySymbols ? settings.currency : "BDT") as CurrencyCode,
      status: oneOf(settings.status, STATUSES, "draft"),
      theme: oneOf(settings.theme, THEMES, "red-black"),
      language: oneOf(settings.language, LANGUAGES, "english"),
      darkMode: settings.darkMode === true,
      watermark: text(settings.watermark, 100)
    },
    updatedAt
  };
}

export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceValidationError";
  }
}

/** Validates a SavedInvoice request body. Throws InvoiceValidationError with a user-safe message. */
export function parseSavedInvoice(raw: unknown): SavedInvoice {
  const body = record(raw);

  if (typeof body.id !== "string" || !SAVED_INVOICE_ID_PATTERN.test(body.id)) {
    throw new InvoiceValidationError("Invalid invoice id.");
  }

  if (!body.invoice || typeof body.invoice !== "object" || Array.isArray(body.invoice)) {
    throw new InvoiceValidationError("Missing invoice data.");
  }

  if (Array.isArray(record(body.invoice).items) && (record(body.invoice).items as unknown[]).length > MAX_STORED_ITEMS) {
    throw new InvoiceValidationError(`An invoice can have at most ${MAX_STORED_ITEMS} items.`);
  }

  const invoice = sanitizeInvoiceData(body.invoice);
  const name = text(body.name, 200).trim() || invoice.customer.name.trim() || "Untitled Invoice";
  const savedAt = typeof body.savedAt === "string" && Number.isFinite(Date.parse(body.savedAt)) ? body.savedAt : new Date().toISOString();

  return { id: body.id, name, savedAt, invoice };
}
