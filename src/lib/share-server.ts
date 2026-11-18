import "server-only";

import { randomBytes } from "crypto";
import { currencySymbols, safeNumber } from "@/lib/invoice-utils";
import { isShareExpired, resolveExpiresAt, SHARE_TOKEN_PATTERN } from "@/lib/share-utils";
import { isSupabaseServiceConfigured, SupabaseRequestError, supabaseServiceRequest } from "@/lib/supabase-rest";
import type { CurrencyCode } from "@/types/invoice";
import type { PublicShareResult, ShareExpiryPreset, SharedInvoice, ShareSettings, ShareUpsertInput } from "@/types/share";

const SHARES_TABLE = "smart_sign_invoice_shares";
const INVOICES_TABLE = "smart_sign_invoices";
const DEFAULT_EXPIRY: ShareExpiryPreset = "7d";
const VALID_EXPIRY: ShareExpiryPreset[] = ["never", "24h", "7d", "30d", "custom"];
const MAX_SHARED_ITEMS = 50;
const POSTGRES_UNIQUE_VIOLATION = "23505";

interface ShareRow {
  id: string;
  share_token: string;
  invoice_id: string;
  created_by: string;
  is_enabled: boolean;
  expires_at: string | null;
  created_at: string;
}

/** Errors that carry an HTTP status and a message that is safe to show to the caller. */
export class ShareError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ShareError";
  }
}

export { isSupabaseServiceConfigured as isShareStorageConfigured };

/** 128 bits of entropy, URL-safe, 22 characters. */
export function generateShareToken() {
  return randomBytes(16).toString("base64url");
}

/** Strips database ids so the owner-facing settings object can't leak internals. */
function rowToSettings(row: ShareRow): ShareSettings {
  return {
    token: row.share_token,
    isEnabled: row.is_enabled,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

async function findShareByInvoiceId(invoiceId: string) {
  const rows = await supabaseServiceRequest<ShareRow[]>(`${SHARES_TABLE}?invoice_id=eq.${encodeURIComponent(invoiceId)}&limit=1`);
  return rows?.[0] ?? null;
}

async function findShareByToken(token: string) {
  const rows = await supabaseServiceRequest<ShareRow[]>(`${SHARES_TABLE}?share_token=eq.${encodeURIComponent(token)}&limit=1`);
  return rows?.[0] ?? null;
}

function assertOwner(row: ShareRow, username: string) {
  if (row.created_by !== username) {
    throw new ShareError("Only the user who created this share link can manage it.", 403);
  }
}

function validateInput(rawInput: Partial<ShareUpsertInput> | null): ShareUpsertInput {
  const input: Partial<ShareUpsertInput> = rawInput && typeof rawInput === "object" ? rawInput : {};
  const invoiceId = typeof input.invoiceId === "string" ? input.invoiceId.trim() : "";

  if (!invoiceId || invoiceId.length > 200) {
    throw new ShareError("Missing invoice id.", 400);
  }

  if (input.expiry !== undefined && !VALID_EXPIRY.includes(input.expiry)) {
    throw new ShareError("Invalid expiry option.", 400);
  }

  if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") {
    throw new ShareError("Invalid enabled flag.", 400);
  }

  return {
    invoiceId,
    expiry: input.expiry,
    customExpiresAt: typeof input.customExpiresAt === "string" ? input.customExpiresAt.slice(0, 64) : undefined,
    isEnabled: input.isEnabled,
    regenerate: input.regenerate === true
  };
}

function expiryToTimestamp(input: ShareUpsertInput, fallback: ShareExpiryPreset | null) {
  const preset = input.expiry ?? fallback;

  if (!preset) {
    return undefined;
  }

  const expiresAt = resolveExpiresAt(preset, input.customExpiresAt);

  if (expiresAt === undefined) {
    throw new ShareError("Pick an expiry date in the future.", 400);
  }

  return expiresAt;
}

export async function getShareForOwner(invoiceId: string, username: string) {
  const row = await findShareByInvoiceId(invoiceId);

  if (!row) {
    return null;
  }

  assertOwner(row, username);
  return rowToSettings(row);
}

/**
 * Creates a share for an invoice, or updates the existing one.
 * One invoice has at most one share row, so repeated "Share" clicks reuse the same link.
 */
export async function upsertShare(rawInput: Partial<ShareUpsertInput>, username: string, options: { createIfMissing: boolean }) {
  const input = validateInput(rawInput);
  const existing = await findShareByInvoiceId(input.invoiceId);

  if (existing) {
    assertOwner(existing, username);
    return rowToSettings(await updateShare(existing, input));
  }

  if (!options.createIfMissing) {
    throw new ShareError("This invoice has no share link yet.", 404);
  }

  const invoiceRows = await supabaseServiceRequest<Array<{ id: string }>>(
    `${INVOICES_TABLE}?id=eq.${encodeURIComponent(input.invoiceId)}&select=id&limit=1`
  );

  if (!invoiceRows?.length) {
    throw new ShareError("Save this invoice to the cloud before sharing it.", 404);
  }

  const expiresAt = expiryToTimestamp(input, DEFAULT_EXPIRY);

  try {
    const rows = await supabaseServiceRequest<ShareRow[]>(SHARES_TABLE, {
      method: "POST",
      body: JSON.stringify({
        share_token: generateShareToken(),
        invoice_id: input.invoiceId,
        created_by: username,
        is_enabled: input.isEnabled ?? true,
        expires_at: expiresAt ?? null
      })
    });
    const created = rows?.[0];

    if (!created) {
      throw new ShareError("Unable to create share link.", 500);
    }

    return rowToSettings(created);
  } catch (error) {
    // Two tabs clicking Share at once: the unique(invoice_id) constraint makes the loser re-read the winner's row.
    if (error instanceof SupabaseRequestError && error.message.includes(POSTGRES_UNIQUE_VIOLATION)) {
      const winner = await findShareByInvoiceId(input.invoiceId);

      if (winner) {
        assertOwner(winner, username);
        return rowToSettings(winner);
      }
    }

    throw error;
  }
}

async function updateShare(existing: ShareRow, input: ShareUpsertInput) {
  const patch: Record<string, unknown> = {};

  if (input.regenerate) {
    patch.share_token = generateShareToken();
  }

  if (input.expiry) {
    patch.expires_at = expiryToTimestamp(input, null);
  }

  if (input.isEnabled !== undefined) {
    patch.is_enabled = input.isEnabled;
  }

  if (Object.keys(patch).length === 0) {
    return existing;
  }

  const rows = await supabaseServiceRequest<ShareRow[]>(`${SHARES_TABLE}?id=eq.${encodeURIComponent(existing.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });

  return rows?.[0] ?? existing;
}

/**
 * Whitelist-based projection of a stored invoice. Anything not listed here (activeLock, client ids, company
 * block, notes, signature, customer phone/address, ...) is dropped, so new fields added to InvoiceData later
 * are private by default.
 */
export function toSharedInvoice(raw: unknown): SharedInvoice {
  const invoice = (raw ?? {}) as Record<string, unknown>;
  const customer = (invoice.customer ?? {}) as Record<string, unknown>;
  const settings = (invoice.settings ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(invoice.items) ? invoice.items.slice(0, MAX_SHARED_ITEMS) : [];
  const currency = (typeof settings.currency === "string" && settings.currency in currencySymbols ? settings.currency : "BDT") as CurrencyCode;

  return {
    customer: {
      name: cleanText(customer.name),
      invoiceNumber: cleanText(customer.invoiceNumber),
      date: cleanText(customer.date)
    },
    items: rawItems.map((rawItem) => {
      const item = (rawItem ?? {}) as Record<string, unknown>;

      return {
        name: cleanText(item.name),
        width: cleanNumber(item.width),
        height: cleanNumber(item.height),
        quantity: cleanNumber(item.quantity),
        unitPrice: cleanNumber(item.unitPrice),
        total: cleanNumber(item.total),
        totalIsManual: item.totalIsManual === true
      };
    }),
    advance: cleanNumber(invoice.advance),
    discount: cleanNumber(invoice.discount),
    taxRate: cleanNumber(invoice.taxRate),
    currency
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

function cleanNumber(value: unknown) {
  return Math.max(safeNumber(value), 0);
}

/** Resolves a public token to either the sanitized invoice or the reason it can't be shown. */
export async function resolvePublicShare(token: string): Promise<PublicShareResult> {
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    return { status: "not-found" };
  }

  if (!isSupabaseServiceConfigured()) {
    return { status: "unavailable" };
  }

  try {
    const share = await findShareByToken(token);

    if (!share) {
      return { status: "not-found" };
    }

    if (!share.is_enabled) {
      return { status: "disabled" };
    }

    if (isShareExpired(share.expires_at)) {
      return { status: "expired" };
    }

    const rows = await supabaseServiceRequest<Array<{ invoice: unknown }>>(
      `${INVOICES_TABLE}?id=eq.${encodeURIComponent(share.invoice_id)}&select=invoice&limit=1`
    );
    const invoice = rows?.[0]?.invoice;

    if (!invoice) {
      return { status: "not-found" };
    }

    return { status: "ok", invoice: toSharedInvoice(invoice), expiresAt: share.expires_at };
  } catch (error) {
    console.error("Unable to load shared invoice.", error instanceof Error ? error.message : error);
    return { status: "unavailable" };
  }
}
