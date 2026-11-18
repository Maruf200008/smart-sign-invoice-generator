"use client";

import { forwardRef, type TextareaHTMLAttributes, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * A single-paragraph text field that wraps and grows like the read-only invoice text it stands in for.
 * Height is set to a whole number of line boxes (`n * line-height`, in em), so a field and the matching document
 * text are always exactly the same height. Line breaks are not allowed: they are turned into spaces.
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { lineHeightEm?: number }>(
  function AutoGrowTextarea({ className, lineHeightEm = 1.4, onChange, ...props }, forwardedRef) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

    const resize = useCallback(() => {
      const element = ref.current;
      if (!element) return;

      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      element.style.height = "0px";
      const lines = lineHeight > 0 ? Math.max(1, Math.round(element.scrollHeight / lineHeight)) : 1;
      element.style.height = `${lines * lineHeightEm}em`;
    }, [lineHeightEm]);

    useLayoutEffect(resize, [resize, props.value]);

    useEffect(() => {
      const element = ref.current;
      if (!element || typeof ResizeObserver === "undefined") return;

      // Width changes (and late font loads) change wrapping.
      let lastWidth = element.offsetWidth;
      const observer = new ResizeObserver(() => {
        if (element.offsetWidth !== lastWidth) {
          lastWidth = element.offsetWidth;
          resize();
        }
      });
      observer.observe(element);
      document.fonts?.addEventListener?.("loadingdone", resize);

      return () => {
        observer.disconnect();
        document.fonts?.removeEventListener?.("loadingdone", resize);
      };
    }, [resize]);

    return (
      <textarea
        ref={ref}
        rows={1}
        spellCheck={false}
        className={cn(
          "block w-full resize-none overflow-hidden whitespace-pre-wrap border-0 bg-transparent p-0 [overflow-wrap:anywhere] placeholder:text-[#a1a1aa]",
          className
        )}
        onChange={(event) => {
          if (/[\r\n]/.test(event.target.value)) {
            event.target.value = event.target.value.replace(/\s*[\r\n]+\s*/g, " ");
          }
          onChange?.(event);
        }}
        {...props}
      />
    );
  }
);
