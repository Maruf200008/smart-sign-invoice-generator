import { describe, expect, it } from "vitest";
import { InvoiceValidationError, MAX_STORED_ITEMS, parseSavedInvoice, sanitizeInvoiceData } from "@/lib/invoice-normalize";
import { createSampleInvoice } from "@/lib/sample-invoice";

describe("sanitizeInvoiceData", () => {
  it("keeps a valid invoice intact", () => {
    const invoice = createSampleInvoice();
    invoice.customer.name = "রহিম আহমেদ";
    invoice.items[0] = { ...invoice.items[0], name: "Banner", width: 4, height: 2, quantity: 1, unitPrice: 50, total: 400, sqf: 8 };

    const clean = sanitizeInvoiceData(invoice);

    expect(clean.customer.name).toBe("রহিম আহমেদ");
    expect(clean.items[0]).toMatchObject({ name: "Banner", sqf: 8, total: 400 });
    expect(clean.items).toHaveLength(15);
  });

  it("starts every new invoice with 15 blank rows", () => {
    const invoice = createSampleInvoice();
    expect(invoice.items).toHaveLength(15);
    expect(invoice.items.every((item) => !item.name && !item.quantity && !item.total)).toBe(true);
  });

  it("turns garbage into a safe, well-formed invoice", () => {
    const clean = sanitizeInvoiceData({
      customer: { name: 42, invoiceNumber: "X".repeat(5000) },
      items: [{ width: "abc", quantity: -3, unitPrice: Infinity, total: "lots" }, null],
      discount: -10,
      taxRate: 900,
      advance: "1e400",
      settings: { currency: "BTC", status: "stolen", language: "klingon" },
      evil: "<script>"
    });

    expect(clean.customer.name).toBe("42");
    expect(clean.customer.invoiceNumber).toHaveLength(100);
    expect(clean.items[0]).toMatchObject({ width: 0, quantity: 0, unitPrice: 0, total: 0 });
    expect(clean.items[1].id).toBeTruthy();
    expect(clean.discount).toBe(0);
    expect(clean.taxRate).toBe(100);
    expect(clean.advance).toBe(0);
    expect(clean.settings).toMatchObject({ currency: "BDT", status: "draft", language: "english" });
    expect(clean).not.toHaveProperty("evil");
  });

  it("recomputes automatic line totals but keeps manual ones", () => {
    const clean = sanitizeInvoiceData({
      items: [
        { quantity: 2, unitPrice: 100, total: 999999, totalIsManual: false },
        { quantity: 2, unitPrice: 100, total: 150, totalIsManual: true }
      ]
    });

    expect(clean.items[0].total).toBe(200);
    expect(clean.items[1].total).toBe(150);
  });

  it("drops the legacy activeLock and any non-image or remote logo", () => {
    const clean = sanitizeInvoiceData({
      activeLock: { clientId: "x" },
      company: { logo: "https://tracker.example/pixel.png" },
      signature: "data:image/svg+xml;base64,PHN2Zz4="
    });

    expect(clean).not.toHaveProperty("activeLock");
    expect(clean.company.logo).toBe("");
    expect(clean.signature).toBe("");
    expect(sanitizeInvoiceData({ company: { logo: "data:image/png;base64,iVBORw0KGgo=" } }).company.logo).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("caps the number of stored items", () => {
    const clean = sanitizeInvoiceData({ items: Array.from({ length: 80 }, () => ({})) });
    expect(clean.items).toHaveLength(MAX_STORED_ITEMS);
  });
});

describe("parseSavedInvoice", () => {
  const valid = { id: "saved-invoice-abc123-xyz", name: "Rahim", savedAt: "2026-01-01T00:00:00.000Z", invoice: createSampleInvoice() };

  it("accepts a valid saved invoice", () => {
    expect(parseSavedInvoice(valid)).toMatchObject({ id: valid.id, name: "Rahim" });
  });

  it.each([
    ["missing id", { ...valid, id: undefined }],
    ["id with filter characters", { ...valid, id: "abc,or=(1.eq.1)" }],
    ["overlong id", { ...valid, id: "a".repeat(101) }],
    ["missing invoice", { ...valid, invoice: undefined }],
    ["array invoice", { ...valid, invoice: [] }],
    ["too many items", { ...valid, invoice: { ...valid.invoice, items: Array.from({ length: MAX_STORED_ITEMS + 1 }, () => ({})) } }]
  ])("rejects %s", (_label, body) => {
    expect(() => parseSavedInvoice(body)).toThrow(InvoiceValidationError);
  });

  it("falls back to a sensible name", () => {
    expect(parseSavedInvoice({ ...valid, name: "   " }).name).toBe("Untitled Invoice");
  });
});
