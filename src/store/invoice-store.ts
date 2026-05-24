"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InvoiceData, InvoiceItem } from "@/types/invoice";
import { createBlankItem, generateInvoiceNumber, uid } from "@/lib/invoice-utils";
import { sampleInvoice } from "@/lib/sample-invoice";

interface InvoiceStore {
  invoice: InvoiceData;
  setInvoice: (invoice: InvoiceData) => void;
  updateInvoice: (patch: Partial<InvoiceData>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<InvoiceItem>) => void;
  resetDraft: () => void;
  duplicateInvoice: () => void;
  newInvoiceNumber: () => void;
}

function touch(invoice: InvoiceData): InvoiceData {
  return { ...invoice, updatedAt: new Date().toISOString() };
}

export const useInvoiceStore = create<InvoiceStore>()(
  persist(
    (set, get) => ({
      invoice: sampleInvoice,
      setInvoice: (invoice) => set({ invoice: touch(invoice) }),
      updateInvoice: (patch) =>
        set((state) => ({
          invoice: touch({ ...state.invoice, ...patch })
        })),
      addItem: () =>
        set((state) => {
          const isFirstItem = state.invoice.items.length === 0;
          return {
            invoice: touch({
              ...state.invoice,
              advance: isFirstItem ? 0 : state.invoice.advance,
              discount: isFirstItem ? 0 : state.invoice.discount,
              taxRate: isFirstItem ? 0 : state.invoice.taxRate,
              items: [...state.invoice.items, createBlankItem()]
            })
          };
        }),
      removeItem: (id) =>
        set((state) => {
          const items = state.invoice.items.filter((item) => item.id !== id);
          return { invoice: touch({ ...state.invoice, items }) };
        }),
      updateItem: (id, patch) =>
        set((state) => ({
          invoice: touch({
            ...state.invoice,
            items: state.invoice.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
          })
        })),
      resetDraft: () => set({ invoice: touch({ ...sampleInvoice, customer: { ...sampleInvoice.customer, invoiceNumber: generateInvoiceNumber() } }) }),
      duplicateInvoice: () => {
        const invoice = get().invoice;
        set({
          invoice: touch({
            ...invoice,
            customer: { ...invoice.customer, invoiceNumber: generateInvoiceNumber(), date: new Date().toISOString().slice(0, 10) },
            items: invoice.items.map((item) => ({ ...item, id: uid("item") })),
            settings: { ...invoice.settings, status: "draft" }
          })
        });
      },
      newInvoiceNumber: () =>
        set((state) => ({
          invoice: touch({
            ...state.invoice,
            customer: { ...state.invoice.customer, invoiceNumber: generateInvoiceNumber() }
          })
        }))
    }),
    {
      name: "smart-invoice-draft",
      version: 2
    }
  )
);
