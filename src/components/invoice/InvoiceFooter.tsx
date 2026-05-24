"use client";

import { Mail, MapPin, Phone, User } from "lucide-react";

const contactInfo = [
  { icon: User, text: "Md. Mahabubur Rahmn" },
  { icon: Phone, text: "+8801677-206964" },
  { icon: Mail, text: "smartsign2024@gmail.com" },
  { icon: MapPin, text: "Appolo Akbari Complex, Oposite Of Chandpur Govt. College,\nChandpur Sadar, Chandpur." }
];

export function InvoiceFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden px-4 pb-24 pt-5 sm:px-10 sm:pb-36">
      <div className="relative z-10 grid gap-8 sm:grid-cols-[1fr_240px]">
        <div className="pr-14 sm:pr-0">
          <p className="mb-7 text-xs text-zinc-600">Signature</p>
          <div className="w-44 border-b-[1.5px] border-[#1a1a1a] sm:w-56" />

          <ul className="mt-5 grid gap-1.5 text-[12px] leading-[1.35] text-[#222]">
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
