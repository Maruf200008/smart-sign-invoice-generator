"use client";

import { create } from "zustand";

export type ToastVariant = "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  action?: ToastAction;
}

interface ToastOptions {
  action?: ToastAction;
}

interface ToastStore {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const TOAST_DURATION_MS = 4000;
/** Toasts with a button stay longer so there is time to use it. */
const ACTION_TOAST_DURATION_MS = 10000;
const MAX_TOASTS = 3;
let nextToastId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (variant, message, options = {}) => {
    const id = nextToastId++;

    set((state) => ({ toasts: [...state.toasts, { id, variant, message, ...(options.action ? { action: options.action } : {}) }].slice(-MAX_TOASTS) }));
    window.setTimeout(() => get().dismiss(id), options.action ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}));

/** Imperative helpers so non-component code (store actions, event handlers) can raise toasts. */
export const toast = {
  success: (message: string, options?: ToastOptions) => useToastStore.getState().push("success", message, options),
  error: (message: string, options?: ToastOptions) => useToastStore.getState().push("error", message, options)
};
