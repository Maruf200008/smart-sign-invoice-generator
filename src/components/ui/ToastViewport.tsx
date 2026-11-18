"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToastStore } from "@/store/toast-store";

/** Mounted once in the root layout. Announces toasts to screen readers via role="status" / role="alert". */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[10001] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const isError = toast.variant === "error";

          return (
            <motion.div
              key={toast.id}
              layout
              role={isError ? "alert" : "status"}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl backdrop-blur-md",
                isError
                  ? "border-red-200 bg-red-50/95 text-red-800 sysdark:border-red-900 sysdark:bg-red-950/90 sysdark:text-red-100"
                  : "border-emerald-200 bg-emerald-50/95 text-emerald-800 sysdark:border-emerald-900 sysdark:bg-emerald-950/90 sysdark:text-emerald-100"
              )}
            >
              {isError ? <XCircle className="size-5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 flex-1">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                className="grid size-6 shrink-0 place-items-center rounded-full opacity-70 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                onClick={() => dismiss(toast.id)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
