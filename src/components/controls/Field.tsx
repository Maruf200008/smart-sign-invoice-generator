"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function Field({ label, className, ...props }: FieldProps) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
      {label}
      <input
        className={cn(
          "h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-accent focus:ring-4 focus:ring-red-500/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
          className
        )}
        {...props}
      />
    </label>
  );
}

export function TextArea({ label, className, ...props }: TextAreaProps) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
      {label}
      <textarea
        className={cn(
          "min-h-24 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none transition focus:border-accent focus:ring-4 focus:ring-red-500/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
          className
        )}
        {...props}
      />
    </label>
  );
}
