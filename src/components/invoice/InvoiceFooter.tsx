"use client";

import { getInvoiceLabels } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import { Mail, MapPin, Phone, User } from "lucide-react";

const contactInfo = [
  { icon: User, text: "Md. Mahabubur Rahman" },
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
  const dense = itemCount > 12;
  const labels = getInvoiceLabels();

  return (
    <footer
      className={`relative mt-auto overflow-hidden px-4 sm:px-10 ${dense ? "pb-3 pt-0" : compact ? "pb-16 pt-2" : "pb-24 pt-5 sm:pb-36"}`}
    >
      <div className={`relative z-10 grid sm:grid-cols-[1fr_240px] ${dense ? "gap-3" : "gap-8"}`}>
        <div className="pr-14 sm:pr-0">
          <p className={`text-xs text-zinc-600 ${dense ? "mb-2" : compact ? "mb-4" : "mb-7"}`}>
            {labels.signature}
          </p>
          <div className="w-44 border-b-[1.5px] border-[#1a1a1a] sm:w-56" />

          <ul
            className={`grid text-[#222] ${dense ? "mt-1.5 gap-0 text-[11px] leading-[1.2]" : compact ? "mt-3 gap-1 text-[12px] leading-[1.35]" : "mt-5 gap-1.5 text-[12px] leading-[1.35]"}`}
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
