/**
 * Splits the invoice rows over A4 pages. Every page holds at most ROWS_PER_PAGE rows; row numbers keep counting
 * across pages (page 2 starts at 13). Every page carries the signature and contact footer; only the last page
 * carries the totals.
 */
export const ROWS_PER_PAGE = 12;

export interface InvoicePageRange {
  /** Zero-based page index. */
  index: number;
  /** Index of the first row on this page (inclusive). */
  start: number;
  /** Index after the last row on this page (exclusive). */
  end: number;
  isFirst: boolean;
  isLast: boolean;
}

/** Page ranges for `rowCount` rows. Always at least one page, so an empty invoice still prints its table. */
export function paginateInvoiceRows(rowCount: number, rowsPerPage = ROWS_PER_PAGE): InvoicePageRange[] {
  const perPage = Math.max(1, Math.floor(rowsPerPage));
  const count = Math.max(0, Math.floor(Number.isFinite(rowCount) ? rowCount : 0));
  const pageCount = Math.max(1, Math.ceil(count / perPage));

  return Array.from({ length: pageCount }, (_, index) => ({
    index,
    start: index * perPage,
    end: Math.min(count, (index + 1) * perPage),
    isFirst: index === 0,
    isLast: index === pageCount - 1
  }));
}
