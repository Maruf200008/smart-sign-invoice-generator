import { type GlyphOutline, type GlyphPlacement, type PathOp, type PdfDocument, type PdfPage, type Rgb } from "@/lib/pdf/pdf-writer";

/**
 * The drawing operations captured invoice pages are replayed with. One captured page can be drawn onto a PDF page
 * (vector) or onto a canvas (JPEG) with exactly the same geometry, so both formats come from a single DOM capture.
 *
 * The model is PDF's: build a path, then fill / stroke / clip it. Coordinates are CSS px, y down.
 */
export interface DrawSurface {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillColor(color: Rgb): void;
  strokeColor(color: Rgb): void;
  alpha(fill: number, stroke?: number): void;
  lineWidth(width: number): void;
  lineStyle(width: number, cap: string, join: string, miterLimit: number): void;
  /** Starts a new path. */
  path(path: PathOp[]): void;
  /** Starts a new rectangular path. */
  rect(x: number, y: number, width: number, height: number): void;
  fill(evenOdd?: boolean): void;
  stroke(): void;
  fillAndStroke(evenOdd?: boolean): void;
  clip(): void;
  /** A raster drawn at the given box (photos, characters no bundled font has). */
  image(source: HTMLCanvasElement, x: number, y: number, width: number, height: number): void;
  /** One word of shaped glyphs; placements are glyph origins in page space. */
  glyphs(placements: GlyphPlacement[], size: number, actualText: string, baseline: number): void;
}

function capCode(value: string) {
  return value === "round" ? 1 : value === "square" ? 2 : 0;
}

function joinCode(value: string) {
  return value === "round" ? 1 : value === "bevel" ? 2 : 0;
}

/** Writes PDF content-stream operators. Emits exactly what the PDF renderer always wrote. */
export class PdfSurface implements DrawSurface {
  constructor(
    private readonly page: PdfPage,
    private readonly pdf: PdfDocument,
    private readonly images: Map<HTMLCanvasElement, string | null>
  ) {}

  save() {
    this.page.save();
  }
  restore() {
    this.page.restore();
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.page.transform(a, b, c, d, e, f);
  }
  fillColor(color: Rgb) {
    this.page.fillColor(color);
  }
  strokeColor(color: Rgb) {
    this.page.strokeColor(color);
  }
  alpha(fill: number, stroke = fill) {
    this.page.alpha(fill, stroke);
  }
  lineWidth(width: number) {
    this.page.push(`${width} w`);
  }
  lineStyle(width: number, cap: string, join: string, miterLimit: number) {
    this.page.push(`${width} w ${capCode(cap)} J ${joinCode(join)} j ${miterLimit} M`);
  }
  path(path: PathOp[]) {
    this.page.path(path);
  }
  rect(x: number, y: number, width: number, height: number) {
    this.page.rect(x, y, width, height);
  }
  fill(evenOdd = false) {
    this.page.push(evenOdd ? "f*" : "f");
  }
  stroke() {
    this.page.push("S");
  }
  fillAndStroke(evenOdd = false) {
    this.page.push(evenOdd ? "B*" : "B");
  }
  clip() {
    this.page.push("W n");
  }
  image(source: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
    // Each raster is embedded once per document, however many times it's drawn.
    if (!this.images.has(source)) this.images.set(source, canvasToPdfImage(this.pdf, source));
    const name = this.images.get(source);
    if (name) this.page.image(name, x, y, width, height);
  }
  glyphs(placements: GlyphPlacement[], size: number, actualText: string, baseline: number) {
    this.page.glyphs(placements, size, actualText, baseline);
  }
}

/** Canvas -> lossless RGB image + alpha soft mask (the mask is dropped when fully opaque). */
function canvasToPdfImage(pdf: PdfDocument, canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) return null;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = canvas.width * canvas.height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;

  for (let index = 0; index < pixels; index += 1) {
    const a = data[index * 4 + 3];
    // Canvas data is un-premultiplied already; transparent pixels keep their (black) colour, masked out by alpha.
    rgb[index * 3] = data[index * 4];
    rgb[index * 3 + 1] = data[index * 4 + 1];
    rgb[index * 3 + 2] = data[index * 4 + 2];
    alpha[index] = a;
    if (a !== 255) opaque = false;
  }

  return pdf.addImage(canvas.width, canvas.height, rgb, opaque ? null : alpha);
}

/** The subset of CanvasRenderingContext2D the canvas surface uses (lets tests pass a recorder). */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "transform"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "bezierCurveTo"
  | "closePath"
  | "rect"
  | "fill"
  | "stroke"
  | "clip"
  | "drawImage"
  | "fillStyle"
  | "strokeStyle"
  | "globalAlpha"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "miterLimit"
  | "imageSmoothingEnabled"
  | "imageSmoothingQuality"
>;

interface CanvasState {
  fillAlpha: number;
  strokeAlpha: number;
}

const LINE_CAPS: Record<string, CanvasLineCap> = { round: "round", square: "square" };
const LINE_JOINS: Record<string, CanvasLineJoin> = { round: "round", bevel: "bevel" };

function rgbCss({ r, g, b }: Rgb) {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Replays the same operations on a 2D canvas. Glyphs are filled from the very outlines the PDF embeds, so the
 * image shows the HarfBuzz-shaped text (Bengali conjuncts and all) identically to the PDF, at any resolution.
 */
export class CanvasSurface implements DrawSurface {
  private state: CanvasState = { fillAlpha: 1, strokeAlpha: 1 };
  private readonly stack: CanvasState[] = [];
  private readonly glyphPaths = new Map<GlyphOutline, Path2D | PathOp[]>();

  constructor(private readonly context: Canvas2D) {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  }

  save() {
    this.stack.push({ ...this.state });
    this.context.save();
  }
  restore() {
    this.state = this.stack.pop() ?? { fillAlpha: 1, strokeAlpha: 1 };
    this.context.restore();
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.context.transform(a, b, c, d, e, f);
  }
  fillColor(color: Rgb) {
    this.context.fillStyle = rgbCss(color);
  }
  strokeColor(color: Rgb) {
    this.context.strokeStyle = rgbCss(color);
  }
  alpha(fill: number, stroke = fill) {
    // PDF keeps separate fill and stroke opacity; a canvas has one, set right before each paint.
    this.state.fillAlpha = fill;
    this.state.strokeAlpha = stroke;
  }
  lineWidth(width: number) {
    this.context.lineWidth = width;
  }
  lineStyle(width: number, cap: string, join: string, miterLimit: number) {
    this.context.lineWidth = width;
    this.context.lineCap = LINE_CAPS[cap] ?? "butt";
    this.context.lineJoin = LINE_JOINS[join] ?? "miter";
    this.context.miterLimit = miterLimit;
  }
  path(path: PathOp[]) {
    this.context.beginPath();
    tracePath(this.context, path);
  }
  rect(x: number, y: number, width: number, height: number) {
    this.context.beginPath();
    this.context.rect(x, y, width, height);
  }
  fill(evenOdd = false) {
    this.context.globalAlpha = this.state.fillAlpha;
    this.context.fill(evenOdd ? "evenodd" : "nonzero");
  }
  stroke() {
    this.context.globalAlpha = this.state.strokeAlpha;
    this.context.stroke();
  }
  fillAndStroke(evenOdd = false) {
    this.fill(evenOdd);
    this.stroke();
  }
  clip() {
    this.context.clip();
  }
  image(source: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
    this.context.globalAlpha = this.state.fillAlpha;
    this.context.drawImage(source, x, y, width, height);
  }
  glyphs(placements: GlyphPlacement[], size: number) {
    this.context.globalAlpha = this.state.fillAlpha;

    for (const placement of placements) {
      const outline = placement.outline();
      if (outline.path.length === 0) continue;
      const scale = size / placement.upem;

      this.context.save();
      // Glyph outlines are in font units with y up; the page is y down.
      this.context.transform(scale, 0, 0, -scale, placement.x, placement.y);
      const path = this.glyphPath(outline);
      if (Array.isArray(path)) {
        this.context.beginPath();
        tracePath(this.context, path);
        this.context.fill("nonzero");
      } else {
        this.context.fill(path, "nonzero");
      }
      this.context.restore();
    }
  }

  /** Each distinct glyph is turned into a Path2D once and reused for every occurrence. */
  private glyphPath(outline: GlyphOutline) {
    let path = this.glyphPaths.get(outline);
    if (!path) {
      if (typeof Path2D === "function") {
        const built = new Path2D();
        tracePath(built, outline.path);
        path = built;
      } else {
        path = outline.path;
      }
      this.glyphPaths.set(outline, path);
    }
    return path;
  }
}

function tracePath(target: Pick<CanvasPath, "moveTo" | "lineTo" | "bezierCurveTo" | "closePath">, path: PathOp[]) {
  for (const segment of path) {
    switch (segment.op) {
      case "M":
        target.moveTo(segment.x, segment.y);
        break;
      case "L":
        target.lineTo(segment.x, segment.y);
        break;
      case "C":
        target.bezierCurveTo(segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y);
        break;
      case "Z":
        target.closePath();
        break;
    }
  }
}

