/**
 * Class tokens for the A4 invoice. The editable preview and the read-only document (share page + PDF source) both
 * use these, so they lay out identically. Rules that keep screen and PDF in lock-step:
 *  - every text element has an explicit line-height (never `normal`, which differs between browsers);
 *  - sizes are absolute (px / pt / mm), never responsive breakpoints;
 *  - no text-transform / letter-spacing / text-overflow: what is in the DOM is exactly what is drawn;
 *  - long text wraps (`overflow-wrap:anywhere`) instead of overflowing or being clipped.
 *
 * Geometry (margins, paddings, column widths, box sizes) is the original A4 design.
 * Type tiers:
 *  - original sizes: meta (SL No / Date) 12px · To 15px · row No. 12px · signature & contacts 12px;
 *  - enlarged summary: in-words label 14px (was 12) · in-words text 17px (was 13) · totals box 16px (was 13, box
 *    320px, was 280) · remaining 19px (was 15);
 *  - enlarged for readability (~15–20%): title 50px (was 42) · table head 15px (was 13) · table body 15.5px (was 13).
 *
 * Vertical spacing that the original design tightened for longer invoices reads `--inv-*` variables; their values
 * per density ("normal" / "compact" / "dense") are defined in globals.css on `.invoice-sheet[data-density]`.
 */

// min-h keeps an empty value one line tall, exactly like the always-present input in the editor.
const wrapText = "min-h-[1.4em] whitespace-pre-wrap [overflow-wrap:anywhere]";

export const sheetText = {
  wrap: wrapText
};

export const sheetClasses = {
  banner: "bg-[#231f20] px-[48px] pb-[24px] pt-[48px]",
  bannerInner: "flex min-h-[130px] items-end justify-end",
  logo: "block h-auto w-[430px]",

  titleRow: "flex items-start justify-between gap-[16px] px-[40px] pb-[20px] pt-[24px]",
  title: "text-[50px] font-black leading-none text-[#e01b24]",
  metaList: "grid gap-[6px]",
  metaRow: "flex border-[1.5px] border-[#1a1a1a] bg-white",
  metaLabel:
    "w-[56px] shrink-0 whitespace-nowrap border-r-[1.5px] border-[#1a1a1a] px-[10px] py-[4px] text-[12px] font-semibold leading-[1.4]",
  // pr leaves room for the editor's calendar button; the PDF keeps the same box so text wraps identically.
  metaValue: `relative w-[168px] py-[4px] pl-[10px] pr-[40px] text-[12px] leading-[1.4] ${wrapText}`,

  toRow: "flex items-start gap-[6px] px-[40px] pb-[16px]",
  toLabel: "min-w-[32px] shrink-0 py-[4px] text-[15px] font-bold leading-[1.4]",
  toValue: `min-w-0 flex-1 px-[4px] py-[4px] text-[15px] font-bold leading-[1.4] ${wrapText}`,

  tableSection: "px-[40px]",
  table: "mt-[var(--inv-table-mt)] w-full table-fixed border-separate border-spacing-0 text-left",
  th: "bg-[#e01b24] py-[var(--inv-th-py)] text-center align-middle text-[15px] font-bold leading-[1.3] text-white",
  thNo: "rounded-l-[8px] px-[6px] text-[13px]",
  thName: "px-[8px]",
  thSize: "border-x border-white/35 px-0",
  thNumber: "px-[4px]",
  thLast: "rounded-r-[8px] px-[6px]",

  td: "border-b border-[#ddd] py-[var(--inv-td-py)] align-middle text-[15.5px] leading-[1.4]",
  tdNo: "px-[4px] text-center text-[12px] text-[#71717a]",
  tdName: "bg-[#fafafa] px-[12px]",
  tdSize: "px-[4px] text-center",
  tdNumber: "px-[4px] text-center",
  tdTimes: "px-0 text-center text-[13px] font-bold text-[#a1a1aa]",
  tdHeight: "border-r border-r-[#ddd]",
  tdSqf: "bg-[#fafafa] px-[4px] text-center font-semibold text-[#1a1a1a]",
  tdRate: "px-[4px] text-right",
  tdTotal: "bg-[#fafafa] px-[6px] text-center font-semibold",
  cellText: wrapText,

  tail: "flex flex-1 flex-col",
  beforeSummary: "no-print px-[40px] pt-[10px]",
  // Two columns: in-words, then signature + contacts on the left; totals box, then the Remaining pill on the right.
  // Both columns are equally tall: the footer sits at the bottom of the left column, level with the Remaining pill,
  // instead of being pinned to the page bottom, freeing that space.
  summarySection: "relative flex items-stretch justify-end gap-[24px] px-[40px] pb-[var(--inv-foot-pb)] pt-[var(--inv-table-pb)]",
  summaryMain: "flex min-w-0 flex-1 flex-col",
  summaryAside: "flex w-[320px] shrink-0 flex-col items-end gap-[var(--inv-sum-pb)]",
  summaryBox: "w-[320px] shrink-0",
  // Remaining amount in words, left of the totals box (uses the free space there, so pages don't get taller).
  inWords: "min-w-0 border-l-[3px] border-[#e01b24] py-[2px] pl-[12px]",
  inWordsLabel: "block text-[14px] font-bold leading-[1.4] text-[#52525b]",
  inWordsText: "text-[17px] font-semibold leading-[1.4] text-[#1a1a1a] [overflow-wrap:break-word]",
  summaryRow:
    "grid grid-cols-[minmax(0,1fr)_140px] items-center border border-[#ddd] px-[14px] py-[var(--inv-sum-py)] text-[16px] leading-[1.4]",
  summaryRowAttached: "border-t-0",
  vatRow:
    "grid grid-cols-[minmax(0,1fr)_60px_140px] items-center border border-t-0 border-[#ddd] py-[var(--inv-sum-py)] text-[16px] leading-[1.4]",
  vatLabel: "min-w-0 border-r border-[#ddd] px-[14px] font-semibold text-[#52525b]",
  vatRate: "flex items-center justify-center border-r border-[#ddd] px-[4px] font-semibold text-[#52525b]",
  vatAmount: "px-[14px] text-right font-semibold text-[#27272a]",
  summaryLabel: "font-semibold text-[#52525b]",
  summaryValue: "text-right font-semibold",
  grandTotalRow: "bg-[#fafafa] font-bold",

  remaining:
    "flex min-w-[270px] items-center justify-end gap-[12px] rounded-full border-2 border-[#1a1a1a] px-[36px] py-[var(--inv-rem-py)] text-[19px] font-extrabold leading-[1.3]",
  remainingValue: "text-[#e01b24]",

  footer: "mt-auto px-[40px] pb-[var(--inv-foot-pb)] pt-[var(--inv-foot-pt)]",
  // Last page: the same footer at the bottom of the summary's left column (at least a small gap below the in-words).
  footerInline: "mt-auto pt-[var(--inv-sum-pb)]",
  signatureLabel: "mb-[var(--inv-sig-mb)] text-[12px] leading-[1.35] text-[#52525b]",
  signatureLine: "w-[224px] border-b-[1.5px] border-[#1a1a1a]",
  contactList: "mt-[var(--inv-contact-mt)] grid gap-[var(--inv-contact-gap)] text-[12px] leading-[var(--inv-contact-lh)] text-[#222]",
  contactItem: "flex items-start gap-[8px]",
  // Centres a 14px icon on the first 12px line box, whatever the line-height of the current density.
  contactIcon: "mt-[calc((var(--inv-contact-lh)*12px_-_14px)/2)] size-[14px] shrink-0 text-black"

} as const;

/** Column widths of the item table: the original A4 proportions (No, Description, W, ×, H, Qty, SQF, Rate, Total). */
export const ITEM_COLUMN_WIDTHS = ["7%", "39%", "6%", "3%", "6%", "7%", "10%", "9%", "13%"] as const;
export const ITEM_COLUMN_COUNT = ITEM_COLUMN_WIDTHS.length;
