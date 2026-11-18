/**
 * Invoice pages are A4: rows are split 12 per page (see pagination.ts). A page only grows taller than A4 in the
 * rare case its own content can't fit (e.g. very long descriptions), so nothing is ever clipped.
 */
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

export const PX_PER_MM = 96 / 25.4;
export const PT_PER_MM = 72 / 25.4;

export const PAGE_WIDTH_PX = PAGE_WIDTH_MM * PX_PER_MM;
export const PAGE_HEIGHT_PX = PAGE_HEIGHT_MM * PX_PER_MM;
export const PAGE_WIDTH_PT = PAGE_WIDTH_MM * PT_PER_MM;
export const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * PT_PER_MM;

export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;

/** Sub-pixel slack so measuring noise never turns a page that fits A4 into an extended page. */
const FIT_EPSILON_PX = 0.5;

/** Whether content of this natural height fits on a standard A4 page. */
export function fitsA4(contentHeightPx: number) {
  return contentHeightPx <= PAGE_HEIGHT_PX + FIT_EPSILON_PX;
}

/**
 * Height of an invoice page for content of the given natural height (CSS px): exactly A4 when it fits,
 * otherwise the content height rounded up to a whole pixel, so nothing at the bottom is ever clipped.
 */
export function sheetPageHeightPx(contentHeightPx: number) {
  if (!Number.isFinite(contentHeightPx) || fitsA4(contentHeightPx)) return PAGE_HEIGHT_PX;
  return Math.ceil(contentHeightPx);
}
