"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InvoiceData, InvoiceItem, SavedInvoice } from "@/types/invoice";
import { calculateLineTotal, calculateSqf, createBlankItem, generateInvoiceNumber, roundToTwo, safePositiveNumber, uid } from "@/lib/invoice-utils";
import { createSampleInvoice } from "@/lib/sample-invoice";

interface InvoiceStore {
  invoice: InvoiceData;
  savedInvoices: SavedInvoice[];
  activeSavedInvoiceId: string;
  setInvoice: (invoice: InvoiceData) => void;
  updateInvoice: (patch: Partial<InvoiceData>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  reorderItem: (fromIndex: number, toIndex: number) => void;
  updateItem: (id: string, patch: Partial<InvoiceItem>) => void;
  refreshCurrentInvoice: () => void;
  resetDraft: () => void;
  duplicateInvoice: () => void;
  newInvoiceNumber: () => void;
  toggleInvoiceLanguage: () => void;
  saveCurrentInvoice: () => void;
  loadSavedInvoice: (id: string) => void;
  deleteSavedInvoice: (id: string) => void;
  mergeSavedInvoices: (savedInvoices: SavedInvoice[]) => void;
}

const SAVED_INVOICE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function touch(invoice: InvoiceData): InvoiceData {
  return { ...invoice, updatedAt: new Date().toISOString() };
}

function pruneSavedInvoices(savedInvoices: SavedInvoice[]) {
  const cutoff = Date.now() - SAVED_INVOICE_RETENTION_MS;

  return savedInvoices
    .filter((savedInvoice) => {
      const savedAt = new Date(savedInvoice.savedAt).getTime();
      return Number.isFinite(savedAt) && savedAt >= cutoff;
    })
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

function savedInvoiceName(invoice: InvoiceData) {
  return invoice.customer.name.trim() || "Untitled Invoice";
}

function createSavedInvoice(invoice: InvoiceData, id = uid("saved-invoice")) {
  const savedAt = new Date().toISOString();

  return {
    id,
    name: savedInvoiceName(invoice),
    savedAt,
    invoice: { ...invoice, updatedAt: savedAt }
  };
}

function upsertSavedInvoice(savedInvoices: SavedInvoice[], invoice: InvoiceData, activeSavedInvoiceId: string) {
  const savedInvoice = createSavedInvoice(invoice, activeSavedInvoiceId);
  const nextSavedInvoices = savedInvoices.filter((item) => item.id !== activeSavedInvoiceId);

  return pruneSavedInvoices([savedInvoice, ...nextSavedInvoices]);
}

function mergeSavedInvoiceLists(currentInvoices: SavedInvoice[], incomingInvoices: SavedInvoice[]) {
  const invoiceMap = new Map<string, SavedInvoice>();

  [...currentInvoices, ...incomingInvoices].forEach((savedInvoice) => {
    const existing = invoiceMap.get(savedInvoice.id);

    if (!existing || new Date(savedInvoice.savedAt).getTime() > new Date(existing.savedAt).getTime()) {
      invoiceMap.set(savedInvoice.id, savedInvoice);
    }
  });

  return pruneSavedInvoices(Array.from(invoiceMap.values()));
}

function normalizeInvoice(invoice: InvoiceData) {
  return {
    ...invoice,
    settings: {
      ...invoice.settings,
      language: invoice.settings.language ?? "english"
    },
    items: normalizeItems(invoice.items)
  };
}

function createInitialInvoiceState() {
  const invoice = createSampleInvoice();
  const savedInvoice = createSavedInvoice(invoice);

  return {
    invoice,
    savedInvoices: [savedInvoice],
    activeSavedInvoiceId: savedInvoice.id
  };
}

function normalizeItems(items: InvoiceItem[]) {
  return items.map((item) => {
    const width = normalizeNumber(item.width);
    const height = normalizeNumber(item.height);
    const sqf = "sqf" in item ? normalizeNumber(item.sqf) : calculateSqf(width, height);
    const quantity = normalizeNumber(item.quantity);
    const unitPrice = normalizeNumber(item.unitPrice);
    const totalIsManual = Boolean(item.totalIsManual);
    const normalizedItem = {
      ...item,
      width,
      height,
      sqf,
      quantity,
      unitPrice,
      total: normalizeNumber(item.total),
      totalIsManual
    };

    return {
      ...normalizedItem,
      total: totalIsManual ? normalizedItem.total : calculateLineTotal(normalizedItem)
    };
  });
}

function normalizeNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const number = safePositiveNumber(value);
  return number > 0 ? roundToTwo(number) : 0;
}

function withCalculatedFields(item: InvoiceItem, patch: Partial<InvoiceItem>) {
  const nextItem = { ...item, ...patch };
  const sizeChanged = "width" in patch || "height" in patch;
  const calculationChanged = sizeChanged || "sqf" in patch || "quantity" in patch || "unitPrice" in patch;

  if (sizeChanged) {
    nextItem.sqf = calculateSqf(nextItem.width, nextItem.height);
  }

  if (calculationChanged) {
    nextItem.totalIsManual = false;
    nextItem.total = calculateLineTotal(nextItem);
  }

  if ("total" in patch && !calculationChanged) {
    nextItem.totalIsManual = true;
  }

  if ("totalIsManual" in patch && patch.totalIsManual === false) {
    nextItem.total = calculateLineTotal(nextItem);
  }

  return nextItem;
}

export const useInvoiceStore = create<InvoiceStore>()(
  persist(
    (set, get) => ({
      ...createInitialInvoiceState(),
      setInvoice: (invoice) =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const nextInvoice = touch(normalizeInvoice(invoice));

          return {
            invoice: nextInvoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, nextInvoice, activeSavedInvoiceId)
          };
        }),
      updateInvoice: (patch) =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({ ...state.invoice, ...patch });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      addItem: () =>
        set((state) => {
          const isFirstItem = state.invoice.items.length === 0;
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({
            ...state.invoice,
            advance: isFirstItem ? 0 : state.invoice.advance,
            taxRate: isFirstItem ? 0 : state.invoice.taxRate,
            items: [...state.invoice.items, createBlankItem()]
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      removeItem: (id) =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const items = state.invoice.items.filter((item) => item.id !== id);
          const invoice = touch({ ...state.invoice, items });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      reorderItem: (fromIndex, toIndex) =>
        set((state) => {
          if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
            return state;
          }

          const items = [...state.invoice.items];
          const [item] = items.splice(fromIndex, 1);

          if (!item) {
            return state;
          }

          items.splice(Math.min(toIndex, items.length), 0, item);
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({ ...state.invoice, items });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      updateItem: (id, patch) =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({
            ...state.invoice,
            items: state.invoice.items.map((item) => (item.id === id ? withCalculatedFields(item, patch) : item))
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      refreshCurrentInvoice: () =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const blankInvoice = createSampleInvoice();
          const invoice = touch({
            ...blankInvoice,
            customer: {
              ...blankInvoice.customer,
              invoiceNumber: state.invoice.customer.invoiceNumber,
              date: state.invoice.customer.date
            }
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      resetDraft: () => {
        const invoice = createSampleInvoice();
        const activeSavedInvoiceId = uid("saved-invoice");
        const nextInvoice = touch({
          ...invoice,
          customer: { ...invoice.customer, invoiceNumber: generateInvoiceNumber() }
        });

        set({
          invoice: nextInvoice,
          activeSavedInvoiceId,
          savedInvoices: upsertSavedInvoice(get().savedInvoices, nextInvoice, activeSavedInvoiceId)
        });
      },
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
      toggleInvoiceLanguage: () =>
        set((state) => ({
          invoice: touch({
            ...state.invoice,
            settings: {
              ...state.invoice.settings,
              language: state.invoice.settings.language === "bangla" ? "english" : "bangla"
            }
          })
        })),
      newInvoiceNumber: () =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({
            ...state.invoice,
            customer: { ...state.invoice.customer, invoiceNumber: generateInvoiceNumber() }
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      saveCurrentInvoice: () =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch(state.invoice);

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId)
          };
        }),
      loadSavedInvoice: (id) =>
        set((state) => {
          const savedInvoice = state.savedInvoices.find((item) => item.id === id);

          if (!savedInvoice) {
            return { savedInvoices: pruneSavedInvoices(state.savedInvoices) };
          }

          return {
            invoice: touch(normalizeInvoice(savedInvoice.invoice)),
            activeSavedInvoiceId: savedInvoice.id,
            savedInvoices: pruneSavedInvoices(state.savedInvoices)
          };
        }),
      deleteSavedInvoice: (id) =>
        set((state) => ({
          savedInvoices: state.savedInvoices.filter((savedInvoice) => savedInvoice.id !== id)
        })),
      mergeSavedInvoices: (savedInvoices) =>
        set((state) => ({
          savedInvoices: mergeSavedInvoiceLists(state.savedInvoices, savedInvoices.map((savedInvoice) => ({
            ...savedInvoice,
            name: savedInvoice.name || savedInvoiceName(savedInvoice.invoice),
            invoice: normalizeInvoice(savedInvoice.invoice)
          })))
        }))
    }),
    {
      name: "smart-invoice-draft",
      version: 6,
      migrate: (persistedState: unknown) => {
        const state = persistedState as { invoice?: InvoiceData; savedInvoices?: SavedInvoice[]; activeSavedInvoiceId?: string } | undefined;

        if (!state?.invoice) {
          const invoice = createSampleInvoice();
          const savedInvoice = createSavedInvoice(invoice);

          return { invoice, savedInvoices: [savedInvoice], activeSavedInvoiceId: savedInvoice.id };
        }

        const savedInvoices = pruneSavedInvoices(
          (state.savedInvoices ?? []).map((savedInvoice) => ({
            ...savedInvoice,
            name: savedInvoice.name || savedInvoiceName(savedInvoice.invoice),
            invoice: normalizeInvoice(savedInvoice.invoice)
          }))
        );

        if (state.invoice.items.length > 0) {
          const invoice = normalizeInvoice(state.invoice);
          const activeSavedInvoiceId = state.activeSavedInvoiceId || savedInvoices[0]?.id || uid("saved-invoice");

          return {
            ...state,
            invoice,
            activeSavedInvoiceId,
            savedInvoices: savedInvoices.length > 0 ? savedInvoices : [createSavedInvoice(invoice, activeSavedInvoiceId)]
          };
        }

        const activeSavedInvoiceId = state.activeSavedInvoiceId || savedInvoices[0]?.id || uid("saved-invoice");
        const invoice = touch({
          ...state.invoice,
          settings: {
            ...state.invoice.settings,
            language: state.invoice.settings.language ?? "english"
          },
          items: Array.from({ length: 10 }, () => createBlankItem())
        });

        return {
          ...state,
          invoice,
          activeSavedInvoiceId,
          savedInvoices: savedInvoices.length > 0 ? savedInvoices : [createSavedInvoice(invoice, activeSavedInvoiceId)]
        };
      }
    }
  )
);
