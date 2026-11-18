import { roundToTwo, safePositiveNumber } from "@/lib/invoice-utils";
import type { CurrencyCode } from "@/types/invoice";

/**
 * Money amounts in English words, e.g. 125000.5 -> "One Lakh Twenty Five Thousand Taka and Fifty Paisa Only."
 *
 * The amount is first rounded to 2 decimals (exactly like every printed total) and then split into whole integer
 * major/minor units, so float noise such as 0.1 + 0.2 can never turn into "Twenty Nine Paisa".
 *
 * Two numbering systems are supported:
 *  - "south-asian" (the invoice default): Thousand, Lakh, Crore (1,25,350 -> One Lakh Twenty Five Thousand ...),
 *    the Bangladeshi system. Crores repeat for very large values ("One Thousand Crore").
 *  - "international": Thousand, Million, Billion, ... (125,350 -> One Hundred Twenty Five Thousand ...)
 *
 * Compound tens are written without a hyphen ("Twenty Five"), and the major unit is always stated, so BDT text
 * always ends in "Taka Only." or "Taka and <n> Paisa Only.".
 */
export type NumberingSystem = "international" | "south-asian";

/** The numbering system the invoice prints: Bangladeshi Lakh / Crore. */
export const INVOICE_NUMBERING_SYSTEM: NumberingSystem = "south-asian";

interface CurrencyUnits {
  major: [singular: string, plural: string];
  minor: [singular: string, plural: string];
}

const CURRENCY_UNITS: Record<CurrencyCode, CurrencyUnits> = {
  BDT: { major: ["Taka", "Taka"], minor: ["Paisa", "Paisa"] },
  USD: { major: ["Dollar", "Dollars"], minor: ["Cent", "Cents"] },
  EUR: { major: ["Euro", "Euros"], minor: ["Cent", "Cents"] },
  GBP: { major: ["Pound", "Pounds"], minor: ["Penny", "Pence"] },
  INR: { major: ["Rupee", "Rupees"], minor: ["Paisa", "Paise"] }
};

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const INTERNATIONAL_SCALES = ["", "Thousand", "Million", "Billion", "Trillion", "Quadrillion", "Quintillion"];

/** 1..99 ("Twenty Five"). */
function belowHundred(value: number) {
  if (value < 20) return ONES[value];
  const tens = TENS[Math.floor(value / 10)];
  const ones = value % 10;
  return ones ? `${tens} ${ONES[ones]}` : tens;
}

/** 1..999. */
function belowThousand(value: number) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(" ");
}

function internationalWords(value: number) {
  const parts: string[] = [];
  let remaining = value;

  for (let scale = 0; remaining > 0; scale += 1) {
    const group = remaining % 1000;
    remaining = Math.floor(remaining / 1000);
    if (group) parts.unshift(INTERNATIONAL_SCALES[scale] ? `${belowThousand(group)} ${INTERNATIONAL_SCALES[scale]}` : belowThousand(group));
  }

  return parts.join(" ");
}

/** 1,23,45,67,890 -> "Twelve Crore Thirty Four Lakh ...". Amounts of 100 crore and more repeat "Crore". */
function southAsianWords(value: number): string {
  const crore = Math.floor(value / 10_000_000);
  const rest = value % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  const thousand = Math.floor((rest % 100_000) / 1000);
  const hundreds = rest % 1000;
  const parts: string[] = [];

  if (crore) parts.push(`${southAsianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (hundreds) parts.push(belowThousand(hundreds));

  return parts.join(" ");
}

/** A non-negative whole number in words ("Zero" for 0). */
export function integerToWords(value: number, system: NumberingSystem = INVOICE_NUMBERING_SYSTEM) {
  const whole = Math.floor(safePositiveNumber(value));
  if (!Number.isFinite(whole) || whole === 0) return "Zero";
  return system === "south-asian" ? southAsianWords(whole) : internationalWords(whole);
}

/** Splits an amount into whole major and minor (1/100) units without float error. */
export function splitAmount(amount: number) {
  const value = roundToTwo(safePositiveNumber(amount));
  const minorTotal = Math.round(value * 100);

  // Beyond 2^53 cents the fraction can't be represented any more; print the whole part only.
  if (!Number.isSafeInteger(minorTotal)) return { major: Math.floor(value), minor: 0 };

  return { major: Math.floor(minorTotal / 100), minor: minorTotal % 100 };
}

export function amountInWords(
  amount: number,
  { currency = "BDT", system = INVOICE_NUMBERING_SYSTEM }: { currency?: CurrencyCode; system?: NumberingSystem } = {}
) {
  const units = CURRENCY_UNITS[currency] ?? CURRENCY_UNITS.BDT;
  const { major, minor } = splitAmount(amount);
  const majorText = `${integerToWords(major, system)} ${units.major[major === 1 ? 0 : 1]}`;

  if (minor === 0) return `${majorText} Only.`;
  // Paisa is always below 100, so it reads the same in both systems.
  return `${majorText} and ${integerToWords(minor, system)} ${units.minor[minor === 1 ? 0 : 1]} Only.`;
}
