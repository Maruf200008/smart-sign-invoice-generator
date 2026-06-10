"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

export function ActionButton({ icon, children, className, variant = "secondary", ...props }: ActionButtonProps) {
  return (
    <button
      className={cn(
        "group relative isolate inline-flex h-10 min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-md px-2.5 text-sm font-bold transition duration-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3",
        variant === "primary" && "bg-accent text-white shadow-lg shadow-red-600/20 hover:bg-red-700",
        variant === "secondary" && "border border-zinc-200 bg-white text-zinc-900 hover:border-accent hover:text-accent dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white",
        className
      )}
      {...props}
    >
      <span className="relative z-10 inline-flex min-w-0 items-center justify-center gap-2">
        {icon}
        {children}
      </span>
    </button>
  );
}
