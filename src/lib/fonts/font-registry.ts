/**
 * Single source of truth for the invoice typeface chain. The on-screen invoice (via the generated @font-face CSS)
 * and the PDF engine (which shapes text with HarfBuzz from the same files) both read this list, so screen and PDF
 * always use byte-identical fonts with identical metrics.
 *
 * Order matters: for every character the first family that contains it wins, exactly like CSS font fallback.
 * Anek Bangla (Ek Type) is the invoice typeface. It covers every Bengali letter, vowel sign, conjunct (via its
 * shaping tables), Bengali digits, dandas and ৳, plus full Latin and € £ ₹, so mixed Bengali-English text shares
 * one design and one set of vertical metrics. It is a variable font (wght 100–800, wdth 75–125); the invoice uses
 * the default width (100, CSS "normal"), and weights above 800 render at 800 on screen and in the PDF alike.
 * The other bundled families only ever supply the few rare characters Anek Bangla lacks.
 *
 * All bundled files are SIL Open Font License 1.1 (licences next to the files in /public/fonts) and are served from
 * this app, so nothing depends on the network at render time or on fonts installed on the device.
 */

export interface BundledFontFile {
  url: string;
  /** A single static weight, or the [min, max] wght range of a variable font. */
  weight: number | readonly [number, number];
}

export interface BundledFontFamily {
  id: string;
  /** Private CSS family name, so a differently-versioned copy installed on the device can never be picked instead. */
  cssFamily: string;
  displayName: string;
  files: readonly BundledFontFile[];
}

export const BUNDLED_FONT_FAMILIES: readonly BundledFontFamily[] = [
  {
    id: "anek-bangla",
    cssFamily: "SSI Anek Bangla",
    displayName: "Anek Bangla",
    files: [{ url: "/fonts/AnekBangla-Variable.ttf", weight: [100, 800] }]
  },
  {
    id: "noto-sans-bengali",
    cssFamily: "SSI Noto Sans Bengali",
    displayName: "Noto Sans Bengali",
    files: [{ url: "/fonts/NotoSansBengali-Variable.ttf", weight: [100, 900] }]
  },
  {
    id: "hind-siliguri",
    cssFamily: "SSI Hind Siliguri",
    displayName: "Hind Siliguri",
    files: [
      { url: "/fonts/HindSiliguri-Regular.ttf", weight: 400 },
      { url: "/fonts/HindSiliguri-SemiBold.ttf", weight: 600 },
      { url: "/fonts/HindSiliguri-Bold.ttf", weight: 700 }
    ]
  },
  {
    id: "noto-serif-bengali",
    cssFamily: "SSI Noto Serif Bengali",
    displayName: "Noto Serif Bengali",
    files: [{ url: "/fonts/NotoSerifBengali-Variable.ttf", weight: [100, 900] }]
  }
];

/**
 * Popular Bangladeshi fonts used when installed on the device. Their licences don't allow (or don't clearly allow)
 * redistribution, and Vrinda is proprietary to Microsoft, so they are referenced by name only. Because the bundled
 * chain above already covers every Bengali code point, these are a last resort and never change the layout.
 */
export const SYSTEM_BENGALI_FALLBACKS: readonly string[] = [
  "Kalpurush",
  "SolaimanLipi",
  "Siyam Rupali",
  "AdorshoLipi",
  "Nikosh",
  "Vrinda",
  "Nirmala UI",
  "Bangla Sangam MN",
  "Noto Sans Bengali"
];

export const PRIMARY_FONT_FILE = BUNDLED_FONT_FAMILIES[0].files[0];
/** Every file of the primary family: the invoice needs it on first paint. */
export const PRIMARY_FONT_FILES = BUNDLED_FONT_FAMILIES[0].files;

/** Text used to force-load every face a Bengali invoice needs before measuring or drawing it. */
export const FONT_WARMUP_TEXT = "Invoice ক্ষ র্ক কি কৌ জ্ঞ ত্র ০১২৩ ৳ । $€£₹";

const quote = (family: string) => `"${family.replace(/["\\]/g, "")}"`;

/** CSS font-family value for the invoice paper. */
export const INVOICE_FONT_STACK = [
  ...BUNDLED_FONT_FAMILIES.map((family) => quote(family.cssFamily)),
  ...SYSTEM_BENGALI_FALLBACKS.map(quote),
  "sans-serif"
].join(", ");

function fontWeightDescriptor(weight: BundledFontFile["weight"]) {
  return typeof weight === "number" ? String(weight) : `${weight[0]} ${weight[1]}`;
}

/**
 * @font-face rules for every bundled file plus the --invoice-font custom property.
 * `font-display: swap` never hides text; the invoice re-measures its pages when a face finishes loading.
 * Browsers only download a fallback family when a character actually needs it.
 */
export function buildInvoiceFontCss() {
  const faces = BUNDLED_FONT_FAMILIES.flatMap((family) =>
    family.files.map(
      (file) =>
        `@font-face{font-family:${quote(family.cssFamily)};src:url(${file.url}) format("truetype");` +
        `font-weight:${fontWeightDescriptor(file.weight)};font-style:normal;font-display:swap;}`
    )
  );

  return `${faces.join("\n")}\n:root{--invoice-font:${INVOICE_FONT_STACK};}`;
}

/**
 * Picks the file the browser would use for `weight`, following the CSS Fonts 4 matching rules, so the PDF engine
 * selects the same face as the screen.
 */
export function pickFontFile(files: readonly BundledFontFile[], weight: number): { file: BundledFontFile; weight: number } {
  const variable = files.find((file) => typeof file.weight !== "number" && weight >= file.weight[0] && weight <= file.weight[1]);
  if (variable) return { file: variable, weight };

  const statics = files
    .map((file) => ({ file, value: typeof file.weight === "number" ? file.weight : clampWeight(weight, file.weight) }))
    .sort((a, b) => a.value - b.value);
  const heavier = statics.filter((entry) => entry.value >= weight);
  const lighter = statics.filter((entry) => entry.value < weight).reverse();
  let order: typeof statics;

  if (weight >= 400 && weight <= 500) {
    const upTo500 = heavier.filter((entry) => entry.value <= 500);
    const above500 = heavier.filter((entry) => entry.value > 500);
    order = [...upTo500, ...lighter, ...above500];
  } else if (weight < 400) {
    order = [...lighter, ...heavier];
  } else {
    order = [...heavier, ...lighter];
  }

  const chosen = order[0] ?? statics[0];
  return { file: chosen.file, weight: chosen.value };
}

function clampWeight(weight: number, range: readonly [number, number]) {
  return Math.min(Math.max(weight, range[0]), range[1]);
}
