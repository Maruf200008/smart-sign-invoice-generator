import { roundToTwo, safePositiveNumber } from "@/lib/invoice-utils";
import type { CurrencyCode, InvoiceLanguage } from "@/types/invoice";

/**
 * Money amounts in words, in the invoice's language:
 *   English: 125000.5 -> "One Lakh Twenty Five Thousand Taka and Fifty Paisa Only."
 *   Bangla:  26150    -> "ছাব্বিশ হাজার একশ পঞ্চাশ টাকা মাত্র।"
 *
 * The amount is first rounded to 2 decimals (exactly like every printed total) and then split into whole integer
 * major/minor units, so float noise such as 0.1 + 0.2 can never turn into "Twenty Nine Paisa".
 *
 * Two numbering systems are supported:
 *  - "south-asian" (the invoice default): Thousand, Lakh, Crore (1,25,350 -> One Lakh Twenty Five Thousand ...),
 *    the Bangladeshi system. Crores repeat for very large values ("One Thousand Crore").
 *  - "international": Thousand, Million, Billion, ... (125,350 -> One Hundred Twenty Five Thousand ...)
 *
 * Both languages share the same decomposition; only the vocabulary differs (see `VOCABULARIES`).
 * English compound tens are written without a hyphen ("Twenty Five"), and the major unit is always stated, so BDT
 * text always ends in "Taka Only." / "Taka and <n> Paisa Only." (Bangla: "টাকা মাত্র।" / "টাকা <n> পয়সা মাত্র।").
 */
export type NumberingSystem = "international" | "south-asian";

/** The numbering system the invoice prints: Bangladeshi Lakh / Crore. */
export const INVOICE_NUMBERING_SYSTEM: NumberingSystem = "south-asian";

interface CurrencyUnits {
  major: [singular: string, plural: string];
  minor: [singular: string, plural: string];
}

interface NumberVocabulary {
  zero: string;
  /** 1..99 in words. */
  belowHundred: (value: number) => string;
  /** 1..9 hundreds ("Two Hundred", "দুইশ"). */
  hundreds: (value: number) => string;
  southAsianScales: { thousand: string; lakh: string; crore: string };
  /** Index n is 1000^n. */
  internationalScales: readonly string[];
  currencies: Record<CurrencyCode, CurrencyUnits>;
  /** Joins the finished parts: "<major> <unit>" and the optional "<minor> <unit>". */
  phrase: (major: string, minor: string | null) => string;
}

// ---------------------------------------------------------------------------------------------------------------
// English

const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const ENGLISH: NumberVocabulary = {
  zero: "Zero",
  belowHundred: (value) => {
    if (value < 20) return ONES[value];
    const tens = TENS[Math.floor(value / 10)];
    const ones = value % 10;
    return ones ? `${tens} ${ONES[ones]}` : tens;
  },
  hundreds: (value) => `${ONES[value]} Hundred`,
  southAsianScales: { thousand: "Thousand", lakh: "Lakh", crore: "Crore" },
  internationalScales: ["", "Thousand", "Million", "Billion", "Trillion", "Quadrillion", "Quintillion"],
  currencies: {
    BDT: { major: ["Taka", "Taka"], minor: ["Paisa", "Paisa"] },
    USD: { major: ["Dollar", "Dollars"], minor: ["Cent", "Cents"] },
    EUR: { major: ["Euro", "Euros"], minor: ["Cent", "Cents"] },
    GBP: { major: ["Pound", "Pounds"], minor: ["Penny", "Pence"] },
    INR: { major: ["Rupee", "Rupees"], minor: ["Paisa", "Paise"] }
  },
  phrase: (major, minor) => (minor ? `${major} and ${minor} Only.` : `${major} Only.`)
};

// ---------------------------------------------------------------------------------------------------------------
// Bangla. Every number from 0 to 99 has its own word in Bengali, so they are listed rather than composed.

const BANGLA_0_TO_99 = [
  "শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়",
  "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "উনিশ",
  "বিশ", "একুশ", "বাইশ", "তেইশ", "চব্বিশ", "পঁচিশ", "ছাব্বিশ", "সাতাশ", "আটাশ", "উনত্রিশ",
  "ত্রিশ", "একত্রিশ", "বত্রিশ", "তেত্রিশ", "চৌত্রিশ", "পঁয়ত্রিশ", "ছত্রিশ", "সাঁইত্রিশ", "আটত্রিশ", "উনচল্লিশ",
  "চল্লিশ", "একচল্লিশ", "বিয়াল্লিশ", "তেতাল্লিশ", "চুয়াল্লিশ", "পঁয়তাল্লিশ", "ছেচল্লিশ", "সাতচল্লিশ", "আটচল্লিশ", "উনপঞ্চাশ",
  "পঞ্চাশ", "একান্ন", "বায়ান্ন", "তিপ্পান্ন", "চুয়ান্ন", "পঞ্চান্ন", "ছাপ্পান্ন", "সাতান্ন", "আটান্ন", "উনষাট",
  "ষাট", "একষট্টি", "বাষট্টি", "তেষট্টি", "চৌষট্টি", "পঁয়ষট্টি", "ছেষট্টি", "সাতষট্টি", "আটষট্টি", "উনসত্তর",
  "সত্তর", "একাত্তর", "বাহাত্তর", "তিয়াত্তর", "চুয়াত্তর", "পঁচাত্তর", "ছিয়াত্তর", "সাতাত্তর", "আটাত্তর", "উনআশি",
  "আশি", "একাশি", "বিরাশি", "তিরাশি", "চুরাশি", "পঁচাশি", "ছিয়াশি", "সাতাশি", "অষ্টাশি", "উননব্বই",
  "নব্বই", "একানব্বই", "বিরানব্বই", "তিরানব্বই", "চুরানব্বই", "পঁচানব্বই", "ছিয়ানব্বই", "সাতানব্বই", "আটানব্বই", "নিরানব্বই"
];

const BANGLA: NumberVocabulary = {
  zero: BANGLA_0_TO_99[0],
  belowHundred: (value) => BANGLA_0_TO_99[value],
  // "একশ", "দুইশ", ... "নয়শ"
  hundreds: (value) => `${BANGLA_0_TO_99[value]}শ`,
  southAsianScales: { thousand: "হাজার", lakh: "লক্ষ", crore: "কোটি" },
  internationalScales: ["", "হাজার", "মিলিয়ন", "বিলিয়ন", "ট্রিলিয়ন", "কোয়াড্রিলিয়ন", "কুইন্টিলিয়ন"],
  // Bengali nouns don't change for plural.
  currencies: {
    BDT: { major: ["টাকা", "টাকা"], minor: ["পয়সা", "পয়সা"] },
    USD: { major: ["ডলার", "ডলার"], minor: ["সেন্ট", "সেন্ট"] },
    EUR: { major: ["ইউরো", "ইউরো"], minor: ["সেন্ট", "সেন্ট"] },
    GBP: { major: ["পাউন্ড", "পাউন্ড"], minor: ["পেনি", "পেন্স"] },
    INR: { major: ["রুপি", "রুপি"], minor: ["পয়সা", "পয়সা"] }
  },
  // Cheque style: "এক হাজার টাকা পঞ্চাশ পয়সা মাত্র।"
  phrase: (major, minor) => (minor ? `${major} ${minor} মাত্র।` : `${major} মাত্র।`)
};

const VOCABULARIES: Record<InvoiceLanguage, NumberVocabulary> = { english: ENGLISH, bangla: BANGLA };

const vocabularyFor = (language: InvoiceLanguage) => VOCABULARIES[language] ?? ENGLISH;

// ---------------------------------------------------------------------------------------------------------------
// Shared decomposition

/** 1..999. */
function belowThousand(value: number, words: NumberVocabulary) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(words.hundreds(hundreds));
  if (rest) parts.push(words.belowHundred(rest));
  return parts.join(" ");
}

function internationalWords(value: number, words: NumberVocabulary) {
  const parts: string[] = [];
  let remaining = value;

  for (let scale = 0; remaining > 0; scale += 1) {
    const group = remaining % 1000;
    remaining = Math.floor(remaining / 1000);
    const scaleWord = words.internationalScales[scale];
    if (group) parts.unshift(scaleWord ? `${belowThousand(group, words)} ${scaleWord}` : belowThousand(group, words));
  }

  return parts.join(" ");
}

/** 1,23,45,67,890 -> "Twelve Crore Thirty Four Lakh ...". Amounts of 100 crore and more repeat "Crore". */
function southAsianWords(value: number, words: NumberVocabulary): string {
  const crore = Math.floor(value / 10_000_000);
  const rest = value % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  const thousand = Math.floor((rest % 100_000) / 1000);
  const hundreds = rest % 1000;
  const { thousand: thousandWord, lakh: lakhWord, crore: croreWord } = words.southAsianScales;
  const parts: string[] = [];

  if (crore) parts.push(`${southAsianWords(crore, words)} ${croreWord}`);
  if (lakh) parts.push(`${words.belowHundred(lakh)} ${lakhWord}`);
  if (thousand) parts.push(`${words.belowHundred(thousand)} ${thousandWord}`);
  if (hundreds) parts.push(belowThousand(hundreds, words));

  return parts.join(" ");
}

/** A non-negative whole number in words ("Zero" / "শূন্য" for 0). */
export function integerToWords(value: number, system: NumberingSystem = INVOICE_NUMBERING_SYSTEM, language: InvoiceLanguage = "english") {
  const words = vocabularyFor(language);
  const whole = Math.floor(safePositiveNumber(value));
  if (!Number.isFinite(whole) || whole === 0) return words.zero;
  return system === "south-asian" ? southAsianWords(whole, words) : internationalWords(whole, words);
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
  {
    currency = "BDT",
    system = INVOICE_NUMBERING_SYSTEM,
    language = "english"
  }: { currency?: CurrencyCode; system?: NumberingSystem; language?: InvoiceLanguage } = {}
) {
  const words = vocabularyFor(language);
  const units = words.currencies[currency] ?? words.currencies.BDT;
  const { major, minor } = splitAmount(amount);
  const majorText = `${integerToWords(major, system, language)} ${units.major[major === 1 ? 0 : 1]}`;

  // Paisa is always below 100, so it reads the same in both systems.
  const minorText = minor === 0 ? null : `${integerToWords(minor, system, language)} ${units.minor[minor === 1 ? 0 : 1]}`;
  return words.phrase(majorText, minorText);
}
