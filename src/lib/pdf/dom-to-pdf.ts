import { type Canvas2D, CanvasSurface, type DrawSurface, PdfSurface } from "@/lib/pdf/draw-surface";
import { type GlyphPlacement, PdfDocument, type PathOp, type Rgb } from "@/lib/pdf/pdf-writer";
import { ellipsePath, parseSvgPath, polyPath, roundedRectPath } from "@/lib/pdf/svg-path";
import { graphemes, type TextShaper } from "@/lib/pdf/text-shaper";

/**
 * Converts laid-out DOM elements into pages: one element per page (the invoice's A4 sheets).
 *
 * Nothing is re-laid-out here: every box, line break and word position is read from the browser's own layout
 * (getBoundingClientRect / Range rects), and only the glyph shapes are produced by HarfBuzz from the very same
 * font files the page uses. That is what makes the output match the on-screen invoice exactly.
 *
 * Work is split in two so one capture serves every export format:
 *  1. captureDomPages() walks the DOM once and records backend-neutral drawing primitives per page.
 *  2. capturedPagesToPdf() replays them as a vector PDF; drawCapturedPage() replays them on a canvas (JPEG).
 *
 * Each page is drawn relative to its own element's top-left corner and clipped to its own height.
 */

const PX_TO_PT = 0.75;

interface Primitive {
  top: number;
  bottom: number;
  draw: (page: DrawSurface) => void;
}

/** A page recorded from the DOM, independent of the output format. Holds no DOM references. */
export interface CapturedPage {
  widthPx: number;
  heightPx: number;
  primitives: readonly Primitive[];
}

interface Rgba extends Rgb {
  a: number;
}

export interface DomPdfPage {
  element: HTMLElement;
  /** Height of this PDF page in CSS px (the page width is shared). */
  heightPx: number;
}

export interface PdfInfo {
  title?: string;
  subject?: string;
  lang?: string;
}

export interface CaptureOptions {
  pageWidthPx: number;
  shaper: TextShaper;
}

export type DomToPdfOptions = CaptureOptions & PdfInfo;

export function parseCssColor(value: string | null | undefined): Rgba | null {
  if (!value || value === "transparent" || value === "none") return null;

  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = digits.split("").map((digit) => digit + digit).join("");
    const parts = digits.match(/../g)!.map((pair) => parseInt(pair, 16));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] / 255 : 1 };
  }

  // rgb()/rgba() in comma or space syntax, and color(srgb r g b / a).
  const isSrgb = value.startsWith("color(srgb");
  const numbers = value.match(/-?\d*\.?\d+(?:e[-+]?\d+)?%?/gi);
  if (!numbers || numbers.length < 3) return null;

  const channel = (token: string) => (token.endsWith("%") ? (parseFloat(token) / 100) * 255 : isSrgb ? parseFloat(token) * 255 : parseFloat(token));
  const alphaToken = numbers[3];
  const a = alphaToken === undefined ? 1 : alphaToken.endsWith("%") ? parseFloat(alphaToken) / 100 : parseFloat(alphaToken);

  return { r: channel(numbers[0]), g: channel(numbers[1]), b: channel(numbers[2]), a: Math.max(0, Math.min(1, a)) };
}

function isScreenReaderOnly(style: CSSStyleDeclaration) {
  return style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)");
}

/** Walks each page element once and records what to draw. Browser-only; the DOM must stay mounted until it resolves. */
export async function captureDomPages(pages: DomPdfPage[], options: CaptureOptions): Promise<CapturedPage[]> {
  if (pages.length === 0) throw new Error("Nothing to render.");
  // The page being captured: its element, its top-left corner and what is drawn on it.
  let root = pages[0].element;
  let origin = root.getBoundingClientRect();
  let primitives: Primitive[] = [];
  const baselineCache = new Map<string, number>();
  const range = document.createRange();

  const local = (rect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) => ({
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height
  });

  /** Distance from the top of a text fragment's rect to its baseline, measured with the exact same font. */
  const baselineOffset = (style: CSSStyleDeclaration) => {
    const key = `${style.fontFamily}|${style.fontWeight}|${style.fontSize}|${style.fontStyle}|${style.fontStretch}`;
    const cached = baselineCache.get(key);
    if (cached !== undefined) return cached;

    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;line-height:normal";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontWeight = style.fontWeight;
    probe.style.fontSize = style.fontSize;
    probe.style.fontStyle = style.fontStyle;
    probe.style.fontStretch = style.fontStretch;
    const text = document.createTextNode("Hxক");
    // An empty zero-height inline-block sits exactly on the baseline.
    const marker = document.createElement("span");
    marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    probe.append(text, marker);
    root.appendChild(probe);

    range.selectNodeContents(text);
    const offset = marker.getBoundingClientRect().bottom - range.getBoundingClientRect().top;
    probe.remove();
    baselineCache.set(key, offset);
    return offset;
  };

  const addBox = (element: Element, style: CSSStyleDeclaration, opacity: number) => {
    const box = local(element.getBoundingClientRect());
    if (box.width <= 0 || box.height <= 0) return;

    const radius = (value: string) => Math.min(parseFloat(value) || 0, box.width / 2, box.height / 2);
    const radii: [number, number, number, number] = [
      radius(style.borderTopLeftRadius),
      radius(style.borderTopRightRadius),
      radius(style.borderBottomRightRadius),
      radius(style.borderBottomLeftRadius)
    ];
    const rounded = radii.some((value) => value > 0);
    const background = parseCssColor(style.backgroundColor);

    const sides = (["Top", "Right", "Bottom", "Left"] as const).map((side) => {
      const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
      const lineStyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = parseCssColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
      return { width: lineStyle === "none" || lineStyle === "hidden" || !color || color.a === 0 ? 0 : width, color };
    });
    const hasBorder = sides.some((side) => side.width > 0);
    if ((!background || background.a === 0) && !hasBorder) return;

    primitives.push({
      top: box.y,
      bottom: box.y + box.height,
      draw: (page) => {
        if (background && background.a > 0) {
          page.save();
          page.alpha(background.a * opacity);
          page.fillColor(background);
          if (rounded) page.path(roundedRectPath(box.x, box.y, box.width, box.height, radii));
          else page.rect(box.x, box.y, box.width, box.height);
          page.fill();
          page.restore();
        }

        if (!hasBorder) return;
        const [top, right, bottom, left] = sides;
        const uniform = sides.every((side) => side.width === top.width && sameColor(side.color, top.color));

        if (uniform && rounded) {
          const inset = top.width / 2;
          page.save();
          page.alpha(top.color!.a * opacity);
          page.strokeColor(top.color!);
          page.lineWidth(top.width);
          page.path(roundedRectPath(box.x + inset, box.y + inset, box.width - top.width, box.height - top.width, radii.map((value) => Math.max(0, value - inset)) as [number, number, number, number]));
          page.stroke();
          page.restore();
          return;
        }

        const edges: [typeof top, number, number, number, number][] = [
          [top, box.x, box.y, box.width, top.width],
          [bottom, box.x, box.y + box.height - bottom.width, box.width, bottom.width],
          [left, box.x, box.y, left.width, box.height],
          [right, box.x + box.width - right.width, box.y, right.width, box.height]
        ];
        for (const [side, x, y, width, height] of edges) {
          if (side.width <= 0 || !side.color) continue;
          page.save();
          page.alpha(side.color.a * opacity);
          page.fillColor(side.color);
          page.rect(x, y, width, height);
          page.fill();
          page.restore();
        }
      }
    });
  };

  const addRasterText = (text: string, style: CSSStyleDeclaration, x: number, baseline: number, color: Rgba, opacity: number) => {
    // Last resort for characters no bundled font has (e.g. emoji): let the browser draw them at print resolution.
    const size = parseFloat(style.fontSize) || 16;
    const scale = 8;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width) + 2;
    canvas.width = width * scale;
    canvas.height = Math.ceil(size * 2) * scale;
    context.scale(scale, scale);
    context.font = font;
    context.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
    context.textBaseline = "alphabetic";
    context.fillText(text, 1, size * 1.4);
    primitives.push({
      top: baseline - size * 1.4,
      bottom: baseline + size * 0.6,
      draw: (page) => {
        page.save();
        page.alpha(opacity);
        page.image(canvas, x - 1, baseline - size * 1.4, width, size * 2);
        page.restore();
      }
    });
    return width - 2;
  };

  const addTextSegment = async (text: string, x: number, top: number, height: number, style: CSSStyleDeclaration, opacity: number) => {
    const color = parseCssColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    if (color.a === 0) return;

    const size = parseFloat(style.fontSize) || 16;
    const weight = parseInt(style.fontWeight, 10) || 400;
    const letterSpacing = parseFloat(style.letterSpacing) || 0;
    const baseline = top + baselineOffset(style);
    const runs = await options.shaper.shape(text, weight);
    const placements: GlyphPlacement[] = [];
    let pen = x;

    for (const run of runs) {
      if (run.kind === "missing") {
        pen += addRasterText(run.text, style, pen, baseline, color, color.a * opacity) + letterSpacing * graphemes(run.text).length;
        continue;
      }

      const scale = size / run.upem;
      let clusterCount = 0;
      for (const glyph of run.glyphs) {
        if (glyph.unicode) clusterCount += 1;
        placements.push({
          fontKey: run.fontKey,
          upem: run.upem,
          glyphId: glyph.glyphId,
          unicode: glyph.unicode,
          outline: () => run.outline(glyph.glyphId),
          x: pen + glyph.x * scale + letterSpacing * Math.max(0, clusterCount - 1),
          y: baseline - glyph.y * scale
        });
      }
      pen += run.advance * scale + letterSpacing * clusterCount;
    }

    primitives.push({
      top,
      bottom: top + height,
      draw: (page) => {
        page.save();
        page.alpha(color.a * opacity);
        page.fillColor(color);
        page.glyphs(placements, size, text, baseline);
        page.restore();
      }
    });
  };

  const addTextNode = async (node: Text, style: CSSStyleDeclaration, opacity: number) => {
    const data = node.data;
    if (!data.trim()) return;

    const transform = (value: string) =>
      style.textTransform === "uppercase" ? value.toLocaleUpperCase() : style.textTransform === "lowercase" ? value.toLocaleLowerCase() : value;

    for (const match of data.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      const word = match[0];
      range.setStart(node, start);
      range.setEnd(node, start + word.length);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.01 && rect.height > 0);
      if (rects.length === 0) continue;

      if (rects.length === 1) {
        const rect = local(rects[0]);
        await addTextSegment(transform(word), rect.x, rect.y, rect.height, style, opacity);
        continue;
      }

      // The word itself wraps (overflow-wrap: anywhere): split it at the browser's line breaks, by grapheme.
      let line: { text: string; x: number; y: number; height: number } | null = null;
      let offset = start;
      for (const grapheme of graphemes(word)) {
        range.setStart(node, offset);
        range.setEnd(node, offset + grapheme.length);
        offset += grapheme.length;
        const rect = Array.from(range.getClientRects()).find((candidate) => candidate.width > 0.01);
        if (!rect) {
          if (line) line.text += grapheme;
          continue;
        }

        const box = local(rect);
        if (!line || Math.abs(box.y - line.y) > box.height / 2) {
          if (line) await addTextSegment(transform(line.text), line.x, line.y, line.height, style, opacity);
          line = { text: grapheme, x: box.x, y: box.y, height: box.height };
        } else {
          line.text += grapheme;
        }
      }
      if (line) await addTextSegment(transform(line.text), line.x, line.y, line.height, style, opacity);
    }
  };

  const addSvg = (svg: SVGSVGElement, opacity: number) => {
    // getCTM() maps to the <svg> viewport; anchoring it on the svg's own box avoids browser differences in
    // whether getScreenCTM() includes scrolling.
    const svgBox = svg.getBoundingClientRect();
    const svgStyle = getComputedStyle(svg);
    const viewportX = svgBox.left - origin.left + (parseFloat(svgStyle.borderLeftWidth) || 0) + (parseFloat(svgStyle.paddingLeft) || 0);
    const viewportY = svgBox.top - origin.top + (parseFloat(svgStyle.borderTopWidth) || 0) + (parseFloat(svgStyle.paddingTop) || 0);
    const shapes = svg.querySelectorAll<SVGGraphicsElement>("path, rect, circle, ellipse, line, polyline, polygon");

    for (const shape of Array.from(shapes)) {
      if (shape.closest("defs, clipPath, mask, symbol, marker, pattern")) continue;
      const style = getComputedStyle(shape);
      if (style.display === "none" || style.visibility !== "visible") continue;

      const path = svgShapePath(shape);
      const matrix = shape.getCTM();
      if (!path.length || !matrix) continue;

      let shapeOpacity = opacity;
      for (let node: Element | null = shape; node && node !== svg.parentElement; node = node.parentElement) {
        shapeOpacity *= parseFloat(getComputedStyle(node).opacity) || (getComputedStyle(node).opacity === "0" ? 0 : 1);
      }
      if (shapeOpacity <= 0) continue;

      const fill = parseCssColor(style.fill);
      const stroke = parseCssColor(style.stroke);
      const strokeWidth = parseFloat(style.strokeWidth) || 0;
      const fillAlpha = (fill?.a ?? 0) * (parseFloat(style.fillOpacity) || 0) * shapeOpacity;
      const strokeAlpha = (stroke?.a ?? 0) * (parseFloat(style.strokeOpacity) || 0) * shapeOpacity;
      const doFill = !!fill && fillAlpha > 0;
      const doStroke = !!stroke && strokeAlpha > 0 && strokeWidth > 0;
      if (!doFill && !doStroke) continue;

      const bounds = local(shape.getBoundingClientRect());
      const pad = strokeWidth * Math.hypot(matrix.a, matrix.b);
      const evenOdd = style.fillRule === "evenodd";
      // Read now: the captured page may be replayed after the off-screen DOM (and its computed styles) is gone.
      const lineCap = style.strokeLinecap;
      const lineJoin = style.strokeLinejoin;
      const miterLimit = parseFloat(style.strokeMiterlimit) || 4;

      primitives.push({
        top: bounds.y - pad,
        bottom: bounds.y + bounds.height + pad,
        draw: (page) => {
          page.save();
          page.alpha(doFill ? fillAlpha : 1, doStroke ? strokeAlpha : 1);
          page.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e + viewportX, matrix.f + viewportY);
          if (doFill) page.fillColor(fill!);
          if (doStroke) {
            page.strokeColor(stroke!);
            page.lineStyle(strokeWidth, lineCap, lineJoin, miterLimit);
          }
          page.path(path);
          if (doFill && doStroke) page.fillAndStroke(evenOdd);
          else if (doFill) page.fill(evenOdd);
          else page.stroke();
          page.restore();
        }
      });
    }
  };

  const addImage = async (image: HTMLImageElement, style: CSSStyleDeclaration, opacity: number) => {
    const box = local(image.getBoundingClientRect());
    if (box.width <= 0 || box.height <= 0 || !image.currentSrc && !image.src) return;
    const source = image.currentSrc || image.src;

    if (/\.svg(?:[?#]|$)/i.test(source) || source.startsWith("data:image/svg")) {
      const inline = await inlineSvgImage(source, style.objectFit);
      if (inline) {
        // Place the parsed SVG exactly over the <img> so the browser resolves its styles and transforms.
        const holder = document.createElement("div");
        holder.style.cssText = `position:absolute;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;pointer-events:none`;
        holder.appendChild(inline);
        root.appendChild(holder);
        addSvg(inline, opacity);
        holder.remove();
        return;
      }
    }

    try {
      await image.decode();
    } catch {
      return;
    }

    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight) return;
    const target = fitRect(box, naturalWidth, naturalHeight, style.objectFit);
    // Enough pixels for 600 dpi at the printed size, never more than the source has.
    const maxPixels = Math.ceil((target.width / 96) * 600);
    const scale = Math.min(1, maxPixels / naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    primitives.push({
      top: target.y,
      bottom: target.y + target.height,
      draw: (page) => {
        page.save();
        page.alpha(opacity);
        page.image(canvas, target.x, target.y, target.width, target.height);
        page.restore();
      }
    });
  };

  const walk = async (element: Element, inheritedOpacity: number) => {
    if (element instanceof HTMLElement && (element.dataset.pdfIgnore !== undefined || element.classList.contains("no-print"))) return;
    const style = getComputedStyle(element);
    if (style.display === "none" || isScreenReaderOnly(style)) return;

    const opacity = inheritedOpacity * (parseFloat(style.opacity) || (style.opacity === "0" ? 0 : 1));
    if (opacity <= 0.001) return;
    const visible = style.visibility === "visible";

    if (element instanceof SVGSVGElement) {
      if (visible) addSvg(element, opacity);
      return;
    }
    if (element instanceof HTMLImageElement) {
      if (visible) await addImage(element, style, opacity);
      return;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      // Form controls never appear in the document this renderer is given.
      return;
    }

    if (visible) addBox(element, style, opacity);

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (visible) await addTextNode(child as Text, style, opacity);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        await walk(child as Element, opacity);
      }
    }
  };

  const captured: CapturedPage[] = [];
  for (const { element, heightPx } of pages) {
    root = element;
    origin = element.getBoundingClientRect();
    primitives = [];
    await walk(element, 1);
    // Off-page primitives are dropped once here instead of on every replay.
    captured.push({
      widthPx: options.pageWidthPx,
      heightPx,
      primitives: primitives.filter((primitive) => primitive.bottom > 0.01 && primitive.top < heightPx - 0.01)
    });
  }

  range.detach?.();
  return captured;
}

/** Replays captured pages into a vector PDF (one PDF page per captured page). */
export function capturedPagesToPdf(pages: CapturedPage[], info: PdfInfo = {}): Uint8Array {
  if (pages.length === 0) throw new Error("Nothing to render.");
  const pdf = new PdfDocument({ title: info.title, subject: info.subject, lang: info.lang });
  const images = new Map<HTMLCanvasElement, string | null>();

  for (const captured of pages) {
    const page = pdf.addPage(captured.widthPx * PX_TO_PT, captured.heightPx * PX_TO_PT);
    const surface = new PdfSurface(page, pdf, images);
    surface.save();
    // Work in CSS px with a top-left origin, like the DOM.
    surface.transform(PX_TO_PT, 0, 0, -PX_TO_PT, 0, captured.heightPx * PX_TO_PT);
    drawPrimitives(surface, captured);
    surface.restore();
  }

  return pdf.save();
}

/**
 * Replays a captured page onto a 2D canvas at `scale` device pixels per CSS px (300 dpi = 300 / 96).
 * The caller sizes the canvas; the page is painted on white so formats without alpha (JPEG) look like paper.
 */
export function drawCapturedPage(context: Canvas2D, page: CapturedPage, scale: number) {
  const surface = new CanvasSurface(context);
  surface.save();
  surface.transform(scale, 0, 0, scale, 0, 0);
  surface.fillColor({ r: 255, g: 255, b: 255 });
  surface.rect(0, 0, page.widthPx, page.heightPx);
  surface.fill();
  drawPrimitives(surface, page);
  surface.restore();
}

function drawPrimitives(surface: DrawSurface, page: CapturedPage) {
  surface.rect(0, 0, page.widthPx, page.heightPx);
  surface.clip();
  for (const primitive of page.primitives) primitive.draw(surface);
}

/** Convenience: capture and write the PDF in one go. */
export async function renderDomToPdf(pages: DomPdfPage[], options: DomToPdfOptions): Promise<Uint8Array> {
  return capturedPagesToPdf(await captureDomPages(pages, options), options);
}

function sameColor(a: Rgba | null, b: Rgba | null) {
  return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function attr(element: Element, name: string) {
  return parseFloat(element.getAttribute(name) ?? "") || 0;
}

export function svgShapePath(shape: Element): PathOp[] {
  switch (shape.tagName.toLowerCase()) {
    case "path":
      return parseSvgPath(shape.getAttribute("d") ?? "");
    case "rect": {
      const width = attr(shape, "width");
      const height = attr(shape, "height");
      if (width <= 0 || height <= 0) return [];
      let rx = shape.hasAttribute("rx") ? attr(shape, "rx") : attr(shape, "ry");
      let ry = shape.hasAttribute("ry") ? attr(shape, "ry") : rx;
      rx = Math.min(rx, width / 2);
      ry = Math.min(ry, height / 2);
      const radius = Math.min(rx, ry);
      return roundedRectPath(attr(shape, "x"), attr(shape, "y"), width, height, [radius, radius, radius, radius]);
    }
    case "circle":
      return ellipsePath(attr(shape, "cx"), attr(shape, "cy"), attr(shape, "r"), attr(shape, "r"));
    case "ellipse":
      return ellipsePath(attr(shape, "cx"), attr(shape, "cy"), attr(shape, "rx"), attr(shape, "ry"));
    case "line":
      return [
        { op: "M", x: attr(shape, "x1"), y: attr(shape, "y1") },
        { op: "L", x: attr(shape, "x2"), y: attr(shape, "y2") }
      ];
    case "polyline":
      return polyPath(shape.getAttribute("points") ?? "", false);
    case "polygon":
      return polyPath(shape.getAttribute("points") ?? "", true);
    default:
      return [];
  }
}

function fitRect(box: { x: number; y: number; width: number; height: number }, naturalWidth: number, naturalHeight: number, objectFit: string) {
  if (objectFit !== "contain" && objectFit !== "scale-down") return box;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

const svgCache = new Map<string, Promise<string | null>>();

/** Fetches an SVG file and returns a self-contained <svg> element (class rules inlined, <style> removed). */
async function inlineSvgImage(source: string, objectFit: string): Promise<SVGSVGElement | null> {
  let text = svgCache.get(source);
  if (!text) {
    text = fetch(source)
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null);
    svgCache.set(source, text);
  }

  const markup = await text;
  if (!markup) return null;

  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  if (!(svg instanceof SVGSVGElement) || parsed.querySelector("parsererror")) return null;

  // Apply simple ".class { ... }" rules inline so they can't leak into, or be affected by, the page's CSS.
  for (const styleElement of Array.from(svg.querySelectorAll("style"))) {
    for (const rule of (styleElement.textContent ?? "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1].split(",").map((selector) => selector.trim()).filter((selector) => /^\.[\w-]+$/.test(selector));
      for (const selector of selectors) {
        svg.querySelectorAll(selector).forEach((element) => {
          element.setAttribute("style", `${rule[2]};${element.getAttribute("style") ?? ""}`);
        });
      }
    }
    styleElement.remove();
  }
  svg.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  svg.removeAttribute("id");

  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", objectFit === "fill" ? "none" : objectFit === "cover" ? "xMidYMid slice" : "xMidYMid meet");
  svg.style.display = "block";
  return document.importNode(svg, true);
}

