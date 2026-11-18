import type * as HarfBuzzModule from "harfbuzzjs";
import { BUNDLED_FONT_FAMILIES, type BundledFontFamily, pickFontFile } from "@/lib/fonts/font-registry";
import type { GlyphOutline, PathOp } from "@/lib/pdf/pdf-writer";

export type HarfBuzz = typeof HarfBuzzModule;

/** Fetches a font file's bytes. Injected so the shaper also runs in Node tests. */
export type FontLoader = (url: string) => Promise<ArrayBuffer>;

export interface ShapedGlyph {
  glyphId: number;
  /** Glyph origin relative to the run start, in font units (x right, y up). */
  x: number;
  y: number;
  /** Characters this glyph stands for when text is copied (see shapeWith). */
  unicode: string;
}

export type ShapedRun =
  | { kind: "glyphs"; fontKey: string; upem: number; text: string; glyphs: ShapedGlyph[]; advance: number; outline: (glyphId: number) => GlyphOutline }
  /** No bundled font has these characters (e.g. emoji); the caller rasterises them with the browser's fonts. */
  | { kind: "missing"; text: string };

interface FontFile {
  face: HarfBuzzModule.Face;
  upem: number;
  unicodes: Set<number>;
  instances: Map<number, HarfBuzzModule.Font>;
  outlines: Map<string, GlyphOutline>;
}

// Format/joiner characters that are legitimately absent from a font's cmap; they never decide the font.
const IGNORABLE = /[​-‏⁠︀-️﻿]/u;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function graphemes(text: string) {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

/**
 * Shapes text with HarfBuzz (the engine Chrome, Firefox and Android use) using the bundled font chain from the
 * font registry, picking the first family that covers each grapheme — the same rule as CSS font fallback.
 */
export class TextShaper {
  private readonly files = new Map<string, Promise<FontFile>>();

  constructor(
    private readonly hb: HarfBuzz,
    private readonly loadFont: FontLoader,
    private readonly families: readonly BundledFontFamily[] = BUNDLED_FONT_FAMILIES
  ) {}

  private file(url: string) {
    let file = this.files.get(url);
    if (!file) {
      file = this.loadFont(url).then((bytes) => {
        const face = new this.hb.Face(new this.hb.Blob(bytes));
        return { face, upem: face.upem, unicodes: new Set(face.collectUnicodes()), instances: new Map(), outlines: new Map() };
      });
      // Don't cache a failed download; the next PDF attempt retries.
      file.catch(() => this.files.delete(url));
      this.files.set(url, file);
    }
    return file;
  }

  /** Loads every file of the primary family so the first export doesn't wait on it. */
  async warmUp() {
    await Promise.all(this.families[0].files.map((file) => this.file(file.url)));
  }

  private async familyFor(grapheme: string): Promise<number> {
    const codepoints = Array.from(grapheme)
      .filter((char) => !IGNORABLE.test(char))
      .map((char) => char.codePointAt(0) as number);

    for (let index = 0; index < this.families.length; index += 1) {
      // Every file of a family has the same character set, so the first file decides coverage.
      const file = await this.file(this.families[index].files[0].url);
      if (codepoints.every((codepoint) => file.unicodes.has(codepoint))) return index;
    }

    return -1;
  }

  private instance(file: FontFile, variable: boolean, weight: number) {
    const key = variable ? weight : 0;
    let font = file.instances.get(key);
    if (!font) {
      font = new this.hb.Font(file.face);
      if (variable) font.setVariations([new this.hb.Variation("wght", weight)]);
      file.instances.set(key, font);
    }
    return font;
  }

  async shape(text: string, weight: number): Promise<ShapedRun[]> {
    const groups: { family: number; text: string }[] = [];

    for (const grapheme of graphemes(text)) {
      const family = await this.familyFor(grapheme);
      const last = groups[groups.length - 1];
      if (last && last.family === family) last.text += grapheme;
      else groups.push({ family, text: grapheme });
    }

    const runs: ShapedRun[] = [];
    for (const group of groups) {
      if (group.family < 0) {
        runs.push({ kind: "missing", text: group.text });
        continue;
      }

      const { file: fontFile, weight: faceWeight } = pickFontFile(this.families[group.family].files, weight);
      const variable = typeof fontFile.weight !== "number";
      const file = await this.file(fontFile.url);
      const font = this.instance(file, variable, faceWeight);
      runs.push(this.shapeWith(font, file, `${fontFile.url}${variable ? `#wght=${faceWeight}` : ""}`, group.text));
    }

    return runs;
  }

  private shapeWith(font: HarfBuzzModule.Font, file: FontFile, fontKey: string, text: string): ShapedRun {
    const buffer = new this.hb.Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    this.hb.shape(font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();

    // Clusters are UTF-16 offsets into `text`; map each to the text it covers.
    const starts = Array.from(new Set(infos.map((info) => info.cluster))).sort((a, b) => a - b);
    const clusterText = new Map(starts.map((start, index) => [start, text.slice(start, starts[index + 1] ?? text.length)]));
    // Copy/paste text per glyph: a cluster's characters are handed out to its glyphs in visual order, so
    // concatenating the glyphs always gives the cluster's logical text (কি -> [ি glyph: "ক", ক glyph: "ি"]).
    // Viewers read text glyph by glyph; this keeps extraction correct even where they ignore /ActualText.
    // A glyph left without a character gets an invisible WORD JOINER rather than an empty (= garbage) mapping.
    const glyphCount = new Map<number, number>();
    infos.forEach((info) => glyphCount.set(info.cluster, (glyphCount.get(info.cluster) ?? 0) + 1));
    const used = new Map<number, number>();
    const unicodeFor = (cluster: number) => {
      const chars = Array.from(clusterText.get(cluster) ?? "");
      const count = glyphCount.get(cluster) ?? 1;
      const index = used.get(cluster) ?? 0;
      used.set(cluster, index + 1);
      if (index >= chars.length) return "⁠";
      return index === count - 1 ? chars.slice(index).join("") : chars[index];
    };

    let pen = 0;
    const glyphs: ShapedGlyph[] = infos.map((info, index) => {
      const position = positions[index];
      const glyph = { glyphId: info.codepoint, x: pen + position.xOffset, y: position.yOffset, unicode: unicodeFor(info.cluster) };
      pen += position.xAdvance;
      return glyph;
    });

    const outline = (glyphId: number) => {
      const key = `${fontKey}:${glyphId}`;
      let cached = file.outlines.get(key);
      if (!cached) {
        cached = { advance: font.glyphHAdvance(glyphId), path: toPathOps(font.glyphToJson(glyphId)) };
        file.outlines.set(key, cached);
      }
      return cached;
    };

    return { kind: "glyphs", fontKey, upem: file.upem, text, glyphs, advance: pen, outline };
  }
}

/** HarfBuzz draw commands (font units, y up; quadratic for TrueType) -> PDF path ops. */
export function toPathOps(commands: { type: string; values: number[] }[]): PathOp[] {
  const path: PathOp[] = [];
  let x = 0;
  let y = 0;

  for (const { type, values } of commands) {
    switch (type) {
      case "M":
        [x, y] = values;
        path.push({ op: "M", x, y });
        break;
      case "L":
        [x, y] = values;
        path.push({ op: "L", x, y });
        break;
      case "Q": {
        const [qx, qy, endX, endY] = values;
        path.push({ op: "C", x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: endX + (2 / 3) * (qx - endX), y2: endY + (2 / 3) * (qy - endY), x: endX, y: endY });
        x = endX;
        y = endY;
        break;
      }
      case "C": {
        const [x1, y1, x2, y2, endX, endY] = values;
        path.push({ op: "C", x1, y1, x2, y2, x: endX, y: endY });
        x = endX;
        y = endY;
        break;
      }
      case "Z":
        path.push({ op: "Z" });
        break;
    }
  }

  return path;
}
