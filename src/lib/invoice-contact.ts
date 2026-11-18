export type ContactIconKind = "user" | "phone" | "mail" | "pin";

/** Company contact lines printed in the invoice footer. Shared by the editor footer and the public share page. */
export const invoiceContactLines: ReadonlyArray<{ kind: ContactIconKind; text: string }> = [
  { kind: "user", text: "Md. Mahabubur Rahman" },
  { kind: "phone", text: "+8801677-206964" },
  { kind: "mail", text: "smartsign2024@gmail.com" },
  {
    kind: "pin",
    text: "Appolo Akbari Complex, Opposite Of Chandpur Govt. College,\nChandpur Sadar, Chandpur."
  }
];
