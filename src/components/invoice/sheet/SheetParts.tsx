"use client";

import Image from "next/image";
import { Fragment, type ReactNode } from "react";
import { Mail, MapPin, Phone, User } from "lucide-react";
import smartSignLogo from "@/assets/smart_sign_logo.svg";
import { ITEM_COLUMN_WIDTHS, sheetClasses } from "@/components/invoice/sheet/sheet-styles";
import { cn } from "@/lib/cn";
import { invoiceContactLines } from "@/lib/invoice-contact";
import type { getInvoiceLabels } from "@/lib/invoice-labels";

type Labels = ReturnType<typeof getInvoiceLabels>;

const contactIcons = { user: User, phone: Phone, mail: Mail, pin: MapPin } as const;

/** Full-width dark banner with the logo bottom-right. */
export function SheetBanner() {
  return (
    <div className={sheetClasses.banner}>
      <div className={sheetClasses.bannerInner}>
        <Image src={smartSignLogo} alt="Smart Sign Color Lab" priority unoptimized className={sheetClasses.logo} />
      </div>
    </div>
  );
}

/** Large red INVOICE title on the left, SL No / Date boxes on the right. */
export function SheetTitleRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={sheetClasses.titleRow}>
      <h1 className={sheetClasses.title}>{title.toLocaleUpperCase("en-US")}</h1>
      <div className={sheetClasses.metaList}>{children}</div>
    </div>
  );
}

export function SheetMetaRow({ label, children, as: Tag = "div" }: { label: string; children: ReactNode; as?: "div" | "label" }) {
  return (
    <Tag className={sheetClasses.metaRow}>
      <span className={sheetClasses.metaLabel}>{label}</span>
      <span className={sheetClasses.metaValue}>{children}</span>
    </Tag>
  );
}

export function SheetToRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={sheetClasses.toRow}>
      <span className={sheetClasses.toLabel}>{label}</span>
      <div className={sheetClasses.toValue}>{children}</div>
    </div>
  );
}

function HeaderCells({ labels }: { labels: Labels }) {
  return (
    <>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thNo)}>{labels.no}</th>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thName)}>{labels.productDescription}</th>
      <th scope="col" colSpan={3} className={cn(sheetClasses.th, sheetClasses.thSize)}>{labels.size}</th>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thNumber)}>{labels.qty}</th>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thNumber)}>{labels.sqf}</th>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thNumber)}>{labels.rate}</th>
      <th scope="col" className={cn(sheetClasses.th, sheetClasses.thLast)}>{labels.total}</th>
    </>
  );
}

/** The item table frame (columns + header). Rows are passed as children. */
export function SheetItemsTable({ labels, children, caption }: { labels: Labels; children: ReactNode; caption?: string }) {
  return (
    <section className={sheetClasses.tableSection}>
      <table className={sheetClasses.table}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {ITEM_COLUMN_WIDTHS.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr data-sheet-head="">
            <HeaderCells labels={labels} />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

/**
 * One page's item rows (at most 12, see pagination.ts). Rows keep their own keys, so editing focus is kept while a
 * row stays on the same page.
 */
export function SheetRows({ rows }: { rows: { key: string; node: ReactNode }[] }) {
  return (
    <>
      {rows.map(({ key, node }) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </>
  );
}

/**
 * Everything after the table, in the original order: the totals box (right), the Remaining pill (right), then the
 * signature and contact footer pinned to the bottom of the page. Rendered on the last page only; earlier pages
 * get the footer alone (`SheetPageFooter`).
 */
export function SheetTail({
  labels,
  summary,
  remaining,
  amountInWords,
  beforeSummary
}: {
  labels: Labels;
  summary: ReactNode;
  remaining: ReactNode;
  /** Grand total in words ("... Taka Only."), shown left of the totals box. */
  amountInWords?: string;
  beforeSummary?: ReactNode;
}) {
  return (
    <div className={sheetClasses.tail}>
      {/* Editor-only (no-print) full-width bar between the table and the totals, as in the original design. */}
      {beforeSummary && (
        <div data-sheet-tail-part="" className={sheetClasses.beforeSummary}>
          {beforeSummary}
        </div>
      )}
      <section data-sheet-tail-part="" className={sheetClasses.summarySection}>
        {amountInWords && (
          <div className={sheetClasses.inWords} data-amount-in-words="">
            <span className={sheetClasses.inWordsLabel}>{labels.inWords}</span>
            <p className={sheetClasses.inWordsText} aria-live="polite">
              {amountInWords}
            </p>
          </div>
        )}
        <div className={sheetClasses.summaryBox}>{summary}</div>
      </section>
      <section data-sheet-tail-part="" className={sheetClasses.remainingSection}>
        {remaining}
      </section>
      <SheetFooter labels={labels} />
    </div>
  );
}

export function SheetSummaryRow({
  label,
  children,
  attached = true,
  emphasis = false,
  as: Tag = "div"
}: {
  label: string;
  children: ReactNode;
  attached?: boolean;
  emphasis?: boolean;
  as?: "div" | "label";
}) {
  return (
    <Tag className={cn(sheetClasses.summaryRow, attached && sheetClasses.summaryRowAttached, emphasis && sheetClasses.grandTotalRow)}>
      <span className={emphasis ? undefined : sheetClasses.summaryLabel}>{label}</span>
      <span className={emphasis ? "text-right" : sheetClasses.summaryValue}>{children}</span>
    </Tag>
  );
}

export function SheetVatRow({ label, rate, amount, as: Tag = "div" }: { label: string; rate: ReactNode; amount: string; as?: "div" | "label" }) {
  return (
    <Tag className={sheetClasses.vatRow}>
      <span className={sheetClasses.vatLabel}>{label}</span>
      <span className={sheetClasses.vatRate}>{rate}</span>
      <span className={sheetClasses.vatAmount}>{amount}</span>
    </Tag>
  );
}

export function SheetRemaining({ label, value }: { label: string; value: string }) {
  return (
    <div className={sheetClasses.remaining}>
      <span>{label}</span>
      <span className={sheetClasses.remainingValue}>{value}</span>
    </div>
  );
}

/**
 * Bottom of every page except the last: the same signature and contact footer, pinned to the bottom of the page.
 * The last page renders it as part of `SheetTail`, after the totals.
 */
export function SheetPageFooter({ labels }: { labels: Labels }) {
  return (
    <div className={sheetClasses.tail}>
      <SheetFooter labels={labels} />
    </div>
  );
}

/** Signature line, then the company contact list underneath it (left-aligned), as in the original layout. */
export function SheetFooter({ labels }: { labels: Labels }) {
  return (
    <footer data-sheet-tail-part="" className={sheetClasses.footer}>
      <p className={sheetClasses.signatureLabel}>{labels.signature}</p>
      <div className={sheetClasses.signatureLine} />
      <ul className={sheetClasses.contactList}>
        {invoiceContactLines.map(({ kind, text }) => {
          const Icon = contactIcons[kind];

          return (
            <li key={text} className={sheetClasses.contactItem}>
              <Icon className={sheetClasses.contactIcon} aria-hidden="true" />
              <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{text}</span>
            </li>
          );
        })}
      </ul>
    </footer>
  );
}
