"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toInvoiceDocument } from "@/lib/invoice-document";
import { DEFAULT_INVOICE_LANGUAGE, getInvoiceLabels, isInvoiceLanguage, nextInvoiceLanguage } from "@/lib/invoice-labels";
import { useInvoiceStore } from "@/store/invoice-store";
import type { InvoiceLanguage } from "@/types/invoice";

interface InvoiceLanguageStore {
  language: InvoiceLanguage;
  setLanguage: (language: InvoiceLanguage) => void;
  /** Switches to the next language (English <-> বাংলা). */
  toggleLanguage: () => void;
}

/**
 * The language the invoice is shown, printed and exported in.
 *
 * It is a per-device viewing preference, deliberately kept out of the invoice data: switching it never edits the
 * invoice, so nothing is recalculated, marked unsaved or synced, and the choice carries over to every invoice
 * opened or created afterwards. It survives sign-out (it is not invoice data).
 */
export const useInvoiceLanguageStore = create<InvoiceLanguageStore>()(
  persist(
    (set) => ({
      language: DEFAULT_INVOICE_LANGUAGE,
      setLanguage: (language) => set({ language: isInvoiceLanguage(language) ? language : DEFAULT_INVOICE_LANGUAGE }),
      toggleLanguage: () => set((state) => ({ language: nextInvoiceLanguage(state.language) }))
    }),
    {
      name: "smart-invoice:invoice-language",
      version: 1,
      partialize: (state) => ({ language: state.language }),
      // Read back from localStorage, so untrusted: anything unknown falls back to the default.
      merge: (persisted, current) => {
        const language = (persisted as { language?: unknown } | undefined)?.language;
        return { ...current, language: isInvoiceLanguage(language) ? language : DEFAULT_INVOICE_LANGUAGE };
      }
    }
  )
);

export function useInvoiceLanguage() {
  return useInvoiceLanguageStore((state) => state.language);
}

/** Labels of the current invoice language; re-renders only when the language changes. */
export function useInvoiceLabels() {
  return getInvoiceLabels(useInvoiceLanguage());
}

/**
 * The printable document of the invoice being edited, in the current language, read at call time. Download, Share
 * and the background PDF pre-build all use it, so an export always matches what is on screen.
 */
export function getCurrentInvoiceDocument() {
  return toInvoiceDocument(useInvoiceStore.getState().invoice, useInvoiceLanguageStore.getState().language);
}
