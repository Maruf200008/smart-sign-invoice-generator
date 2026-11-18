import { describe, expect, it } from "vitest";
import { mergeCloudInvoices, pruneSavedInvoices } from "@/lib/invoice-sync";
import { createSampleInvoice } from "@/lib/sample-invoice";
import type { SavedInvoice } from "@/types/invoice";

const NOW = Date.parse("2026-06-01T12:00:00.000Z");

function saved(id: string, name: string, updatedAt: string, savedAt = updatedAt): SavedInvoice {
  const invoice = createSampleInvoice();
  invoice.customer.name = name;
  invoice.updatedAt = updatedAt;
  return { id, name, savedAt, invoice };
}

describe("mergeCloudInvoices", () => {
  it("keeps unsynced local edits of the open invoice instead of reverting them", () => {
    const local = [saved("a", "Local newer", "2026-06-01T11:00:05.000Z")];
    const cloud = [saved("a", "Cloud older", "2026-06-01T11:00:00.000Z")];

    const merged = mergeCloudInvoices(local, cloud, "a", NOW);

    expect(merged.find((invoice) => invoice.id === "a")?.invoice.customer.name).toBe("Local newer");
  });

  it("takes the cloud copy of the open invoice when it is newer (edited on another device)", () => {
    const local = [saved("a", "Local older", "2026-06-01T10:00:00.000Z")];
    const cloud = [saved("a", "Cloud newer", "2026-06-01T11:00:00.000Z")];

    expect(mergeCloudInvoices(local, cloud, "a", NOW)[0].invoice.customer.name).toBe("Cloud newer");
  });

  it("keeps the open invoice even before its first upload", () => {
    const local = [saved("new", "Draft", "2026-06-01T11:00:00.000Z")];
    const cloud = [saved("b", "Other", "2026-06-01T10:00:00.000Z")];

    expect(mergeCloudInvoices(local, cloud, "new", NOW).map((invoice) => invoice.id).sort()).toEqual(["b", "new"]);
  });

  it("lets the cloud win for every other invoice, so remote deletions propagate", () => {
    const local = [saved("a", "Open", "2026-06-01T11:00:00.000Z"), saved("deleted", "Gone", "2026-06-01T11:00:00.000Z")];
    const cloud = [saved("a", "Open", "2026-06-01T11:00:00.000Z"), saved("c", "New remote", "2026-06-01T10:00:00.000Z")];

    expect(mergeCloudInvoices(local, cloud, "a", NOW).map((invoice) => invoice.id).sort()).toEqual(["a", "c"]);
  });

  it("sanitizes cloud data before it reaches the editor", () => {
    const cloud = [{ id: "x", name: "", savedAt: "2026-06-01T10:00:00.000Z", invoice: { items: "nope", customer: { name: "Rahim" } } }] as unknown as SavedInvoice[];
    const [merged] = mergeCloudInvoices([], cloud, "", NOW);

    expect(merged.name).toBe("Rahim");
    expect(merged.invoice.items).toEqual([]);
  });
});

describe("pruneSavedInvoices", () => {
  it("drops invoices older than one year and sorts newest first", () => {
    const result = pruneSavedInvoices(
      [saved("old", "Old", "2025-01-01T00:00:00.000Z"), saved("mid", "Mid", "2026-03-01T00:00:00.000Z"), saved("new", "New", "2026-05-01T00:00:00.000Z")],
      NOW
    );

    expect(result.map((invoice) => invoice.id)).toEqual(["new", "mid"]);
  });
});
