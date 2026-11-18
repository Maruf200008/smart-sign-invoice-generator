import { type CapturedPage, drawCapturedPage } from "@/lib/pdf/dom-to-pdf";

/** CSS px are defined at 96 per inch, so an A4 page (794 px wide) at 300 dpi is 2481 px wide. */
export const CSS_DPI = 96;
export const JPEG_DPI = 300;
/** Lower resolutions tried, in order, when a device can't allocate a canvas at the requested one. */
const FALLBACK_DPIS = [240, 200, 150];
// Safari (iOS and macOS) refuses canvases over ~16.7 MP; most browsers cap a side at 16384 / 32767 px.
const MAX_CANVAS_AREA = 16_000_000;
const MAX_CANVAS_SIDE = 16_384;

export class RasterError extends Error {
  constructor(
    public readonly code: "out-of-memory" | "encode-failed",
    message: string
  ) {
    super(message);
    this.name = "RasterError";
  }
}

export interface RasterResult {
  blob: Blob;
  dpi: number;
  widthPx: number;
  heightPx: number;
}

/** Device pixel size of a page at `dpi`. */
export function rasterSize(page: Pick<CapturedPage, "widthPx" | "heightPx">, dpi: number) {
  const scale = dpi / CSS_DPI;
  return { width: Math.max(1, Math.round(page.widthPx * scale)), height: Math.max(1, Math.round(page.heightPx * scale)), scale };
}

/** True when a canvas of this size can be created on (practically) every browser. */
export function fitsCanvasLimits(width: number, height: number) {
  return width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE && width * height <= MAX_CANVAS_AREA;
}

/** The resolutions to attempt for a page, best first, skipping any that exceed canvas limits. */
export function candidateDpis(page: Pick<CapturedPage, "widthPx" | "heightPx">, dpi: number) {
  const candidates = [dpi, ...FALLBACK_DPIS.filter((value) => value < dpi)];
  const usable = candidates.filter((value) => {
    const { width, height } = rasterSize(page, value);
    return fitsCanvasLimits(width, height);
  });
  if (usable.length) return usable;

  // A very tall page: the largest resolution that still fits.
  const maxScale = Math.min(MAX_CANVAS_SIDE / page.widthPx, MAX_CANVAS_SIDE / page.heightPx, Math.sqrt(MAX_CANVAS_AREA / (page.widthPx * page.heightPx)));
  return [Math.max(1, Math.floor(maxScale * CSS_DPI))];
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      // Tainted or oversized canvases throw synchronously in some browsers.
      resolve(null);
    }
  });
}

/**
 * Draws one captured page onto a canvas and encodes it. The canvas is released right after encoding, so only
 * one page's pixels are ever in memory. Falls back to a lower resolution if the device can't allocate the canvas.
 */
export async function rasterizePage(page: CapturedPage, { dpi, type, quality }: { dpi: number; type: "image/jpeg" | "image/png"; quality: number }): Promise<RasterResult> {
  let lastError: unknown = null;

  for (const candidate of candidateDpis(page, dpi)) {
    const { width, height, scale } = rasterSize(page, candidate);
    const canvas = document.createElement("canvas");

    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      // A canvas the browser couldn't allocate has no context, or silently reports 0x0.
      if (!context || canvas.width !== width || canvas.height !== height) continue;

      drawCapturedPage(context, page, scale);
      const blob = await canvasToBlob(canvas, type, quality);
      if (blob && blob.size > 0) {
        const stamped = type === "image/jpeg" ? await withJpegDensity(blob, candidate) : blob;
        return { blob: stamped, dpi: candidate, widthPx: width, heightPx: height };
      }
    } catch (error) {
      lastError = error;
    } finally {
      // Frees the backing store immediately instead of waiting for garbage collection (matters on iOS).
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  if (lastError) console.error("Page rasterization failed", lastError);
  throw new RasterError(
    lastError ? "encode-failed" : "out-of-memory",
    "This device ran out of memory while creating the image."
  );
}

/**
 * Writes the resolution into a JPEG's JFIF header (units = dots per inch), so print and image apps size the page
 * as A4 instead of assuming 72 or 96 dpi. Returns the bytes unchanged when there is no JFIF header.
 */
export function setJpegDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  const isJfif =
    bytes.length > 18 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && // SOI
    bytes[2] === 0xff && bytes[3] === 0xe0 && // APP0
    bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00; // "JFIF\0"
  if (!isJfif) return bytes;

  const density = Math.max(1, Math.min(0xffff, Math.round(dpi)));
  const output = bytes.slice();
  output[13] = 1; // units: dots per inch
  output[14] = density >> 8;
  output[15] = density & 0xff;
  output[16] = density >> 8;
  output[17] = density & 0xff;
  return output;
}

async function withJpegDensity(blob: Blob, dpi: number) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([setJpegDensity(bytes, dpi) as BlobPart], { type: blob.type });
  } catch {
    return blob;
  }
}
