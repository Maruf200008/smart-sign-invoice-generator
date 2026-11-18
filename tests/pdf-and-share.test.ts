import { describe, expect, it } from "vitest";
import { isLockedByOther, writableByFilter } from "@/lib/invoice-lock";
import { toSharedInvoice } from "@/lib/share-server";
import { buildPdfFileName } from "@/lib/share-pdf";
import { isShareExpired, resolveExpiresAt } from "@/lib/share-utils";

describe("PDF file names", () => {
  it.each([
    ["Rahim Ahmed", "Rahim Ahmed.pdf"],
    ["রহিম আহমেদ", "রহিম আহমেদ.pdf"],
    ["A/B\\C:D*E?F\"G<H>I|J", "A B C D E F G H I J.pdf"],
    ["  spaced   out  ", "spaced out.pdf"],
    ["trailing dots...", "trailing dots.pdf"],
    ["CON", "Invoice.pdf"],
    ["", "Invoice.pdf"],
    [null, "Invoice.pdf"],
    ["\u0000\u0007", "Invoice.pdf"]
  ])("%j -> %j", (input, expected) => {
    expect(buildPdfFileName(input)).toBe(expected);
  });

  it("caps very long names", () => {
    expect(buildPdfFileName("x".repeat(500)).length).toBeLessThanOrEqual(104);
  });
});

describe("edit locks", () => {
  const now = Date.parse("2026-06-01T12:00:00.000Z");

  it("treats a fresh lock from another device as locked", () => {
    expect(isLockedByOther({ lock_client_id: "other-device", lock_touched_at: "2026-06-01T11:59:50.000Z" }, "this-device", now)).toBe(true);
  });

  it("ignores its own lock, missing locks and lapsed locks", () => {
    expect(isLockedByOther({ lock_client_id: "this-device", lock_touched_at: "2026-06-01T11:59:50.000Z" }, "this-device", now)).toBe(false);
    expect(isLockedByOther({ lock_client_id: null, lock_touched_at: null }, "this-device", now)).toBe(false);
    expect(isLockedByOther({ lock_client_id: "other-device", lock_touched_at: "2026-06-01T11:58:00.000Z" }, "this-device", now)).toBe(false);
    expect(isLockedByOther(undefined, "this-device", now)).toBe(false);
  });

  it("builds a conditional-write filter and refuses unsafe client ids", () => {
    expect(writableByFilter("abc-123", now)).toContain("lock_client_id.eq.abc-123");
    expect(() => writableByFilter("x,lock_client_id.neq.y", now)).toThrow();
  });
});

describe("public share projection", () => {
  it("exposes only whitelisted, sanitized fields", () => {
    const shared = toSharedInvoice({
      customer: { name: "Rahim", invoiceNumber: "INV-1", date: "01/01/2026", phone: "+880 secret", address: "secret" },
      company: { name: "Smart Sign" },
      notes: "internal",
      activeLock: { clientId: "x" },
      items: [{ id: "row-1", name: "Banner", quantity: 2, unitPrice: -5, total: 10 }],
      discount: -3,
      settings: { currency: "XYZ" }
    });

    expect(shared.customer).toEqual({ name: "Rahim", invoiceNumber: "INV-1", date: "01/01/2026" });
    expect(shared).not.toHaveProperty("notes");
    expect(shared).not.toHaveProperty("company");
    expect(shared.items[0]).not.toHaveProperty("id");
    expect(shared.items[0].unitPrice).toBe(0);
    expect(shared.discount).toBe(0);
    expect(shared.currency).toBe("BDT");
  });
});

describe("share expiry", () => {
  const now = Date.parse("2026-06-01T12:00:00.000Z");

  it("resolves presets and validates custom dates", () => {
    expect(resolveExpiresAt("never", undefined, now)).toBeNull();
    expect(resolveExpiresAt("24h", undefined, now)).toBe("2026-06-02T12:00:00.000Z");
    expect(resolveExpiresAt("custom", "2026-05-01T00:00:00.000Z", now)).toBeUndefined();
    expect(resolveExpiresAt("custom", "not a date", now)).toBeUndefined();
    expect(resolveExpiresAt("custom", "2026-07-01T00:00:00.000Z", now)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("treats past or malformed expiry as expired", () => {
    expect(isShareExpired(null, now)).toBe(false);
    expect(isShareExpired("2026-05-31T00:00:00.000Z", now)).toBe(true);
    expect(isShareExpired("garbage", now)).toBe(true);
  });
});
