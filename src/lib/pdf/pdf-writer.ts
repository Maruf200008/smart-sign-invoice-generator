import { zlibSync } from "fflate";

/**
 * Minimal PDF 1.7 writer for the invoice. Everything is vector:
 *  - Text is drawn with Type 3 fonts whose glyph procedures are the exact outlines HarfBuzz produced after full
 *    OpenType shaping (conjuncts, reph, pre-base vowel signs, mark positioning). The PDF viewer therefore never has
 *    to shape Bengali itself, which is where most viewers/printers break it. Glyphs carry a ToUnicode map and every
 *    word is wrapped in /ActualText, so text stays selectable, searchable and copyable in logical order.
 *  - Boxes, borders and SVG icons/logo are PDF paths. Raster images (only used for photos or for characters no
 *    bundled font covers) are lossless Flate images with a soft mask.
 * Streams are Flate-compressed; glyph outlines are stored once and reused, which keeps files small.
 */

export type PathOp = { op: "M" | "L"; x: number; y: number } | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: "Z" };

export interface GlyphOutline {
  advance: number;
  path: PathOp[];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const encoder = new TextEncoder();

/** Number for a content stream: at most 3 decimals, no exponent, no "-0". */
export function num(value: number) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0) return "0";
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

function precise(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toFixed(10).replace(/\.?0+$/, "");
}

/** UTF-16BE hex string with BOM, the PDF encoding for Unicode text strings. */
export function utf16Hex(text: string, withBom = true) {
  let hex = withBom ? "FEFF" : "";
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return hex;
}

function pdfDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function pathToOps(path: PathOp[]) {
  return path
    .map((segment) => {
      switch (segment.op) {
        case "M":
          return `${num(segment.x)} ${num(segment.y)} m`;
        case "L":
          return `${num(segment.x)} ${num(segment.y)} l`;
        case "C":
          return `${num(segment.x1)} ${num(segment.y1)} ${num(segment.x2)} ${num(segment.y2)} ${num(segment.x)} ${num(segment.y)} c`;
        default:
          return "h";
      }
    })
    .join("\n");
}

function pathBounds(path: PathOp[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };

  for (const segment of path) {
    if (segment.op === "C") {
      add(segment.x1, segment.y1);
      add(segment.x2, segment.y2);
    }
    if (segment.op !== "Z") add(segment.x, segment.y);
  }

  return Number.isFinite(x0) ? [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)] : [0, 0, 0, 0];
}

interface Type3Glyph {
  outline: GlyphOutline;
  unicode: string;
}

interface Type3Font {
  name: string;
  upem: number;
  glyphs: Type3Glyph[];
}

interface ImageEntry {
  name: string;
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array | null;
}

export interface GlyphPlacement {
  fontKey: string;
  upem: number;
  glyphId: number;
  /** Characters this glyph stands for when copied. */
  unicode: string;
  outline: () => GlyphOutline;
  x: number;
  y: number;
}

/** Content of one page. Coordinates are whatever the caller's current transform says (see dom-to-pdf). */
export class PdfPage {
  readonly ops: string[] = [];

  constructor(
    private readonly document: PdfDocument,
    readonly width: number,
    readonly height: number
  ) {}

  push(op: string) {
    this.ops.push(op);
  }

  save() {
    this.ops.push("q");
  }

  restore() {
    this.ops.push("Q");
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.ops.push(`${precise(a)} ${precise(b)} ${precise(c)} ${precise(d)} ${num(e)} ${num(f)} cm`);
  }

  fillColor({ r, g, b }: Rgb) {
    this.ops.push(`${num(r / 255)} ${num(g / 255)} ${num(b / 255)} rg`);
  }

  strokeColor({ r, g, b }: Rgb) {
    this.ops.push(`${num(r / 255)} ${num(g / 255)} ${num(b / 255)} RG`);
  }

  alpha(fill: number, stroke = fill) {
    if (fill >= 0.999 && stroke >= 0.999) return;
    this.ops.push(`/${this.document.extGState(fill, stroke)} gs`);
  }

  path(path: PathOp[]) {
    this.ops.push(pathToOps(path));
  }

  rect(x: number, y: number, width: number, height: number) {
    this.ops.push(`${num(x)} ${num(y)} ${num(width)} ${num(height)} re`);
  }

  image(name: string, x: number, y: number, width: number, height: number) {
    // The page space is y-down (see dom-to-pdf); an image's unit square is y-up, so flip it.
    this.save();
    this.transform(width, 0, 0, -height, x, y + height);
    this.ops.push(`/${name} Do`);
    this.restore();
  }

  /**
   * Draws one word of shaped glyphs at `size` px. Placements are glyph origins in the y-down page space.
   * The word is a single text run (TJ with kerning adjustments, Ts for raised/lowered marks), so viewers see
   * contiguous text, and it is wrapped in /ActualText so copy/search returns `actualText` in logical order.
   */
  glyphs(placements: GlyphPlacement[], size: number, actualText: string, baseline: number) {
    if (placements.length === 0) return;

    let pen = placements[0].x;
    let rise = 0;
    let currentFont = "";
    let run: string[] = [];
    const flush = () => {
      if (run.length) this.ops.push(`[${run.join(" ")}] TJ`);
      run = [];
    };

    // Text space = CSS px with y flipped back up, origin at the word's start on the baseline.
    this.ops.push(`/Span <</ActualText <${utf16Hex(actualText)}>>> BDC`, "BT", `1 0 0 -1 ${num(pen)} ${num(baseline)} Tm`);

    for (const placement of placements) {
      const { fontName, code, advance, upem } = this.document.glyph(placement);
      if (fontName !== currentFont) {
        flush();
        this.ops.push(`/${fontName} ${num(size)} Tf`);
        currentFont = fontName;
      }

      const wantedRise = baseline - placement.y;
      if (Math.abs(wantedRise - rise) > 0.001) {
        flush();
        this.ops.push(`${num(wantedRise)} Ts`);
        rise = wantedRise;
      }

      const delta = placement.x - pen;
      if (Math.abs(delta) > 0.0005) run.push(num((-delta / size) * 1000));
      run.push(`<${code.toString(16).padStart(2, "0")}>`);
      pen = placement.x + (advance / upem) * size;
    }

    flush();
    this.ops.push("ET", "EMC");
  }
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly fonts: Type3Font[] = [];
  private readonly openFont = new Map<string, Type3Font>();
  private readonly glyphCodes = new Map<string, { fontName: string; code: number; advance: number; upem: number }>();
  private readonly images: ImageEntry[] = [];
  private readonly gStates = new Map<string, string>();

  constructor(private readonly info: { title?: string; author?: string; subject?: string; lang?: string } = {}) {}

  addPage(width: number, height: number) {
    const page = new PdfPage(this, width, height);
    this.pages.push(page);
    return page;
  }

  /** Returns the Type 3 font + 1-byte code for a glyph, creating it on first use (256 glyphs per font). */
  glyph(placement: GlyphPlacement) {
    const key = `${placement.fontKey}\u0000${placement.glyphId}\u0000${placement.unicode}`;
    const existing = this.glyphCodes.get(key);
    if (existing) return existing;


    let font = this.openFont.get(placement.fontKey);
    if (!font || font.glyphs.length >= 256) {
      font = { name: `T${this.fonts.length}`, upem: placement.upem, glyphs: [] };
      this.fonts.push(font);
      this.openFont.set(placement.fontKey, font);
    }

    const outline = placement.outline();
    const entry = { fontName: font.name, code: font.glyphs.length, advance: outline.advance, upem: font.upem };
    font.glyphs.push({ outline, unicode: placement.unicode });
    this.glyphCodes.set(key, entry);
    return entry;
  }

  addImage(width: number, height: number, rgb: Uint8Array, alpha: Uint8Array | null) {
    const name = `Im${this.images.length}`;
    this.images.push({ name, width, height, rgb, alpha });
    return name;
  }

  extGState(fill: number, stroke: number) {
    const key = `${num(fill)}/${num(stroke)}`;
    let name = this.gStates.get(key);
    if (!name) {
      name = `GS${this.gStates.size}`;
      this.gStates.set(key, name);
    }
    return name;
  }

  save(): Uint8Array {
    const objects: (Uint8Array | null)[] = [];
    const alloc = () => {
      objects.push(null);
      return objects.length;
    };
    const set = (ref: number, body: string) => {
      objects[ref - 1] = encoder.encode(body);
    };
    const setStream = (ref: number, dict: string, data: Uint8Array, compress = true) => {
      const payload = compress ? zlibSync(data, { level: 9 }) : data;
      const head = encoder.encode(`<<${dict}${compress ? "/Filter/FlateDecode" : ""}/Length ${payload.length}>>\nstream\n`);
      const tail = encoder.encode("\nendstream");
      const bytes = new Uint8Array(head.length + payload.length + tail.length);
      bytes.set(head, 0);
      bytes.set(payload, head.length);
      bytes.set(tail, head.length + payload.length);
      objects[ref - 1] = bytes;
    };

    const catalogRef = alloc();
    const pagesRef = alloc();
    const resourcesRef = alloc();
    const infoRef = alloc();

    const fontRefs = this.fonts.map((font) => ({ font, ref: this.writeType3Font(font, alloc, set, setStream) }));

    const imageRefs = this.images.map((image) => {
      const ref = alloc();
      let smask = "";
      if (image.alpha) {
        const maskRef = alloc();
        setStream(maskRef, `/Type/XObject/Subtype/Image/Width ${image.width}/Height ${image.height}/ColorSpace/DeviceGray/BitsPerComponent 8`, image.alpha);
        smask = `/SMask ${maskRef} 0 R`;
      }
      setStream(ref, `/Type/XObject/Subtype/Image/Width ${image.width}/Height ${image.height}/ColorSpace/DeviceRGB/BitsPerComponent 8${smask}`, image.rgb);
      return { name: image.name, ref };
    });

    const gStateRefs = Array.from(this.gStates.entries()).map(([key, name]) => {
      const ref = alloc();
      const [fill, stroke] = key.split("/");
      set(ref, `<</Type/ExtGState/ca ${fill}/CA ${stroke}>>`);
      return { name, ref };
    });

    const dict = (entries: { name: string; ref: number }[]) => entries.map((entry) => `/${entry.name} ${entry.ref} 0 R`).join("");
    set(
      resourcesRef,
      `<</ProcSet[/PDF/Text/ImageC/ImageB]/Font<<${dict(fontRefs.map(({ font, ref }) => ({ name: font.name, ref })))}>>` +
        `/XObject<<${dict(imageRefs)}>>/ExtGState<<${dict(gStateRefs)}>>>>`
    );

    const pageRefs = this.pages.map((page) => {
      const pageRef = alloc();
      const contentRef = alloc();
      setStream(contentRef, "", encoder.encode(page.ops.join("\n")));
      set(pageRef, `<</Type/Page/Parent ${pagesRef} 0 R/MediaBox[0 0 ${num(page.width)} ${num(page.height)}]/Resources ${resourcesRef} 0 R/Contents ${contentRef} 0 R>>`);
      return pageRef;
    });

    set(pagesRef, `<</Type/Pages/Kids[${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}]/Count ${pageRefs.length}>>`);
    set(
      catalogRef,
      // PrintScaling /None asks print dialogs to default to "Actual size", so A4 prints at exactly A4.
      `<</Type/Catalog/Pages ${pagesRef} 0 R/ViewerPreferences<</DisplayDocTitle true/PrintScaling/None/PickTrayByPDFSize true>>` +
        `${this.info.lang ? `/Lang<${utf16Hex(this.info.lang)}>` : ""}>>`
    );

    const infoEntries = [
      this.info.title ? `/Title<${utf16Hex(this.info.title)}>` : "",
      this.info.author ? `/Author<${utf16Hex(this.info.author)}>` : "",
      this.info.subject ? `/Subject<${utf16Hex(this.info.subject)}>` : "",
      `/Producer<${utf16Hex("Smart Sign Invoice")}>`,
      `/CreationDate(${pdfDate(new Date())})`
    ].join("");
    set(infoRef, `<<${infoEntries}>>`);

    return serialize(objects, catalogRef, infoRef);
  }

  private writeType3Font(
    font: Type3Font,
    alloc: () => number,
    set: (ref: number, body: string) => void,
    setStream: (ref: number, dict: string, data: Uint8Array, compress?: boolean) => void
  ) {
    const fontRef = alloc();
    const toUnicodeRef = alloc();
    const bbox: [number, number, number, number] = [0, 0, 0, 0];
    const procs: string[] = [];

    font.glyphs.forEach((glyph, code) => {
      const procRef = alloc();
      const [x0, y0, x1, y1] = pathBounds(glyph.outline.path);
      bbox[0] = Math.min(bbox[0], x0);
      bbox[1] = Math.min(bbox[1], y0);
      bbox[2] = Math.max(bbox[2], x1);
      bbox[3] = Math.max(bbox[3], y1);
      // d1: the glyph has no colour of its own and is painted with the current fill colour.
      const body = glyph.outline.path.length > 0 ? `\n${pathToOps(glyph.outline.path)}\nf` : "";
      setStream(procRef, "", encoder.encode(`${num(glyph.outline.advance)} 0 ${x0} ${y0} ${x1} ${y1} d1${body}`));
      procs.push(`/g${code} ${procRef} 0 R`);
    });

    const codes = font.glyphs.map((_, code) => code);
    const scale = precise(1 / font.upem);
    set(
      fontRef,
      `<</Type/Font/Subtype/Type3/FontBBox[${bbox.join(" ")}]/FontMatrix[${scale} 0 0 ${scale} 0 0]` +
        `/CharProcs<<${procs.join("")}>>/Encoding<</Type/Encoding/Differences[0 ${codes.map((code) => `/g${code}`).join("")}]>>` +
        `/FirstChar 0/LastChar ${Math.max(codes.length - 1, 0)}/Widths[${font.glyphs.map((glyph) => num(glyph.outline.advance)).join(" ")}]` +
        `/ToUnicode ${toUnicodeRef} 0 R/Resources<<>>>>`
    );
    setStream(toUnicodeRef, "", encoder.encode(toUnicodeCMap(font.glyphs.map((glyph) => glyph.unicode))));

    return fontRef;
  }
}

function toUnicodeCMap(unicodes: string[]) {
  const entries = unicodes.map((text, code) => `<${code.toString(16).padStart(2, "0")}> <${utf16Hex(text, false)}>`);
  const blocks: string[] = [];

  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }

  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    ...blocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end"
  ].join("\n");
}

function serialize(objects: (Uint8Array | null)[], catalogRef: number, infoRef: number) {
  // The binary comment line tells transfer tools the file is binary.
  const header = new Uint8Array([...encoder.encode("%PDF-1.7\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  const chunks: Uint8Array[] = [header];
  const offsets: number[] = [];
  let length = header.length;

  objects.forEach((body, index) => {
    if (!body) throw new Error(`PDF object ${index + 1} was allocated but never written.`);
    offsets.push(length);
    const open = encoder.encode(`${index + 1} 0 obj\n`);
    const close = encoder.encode("\nendobj\n");
    chunks.push(open, body, close);
    length += open.length + body.length + close.length;
  });

  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(encoder.encode(`${xref}trailer\n<</Size ${objects.length + 1}/Root ${catalogRef} 0 R/Info ${infoRef} 0 R>>\nstartxref\n${length}\n%%EOF\n`));

  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
