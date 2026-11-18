"use client";

import { create } from "zustand";

export type ToastVariant = "success" | "error";

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 4000;
const MAX_TOASTS = 3;
let nextToastId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (variant, message) => {
    const id = nextToastId++;

    set((state) => ({ toasts: [...state.toasts, { id, variant, message }].slice(-MAX_TOASTS) }));
    window.setTimeout(() => get().dismiss(id), TOAST_DURATION_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));

/** Imperative helpers so non-component code (store actions, event handlers) can raise toasts. */
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message)
};
