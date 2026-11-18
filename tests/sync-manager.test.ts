import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleInvoice } from "@/lib/sample-invoice";
import { SyncManager, type SyncStorage, type SyncTransport, type SyncTransportResult, validateSnapshot } from "@/lib/sync/sync-manager";
import type { SyncSaveRequest } from "@/lib/sync/sync-protocol";
import type { SavedInvoice } from "@/types/invoice";

const CLIENT_ID = "device-aaaa-1111";

function snapshot(id: string, updatedAt: string, name = "Rahim"): SavedInvoice {
  const invoice = createSampleInvoice();
  invoice.customer.name = name;
  invoice.updatedAt = updatedAt;
  return { id, name, savedAt: updatedAt, invoice };
}

function ok(version: number, duplicate = false): SyncTransportResult {
  return {
    status: 200,
    body: { success: true, version, serverUpdatedAt: "2026-11-19T10:00:00.000Z", createdBy: "rahim", duplicate, message: "Saved successfully" }
  };
}

function memoryStorage(): SyncStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

/** A transport whose responses are scripted per call; every request is recorded. */
function scriptedTransport(...responses: Array<SyncTransportResult | Error | (() => Promise<SyncTransportResult>)>) {
  const requests: SyncSaveRequest[] = [];
  const transport: SyncTransport & { requests: SyncSaveRequest[] } = {
    requests,
    save: vi.fn(async (request: SyncSaveRequest) => {
      requests.push(structuredClone(request));
      const next = responses.length > 1 ? responses.shift()! : responses[0];
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next();
      return next;
    })
  };
  return transport;
}

let syncIdCounter = 0;
let online = true;

function createManager(transport: SyncTransport, extra: Partial<ConstructorParameters<typeof SyncManager>[0]> = {}) {
  return new SyncManager({
    transport,
    getClientId: () => CLIENT_ID,
    isOnline: () => online,
    newSyncId: () => `sync-id-${String(++syncIdCounter).padStart(4, "0")}`,
    retryDelaysMs: [1000, 5000],
    ...extra
  });
}

beforeEach(() => {
  syncIdCounter = 0;
  online = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dirty state", () => {
  it("does not touch the network when an edit is tracked (no per-keystroke saves)", () => {
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    manager.track(snapshot("a", "2026-11-19T10:00:01.000Z"));
    manager.track(snapshot("a", "2026-11-19T10:00:02.000Z"));

    expect(transport.save).not.toHaveBeenCalled();
    expect(manager.getStatus()).toMatchObject({ phase: "dirty", pendingCount: 1 });
  });

  it("ignores a snapshot the server already holds", () => {
    const manager = createManager(scriptedTransport(ok(1)));
    const stored = { ...snapshot("a", "2026-11-19T10:00:00.000Z"), version: 3 };

    manager.recordServerCopies([stored]);
    manager.track(stored);

    expect(manager.getStatus()).toMatchObject({ phase: "saved", pendingCount: 0 });
  });

  it("persists the queue so edits survive a reload", () => {
    const storage = memoryStorage();
    createManager(scriptedTransport(ok(1)), { storage }).track(snapshot("a", "2026-11-19T10:00:00.000Z"));

    const reloaded = createManager(scriptedTransport(ok(1)), { storage });

    expect(reloaded.isPending("a")).toBe(true);
    expect(reloaded.getStatus().phase).toBe("dirty");
  });

  it("survives corrupt or unavailable storage", () => {
    const storage = memoryStorage();
    storage.data.set("smart-sign-sync-queue", "{not json");
    const throwing: SyncStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };

    expect(() => createManager(scriptedTransport(ok(1)), { storage })).not.toThrow();
    const manager = createManager(scriptedTransport(ok(1)), { storage: throwing });
    expect(() => manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"))).not.toThrow();
  });
});

describe("successful server sync", () => {
  it("sends the snapshot with its base version, then clears the queue only after the server confirms", async () => {
    let resolveSave!: (result: SyncTransportResult) => void;
    const transport = scriptedTransport(() => new Promise((resolve) => (resolveSave = resolve)));
    const onSaved = vi.fn();
    const manager = createManager(transport, { onSaved });

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const flushing = manager.flush();

    expect(manager.getStatus().phase).toBe("saving");
    expect(manager.isPending("a")).toBe(true);

    resolveSave(ok(4));
    await expect(flushing).resolves.toEqual({ status: "saved", count: 1 });

    expect(transport.requests[0]).toMatchObject({ documentId: "a", baseVersion: 3, clientId: CLIENT_ID, syncId: "sync-id-0001", updatedAt: "2026-11-19T10:00:00.000Z" });
    expect(manager.isPending("a")).toBe(false);
    expect(manager.getStatus()).toMatchObject({ phase: "saved", pendingCount: 0, error: null });
    expect(manager.getStatus().lastSavedAt).not.toBeNull();
    expect(onSaved).toHaveBeenCalledWith({ documentId: "a", version: 4, serverUpdatedAt: "2026-11-19T10:00:00.000Z", createdBy: "rahim" });
  });

  it("sends a never-stored invoice with a null base version (create)", async () => {
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("new-one", "2026-11-19T10:00:00.000Z"));
    await manager.flush();

    expect(transport.requests[0].baseVersion).toBeNull();
  });

  it("uses the confirmed version as the base of the next save", async () => {
    const transport = scriptedTransport(ok(1), ok(2));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    manager.track(snapshot("a", "2026-11-19T10:05:00.000Z"));
    await manager.flush();

    expect(transport.requests.map((request) => request.baseVersion)).toEqual([null, 1]);
  });

  it("keeps an edit made while a save was in flight, based on the new version", async () => {
    let resolveFirst!: (result: SyncTransportResult) => void;
    const transport = scriptedTransport(() => new Promise((resolve) => (resolveFirst = resolve)), ok(5));
    const manager = createManager(transport);

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const first = manager.flush();
    manager.track(snapshot("a", "2026-11-19T10:00:05.000Z", "Edited mid-flight"));
    resolveFirst(ok(4));
    await first;

    expect(manager.isPending("a")).toBe(true);
    await manager.flush();

    expect(transport.requests[1]).toMatchObject({ baseVersion: 4, updatedAt: "2026-11-19T10:00:05.000Z" });
    expect(transport.requests[1].syncId).not.toBe(transport.requests[0].syncId);
    expect(manager.isPending("a")).toBe(false);
  });

  it("reports nothing to save when the queue is empty", async () => {
    const transport = scriptedTransport(ok(1));
    await expect(createManager(transport).flush()).resolves.toEqual({ status: "nothing" });
    expect(transport.save).not.toHaveBeenCalled();
  });
});

describe("failed server sync", () => {
  it("keeps the change queued and surfaces the API error message", async () => {
    const transport = scriptedTransport({ status: 502, body: { success: false, message: "Cloud storage is unavailable right now. Please try again." } });
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();

    expect(outcome).toEqual({ status: "failed", error: { kind: "server", message: "Cloud storage is unavailable right now. Please try again." } });
    expect(manager.isPending("a")).toBe(true);
    expect(manager.getStatus()).toMatchObject({ phase: "error", error: { kind: "server" } });
  });

  it("detects network errors", async () => {
    const manager = createManager(scriptedTransport(new TypeError("Failed to fetch")));

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();

    expect(outcome).toMatchObject({ status: "failed", error: { kind: "network" } });
    expect(manager.isPending("a")).toBe(true);
  });

  it("does not auto-retry a request the server rejected as invalid", async () => {
    vi.useFakeTimers();
    const transport = scriptedTransport({ status: 400, body: { success: false, message: "Invalid invoice id." } });
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(outcome).toMatchObject({ status: "failed", error: { kind: "rejected", message: "Invalid invoice id." } });
    expect(transport.save).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().nextRetryAt).toBeNull();
  });

  it("validates the snapshot before sending anything", async () => {
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);
    const invalid = snapshot("bad,id", "2026-11-19T10:00:00.000Z");

    expect(validateSnapshot(invalid)).toMatch(/invalid id/);
    manager.track(invalid);
    const outcome = await manager.flush();

    expect(outcome).toMatchObject({ status: "failed", error: { kind: "rejected" } });
    expect(transport.save).not.toHaveBeenCalled();
  });

  it("stops and waits when the session expired", async () => {
    const onSessionExpired = vi.fn();
    const manager = createManager(scriptedTransport({ status: 401, body: { success: false, message: "Your session has expired." } }), { onSessionExpired });

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();

    expect(outcome).toMatchObject({ status: "failed", error: { kind: "auth" } });
    expect(onSessionExpired).toHaveBeenCalled();
    expect(manager.isPending("a")).toBe(true);
  });

  it("switches to device-only mode when the server has no cloud storage configured", async () => {
    const manager = createManager(scriptedTransport({ status: 503, body: { success: false, configured: false, message: "Cloud storage is not configured on the server." } }));

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();

    expect(manager.getStatus().phase).toBe("disabled");
    expect(manager.isPending("a")).toBe(true);
    await expect(manager.flush()).resolves.toEqual({ status: "disabled" });
  });
});

describe("offline mode", () => {
  it("does not attempt a request while offline and keeps the change", async () => {
    online = false;
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();

    expect(outcome).toMatchObject({ status: "failed", error: { kind: "offline" } });
    expect(transport.save).not.toHaveBeenCalled();
    expect(manager.getStatus()).toMatchObject({ phase: "error", pendingCount: 1, error: { kind: "offline" } });
  });

  it("syncs automatically when the connection returns", async () => {
    online = false;
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();

    online = true;
    manager.handleOnline();
    await vi.waitFor(() => expect(manager.getStatus().phase).toBe("saved"));

    expect(transport.save).toHaveBeenCalledTimes(1);
    expect(manager.isPending("a")).toBe(false);
  });

  it("treats a fetch that fails because the device went offline as offline", async () => {
    const transport = scriptedTransport(() => {
      online = false;
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));

    await expect(manager.flush()).resolves.toMatchObject({ status: "failed", error: { kind: "offline" } });
  });
});

describe("retry mechanism", () => {
  it("retries transient failures automatically with backoff, reusing the same syncId", async () => {
    vi.useFakeTimers();
    const transport = scriptedTransport(new TypeError("Failed to fetch"), { status: 503, body: { success: false, message: "down" } }, ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    expect(manager.getStatus().nextRetryAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4999);
    expect(transport.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.save).toHaveBeenCalledTimes(3);

    expect(new Set(transport.requests.map((request) => request.syncId)).size).toBe(1);
    expect(manager.getStatus()).toMatchObject({ phase: "saved", nextRetryAt: null });
  });

  it("lets the user retry immediately", async () => {
    vi.useFakeTimers();
    const transport = scriptedTransport(new TypeError("Failed to fetch"), ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    await expect(manager.retry()).resolves.toEqual({ status: "saved", count: 1 });
    expect(manager.getStatus().nextRetryAt).toBeNull();
  });

  it("auto-saves on the interval only while there are queued edits", async () => {
    vi.useFakeTimers();
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);
    manager.startAutoSave(30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.save).not.toHaveBeenCalled();

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.save).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("re-sends an unconfirmed syncId on a new edit so the server can tell its own versions apart from a conflict", async () => {
    const transport = scriptedTransport(new TypeError("Failed to fetch"), ok(5));
    const manager = createManager(transport);

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    manager.track(snapshot("a", "2026-11-19T10:01:00.000Z"));
    await manager.retry();

    expect(transport.requests[1]).toMatchObject({ baseVersion: 3, priorSyncIds: [transport.requests[0].syncId] });
    expect(manager.isPending("a")).toBe(false);
  });
});

describe("conflict handling", () => {
  function conflictResponse(serverVersion: number, server?: SavedInvoice): SyncTransportResult {
    return { status: 409, body: { success: false, conflict: true, reason: "stale", serverVersion, server, message: "Newer version exists on server" } };
  }

  it("reports a conflict, keeps the local edit and stops auto-saving it", async () => {
    vi.useFakeTimers();
    const server = { ...snapshot("a", "2026-11-19T10:30:00.000Z", "Edited elsewhere"), version: 5 };
    const transport = scriptedTransport(conflictResponse(5, server));
    const manager = createManager(transport);
    manager.startAutoSave(1000);

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const outcome = await manager.flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(outcome).toMatchObject({ status: "conflict", conflict: { documentId: "a", serverVersion: 5, message: "Newer version exists on server" } });
    expect(manager.getStatus()).toMatchObject({ phase: "conflict" });
    expect(manager.isPending("a")).toBe(true);
    expect(transport.save).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("does not let a cloud poll move the base version of a pending edit (no silent overwrite)", async () => {
    const transport = scriptedTransport(ok(4));
    const manager = createManager(transport);

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T10:30:00.000Z"), version: 9 }]);
    await manager.flush();

    expect(transport.requests[0].baseVersion).toBe(3);
  });

  it("'keep mine' re-bases on the server version and saves", async () => {
    const transport = scriptedTransport(conflictResponse(5), ok(6));
    const manager = createManager(transport);

    manager.recordServerCopies([{ ...snapshot("a", "2026-11-19T09:00:00.000Z"), version: 3 }]);
    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    await manager.resolveConflict("a", "keep-local");

    expect(transport.requests[1]).toMatchObject({ baseVersion: 5, updatedAt: "2026-11-19T10:00:00.000Z" });
    expect(manager.getStatus()).toMatchObject({ phase: "saved", conflict: null });
  });

  it("'use server copy' drops the local edit and returns the server copy", async () => {
    const server = { ...snapshot("a", "2026-11-19T10:30:00.000Z", "Edited elsewhere"), version: 5 };
    const manager = createManager(scriptedTransport(conflictResponse(5, server)));

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    const chosen = await manager.resolveConflict("a", "use-server");

    expect(chosen?.invoice.customer.name).toBe("Edited elsewhere");
    expect(manager.isPending("a")).toBe(false);
    // The server copy is now the known version: tracking it is not a new edit.
    manager.track(server);
    expect(manager.getStatus()).toMatchObject({ phase: "saved", pendingCount: 0 });
  });

  it("reports a still-open conflict on a later Ctrl+S instead of 'nothing to save'", async () => {
    const manager = createManager(scriptedTransport(conflictResponse(5)));

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();

    await expect(manager.flush()).resolves.toMatchObject({ status: "conflict" });
  });
});

describe("duplicate request prevention", () => {
  it("shares one in-flight save between concurrent flushes (e.g. Ctrl+S pressed twice)", async () => {
    let resolveSave!: (result: SyncTransportResult) => void;
    const transport = scriptedTransport(() => new Promise((resolve) => (resolveSave = resolve)));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    const first = manager.flush();
    const second = manager.flush();
    resolveSave(ok(1));

    await Promise.all([first, second]);
    expect(first).toBe(second);
    expect(transport.save).toHaveBeenCalledTimes(1);
  });

  it("re-sends the same syncId after an uncertain failure, and accepts the server's duplicate answer", async () => {
    const transport = scriptedTransport(new TypeError("Failed to fetch"), ok(4, true));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    await manager.flush();
    const outcome = await manager.retry();

    expect(transport.requests[0].syncId).toBe(transport.requests[1].syncId);
    expect(outcome).toEqual({ status: "saved", count: 1 });
    expect(manager.isPending("a")).toBe(false);
  });

  it("keeps the queue on page exit so a keepalive save that landed is deduplicated next time", async () => {
    const storage = memoryStorage();
    const exitTransport = scriptedTransport(ok(1));
    const manager = createManager(exitTransport, { storage });

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    manager.flushOnExit();

    expect(exitTransport.save).toHaveBeenCalledWith(expect.objectContaining({ syncId: "sync-id-0001" }), { keepalive: true });

    const nextSessionTransport = scriptedTransport(ok(1, true));
    const reloaded = createManager(nextSessionTransport, { storage });
    await reloaded.flush();

    expect(nextSessionTransport.requests[0].syncId).toBe("sync-id-0001");
    expect(reloaded.isPending("a")).toBe(false);
  });

  it("discards queued edits of a deleted invoice", async () => {
    const transport = scriptedTransport(ok(1));
    const manager = createManager(transport);

    manager.track(snapshot("a", "2026-11-19T10:00:00.000Z"));
    manager.discard("a");

    await expect(manager.flush()).resolves.toEqual({ status: "nothing" });
    expect(transport.save).not.toHaveBeenCalled();
  });
});
