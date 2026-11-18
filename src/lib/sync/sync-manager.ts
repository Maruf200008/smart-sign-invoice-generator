import { MAX_STORED_ITEMS, SAVED_INVOICE_ID_PATTERN } from "@/lib/invoice-normalize";
import {
  MAX_PRIOR_SYNC_IDS,
  MAX_SYNC_BODY_BYTES,
  type SyncConflictReason,
  type SyncSaveFailure,
  type SyncSaveRequest,
  type SyncSaveResponse,
  type SyncSaveSuccess
} from "@/lib/sync/sync-protocol";
import type { SavedInvoice } from "@/types/invoice";

/**
 * Client-side save queue for invoices.
 *
 * Edits only mark an invoice dirty (a local, persisted queue entry). Nothing goes to the server until
 * flush() runs — on Ctrl+S, on the auto-save interval, or when the page is left. A queue entry is removed
 * only after the server confirms that exact snapshot, so a failed or interrupted save never loses an edit.
 *
 * Idempotency: each snapshot gets one syncId, reused for every retry of that snapshot; the server answers a
 * replayed syncId from its receipt instead of saving twice. Optimistic locking: each save carries the server
 * version it was based on; a stale base is answered with a conflict the user resolves.
 */

export interface SyncTransportResult {
  status: number;
  body: SyncSaveResponse;
}

export interface SyncTransport {
  /** Must throw (e.g. TypeError from fetch) when the request could not complete at all. */
  save(request: SyncSaveRequest, options?: { keepalive?: boolean }): Promise<SyncTransportResult>;
}

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SyncErrorKind = "network" | "offline" | "server" | "rejected" | "locked" | "auth";

export interface SyncError {
  kind: SyncErrorKind;
  message: string;
}

export interface SyncConflict {
  documentId: string;
  reason: SyncConflictReason;
  serverVersion: number | null;
  server?: SavedInvoice;
  message: string;
}

export type SyncPhase = "disabled" | "saved" | "dirty" | "saving" | "error" | "conflict";

export interface SyncStatus {
  phase: SyncPhase;
  pendingCount: number;
  lastSavedAt: number | null;
  error: SyncError | null;
  conflict: SyncConflict | null;
  /** When the next automatic retry is scheduled (epoch ms), if any. */
  nextRetryAt: number | null;
}

export type FlushOutcome =
  | { status: "saved"; count: number }
  | { status: "nothing" }
  | { status: "disabled" }
  | { status: "failed"; error: SyncError }
  | { status: "conflict"; conflict: SyncConflict };

export interface SavedConfirmation {
  documentId: string;
  version: number;
  serverUpdatedAt: string;
  createdBy: string;
}

interface QueueEntry {
  documentId: string;
  syncId: string;
  snapshot: SavedInvoice;
  queuedAt: number;
  attempts: number;
  /** The current syncId has been sent and no definitive answer came back yet. */
  sent: boolean;
  /** Earlier syncIds of this document that may or may not have been applied by the server. */
  unconfirmed: string[];
  conflict?: SyncConflict;
}

interface KnownVersion {
  version: number;
  updatedAt: string;
}

interface PersistedState {
  v: 1;
  queue: QueueEntry[];
  known: Array<[string, KnownVersion]>;
}

export interface SyncManagerOptions {
  transport: SyncTransport;
  getClientId: () => string;
  storage?: SyncStorage | null;
  storageKey?: string;
  isOnline?: () => boolean;
  now?: () => number;
  newSyncId?: () => string;
  /** Delays between automatic retries after a transient failure; the last one repeats. */
  retryDelaysMs?: number[];
  onSaved?: (confirmation: SavedConfirmation) => void;
  onSessionExpired?: () => void;
}

export const DEFAULT_SYNC_STORAGE_KEY = "smart-sign-sync-queue";
export const DEFAULT_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];
/** keepalive request bodies are capped at 64 KB by browsers. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;
const LOCKED_RETRY_MS = 15_000;

export function createSyncId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function byteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

/** Client-side validation before anything is sent. Returns a user-facing message, or null when valid. */
export function validateSnapshot(snapshot: SavedInvoice): string | null {
  if (!SAVED_INVOICE_ID_PATTERN.test(snapshot.id)) return "This invoice has an invalid id and can't be saved.";
  if (!snapshot.invoice || typeof snapshot.invoice !== "object") return "This invoice has no data to save.";
  if (!Number.isFinite(Date.parse(snapshot.invoice.updatedAt))) return "This invoice has an invalid edit time.";
  if (snapshot.invoice.items.length > MAX_STORED_ITEMS) return `An invoice can have at most ${MAX_STORED_ITEMS} items.`;
  if (byteLength(JSON.stringify(snapshot.invoice)) > MAX_SYNC_BODY_BYTES - 16 * 1024) return "This invoice is too large to save to the server.";
  return null;
}

function sameContent(a: SavedInvoice, b: SavedInvoice) {
  return a.invoice.updatedAt === b.invoice.updatedAt && a.name === b.name;
}

export class SyncManager {
  private readonly options: Required<Omit<SyncManagerOptions, "storage" | "onSaved" | "onSessionExpired">> &
    Pick<SyncManagerOptions, "storage" | "onSaved" | "onSessionExpired">;
  private queue = new Map<string, QueueEntry>();
  private known = new Map<string, KnownVersion>();
  private listeners = new Set<() => void>();
  private enabled = true;
  private flushing: Promise<FlushOutcome> | null = null;
  private flushAgain = false;
  private lastError: SyncError | null = null;
  private lastSavedAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private nextRetryAt: number | null = null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private status: SyncStatus;

  constructor(options: SyncManagerOptions) {
    this.options = {
      storageKey: DEFAULT_SYNC_STORAGE_KEY,
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      now: Date.now,
      newSyncId: createSyncId,
      retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
      ...options
    };
    this.restore();
    this.status = this.computeStatus();
  }

  // ---------------------------------------------------------------------------------------------
  // Observing
  // ---------------------------------------------------------------------------------------------

  /** Stable snapshot for useSyncExternalStore: a new object only when something changed. */
  getStatus = () => this.status;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isPending(documentId: string) {
    return this.queue.has(documentId);
  }

  pendingIds() {
    return new Set(this.queue.keys());
  }

  // ---------------------------------------------------------------------------------------------
  // Recording state
  // ---------------------------------------------------------------------------------------------

  /** Turns server syncing on or off (off = cloud storage isn't configured; edits stay queued locally). */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.emit();
  }

  /**
   * Records the versions the server currently holds. Documents with queued edits are skipped on purpose:
   * their base version must stay the one the edit started from, or a newer server copy would be overwritten.
   */
  recordServerCopies(savedInvoices: SavedInvoice[]) {
    const seen = new Set<string>();

    for (const savedInvoice of savedInvoices) {
      seen.add(savedInvoice.id);

      if (!this.queue.has(savedInvoice.id) && typeof savedInvoice.version === "number") {
        this.known.set(savedInvoice.id, { version: savedInvoice.version, updatedAt: savedInvoice.invoice.updatedAt });
      }
    }

    for (const id of this.known.keys()) {
      if (!seen.has(id) && !this.queue.has(id)) this.known.delete(id);
    }

    this.persist();
  }

  /**
   * Marks an invoice dirty if it differs from what the server is known to hold. Cheap and local: call it on
   * every edit. A changed snapshot gets a fresh syncId; the old one is remembered as "unconfirmed" if it was
   * ever sent, so the server can recognise versions it produced as this client's own.
   */
  track(snapshot: SavedInvoice) {
    const entry = this.queue.get(snapshot.id);

    if (entry) {
      if (sameContent(entry.snapshot, snapshot)) return;

      if (entry.sent) {
        entry.unconfirmed = [...entry.unconfirmed, entry.syncId].slice(-MAX_PRIOR_SYNC_IDS);
      }

      entry.snapshot = snapshot;
      entry.syncId = this.options.newSyncId();
      entry.sent = false;
      entry.attempts = 0;
    } else {
      if (this.known.get(snapshot.id)?.updatedAt === snapshot.invoice.updatedAt) return;

      this.queue.set(snapshot.id, {
        documentId: snapshot.id,
        syncId: this.options.newSyncId(),
        snapshot,
        queuedAt: this.options.now(),
        attempts: 0,
        sent: false,
        unconfirmed: []
      });
    }

    this.persist();
    this.emit();
  }

  /** Drops queued edits for an invoice (it was deleted). */
  discard(documentId: string) {
    this.queue.delete(documentId);
    this.known.delete(documentId);
    this.persist();
    this.emit();
  }

  // ---------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------

  /**
   * Sends every queued edit to the server. Concurrent calls share one run (no duplicate requests); a call
   * made while a run is in progress makes it go round once more, so edits made meanwhile are included.
   */
  flush(): Promise<FlushOutcome> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }

    this.clearRetry();
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
      this.emit();
    });
    this.emit();
    return this.flushing;
  }

  /** User-initiated retry: forgets the backoff and saves now. */
  retry() {
    this.retryAttempt = 0;
    return this.flush();
  }

  /** The browser came back online. */
  handleOnline() {
    if (this.queue.size > 0) void this.retry();
  }

  /** Starts periodic auto-save; only does anything while there are queued edits. */
  startAutoSave(intervalMs: number) {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(() => {
      // Rejected/auth failures need the user (fix the data, sign in); don't hammer the server with them.
      const needsUser = this.lastError?.kind === "rejected" || this.lastError?.kind === "auth";
      if (this.queue.size > 0 && !this.flushing && !this.retryTimer && !needsUser && !this.hasConflict()) void this.flush();
    }, intervalMs);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  /**
   * Best-effort save while the page is closing (keepalive requests outlive the page). The queue is kept:
   * if the request lands, the next session's retry of the same syncId is answered as a duplicate.
   */
  flushOnExit() {
    if (!this.enabled) return;

    for (const entry of this.queue.values()) {
      if (entry.conflict || validateSnapshot(entry.snapshot)) continue;

      const request = this.buildRequest(entry);
      if (byteLength(JSON.stringify(request)) > KEEPALIVE_MAX_BYTES) continue;

      entry.sent = true;
      void this.options.transport.save(request, { keepalive: true }).catch(() => undefined);
    }

    this.persist();
  }

  /**
   * Resolves a version conflict. "keep-local" re-bases the local edit on the server's current version and
   * saves it (overwriting the other copy). "use-server" drops the local edit and returns the server copy
   * (or null when the server copy was deleted), which the caller puts into the editor.
   */
  async resolveConflict(documentId: string, choice: "keep-local" | "use-server"): Promise<SavedInvoice | null> {
    const entry = this.queue.get(documentId);
    const conflict = entry?.conflict;

    if (!entry || !conflict) return null;

    if (choice === "use-server") {
      this.queue.delete(documentId);

      if (conflict.server && typeof conflict.serverVersion === "number") {
        this.known.set(documentId, { version: conflict.serverVersion, updatedAt: conflict.server.invoice.updatedAt });
      } else {
        this.known.delete(documentId);
      }

      this.lastError = null;
      this.persist();
      this.emit();
      return conflict.server ?? null;
    }

    if (typeof conflict.serverVersion === "number") {
      this.known.set(documentId, { version: conflict.serverVersion, updatedAt: conflict.server?.invoice.updatedAt ?? "" });
    } else {
      this.known.delete(documentId);
    }

    entry.conflict = undefined;
    entry.unconfirmed = [];
    entry.syncId = this.options.newSyncId();
    entry.sent = false;
    this.persist();
    this.emit();
    await this.flush();
    return null;
  }

  /** Stops timers. Subscribers are left alone (React unsubscribes them itself, also under StrictMode remounts). */
  dispose() {
    this.stopAutoSave();
    this.clearRetry();
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private hasConflict() {
    for (const entry of this.queue.values()) if (entry.conflict) return true;
    return false;
  }

  private async runFlush(): Promise<FlushOutcome> {
    let saved = 0;
    let outcome: FlushOutcome = { status: "nothing" };

    do {
      this.flushAgain = false;

      if (!this.enabled) return { status: "disabled" };

      const entries = [...this.queue.values()].filter((entry) => !entry.conflict);

      if (entries.length === 0) break;

      if (!this.options.isOnline()) {
        const error: SyncError = { kind: "offline", message: "You're offline; it will sync when the connection returns." };
        this.lastError = error;
        return { status: "failed", error };
      }

      for (const entry of entries) {
        const result = await this.sendEntry(entry);

        if (result === "saved") {
          saved += 1;
          continue;
        }

        if (result.status === "conflict") {
          outcome = result;
          continue;
        }

        // Transient or blocking failure: stop here, keep everything queued, retry later.
        this.lastError = result.error;
        this.scheduleRetry(result.error);
        return result;
      }
    } while (this.flushAgain);

    // A conflict left unresolved from an earlier save still blocks that invoice: report it, not "nothing to save".
    const openConflict = [...this.queue.values()].find((entry) => entry.conflict)?.conflict;
    if (outcome.status !== "conflict" && openConflict) outcome = { status: "conflict", conflict: openConflict };
    if (outcome.status === "conflict") {
      this.lastError = null;
      return outcome;
    }

    this.lastError = null;
    this.retryAttempt = 0;
    return saved > 0 ? { status: "saved", count: saved } : { status: "nothing" };
  }

  private buildRequest(entry: QueueEntry): SyncSaveRequest {
    return {
      documentId: entry.documentId,
      changes: { name: entry.snapshot.name, invoice: entry.snapshot.invoice },
      updatedAt: entry.snapshot.invoice.updatedAt,
      clientId: this.options.getClientId(),
      syncId: entry.syncId,
      baseVersion: this.known.get(entry.documentId)?.version ?? null,
      ...(entry.unconfirmed.length > 0 ? { priorSyncIds: entry.unconfirmed } : {})
    };
  }

  private async sendEntry(entry: QueueEntry): Promise<"saved" | Extract<FlushOutcome, { status: "failed" | "conflict" }>> {
    const invalid = validateSnapshot(entry.snapshot);

    if (invalid) {
      return { status: "failed", error: { kind: "rejected", message: invalid } };
    }

    const request = this.buildRequest(entry);
    const { syncId, snapshot } = entry;

    entry.sent = true;
    entry.attempts += 1;
    this.persist();

    let response: SyncTransportResult;

    try {
      response = await this.options.transport.save(request);
    } catch {
      // The request may or may not have reached the server; the syncId stays the same for the retry.
      return {
        status: "failed",
        error: this.options.isOnline()
          ? { kind: "network", message: "Can't reach the server." }
          : { kind: "offline", message: "You're offline; it will sync when the connection returns." }
      };
    }

    const { status, body } = response;

    if (body && body.success === true) {
      this.confirmSaved(entry.documentId, syncId, snapshot, body);
      return "saved";
    }

    const failure = (body ?? {}) as Partial<SyncSaveFailure>;
    const message = failure.message || `Save failed (HTTP ${status}).`;

    if (status === 409 && failure.conflict) {
      this.settleAttempt(entry.documentId, syncId);
      const conflict: SyncConflict = {
        documentId: entry.documentId,
        reason: failure.reason ?? "stale",
        serverVersion: failure.serverVersion ?? null,
        server: failure.server,
        message
      };
      const current = this.queue.get(entry.documentId);
      if (current) current.conflict = conflict;
      this.persist();
      return { status: "conflict", conflict };
    }

    if (failure.configured === false) {
      this.settleAttempt(entry.documentId, syncId);
      this.enabled = false;
      return { status: "failed", error: { kind: "server", message } };
    }

    if (status === 401) {
      this.settleAttempt(entry.documentId, syncId);
      this.options.onSessionExpired?.();
      return { status: "failed", error: { kind: "auth", message } };
    }

    if (status === 423 || failure.locked) {
      this.settleAttempt(entry.documentId, syncId);
      return { status: "failed", error: { kind: "locked", message } };
    }

    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      this.settleAttempt(entry.documentId, syncId);
      return { status: "failed", error: { kind: "rejected", message } };
    }

    // 5xx / 408 / 429: the outcome is uncertain, keep the syncId so the retry is idempotent.
    return { status: "failed", error: { kind: "server", message } };
  }

  /** A definitive "not applied" answer for syncId: it can no longer have produced a server version. */
  private settleAttempt(documentId: string, syncId: string) {
    const entry = this.queue.get(documentId);
    if (!entry) return;

    entry.unconfirmed = entry.unconfirmed.filter((id) => id !== syncId);
    if (entry.syncId === syncId) entry.sent = false;
    this.persist();
  }

  private confirmSaved(documentId: string, syncId: string, snapshot: SavedInvoice, body: SyncSaveSuccess) {
    this.known.set(documentId, { version: body.version, updatedAt: snapshot.invoice.updatedAt });

    const current = this.queue.get(documentId);

    if (current) {
      if (current.syncId === syncId) {
        this.queue.delete(documentId);
      } else {
        // Edited again while this save was in flight: the newer snapshot stays queued, based on the new version.
        current.unconfirmed = [];
      }
    }

    this.lastSavedAt = this.options.now();
    this.persist();
    this.options.onSaved?.({ documentId, version: body.version, serverUpdatedAt: body.serverUpdatedAt, createdBy: body.createdBy });
    this.emit();
  }

  private scheduleRetry(error: SyncError) {
    // Offline waits for the "online" event; rejected/auth/disabled need the user, not a timer.
    if (error.kind === "offline" || error.kind === "rejected" || error.kind === "auth" || !this.enabled) return;

    const delays = this.options.retryDelaysMs;
    const delay = error.kind === "locked" ? LOCKED_RETRY_MS : delays[Math.min(this.retryAttempt, delays.length - 1)];
    this.retryAttempt += 1;
    this.clearRetry();
    this.nextRetryAt = this.options.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.nextRetryAt = null;
      void this.flush();
    }, delay);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.nextRetryAt = null;
  }

  private computeStatus(): SyncStatus {
    const conflict = [...this.queue.values()].find((entry) => entry.conflict)?.conflict ?? null;
    const pendingCount = this.queue.size;
    let phase: SyncPhase;

    if (!this.enabled) phase = "disabled";
    else if (conflict) phase = "conflict";
    else if (this.flushing) phase = "saving";
    else if (this.lastError && pendingCount > 0) phase = "error";
    else if (pendingCount > 0) phase = "dirty";
    else phase = "saved";

    return {
      phase,
      pendingCount,
      lastSavedAt: this.lastSavedAt,
      error: phase === "error" || phase === "disabled" ? this.lastError : null,
      conflict,
      nextRetryAt: this.nextRetryAt
    };
  }

  private emit() {
    const next = this.computeStatus();
    const prev = this.status;

    if (
      prev &&
      prev.phase === next.phase &&
      prev.pendingCount === next.pendingCount &&
      prev.lastSavedAt === next.lastSavedAt &&
      prev.error === next.error &&
      prev.conflict === next.conflict &&
      prev.nextRetryAt === next.nextRetryAt
    ) {
      return;
    }

    this.status = next;
    for (const listener of this.listeners) listener();
  }

  private persist() {
    const storage = this.options.storage;
    if (!storage) return;

    const state: PersistedState = { v: 1, queue: [...this.queue.values()], known: [...this.known.entries()] };

    try {
      storage.setItem(this.options.storageKey, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the queue still lives in memory for this session.
    }
  }

  private restore() {
    const storage = this.options.storage;
    if (!storage) return;

    try {
      const raw = storage.getItem(this.options.storageKey);
      if (!raw) return;

      const state = JSON.parse(raw) as Partial<PersistedState>;
      if (state.v !== 1) return;

      for (const entry of Array.isArray(state.queue) ? state.queue : []) {
        if (entry && typeof entry.documentId === "string" && typeof entry.syncId === "string" && entry.snapshot?.invoice) {
          this.queue.set(entry.documentId, {
            ...entry,
            attempts: Number(entry.attempts) || 0,
            sent: entry.sent === true,
            unconfirmed: Array.isArray(entry.unconfirmed) ? entry.unconfirmed.filter((id) => typeof id === "string") : []
          });
        }
      }

      for (const pair of Array.isArray(state.known) ? state.known : []) {
        if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1]?.version === "number") {
          this.known.set(pair[0], pair[1]);
        }
      }
    } catch {
      // Corrupt storage: start with an empty queue (the invoices themselves are persisted separately).
    }
  }
}
