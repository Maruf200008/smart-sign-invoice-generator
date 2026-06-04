"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/cn";

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

export function ActionButton({ icon, children, className, variant = "secondary", onClick, onMouseMove, onMouseLeave, ...props }: ActionButtonProps) {
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [isCursorVisible, setIsCursorVisible] = useState(false);
  const [clickPulseKey, setClickPulseKey] = useState(0);

  function handleMouseMove(event: MouseEvent<HTMLButtonElement>) {
    setCursorPosition({ x: event.clientX, y: event.clientY });
    setIsCursorVisible(true);
    onMouseMove?.(event);
  }

  function handleMouseLeave(event: MouseEvent<HTMLButtonElement>) {
    setIsCursorVisible(false);
    onMouseLeave?.(event);
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    setClickPulseKey((key) => key + 1);
    onClick?.(event);
  }

  return (
    <button
      className={cn(
        "group relative isolate inline-flex h-10 min-w-0 cursor-none items-center justify-center overflow-hidden rounded-md px-2.5 text-sm font-bold transition duration-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3",
        variant === "primary" && "bg-accent text-white shadow-lg shadow-red-600/20 hover:bg-red-700",
        variant === "secondary" && "border border-zinc-200 bg-white text-zinc-900 hover:border-accent hover:text-accent dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white",
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      {...props}
    >
      <span className="relative z-10 inline-flex min-w-0 items-center justify-center gap-2">
        {icon}
        {children}
      </span>
      {isCursorVisible && !props.disabled && (
        <span
          className="pointer-events-none fixed z-[9999] grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/15 shadow-[0_10px_24px_rgba(0,0,0,0.12)] transition-transform duration-75 ease-out"
          style={{ left: cursorPosition.x, top: cursorPosition.y }}
        >
          <span className="absolute size-6 rounded-full bg-[#e01b24]/35" />
          <span className="relative size-2.5 rounded-full bg-[#e01b24]" />
          {clickPulseKey > 0 && (
            <span
              key={clickPulseKey}
              className="absolute size-8 animate-[cursorClickPulse_420ms_ease-out_forwards] rounded-full border border-[#e01b24]/70 bg-[#e01b24]/20"
            />
          )}
        </span>
      )}
    </button>
  );
}
