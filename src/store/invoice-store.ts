"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InvoiceData, InvoiceItem, SavedInvoice } from "@/types/invoice";
import { applyItemPatch, createBlankItem, uid, withMinimumRows } from "@/lib/invoice-utils";
import { MAX_STORED_ITEMS, sanitizeInvoiceData } from "@/lib/invoice-normalize";
import { mergeCloudInvoices, normalizeSavedInvoice, pruneSavedInvoices, savedInvoiceListsAreEqual, savedInvoiceName } from "@/lib/invoice-sync";
import { createSampleInvoice } from "@/lib/sample-invoice";

interface InvoiceStore {
  invoice: InvoiceData;
  savedInvoices: SavedInvoice[];
  activeSavedInvoiceId: string;
  undoHistory: InvoiceSnapshot[];
  /** Changes undone since the last edit; any new edit clears it. Not persisted. */
  redoHistory: InvoiceSnapshot[];
  undoGroup: UndoGroup;
  updateInvoice: (patch: Partial<InvoiceData>) => void;
  addItem: () => void;
  removeItem: (id: string) => void;
  reorderItem: (fromIndex: number, toIndex: number) => void;
  updateItem: (id: string, patch: Partial<InvoiceItem>) => void;
  /** Replaces all rows at once (paste, insert, duplicate, clear, delete) as a single undo step. */
  setItems: (items: InvoiceItem[]) => void;
  resetDraft: () => void;
  loadSavedInvoice: (id: string) => void;
  deleteSavedInvoice: (id: string) => void;
  mergeSavedInvoices: (savedInvoices: SavedInvoice[]) => void;
  loadCloudSavedInvoices: (savedInvoices: SavedInvoice[]) => void;
  undoLastChange: () => void;
  redoLastChange: () => void;
}

/** Rows an invoice can have. Rows are laid out 12 per A4 page; row 13 onwards continues on the next page. */
export const MAX_INVOICE_ITEMS = MAX_STORED_ITEMS;
const MAX_UNDO_HISTORY = 100;
const UNDO_GROUP_MS = 1200;
/** Undo only ever restores the invoice being edited; it never rewrites other (possibly shared) invoices. */
type InvoiceSnapshot = Pick<InvoiceStore, "invoice" | "activeSavedInvoiceId">;
type UndoGroup = { key: string; expiresAt: number } | null;

function touch(invoice: InvoiceData): InvoiceData {
  return { ...invoice, updatedAt: new Date().toISOString() };
}

/** Every invoice opened in the editor has at least 12 rows (one full page), even ones saved with fewer. */
function withRows(invoice: InvoiceData): InvoiceData {
  const items = withMinimumRows(invoice.items);
  return items === invoice.items ? invoice : { ...invoice, items };
}

function createSavedInvoice(invoice: InvoiceData, id = uid("saved-invoice"), createdBy?: string): SavedInvoice {
  return {
    id,
    name: savedInvoiceName(invoice),
    savedAt: new Date().toISOString(),
    ...(createdBy ? { createdBy } : {}),
    invoice
  };
}

function upsertSavedInvoice(savedInvoices: SavedInvoice[], invoice: InvoiceData, activeSavedInvoiceId: string) {
  const existing = savedInvoices.find((item) => item.id === activeSavedInvoiceId);
  const savedInvoice = createSavedInvoice(invoice, activeSavedInvoiceId, existing?.createdBy);
  const nextSavedInvoices = savedInvoices.filter((item) => item.id !== activeSavedInvoiceId);

  return pruneSavedInvoices([savedInvoice, ...nextSavedInvoices]);
}

/** True for an untouched blank draft, which isn't worth keeping when the cloud already has invoices. */
function isBlankInvoice(invoice: InvoiceData) {
  return (
    !invoice.customer.name.trim() &&
    invoice.advance === 0 &&
    invoice.discount === 0 &&
    invoice.items.every((item) => !item.name.trim() && !item.width && !item.height && !item.quantity && !item.unitPrice && !item.total)
  );
}

function createInitialInvoiceState() {
  const invoice = createSampleInvoice();
  const savedInvoice = createSavedInvoice(invoice);

  return {
    invoice,
    savedInvoices: [savedInvoice],
    activeSavedInvoiceId: savedInvoice.id,
    undoHistory: [],
    redoHistory: [],
    undoGroup: null
  };
}

function nextUndoState(state: InvoiceStore, groupKey?: string) {
  const now = Date.now();

  if (groupKey && state.undoGroup?.key === groupKey && state.undoGroup.expiresAt > now) {
    return {
      undoHistory: state.undoHistory,
      redoHistory: [],
      undoGroup: { key: groupKey, expiresAt: now + UNDO_GROUP_MS }
    };
  }

  const snapshot: InvoiceSnapshot = { invoice: state.invoice, activeSavedInvoiceId: state.activeSavedInvoiceId };

  return {
    undoHistory: [...state.undoHistory.slice(-(MAX_UNDO_HISTORY - 1)), snapshot],
    redoHistory: [],
    undoGroup: groupKey ? { key: groupKey, expiresAt: now + UNDO_GROUP_MS } : null
  };
}

function undoGroupKey(prefix: string, patch: Record<string, unknown>) {
  return `${prefix}:${Object.keys(patch).sort().join("|")}`;
}

/** Applies an edit to the open invoice, mirrors it into the saved list and records an undo step. */
function commitEdit(state: InvoiceStore, invoice: InvoiceData, groupKey?: string) {
  const activeSavedInvoiceId = state.activeSavedInvoiceId || uid("saved-invoice");
  const nextInvoice = touch(invoice);

  return {
    invoice: nextInvoice,
    activeSavedInvoiceId,
    savedInvoices: upsertSavedInvoice(state.savedInvoices, nextInvoice, activeSavedInvoiceId),
    ...nextUndoState(state, groupKey)
  };
}

export const useInvoiceStore = create<InvoiceStore>()(
  persist(
    (set) => ({
      ...createInitialInvoiceState(),
      updateInvoice: (patch) => set((state) => commitEdit(state, { ...state.invoice, ...patch }, undoGroupKey("invoice", patch))),
      addItem: () =>
        set((state) => {
          if (state.invoice.items.length >= MAX_INVOICE_ITEMS) {
            return state;
          }

          const isFirstItem = state.invoice.items.length === 0;

          return commitEdit(state, {
            ...state.invoice,
            advance: isFirstItem ? 0 : state.invoice.advance,
            discount: isFirstItem ? 0 : state.invoice.discount,
            taxRate: isFirstItem ? 0 : state.invoice.taxRate,
            items: [...state.invoice.items, createBlankItem()]
          });
        }),
      removeItem: (id) =>
        set((state) => commitEdit(state, { ...state.invoice, items: withMinimumRows(state.invoice.items.filter((item) => item.id !== id)) })),
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
          return commitEdit(state, { ...state.invoice, items });
        }),
      updateItem: (id, patch) =>
        set((state) =>
          commitEdit(
            state,
            { ...state.invoice, items: state.invoice.items.map((item) => (item.id === id ? applyItemPatch(item, patch) : item)) },
            undoGroupKey(`item:${id}`, patch)
          )
        ),
      setItems: (items) =>
        set((state) => commitEdit(state, { ...state.invoice, items: withMinimumRows(items.slice(0, MAX_INVOICE_ITEMS)) })),
      resetDraft: () =>
        set((state) => {
          const invoice = touch(createSampleInvoice());
          const activeSavedInvoiceId = uid("saved-invoice");

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

          if (!savedInvoice || id === state.activeSavedInvoiceId) {
            return state;
          }

          // Opening an invoice is not an edit, so its updatedAt is left alone (no needless re-upload).
          return {
            invoice: withRows(sanitizeInvoiceData(savedInvoice.invoice)),
            activeSavedInvoiceId: savedInvoice.id,
            ...nextUndoState(state)
          };
        }),
      deleteSavedInvoice: (id) =>
        set((state) => {
          const nextSavedInvoices = state.savedInvoices.filter((savedInvoice) => savedInvoice.id !== id);

          if (id !== state.activeSavedInvoiceId) {
            return { savedInvoices: nextSavedInvoices };
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
      mergeSavedInvoices: (cloudInvoices) =>
        set((state) => {
          const nextSavedInvoices = mergeCloudInvoices(state.savedInvoices, cloudInvoices, state.activeSavedInvoiceId);
          return savedInvoiceListsAreEqual(state.savedInvoices, nextSavedInvoices) ? state : { savedInvoices: nextSavedInvoices };
        }),
      loadCloudSavedInvoices: (cloudInvoices) =>
        set((state) => {
          const localActive = state.savedInvoices.find((savedInvoice) => savedInvoice.id === state.activeSavedInvoiceId);
          const isUnsyncedBlank =
            Boolean(localActive) && isBlankInvoice(localActive!.invoice) && !cloudInvoices.some((savedInvoice) => savedInvoice.id === state.activeSavedInvoiceId);
          // Don't keep (and upload) an empty local draft on a device that is just signing in.
          const keepId = isUnsyncedBlank && cloudInvoices.length > 0 ? "" : state.activeSavedInvoiceId;
          const nextSavedInvoices = mergeCloudInvoices(state.savedInvoices, cloudInvoices, keepId);

          if (nextSavedInvoices.length === 0) {
            const invoice = createSampleInvoice();
            const savedInvoice = createSavedInvoice(invoice);

            return { invoice, activeSavedInvoiceId: savedInvoice.id, savedInvoices: [savedInvoice], undoHistory: [], redoHistory: [], undoGroup: null };
          }

          const activeSavedInvoice = nextSavedInvoices.find((savedInvoice) => savedInvoice.id === keepId) ?? nextSavedInvoices[0];

          return {
            invoice: withRows(activeSavedInvoice.invoice),
            activeSavedInvoiceId: activeSavedInvoice.id,
            savedInvoices: nextSavedInvoices,
            undoHistory: [],
            redoHistory: [],
            undoGroup: null
          };
        }),
      undoLastChange: () =>
        set((state) => {
          const previous = state.undoHistory.at(-1);

          if (!previous) {
            return state;
          }

          // The restored state is a new edit (newer than the cloud copy), so it will be synced like any other.
          const invoice = touch(previous.invoice);

          return {
            invoice,
            activeSavedInvoiceId: previous.activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, previous.activeSavedInvoiceId),
            undoHistory: state.undoHistory.slice(0, -1),
            redoHistory: [...state.redoHistory.slice(-(MAX_UNDO_HISTORY - 1)), { invoice: state.invoice, activeSavedInvoiceId: state.activeSavedInvoiceId }],
            undoGroup: null
          };
        }),
      redoLastChange: () =>
        set((state) => {
          const next = state.redoHistory.at(-1);

          if (!next) {
            return state;
          }

          const invoice = touch(next.invoice);

          return {
            invoice,
            activeSavedInvoiceId: next.activeSavedInvoiceId,
            savedInvoices: upsertSavedInvoice(state.savedInvoices, invoice, next.activeSavedInvoiceId),
            undoHistory: [...state.undoHistory.slice(-(MAX_UNDO_HISTORY - 1)), { invoice: state.invoice, activeSavedInvoiceId: state.activeSavedInvoiceId }],
            redoHistory: state.redoHistory.slice(0, -1),
            undoGroup: null
          };
        })
    }),
    {
      name: "smart-invoice-draft",
      version: 9,
      partialize: (state) => ({
        invoice: state.invoice,
        savedInvoices: state.savedInvoices,
        activeSavedInvoiceId: state.activeSavedInvoiceId
      }),
      // Anything read back from localStorage is untrusted (older versions, manual edits): sanitize all of it.
      migrate: (persistedState: unknown) => {
        const state = persistedState as { invoice?: unknown; savedInvoices?: SavedInvoice[]; activeSavedInvoiceId?: string } | undefined;

        if (!state?.invoice) {
          const invoice = createSampleInvoice();
          const savedInvoice = createSavedInvoice(invoice);

          return { invoice, savedInvoices: [savedInvoice], activeSavedInvoiceId: savedInvoice.id };
        }

        const savedInvoices = pruneSavedInvoices(
          (Array.isArray(state.savedInvoices) ? state.savedInvoices : [])
            .filter((savedInvoice) => savedInvoice && typeof savedInvoice.id === "string")
            .map(normalizeSavedInvoice)
        );
        const invoice = withRows(sanitizeInvoiceData(state.invoice));

        const activeSavedInvoiceId = state.activeSavedInvoiceId || savedInvoices[0]?.id || uid("saved-invoice");

        return {
          invoice,
          activeSavedInvoiceId,
          savedInvoices: savedInvoices.length > 0 ? savedInvoices : [createSavedInvoice(invoice, activeSavedInvoiceId)]
        };
      }
    }
  )
);
