import { InvoiceValidationError, parseSavedInvoice } from "@/lib/invoice-normalize";
import type { InvoiceData, SavedInvoice } from "@/types/invoice";

/**
 * Wire format of POST /api/v1/sync/save, shared by the browser sync manager and the route handler.
 *
 * `changes` carries the full invoice snapshot rather than a field diff: an invoice is small (well under the
 * 1 MB body cap), and a snapshot makes every retry idempotent and every save self-contained.
 */
export const SYNC_SAVE_PATH = "/api/v1/sync/save";
export const SYNC_ID_PATTERN = /^[A-Za-z0-9-]{8,100}$/;
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export const MAX_SYNC_BODY_BYTES = 1024 * 1024;
export const MAX_PRIOR_SYNC_IDS = 20;

export interface SyncSaveRequest {
  documentId: string;
  changes: { name: string; invoice: InvoiceData };
  /** When the user last edited this snapshot (client clock). */
  updatedAt: string;
  clientId: string;
  /** Idempotency key: the same snapshot is always retried with the same syncId. */
  syncId: string;
  /** Server version this edit was based on; null for an invoice that has never been stored. */
  baseVersion: number | null;
  /**
   * Earlier syncIds for this document whose outcome the client never learned (network dropped the response).
   * If those saves did land, the server counts the versions they created as the client's own, not a conflict.
   */
  priorSyncIds?: string[];
}

export interface SyncSaveSuccess {
  success: true;
  serverUpdatedAt: string;
  version: number;
  createdBy: string;
  /** True when the server had already applied this syncId (a retry of a save that went through). */
  duplicate: boolean;
  message: string;
}

export type SyncConflictReason = "stale" | "deleted" | "exists";

export interface SyncSaveFailure {
  success: false;
  message: string;
  conflict?: true;
  reason?: SyncConflictReason;
  serverVersion?: number | null;
  /** The newer server copy, when there is one, so the client can offer "use server copy". */
  server?: SavedInvoice;
  locked?: true;
  lockedBy?: string | null;
  configured?: false;
}

export type SyncSaveResponse = SyncSaveSuccess | SyncSaveFailure;

function fail(message: string): never {
  throw new InvoiceValidationError(message);
}

/** Validates and sanitizes a sync request body. Throws InvoiceValidationError with a user-safe message. */
export function parseSyncSaveRequest(raw: unknown): SyncSaveRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid sync request.");

  const body = raw as Record<string, unknown>;

  if (typeof body.syncId !== "string" || !SYNC_ID_PATTERN.test(body.syncId)) fail("Missing or invalid syncId.");
  if (typeof body.clientId !== "string" || !CLIENT_ID_PATTERN.test(body.clientId)) fail("Missing or invalid clientId.");

  const baseVersion = body.baseVersion ?? null;
  if (baseVersion !== null && !(typeof baseVersion === "number" && Number.isInteger(baseVersion) && baseVersion >= 0)) {
    fail("Invalid baseVersion.");
  }

  const priorSyncIds = body.priorSyncIds ?? [];
  if (
    !Array.isArray(priorSyncIds) ||
    priorSyncIds.length > MAX_PRIOR_SYNC_IDS ||
    !priorSyncIds.every((id) => typeof id === "string" && SYNC_ID_PATTERN.test(id))
  ) {
    fail("Invalid priorSyncIds.");
  }

  if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) fail("Missing or invalid updatedAt.");

  const changes = body.changes && typeof body.changes === "object" && !Array.isArray(body.changes) ? (body.changes as Record<string, unknown>) : fail("Missing changes.");
  const savedInvoice = parseSavedInvoice({ id: body.documentId, name: changes.name, invoice: changes.invoice });

  return {
    documentId: savedInvoice.id,
    changes: { name: savedInvoice.name, invoice: { ...savedInvoice.invoice, updatedAt: body.updatedAt } },
    updatedAt: body.updatedAt,
    clientId: body.clientId,
    syncId: body.syncId,
    baseVersion: baseVersion as number | null,
    priorSyncIds: priorSyncIds as string[]
  };
}
