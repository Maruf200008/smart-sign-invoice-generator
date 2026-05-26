"use client";

import { motion } from "framer-motion";
import { Copy, Plus, RotateCcw, Wand2 } from "lucide-react";
import { ActionButton } from "@/components/controls/ActionButton";
import { ShareInvoiceButton } from "@/components/controls/PDFExportButton";
import { PrintButton } from "@/components/controls/PrintButton";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { useInvoiceStore } from "@/store/invoice-store";

export function InvoiceDashboard() {
  const addItem = useInvoiceStore((state) => state.addItem);
  const resetDraft = useInvoiceStore((state) => state.resetDraft);
  const duplicateInvoice = useInvoiceStore((state) => state.duplicateInvoice);
  const newInvoiceNumber = useInvoiceStore((state) => state.newInvoiceNumber);

  return (
    <main className="min-h-screen bg-[#e8e8e8] text-zinc-950">
      <div className="mx-auto flex w-full flex-col items-center gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-7">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="no-print grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center sm:gap-3"
        >
          <ActionButton variant="ghost" icon={<Plus className="size-4" />} onClick={addItem}>Add Row</ActionButton>
          <PrintButton />
          <ShareInvoiceButton />
          <ActionButton icon={<Wand2 className="size-4" />} onClick={newInvoiceNumber}>New SL</ActionButton>
          <ActionButton icon={<Copy className="size-4" />} onClick={duplicateInvoice}>Duplicate</ActionButton>
          <ActionButton icon={<RotateCcw className="size-4" />} onClick={resetDraft}>Reset</ActionButton>
        </motion.div>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full overflow-x-hidden pb-8 sm:overflow-auto">
          <InvoicePreview />
        </motion.section>
      </div>
    </main>
  );
}
