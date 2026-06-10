"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InvoiceData, InvoiceItem, SavedInvoice } from "@/types/invoice";
import { calculateLineTotal, calculateSqf, createBlankItem, formatInvoiceDate, formatLocalDateInput, generateInvoiceNumber, roundToInteger, roundToTwo, safePositiveNumber, uid } from "@/lib/invoice-utils";
import { createSampleInvoice } from "@/lib/sample-invoice";

interface InvoiceStore {
  invoice: InvoiceData;
  savedInvoices: SavedInvoice[];
  activeSavedInvoiceId: string;
  undoHistory: InvoiceSnapshot[];
  undoGroup: UndoGroup;
  setInvoice: (invoice: InvoiceData) => void;
  updateInvoice: (patch: Partial<InvoiceData>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  reorderItem: (fromIndex: number, toIndex: number) => void;
  updateItem: (id: string, patch: Partial<InvoiceItem>) => void;
  pasteItemNames: (startIndex: number, names: string[]) => void;
  refreshCurrentInvoice: () => void;
  resetDraft: () => void;
  duplicateInvoice: () => void;
  newInvoiceNumber: () => void;
  toggleInvoiceLanguage: () => void;
  saveCurrentInvoice: () => void;
  loadSavedInvoice: (id: string) => void;
  deleteSavedInvoice: (id: string) => void;
  mergeSavedInvoices: (savedInvoices: SavedInvoice[]) => void;
  loadCloudSavedInvoices: (savedInvoices: SavedInvoice[]) => void;
  undoLastChange: () => void;
}

const SAVED_INVOICE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_UNDO_HISTORY = 100;
const UNDO_GROUP_MS = 1200;
const MAX_INVOICE_ITEMS = 15;
type InvoiceSnapshot = Pick<InvoiceStore, "invoice" | "savedInvoices" | "activeSavedInvoiceId">;
type UndoGroup = { key: string; expiresAt: number } | null;

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

function replaceSavedInvoiceList(incomingInvoices: SavedInvoice[]) {
  return pruneSavedInvoices(incomingInvoices);
}

function savedInvoiceListsAreEqual(first: SavedInvoice[], second: SavedInvoice[]) {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((invoice, index) => {
    const otherInvoice = second[index];

    return (
      otherInvoice &&
      invoice.id === otherInvoice.id &&
      invoice.name === otherInvoice.name &&
      invoice.savedAt === otherInvoice.savedAt &&
      invoice.invoice.updatedAt === otherInvoice.invoice.updatedAt
    );
  });
}

function normalizeInvoice(invoice: InvoiceData) {
  return {
    ...invoice,
    customer: {
      ...invoice.customer,
      date: formatInvoiceDate(invoice.customer.date)
    },
    settings: {
      ...invoice.settings,
      language: invoice.settings.language ?? "english"
    },
    advance: normalizeNumber(invoice.advance),
    discount: normalizeNumber(invoice.discount),
    taxRate: normalizeNumber(invoice.taxRate),
    items: normalizeItems(invoice.items)
  };
}

function createInitialInvoiceState() {
  const invoice = createSampleInvoice();
  const savedInvoice = createSavedInvoice(invoice);

  return {
    invoice,
    savedInvoices: [savedInvoice],
    activeSavedInvoiceId: savedInvoice.id,
    undoHistory: [],
    undoGroup: null
  };
}

function createUndoSnapshot(state: InvoiceSnapshot): InvoiceSnapshot {
  return {
    invoice: state.invoice,
    savedInvoices: state.savedInvoices,
    activeSavedInvoiceId: state.activeSavedInvoiceId
  };
}

function withUndoHistory(state: InvoiceStore) {
  return [...state.undoHistory.slice(-(MAX_UNDO_HISTORY - 1)), createUndoSnapshot(state)];
}

function nextUndoState(state: InvoiceStore, groupKey?: string) {
  const now = Date.now();

  if (groupKey && state.undoGroup?.key === groupKey && state.undoGroup.expiresAt > now) {
    return {
      undoHistory: state.undoHistory,
      undoGroup: { key: groupKey, expiresAt: now + UNDO_GROUP_MS }
    };
  }

  return {
    undoHistory: withUndoHistory(state),
    undoGroup: groupKey ? { key: groupKey, expiresAt: now + UNDO_GROUP_MS } : null
  };
}

function undoGroupKey(prefix: string, patch: Record<string, unknown>) {
  return `${prefix}:${Object.keys(patch).sort().join("|")}`;
}

function normalizeItems(items: InvoiceItem[]) {
  return items.map((item) => {
    const width = normalizeNumber(item.width);
    const height = normalizeNumber(item.height);
    const sqf = calculateSqf(width, height);
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
      total: normalizeTotalNumber(item.total),
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

function normalizeTotalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const number = safePositiveNumber(value);
  return number > 0 ? roundToInteger(number) : 0;
}

function withCalculatedFields(item: InvoiceItem, patch: Partial<InvoiceItem>) {
  const nextItem = { ...item, ...patch };
  const sizeChanged = "width" in patch || "height" in patch;
  const calculationChanged = sizeChanged || "quantity" in patch || "unitPrice" in patch;

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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, nextInvoice, activeSavedInvoiceId),
            ...nextUndoState(state)
          };
        }),
      updateInvoice: (patch) =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({ ...state.invoice, ...patch });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state, undoGroupKey("invoice", patch))
          };
        }),
      addItem: () =>
        set((state) => {
          if (state.invoice.items.length >= MAX_INVOICE_ITEMS) {
            return state;
          }

          const isFirstItem = state.invoice.items.length === 0;
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch({
            ...state.invoice,
            advance: isFirstItem ? 0 : state.invoice.advance,
            discount: isFirstItem ? 0 : state.invoice.discount,
            taxRate: isFirstItem ? 0 : state.invoice.taxRate,
            items: [...state.invoice.items, createBlankItem()]
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state, undoGroupKey(`item:${id}`, patch))
          };
        }),
      pasteItemNames: (startIndex, names) =>
        set((state) => {
          const cleanNames = names.map((name) => name.trimEnd());

          if (startIndex < 0 || cleanNames.length === 0 || startIndex >= MAX_INVOICE_ITEMS) {
            return state;
          }

          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const items = [...state.invoice.items];
          const neededLength = Math.min(MAX_INVOICE_ITEMS, startIndex + cleanNames.length);

          while (items.length < neededLength) {
            items.push(createBlankItem());
          }

          cleanNames.slice(0, MAX_INVOICE_ITEMS - startIndex).forEach((name, offset) => {
            const itemIndex = startIndex + offset;
            const item = items[itemIndex];

            if (item) {
              items[itemIndex] = withCalculatedFields(item, { name });
            }
          });

          const invoice = touch({
            ...state.invoice,
            items
          });

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
          savedInvoices: upsertSavedInvoice(get().savedInvoices, nextInvoice, activeSavedInvoiceId),
          ...nextUndoState(get())
        });
      },
      duplicateInvoice: () => {
        const invoice = get().invoice;
        set((state) => ({
          invoice: touch({
            ...invoice,
            customer: { ...invoice.customer, invoiceNumber: generateInvoiceNumber(), date: formatLocalDateInput() },
            items: invoice.items.map((item) => ({ ...item, id: uid("item") })),
            settings: { ...invoice.settings, status: "draft" }
          }),
          ...nextUndoState(state)
        }));
      },
      toggleInvoiceLanguage: () =>
        set((state) => ({
          invoice: touch({
            ...state.invoice,
            settings: {
              ...state.invoice.settings,
              language: state.invoice.settings.language === "bangla" ? "english" : "bangla"
            }
          }),
          ...nextUndoState(state)
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
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
          };
        }),
      saveCurrentInvoice: () =>
        set((state) => {
          const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
          const invoice = touch(state.invoice);

          return {
            invoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, activeSavedInvoiceId),
            ...nextUndoState(state)
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
            savedInvoices: pruneSavedInvoices(state.savedInvoices),
            ...nextUndoState(state)
          };
        }),
      deleteSavedInvoice: (id) =>
        set((state) => {
          const nextSavedInvoices = state.savedInvoices.filter((savedInvoice) => savedInvoice.id !== id);

          if (id !== state.activeSavedInvoiceId) {
            return {
              savedInvoices: nextSavedInvoices,
              ...nextUndoState(state)
            };
          }

          const blankInvoice = touch(createSampleInvoice());
          const activeSavedInvoiceId = uid("saved-invoice");

          return {
            invoice: blankInvoice,
            activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(nextSavedInvoices, blankInvoice, activeSavedInvoiceId),
            ...nextUndoState(state)
          };
        }),
      mergeSavedInvoices: (savedInvoices) =>
        set((state) => {
          const nextSavedInvoices = replaceSavedInvoiceList(savedInvoices.map((savedInvoice) => ({
            ...savedInvoice,
            name: savedInvoice.name || savedInvoiceName(savedInvoice.invoice),
            invoice: normalizeInvoice(savedInvoice.invoice)
          })));

          if (savedInvoiceListsAreEqual(state.savedInvoices, nextSavedInvoices)) {
            return state;
          }

          return { savedInvoices: nextSavedInvoices };
        }),
      loadCloudSavedInvoices: (savedInvoices) =>
        set((state) => {
          const nextSavedInvoices = replaceSavedInvoiceList(savedInvoices.map((savedInvoice) => ({
            ...savedInvoice,
            name: savedInvoice.name || savedInvoiceName(savedInvoice.invoice),
            invoice: normalizeInvoice(savedInvoice.invoice)
          })));

          if (nextSavedInvoices.length === 0) {
            const invoice = createSampleInvoice();
            const savedInvoice = createSavedInvoice(invoice);

            return {
              invoice,
              activeSavedInvoiceId: savedInvoice.id,
              savedInvoices: [savedInvoice],
              undoHistory: [],
              undoGroup: null
            };
          }

          const activeSavedInvoice =
            nextSavedInvoices.find((savedInvoice) => savedInvoice.id === state.activeSavedInvoiceId) ?? nextSavedInvoices[0];

          return {
            invoice: normalizeInvoice(activeSavedInvoice.invoice),
            activeSavedInvoiceId: activeSavedInvoice.id,
            savedInvoices: nextSavedInvoices,
            undoHistory: [],
            undoGroup: null
          };
        }),
      undoLastChange: () =>
        set((state) => {
          const previousState = state.undoHistory.at(-1);

          if (!previousState) {
            return state;
          }

          return {
            ...previousState,
            undoHistory: state.undoHistory.slice(0, -1),
            undoGroup: null
          };
        })
    }),
    {
      name: "smart-invoice-draft",
      version: 8,
      partialize: (state) => ({
        invoice: state.invoice,
        savedInvoices: state.savedInvoices,
        activeSavedInvoiceId: state.activeSavedInvoiceId
      }),
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
          advance: normalizeNumber(state.invoice.advance),
          discount: normalizeNumber(state.invoice.discount),
          taxRate: normalizeNumber(state.invoice.taxRate),
          settings: {
            ...state.invoice.settings,
            language: state.invoice.settings.language ?? "english"
          },
          items: Array.from({ length: 15 }, () => createBlankItem())
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
