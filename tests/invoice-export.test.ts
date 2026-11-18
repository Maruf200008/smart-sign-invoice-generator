import { readFileSync } from "fs";
import { join } from "path";
import { unzipSync } from "fflate";
import * as hb from "harfbuzzjs";
import { describe, expect, it } from "vitest";
import {
  buildJpegFileNames,
  buildZipFileName,
  canShareFiles,
  describeExportError,
  EXPORT_FORMATS,
  InvoiceExportError,
  isExportFormat,
  zipFiles
} from "@/lib/invoice-export";
import { PAGE_HEIGHT_PX, PAGE_WIDTH_PX } from "@/lib/invoice-sheet/sheet-metrics";
import { type CapturedPage, capturedPagesToPdf, drawCapturedPage } from "@/lib/pdf/dom-to-pdf";
import { type Canvas2D, CanvasSurface, PdfSurface } from "@/lib/pdf/draw-surface";
import { candidateDpis, fitsCanvasLimits, RasterError, rasterSize, setJpegDensity } from "@/lib/pdf/page-raster";
import { type GlyphPlacement, PdfDocument } from "@/lib/pdf/pdf-writer";
import { TextShaper } from "@/lib/pdf/text-shaper";
import { roundedRectPath } from "@/lib/pdf/svg-path";

/** Records every call and property write made on a fake 2D context. */
function recordingContext() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const context = new Proxy(target, {
    get(object, property: string) {
      if (property in object) return object[property];
      return (...args: unknown[]) => {
        calls.push(`${property}(${args.map((arg) => (typeof arg === "number" ? +arg.toFixed(4) : typeof arg === "object" ? "obj" : String(arg))).join(",")})`);
      };
    },
    set(object, property: string, value) {
      object[property] = value;
      calls.push(`${property}=${value}`);
      return true;
    }
  });
  return { context: context as unknown as Canvas2D, calls };
}

function fakeCanvas(width: number, height: number, alpha = 255) {
  const data = new Uint8ClampedArray(width * height * 4).fill(alpha);
  return {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data }) })
  } as unknown as HTMLCanvasElement;
}

describe("PDF surface (no PDF regression)", () => {
  it("emits exactly the operators the PDF renderer always wrote", () => {
    const pdf = new PdfDocument();
    const page = pdf.addPage(100, 100);
    const surface = new PdfSurface(page, pdf, new Map());

    surface.rect(0, 0, 10, 20);
    surface.clip();
    surface.fill();
    surface.fill(true);
    surface.stroke();
    surface.fillAndStroke();
    surface.fillAndStroke(true);
    surface.lineWidth(0.5);
    surface.lineStyle(1.5, "round", "bevel", 4);
    surface.lineStyle(2, "butt", "miter", 10);

    expect(page.ops).toEqual(["0 0 10 20 re", "W n", "f", "f*", "S", "B", "B*", "0.5 w", "1.5 w 1 J 2 j 4 M", "2 w 0 J 0 j 10 M"]);
  });

  it("embeds each raster once however often it's drawn", () => {
    const pdf = new PdfDocument();
    const images = new Map<HTMLCanvasElement, string | null>();
    const canvas = fakeCanvas(2, 2);
    const first = pdf.addPage(10, 10);
    const second = pdf.addPage(10, 10);
    new PdfSurface(first, pdf, images).image(canvas, 0, 0, 5, 5);
    new PdfSurface(second, pdf, images).image(canvas, 1, 1, 5, 5);

    expect(images.size).toBe(1);
    expect(first.ops.join(" ")).toContain("/Im0 Do");
    expect(second.ops.join(" ")).toContain("/Im0 Do");
  });

  it("replays captured pages into a multi-page A4 PDF in order", () => {
    const page = (label: number): CapturedPage => ({
      widthPx: PAGE_WIDTH_PX,
      heightPx: PAGE_HEIGHT_PX,
      primitives: [
        {
          top: 0,
          bottom: 10,
          draw: (surface) => {
            surface.fillColor({ r: label, g: 0, b: 0 });
            surface.rect(0, 0, 10, 10);
            surface.fill();
          }
        }
      ]
    });

    const bytes = capturedPagesToPdf([page(1), page(2), page(3)], { title: "Invoice 7" });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toMatch(/\/Count 3/);
    expect(text.match(/\/MediaBox\[0 0 595\.276 841\.89\]/g)).toHaveLength(3);
    expect(() => capturedPagesToPdf([])).toThrow();
  });
});

describe("canvas surface (JPEG renderer)", () => {
  it("paints a white page, clips it, then replays the primitives at the requested scale", () => {
    const { context, calls } = recordingContext();
    const captured: CapturedPage = {
      widthPx: 100,
      heightPx: 200,
      primitives: [
        {
          top: 0,
          bottom: 5,
          draw: (surface) => {
            surface.fillColor({ r: 227, g: 39, b: 46 });
            surface.rect(1, 2, 3, 4);
            surface.fill();
          }
        }
      ]
    };

    drawCapturedPage(context, captured, 300 / 96);

    expect(calls).toEqual([
      "imageSmoothingEnabled=true",
      "imageSmoothingQuality=high",
      "save()",
      "transform(3.125,0,0,3.125,0,0)",
      "fillStyle=rgb(255, 255, 255)",
      "beginPath()",
      "rect(0,0,100,200)",
      "globalAlpha=1",
      "fill(nonzero)",
      "beginPath()",
      "rect(0,0,100,200)",
      "clip()",
      "fillStyle=rgb(227, 39, 46)",
      "beginPath()",
      "rect(1,2,3,4)",
      "globalAlpha=1",
      "fill(nonzero)",
      "restore()"
    ]);
  });

  it("keeps PDF's separate fill and stroke opacity, and restores it", () => {
    const { context, calls } = recordingContext();
    const surface = new CanvasSurface(context);
    surface.save();
    surface.alpha(0.25, 0.75);
    surface.path(roundedRectPath(0, 0, 10, 10, [2, 2, 2, 2]));
    surface.fillAndStroke(true);
    surface.restore();
    surface.rect(0, 0, 1, 1);
    surface.fill();

    expect(calls).toContain("globalAlpha=0.25");
    expect(calls).toContain("fill(evenodd)");
    expect(calls.indexOf("globalAlpha=0.75")).toBeGreaterThan(calls.indexOf("fill(evenodd)"));
    expect(calls.slice(-2)).toEqual(["globalAlpha=1", "fill(nonzero)"]);
  });

  it("maps CSS line caps and joins", () => {
    const { context } = recordingContext();
    const surface = new CanvasSurface(context);
    surface.lineStyle(2, "square", "round", 6);
    expect(context).toMatchObject({ lineWidth: 2, lineCap: "square", lineJoin: "round", miterLimit: 6 });
    surface.lineStyle(1, "butt", "miter", 4);
    expect(context).toMatchObject({ lineCap: "butt", lineJoin: "miter" });
  });

  it("fills shaped Bengali glyphs from the same outlines the PDF embeds, flipped to y-down", async () => {
    const fontPath = (url: string) => join(process.cwd(), "public", url.replace(/^\//, ""));
    const shaper = new TextShaper(hb, async (url) => {
      const buffer = readFileSync(fontPath(url));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    });
    const [run] = await shaper.shape("ক্ষ", 400);
    if (run.kind !== "glyphs") throw new Error("expected glyphs");

    const placements: GlyphPlacement[] = run.glyphs.map((glyph) => ({
      fontKey: run.fontKey,
      upem: run.upem,
      glyphId: glyph.glyphId,
      unicode: glyph.unicode,
      outline: () => run.outline(glyph.glyphId),
      x: 10,
      y: 20
    }));
    const { context, calls } = recordingContext();
    new CanvasSurface(context).glyphs(placements, 16);

    const scale = +(16 / run.upem).toFixed(4);
    expect(calls).toContain(`transform(${scale},0,0,${-scale},10,20)`);
    // In Node there's no Path2D, so outlines are traced directly; a conjunct is real curves, not a box.
    expect(calls.filter((call) => call.startsWith("bezierCurveTo")).length).toBeGreaterThan(4);
    expect(calls).toContain("fill(nonzero)");
  });
});

describe("JPEG rasterization limits", () => {
  it("renders A4 at 300 dpi", () => {
    const { width, height } = rasterSize({ widthPx: PAGE_WIDTH_PX, heightPx: PAGE_HEIGHT_PX }, 300);
    expect(width).toBe(2480);
    expect(height).toBe(3508);
    expect(fitsCanvasLimits(width, height)).toBe(true);
    expect(candidateDpis({ widthPx: PAGE_WIDTH_PX, heightPx: PAGE_HEIGHT_PX }, 300)[0]).toBe(300);
  });

  it("steps down for pages too large for a canvas, but never fails to offer a size", () => {
    const tall = { widthPx: PAGE_WIDTH_PX, heightPx: PAGE_HEIGHT_PX * 2 };
    const dpis = candidateDpis(tall, 300);
    expect(dpis[0]).toBeLessThan(300);
    for (const dpi of dpis) {
      const { width, height } = rasterSize(tall, dpi);
      expect(fitsCanvasLimits(width, height)).toBe(true);
    }

    const huge = { widthPx: PAGE_WIDTH_PX, heightPx: 100_000 };
    const [only] = candidateDpis(huge, 300);
    const size = rasterSize(huge, only);
    expect(fitsCanvasLimits(size.width, size.height)).toBe(true);
  });

  it("stamps the resolution into the JFIF header", () => {
    const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    const stamped = setJpegDensity(jfif, 300);
    expect(Array.from(stamped.slice(13, 18))).toEqual([1, 0x01, 0x2c, 0x01, 0x2c]);
    expect(jfif[13]).toBe(0); // the input is left untouched

    const notJfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(setJpegDensity(notJfif, 300)).toBe(notJfif);
  });
});

describe("export files", () => {
  it("offers both PDF and JPEG", () => {
    expect(EXPORT_FORMATS).toEqual(["pdf", "jpeg"]);
    expect(isExportFormat("jpeg")).toBe(true);
    expect(isExportFormat("png")).toBe(false);
  });

  it("names JPEG pages after the To field, in sortable page order", () => {
    expect(buildJpegFileNames("Rahim Ahmed", 1)).toEqual(["Rahim Ahmed.jpg"]);
    expect(buildJpegFileNames("Rahim Ahmed", 2)).toEqual(["Rahim Ahmed - Page 1 of 2.jpg", "Rahim Ahmed - Page 2 of 2.jpg"]);
    const many = buildJpegFileNames("", 12);
    expect(many[0]).toBe("Invoice - Page 01 of 12.jpg");
    expect([...many].sort()).toEqual(many);
    expect(buildJpegFileNames("a/b:c", 0)).toEqual(["a b c.jpg"]);
    expect(buildZipFileName("রহিম")).toBe("রহিম (JPEG).zip");
  });

  it("zips multi-page JPEGs in page order", async () => {
    const files = buildJpegFileNames("Client", 3).map((name, index) => new File([new Uint8Array([0xff, 0xd8, index])], name, { type: "image/jpeg" }));
    const zip = await zipFiles(files, buildZipFileName("Client"));
    expect(zip.type).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(files.map((file) => file.name));
    expect(Array.from(entries["Client - Page 3 of 3.jpg"])).toEqual([0xff, 0xd8, 2]);
  });

  it("reports that files can't be shared where Web Share is unavailable", () => {
    expect(canShareFiles([new File(["x"], "a.pdf")])).toBe(false);
  });

  it("explains failures in plain language", () => {
    expect(describeExportError(new RasterError("out-of-memory", "x"), "jpeg")).toMatch(/ran out of memory/);
    expect(describeExportError(new RangeError("Invalid array length"), "pdf")).toMatch(/too large .* a PDF/);
    expect(describeExportError(new Error("Font request failed (404): /fonts/x.ttf"), "pdf")).toMatch(/fonts couldn't be loaded/);
    expect(describeExportError(new InvoiceExportError("share-failed", "Custom."), "jpeg")).toBe("Custom.");
    expect(describeExportError(new Error("boom"), "jpeg")).toBe("Couldn't create the invoice image. Please try again.");
  });
});
