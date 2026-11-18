import { describe, expect, it, vi } from "vitest";
import { createSampleInvoice } from "@/lib/sample-invoice";
import { createSaveShortcutHandler, isSaveShortcut } from "@/lib/sync/save-shortcut";
import { SyncManager, type SyncTransportResult } from "@/lib/sync/sync-manager";
import type { SyncSaveRequest } from "@/lib/sync/sync-protocol";

function keyEvent(init: Partial<KeyboardEvent> = {}) {
  return {
    key: "s",
    code: "KeyS",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...init
  };
}

describe("save shortcut", () => {
  it.each([
    ["Ctrl+S (Windows/Linux)", { ctrlKey: true }],
    ["Cmd+S (macOS)", { metaKey: true }],
    ["Ctrl+Shift+S (Save as)", { ctrlKey: true, shiftKey: true, key: "S" }],
    ["Ctrl+S on a non-Latin layout", { ctrlKey: true, key: "স" }]
  ])("recognises %s", (_label, init) => {
    expect(isSaveShortcut(keyEvent(init))).toBe(true);
  });

  it.each([
    ["plain s", {}],
    ["Ctrl+Alt+S", { ctrlKey: true, altKey: true }],
    ["Ctrl+D", { ctrlKey: true, key: "d", code: "KeyD" }]
  ])("ignores %s", (_label, init) => {
    expect(isSaveShortcut(keyEvent(init))).toBe(false);
  });

  it("Ctrl+S triggers a save and blocks the browser's Save dialog", () => {
    const onSave = vi.fn();
    const event = keyEvent({ ctrlKey: true });

    createSaveShortcutHandler(onSave)(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("swallows key auto-repeat so holding the keys sends one save", () => {
    const onSave = vi.fn();
    const handler = createSaveShortcutHandler(onSave);
    const repeated = keyEvent({ ctrlKey: true, repeat: true });

    handler(keyEvent({ ctrlKey: true }));
    handler(repeated);
    handler(repeated);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(repeated.preventDefault).toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    const onSave = vi.fn();
    const event = keyEvent({ key: "a", code: "KeyA", ctrlKey: true });

    createSaveShortcutHandler(onSave)(event);

    expect(onSave).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("Ctrl+S sends the latest edit to the server end to end", async () => {
    const requests: SyncSaveRequest[] = [];
    const manager = new SyncManager({
      getClientId: () => "device-aaaa-1111",
      isOnline: () => true,
      transport: {
        save: async (request): Promise<SyncTransportResult> => {
          requests.push(request);
          return { status: 200, body: { success: true, version: 1, serverUpdatedAt: new Date().toISOString(), createdBy: "rahim", duplicate: false, message: "Saved successfully" } };
        }
      }
    });
    const invoice = createSampleInvoice();
    invoice.customer.name = "Latest edit";
    manager.track({ id: "saved-invoice-1", name: "Latest edit", savedAt: invoice.updatedAt, invoice });

    let saving: Promise<unknown> = Promise.resolve();
    createSaveShortcutHandler(() => (saving = manager.flush()))(keyEvent({ ctrlKey: true }));
    await saving;

    expect(requests).toHaveLength(1);
    expect(requests[0].changes.invoice.customer.name).toBe("Latest edit");
    expect(manager.getStatus().phase).toBe("saved");
  });
});
