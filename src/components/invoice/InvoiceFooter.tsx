"use client";

import { useInvoiceStore } from "@/store/invoice-store";
import { getInvoiceLabels } from "@/lib/invoice-labels";
import { Mail, MapPin, Phone, User } from "lucide-react";

const contactInfo = [
  { icon: User, text: "Md. Mahabubur Rahmn" },
  { icon: Phone, text: "+8801677-206964" },
  { icon: Mail, text: "smartsign2024@gmail.com" },
  {
    icon: MapPin,
    text: "Appolo Akbari Complex, Opposite Of Chandpur Govt. College,\nChandpur Sadar, Chandpur.",
  },
];

export function InvoiceFooter() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const itemCount = invoice.items.length;
  const compact = itemCount > 8;
  const labels = getInvoiceLabels();

  return (
    <footer
      className={`relative mt-auto overflow-hidden px-4 sm:px-10 ${compact ? "pb-24 pt-2" : "pb-24 pt-5 sm:pb-36"}`}
    >
      <div className="relative z-10 grid gap-8 sm:grid-cols-[1fr_240px]">
        <div className="pr-14 sm:pr-0">
          <p className={`text-xs text-zinc-600 ${compact ? "mb-4" : "mb-7"}`}>
            {labels.signature}
          </p>
          <div className="w-44 border-b-[1.5px] border-[#1a1a1a] sm:w-56" />

          <ul
            className={`grid text-[12px] leading-[1.35] text-[#222] ${compact ? "mt-3 gap-1" : "mt-5 gap-1.5"}`}
          >
            {contactInfo.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-[1px] size-3.5 shrink-0 text-black" />
                <span className="whitespace-pre-line">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
