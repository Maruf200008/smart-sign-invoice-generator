import type { CurrencyCode } from "@/types/invoice";

/** Expiry presets offered in the share modal. */
export type ShareExpiryPreset = "never" | "24h" | "7d" | "30d" | "custom";

/** Share settings visible to the owner. Never contains database ids or user ids. */
export interface ShareSettings {
  token: string;
  isEnabled: boolean;
  /** ISO timestamp, or null when the link never expires. */
  expiresAt: string | null;
  createdAt: string;
  createdBy: string;
}

/** Request body for creating/updating a share link. */
export interface ShareUpsertInput {
  invoiceId: string;
  expiry?: ShareExpiryPreset;
  /** ISO timestamp, required when `expiry` is "custom". */
  customExpiresAt?: string;
  isEnabled?: boolean;
  /** Issue a brand new token, invalidating the old link. */
  regenerate?: boolean;
}

/** Item fields that are safe to publish. Intentionally has no internal row id. */
export interface SharedInvoiceItem {
  name: string;
  width: number;
  height: number;
  quantity: number;
  unitPrice: number;
  total: number;
  totalIsManual: boolean;
}

/** The only invoice data ever exposed by the public /share/[token] page. */
export interface SharedInvoice {
  customer: {
    name: string;
    invoiceNumber: string;
    date: string;
  };
  items: SharedInvoiceItem[];
  advance: number;
  discount: number;
  taxRate: number;
  currency: CurrencyCode;
}

export type PublicShareResult =
  | { status: "ok"; invoice: SharedInvoice; expiresAt: string | null }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "expired" }
  | { status: "unavailable" };
