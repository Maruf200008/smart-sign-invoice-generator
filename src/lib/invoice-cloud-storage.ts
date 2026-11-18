import { notifySessionExpired } from "@/lib/auth-client";
import type { SavedInvoice } from "@/types/invoice";

const CLIENT_ID_KEY = "smart-sign-client-id";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** Browsers cap keepalive request bodies at 64 KB; larger saves on page close would be dropped anyway. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

let memoryClientId = "";

/** Thrown when another device currently holds the edit lock for this invoice. */
export class InvoiceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceLockedError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

function randomId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // crypto.randomUUID only exists in secure contexts (HTTPS/localhost); getRandomValues works everywhere.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A random per-browser id, used only to tell this device's edit lock apart from others. */
export function getInvoiceClientId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const existingId = window.localStorage.getItem(CLIENT_ID_KEY);

    if (existingId && CLIENT_ID_PATTERN.test(existingId)) {
      return existingId;
    }

    const id = randomId();
    window.localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    memoryClientId ||= randomId();
    return memoryClientId;
  }
}

function headers(json = false): HeadersInit {
  return {
    "Cache-Control": "no-cache",
    "x-smart-sign-client-id": getInvoiceClientId(),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; locked?: boolean };

  if (response.status === 401) {
    notifySessionExpired();
    throw new SessionExpiredError();
  }

  if (response.status === 409 && data.locked) {
    throw new InvoiceLockedError(data.error || "This invoice is open on another device right now.");
  }

  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data;
}

export async function loadCloudInvoices() {
  const response = await fetch("/api/invoices", { cache: "no-store", credentials: "same-origin", headers: headers() });
  return parseResponse<{ configured: boolean; invoices: SavedInvoice[] }>(response, "Unable to load cloud invoices.");
}

export async function saveCloudInvoice(savedInvoice: SavedInvoice) {
  const response = await fetch("/api/invoices", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: headers(true),
    body: JSON.stringify(savedInvoice)
  });

  return parseResponse<{ configured: boolean; savedAt?: string; createdBy?: string }>(response, "Unable to save cloud invoice.");
}

/** Best-effort save while the page is closing. Returns false when the payload is too big for a keepalive request. */
export function saveCloudInvoiceBeforeUnload(savedInvoice: SavedInvoice) {
  const body = JSON.stringify(savedInvoice);

  if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) {
    return false;
  }

  void fetch("/api/invoices", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
    headers: headers(true),
    body
  }).catch(() => {
    // The browser may cancel keepalive requests during shutdown.
  });

  return true;
}

export async function touchCloudInvoiceLock(id: string) {
  const response = await fetch("/api/invoices", {
    method: "PATCH",
    cache: "no-store",
    credentials: "same-origin",
    headers: headers(true),
    body: JSON.stringify({ id })
  });

  return parseResponse<{ configured: boolean; locked?: boolean; lockedBy?: string | null }>(response, "Unable to lock invoice.");
}

/** Gives up this device's edit lock so another device can edit immediately instead of waiting for it to lapse. */
export function releaseCloudInvoiceLock(id: string) {
  void fetch("/api/invoices", {
    method: "PATCH",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
    headers: headers(true),
    body: JSON.stringify({ id, release: true })
  }).catch(() => undefined);
}

export async function deleteCloudInvoice(id: string) {
  const response = await fetch(`/api/invoices?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: headers()
  });

  return parseResponse<{ configured: boolean }>(response, "Unable to delete cloud invoice.");
}
