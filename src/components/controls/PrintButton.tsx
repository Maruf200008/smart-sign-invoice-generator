"use client";

import { Printer } from "lucide-react";
import { ActionButton } from "@/components/controls/ActionButton";

export function PrintButton() {
  return <ActionButton icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</ActionButton>;
}
