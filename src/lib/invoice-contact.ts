import type { InvoiceLabels } from "@/lib/invoice-labels";

export type ContactIconKind = "user" | "phone" | "mail" | "pin";

/** Order of the company contact lines in the invoice footer. The text of each line lives in invoice-labels.ts. */
export const CONTACT_LINE_ORDER: readonly ContactIconKind[] = ["user", "phone", "mail", "pin"];

/** Company contact lines printed in the invoice footer, in the invoice's language. */
export function invoiceContactLines(labels: Pick<InvoiceLabels, "contact">): ReadonlyArray<{ kind: ContactIconKind; text: string }> {
  return CONTACT_LINE_ORDER.map((kind) => ({ kind, text: labels.contact[kind] }));
}
