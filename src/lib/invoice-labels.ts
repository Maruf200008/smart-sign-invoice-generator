export const invoiceLabels = {
  english: {
    invoice: "Invoice",
    to: "To:",
    enterTo: "Enter To",
    slNo: "SL No",
    date: "Date",
    no: "No",
    productDescription: "Product Description",
    size: "Size",
    sqf: "SQF",
    qty: "Qty",
    rate: "Rate",
    total: "Total",
    discount: "Discount",
    subtotal: "Subtotal",
    vatTax: "VAT / Tax %",
    grandTotal: "Grand Total",
    advance: "Advance",
    remaining: "Remaining:",
    signature: "Signature",
    toggleButton: "Bangla Invoice"
  },
  bangla: {
    invoice: "ইনভয়েস",
    to: "প্রাপক:",
    enterTo: "প্রাপকের নাম লিখুন",
    slNo: "এসএল নং",
    date: "তারিখ",
    no: "নং",
    productDescription: "পণ্যের বিবরণ",
    size: "সাইজ",
    sqf: "বর্গফুট",
    qty: "পরিমাণ",
    rate: "রেট",
    total: "মোট",
    discount: "Discount",
    subtotal: "সাবটোটাল",
    vatTax: "ভ্যাট / ট্যাক্স %",
    grandTotal: "সর্বমোট",
    advance: "অগ্রিম",
    remaining: "বাকি:",
    signature: "স্বাক্ষর",
    toggleButton: "English Invoice"
  }
} as const;

export function getInvoiceLabels() {
  return invoiceLabels.english;
}
