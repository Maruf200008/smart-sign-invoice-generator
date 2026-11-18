"use client";

import { create } from "zustand";
import { saveInvoiceToServerNow } from "@/lib/sync/invoice-sync-client";
import { ensureShare, updateShare } from "@/lib/share-client";
import { toast } from "@/store/toast-store";
import type { SavedInvoice } from "@/types/invoice";
import type { ShareSettings, ShareUpsertInput } from "@/types/share";

type SharePhase = "idle" | "loading" | "ready" | "error";
type ShareSettingsPatch = Pick<ShareUpsertInput, "expiry" | "customExpiresAt" | "isEnabled" | "regenerate">;

interface ShareStore {
  isOpen: boolean;
  phase: SharePhase;
  isUpdating: boolean;
  share: ShareSettings | null;
  error: string | null;
  invoiceId: string;
  open: (savedInvoice: SavedInvoice) => Promise<void>;
  close: () => void;
  updateSettings: (patch: ShareSettingsPatch) => Promise<boolean>;
}

// Guards against a slow response from an earlier open() overwriting a newer one.
let openRequestId = 0;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export const useShareStore = create<ShareStore>((set, get) => ({
  isOpen: false,
  phase: "idle",
  isUpdating: false,
  share: null,
  error: null,
  invoiceId: "",
  open: async (savedInvoice) => {
    const requestId = ++openRequestId;

    set({ isOpen: true, phase: "loading", share: null, error: null, invoiceId: savedInvoice.id });

    try {
      // Make sure the cloud copy is current, because the public page renders from the database.
      await saveInvoiceToServerNow(savedInvoice);
      const share = await ensureShare({ invoiceId: savedInvoice.id });

      if (requestId === openRequestId) {
        set({ phase: "ready", share });
      }
    } catch (error) {
      if (requestId === openRequestId) {
        set({ phase: "error", error: errorMessage(error) });
      }
    }
  },
  close: () => {
    openRequestId++;
    set({ isOpen: false, phase: "idle", share: null, error: null, isUpdating: false });
  },
  updateSettings: async (patch) => {
    const { invoiceId, isUpdating } = get();

    if (!invoiceId || isUpdating) {
      return false;
    }

    set({ isUpdating: true });

    try {
      const share = await updateShare({ invoiceId, ...patch });

      // The modal may have been closed or switched to another invoice while the request was in flight.
      if (get().invoiceId === invoiceId && get().isOpen) {
        set({ share });
      }

      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      set({ isUpdating: false });
    }
  }
}));
