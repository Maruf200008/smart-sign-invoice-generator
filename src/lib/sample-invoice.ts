import type { InvoiceData } from "@/types/invoice";
import { generateInvoiceNumber } from "@/lib/invoice-utils";

export const sampleInvoice: InvoiceData = {
  company: {
    name: "SMART SIGN & PRINT",
    logo: "",
    address: "Appolo Akbari Complex, Oposite Of Chandpur Govt. College, Chandpur Sadar, Chandpur.",
    phone: "+8801677-206964",
    email: "smartsign2024@gmail.com",
    website: ""
  },
  customer: {
    name: "মোহাম্মদ মারুফ",
    address: "Uttara, Dhaka, Bangladesh",
    phone: "+880 1811-223344",
    invoiceNumber: generateInvoiceNumber(),
    date: new Date().toISOString().slice(0, 10)
  },
  items: [],
  advance: 0,
  discount: 0,
  taxRate: 0,
  notes: "Thank you for your business. ধন্যবাদ।",
  terms: "Payment is due within 7 days. Warranty applies only after full payment clearance.",
  signature: "",
  settings: {
    currency: "BDT",
    status: "partial",
    theme: "red-black",
    darkMode: false,
    watermark: "SMART SIGN"
  },
  updatedAt: new Date().toISOString()
};
