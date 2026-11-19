"use client";

import { ArrowDownToLine, ArrowUpToLine, CopyPlus, Eraser, Trash2, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useInvoiceLabels } from "@/store/invoice-language-store";

export type GridMenuAction = "insertAbove" | "insertBelow" | "duplicate" | "clear" | "delete";

interface MenuEntry {
  action: GridMenuAction;
  icon: LucideIcon;
  danger?: boolean;
  separatorBefore?: boolean;
}

// Item text comes from the invoice labels (labels.rowMenu), in the current invoice language.
const ENTRIES: MenuEntry[] = [
  { action: "insertAbove", icon: ArrowUpToLine },
  { action: "insertBelow", icon: ArrowDownToLine },
  { action: "duplicate", icon: CopyPlus, separatorBefore: true },
  { action: "clear", icon: Eraser },
  { action: "delete", icon: Trash2, danger: true, separatorBefore: true }
];

const VIEWPORT_MARGIN = 8;

/**
 * Right-click menu of the item grid. Rendered in a portal on <body>: the invoice is scaled with a CSS transform,
 * which would otherwise make `position: fixed` relative to the sheet instead of the window.
 * Keyboard: arrows / Home / End move, Enter activates, Escape or Tab closes.
 */
export function GridContextMenu({
  x,
  y,
  rowCount,
  disabled,
  onAction,
  onClose
}: {
  x: number;
  y: number;
  rowCount: number;
  disabled: Partial<Record<GridMenuAction, boolean>>;
  onAction: (action: GridMenuAction) => void;
  /** `refocus`: return keyboard focus to the grid (Escape), rather than leaving it where the user clicked. */
  onClose: (refocus: boolean) => void;
}) {
  const labels = useInvoiceLabels();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Keep the whole menu inside the window, flipping it up / left near the edges.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = y + height > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, y - height) : y;
    setPosition({ left, top });
    menu.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const close = () => onCloseRef.current(false);
    const closeOnOutsidePointer = (event: PointerEvent | MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => buttons[(next + buttons.length) % buttons.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(buttons.length - 1);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        onClose(true);
        break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={labels.rowActions}
      data-grid-menu=""
      className="fixed z-[100] min-w-[210px] rounded-xl border border-zinc-200 bg-white p-1 text-[13px] text-zinc-800 shadow-[0_12px_40px_rgba(0,0,0,0.18)] sysdark:border-zinc-700 sysdark:bg-zinc-900 sysdark:text-zinc-100"
      style={position}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {ENTRIES.map(({ action, icon: Icon, danger, separatorBefore }) => (
        <div key={action}>
          {separatorBefore && <div role="separator" className="my-1 h-px bg-zinc-200 sysdark:bg-zinc-700" />}
          <button
            type="button"
            role="menuitem"
            disabled={disabled[action]}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left font-medium outline-none transition-colors",
              "hover:bg-zinc-100 focus-visible:bg-zinc-100 sysdark:hover:bg-zinc-800 sysdark:focus-visible:bg-zinc-800",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              danger && "text-[#e01b24] sysdark:text-red-400"
            )}
            onClick={() => onAction(action)}
          >
            <Icon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
            {labels.rowMenu[action](rowCount)}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
