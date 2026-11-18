import { describe, expect, it } from "vitest";
import { amountInWords, INVOICE_NUMBERING_SYSTEM, integerToWords, splitAmount } from "@/lib/amount-in-words";

describe("amount in words (Bangladeshi Lakh / Crore)", () => {
  it("uses the Bangladeshi numbering system by default", () => {
    expect(INVOICE_NUMBERING_SYSTEM).toBe("south-asian");
    expect(amountInWords(125000)).toBe("One Lakh Twenty Five Thousand Taka Only.");
    expect(amountInWords(125000)).not.toContain("Hundred Twenty Five Thousand");
  });

  it("matches the specification examples", () => {
    expect(amountInWords(100000)).toBe("One Lakh Taka Only.");
    expect(amountInWords(125000)).toBe("One Lakh Twenty Five Thousand Taka Only.");
    expect(amountInWords(125500)).toBe("One Lakh Twenty Five Thousand Five Hundred Taka Only.");
    expect(amountInWords(1050000)).toBe("Ten Lakh Fifty Thousand Taka Only.");
    expect(amountInWords(10000000)).toBe("One Crore Taka Only.");
    expect(amountInWords(12500000)).toBe("One Crore Twenty Five Lakh Taka Only.");
    expect(amountInWords(123456789)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Taka Only."
    );
    expect(amountInWords(125000.5)).toBe("One Lakh Twenty Five Thousand Taka and Fifty Paisa Only.");
  });

  it("handles zero, paisa-only, singular and small amounts", () => {
    expect(amountInWords(0)).toBe("Zero Taka Only.");
    expect(amountInWords(0.5)).toBe("Zero Taka and Fifty Paisa Only.");
    expect(amountInWords(1.01)).toBe("One Taka and One Paisa Only.");
    expect(amountInWords(100)).toBe("One Hundred Taka Only.");
    expect(amountInWords(1250.5)).toBe("One Thousand Two Hundred Fifty Taka and Fifty Paisa Only.");
    expect(amountInWords(99_999)).toBe("Ninety Nine Thousand Nine Hundred Ninety Nine Taka Only.");
  });

  it("rounds correctly to paisa and never shows float noise", () => {
    expect(amountInWords(0.1 + 0.2)).toBe("Zero Taka and Thirty Paisa Only.");
    expect(amountInWords(1150.0000000000002)).toBe("One Thousand One Hundred Fifty Taka Only.");
    expect(amountInWords(1.005)).toBe("One Taka and One Paisa Only.");
    expect(amountInWords(19.999)).toBe("Twenty Taka Only.");
    expect(amountInWords(125000.555)).toBe("One Lakh Twenty Five Thousand Taka and Fifty Six Paisa Only.");
    expect(amountInWords(99.995)).toBe("One Hundred Taka Only.");
    expect(splitAmount(4.35)).toEqual({ major: 4, minor: 35 });
    expect(splitAmount(1234567.89)).toEqual({ major: 1234567, minor: 89 });
  });

  it("treats negative and invalid amounts as zero", () => {
    expect(amountInWords(-50)).toBe("Zero Taka Only.");
    expect(amountInWords(Number.NaN)).toBe("Zero Taka Only.");
    expect(amountInWords(Number.POSITIVE_INFINITY)).toBe("Zero Taka Only.");
  });

  it("handles very large invoices by repeating Crore", () => {
    expect(amountInWords(999_999_999.99)).toBe(
      "Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Taka and Ninety Nine Paisa Only."
    );
    expect(amountInWords(1_000_000_000)).toBe("One Hundred Crore Taka Only.");
    expect(amountInWords(250_050_000.75)).toBe("Twenty Five Crore Fifty Thousand Taka and Seventy Five Paisa Only.");
    expect(amountInWords(12_345_678_901)).toBe(
      "One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred One Taka Only."
    );
    expect(amountInWords(1e14)).toBe("One Crore Crore Taka Only.");
    expect(amountInWords(1e20)).toMatch(/^[A-Za-z ]+ Taka Only\.$/);
  });

  it("never produces double, leading or trailing spaces or hyphens", () => {
    for (const value of [0, 0.01, 7, 10, 20, 101, 1000, 100_001, 1_00_00_001, 10_10_10_101.1, 1e12 + 0.99]) {
      const text = amountInWords(value);
      expect(text).not.toMatch(/\s{2}|^\s|\s$|-/);
      expect(text).toMatch(/Taka (and [A-Za-z ]+ Paisa )?Only\.$/);
    }
  });

  it("still supports the international system when asked", () => {
    const international = { system: "international" } as const;
    expect(amountInWords(125350, international)).toBe("One Hundred Twenty Five Thousand Three Hundred Fifty Taka Only.");
    expect(amountInWords(1_000_000, international)).toBe("One Million Taka Only.");
    expect(integerToWords(2_005_017, "international")).toBe("Two Million Five Thousand Seventeen");
  });

  it("uses the invoice currency's units", () => {
    expect(amountInWords(1, { currency: "USD" })).toBe("One Dollar Only.");
    expect(amountInWords(2.01, { currency: "USD" })).toBe("Two Dollars and One Cent Only.");
    expect(amountInWords(3.5, { currency: "GBP" })).toBe("Three Pounds and Fifty Pence Only.");
  });
});
