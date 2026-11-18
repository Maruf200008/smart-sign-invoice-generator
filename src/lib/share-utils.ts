import { calculateTotals, currencySymbols, formatDecimal } from "@/lib/invoice-utils";
import type { InvoiceData } from "@/types/invoice";
import type { ShareExpiryPreset, SharedInvoice } from "@/types/share";

export const SHARE_TITLE = "Smart Sign Invoice";
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const EXPIRY_OPTIONS: Array<{ value: ShareExpiryPreset; label: string }> = [
  { value: "never", label: "Never expires" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom date" }
];

const PRESET_DURATION_MS: Record<Exclude<ShareExpiryPreset, "never" | "custom">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

/**
 * Turns an expiry preset into an absolute timestamp.
 * Returns `null` for "never", `undefined` when the input is invalid (custom date missing, in the past, or malformed).
 */
export function resolveExpiresAt(preset: ShareExpiryPreset, customExpiresAt?: string, now = Date.now()): string | null | undefined {
  if (preset === "never") {
    return null;
  }

  if (preset === "custom") {
    const time = customExpiresAt ? new Date(customExpiresAt).getTime() : Number.NaN;
    return Number.isFinite(time) && time > now ? new Date(time).toISOString() : undefined;
  }

  const duration = PRESET_DURATION_MS[preset];
  return duration ? new Date(now + duration).toISOString() : undefined;
}

export function isShareExpired(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) {
    return false;
  }

  const time = new Date(expiresAt).getTime();
  return !Number.isFinite(time) || time <= now;
}

/** Best-effort inverse of `resolveExpiresAt`, used to pre-select the dropdown for an existing share. */
export function inferExpiryPreset(share: { expiresAt: string | null; createdAt: string }): ShareExpiryPreset {
  if (!share.expiresAt) {
    return "never";
  }

  const lifetime = new Date(share.expiresAt).getTime() - new Date(share.createdAt).getTime();
  const tolerance = 5 * 60 * 1000;
  const match = (Object.entries(PRESET_DURATION_MS) as Array<[keyof typeof PRESET_DURATION_MS, number]>).find(
    ([, duration]) => Math.abs(lifetime - duration) <= tolerance
  );

  return match?.[0] ?? "custom";
}

/** Converts a `<input type="date">` value (yyyy-mm-dd) to the end of that local day, as an ISO string. */
export function endOfLocalDayIso(dateInputValue: string) {
  const [year, month, day] = dateInputValue.split("-").map(Number);

  if (!year || !month || !day) {
    return undefined;
  }

  return new Date(year, month - 1, day, 23, 59, 59).toISOString();
}

export function toLocalDateInputValue(iso: string | null, fallback = new Date()) {
  const date = iso ? new Date(iso) : fallback;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) {
    return "Never expires";
  }

  return `Expires ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(expiresAt))}`;
}

export function buildShareUrl(token: string, origin?: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const base = (configuredOrigin || origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");

  return `${base}/share/${encodeURIComponent(token)}`;
}

export interface ShareMessageInput {
  invoiceNumber: string;
  customerName: string;
  grandTotal: string;
  url: string;
}

/** Amount formatted for chat messages, e.g. "৳ 52,500". */
export function formatShareAmount(invoice: Pick<InvoiceData, "items" | "discount" | "taxRate" | "advance" | "settings">) {
  const { grandTotal } = calculateTotals(invoice);
  return `${currencySymbols[invoice.settings.currency]} ${formatDecimal(grandTotal)}`;
}

export function formatSharedAmount(invoice: SharedInvoice) {
  const { grandTotal } = calculateTotals(invoice);
  return `${currencySymbols[invoice.currency]} ${formatDecimal(grandTotal)}`;
}

/** The detailed message used for WhatsApp (and the native share sheet, minus the URL). */
export function buildDetailedMessage({ invoiceNumber, customerName, grandTotal, url }: ShareMessageInput) {
  return [
    SHARE_TITLE,
    "",
    `Invoice #${invoiceNumber}`,
    "",
    "Customer:",
    customerName || "-",
    "",
    "Grand Total:",
    grandTotal,
    "",
    "View Invoice:",
    url
  ].join("\n");
}

export function buildEmailBody(url: string) {
  return ["Please find the invoice below.", "", "Invoice:", url].join("\n");
}

export type ShareTargetId = "whatsapp" | "facebook" | "messenger" | "telegram" | "email" | "x" | "linkedin";

/**
 * Builds the outbound URL for each link-based share target.
 * `encodeURIComponent` is used everywhere (not URLSearchParams) so spaces become %20, which mailto: requires.
 */
export function buildShareTargetUrl(target: Exclude<ShareTargetId, "messenger">, input: ShareMessageInput) {
  const url = encodeURIComponent(input.url);
  const shortText = encodeURIComponent(`${SHARE_TITLE} #${input.invoiceNumber}`);

  switch (target) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(buildDetailedMessage(input))}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case "telegram":
      return `https://t.me/share/url?url=${url}&text=${shortText}`;
    case "x":
      return `https://twitter.com/intent/tweet?url=${url}&text=${shortText}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(buildEmailBody(input.url))}`;
  }
}

/**
 * Messenger has no public web share endpoint without a Facebook App ID.
 * - Mobile: `fb-messenger://` deep link opens the app directly.
 * - Desktop with NEXT_PUBLIC_FACEBOOK_APP_ID: Facebook's send dialog.
 * - Otherwise: `null`, and the caller falls back to copying the link.
 */
export function buildMessengerUrl(url: string, isMobile: boolean, origin: string) {
  if (isMobile) {
    return `fb-messenger://share/?link=${encodeURIComponent(url)}`;
  }

  const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;

  if (!appId) {
    return null;
  }

  return `https://www.facebook.com/dialog/send?app_id=${encodeURIComponent(appId)}&link=${encodeURIComponent(url)}&redirect_uri=${encodeURIComponent(origin)}`;
}

export function isMobileDevice() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path (permission denied, or focus lost on iOS).
    }
  }

  // Legacy fallback for non-secure contexts and older Safari.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
