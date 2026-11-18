"use client";

import { CalendarClock, Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import {
  endOfLocalDayIso,
  EXPIRY_OPTIONS,
  formatExpiry,
  inferExpiryPreset,
  isShareExpired,
  toLocalDateInputValue
} from "@/lib/share-utils";
import { useShareStore } from "@/store/share-store";
import { toast } from "@/store/toast-store";
import type { ShareExpiryPreset, ShareSettings } from "@/types/share";

const fieldClass =
  "h-10 rounded-xl border border-zinc-200 bg-white/80 px-3 text-sm font-semibold text-zinc-900 outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 sysdark:border-white/15 sysdark:bg-white/10 sysdark:text-zinc-50 sysdark:[color-scheme:dark]";

export function ShareSettingsPanel({ share }: { share: ShareSettings }) {
  const updateSettings = useShareStore((state) => state.updateSettings);
  const isUpdating = useShareStore((state) => state.isUpdating);
  const expiryId = useId();
  const dateId = useId();
  const [choice, setChoice] = useState<ShareExpiryPreset>(() => inferExpiryPreset(share));
  const [customDate, setCustomDate] = useState(() => toLocalDateInputValue(share.expiresAt));
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const expired = isShareExpired(share.expiresAt);
  const today = toLocalDateInputValue(null);

  // Keep the controls honest if the server returns a different expiry than the one requested (e.g. after regenerate).
  useEffect(() => {
    setCustomDate(toLocalDateInputValue(share.expiresAt));
  }, [share.expiresAt]);

  async function chooseExpiry(next: ShareExpiryPreset) {
    setChoice(next);

    if (next === "custom") {
      // Start from the current expiry if it is still in the future, otherwise a week out; the user then adjusts the date.
      const keepCurrent = share.expiresAt && !expired;
      const startDate = keepCurrent ? toLocalDateInputValue(share.expiresAt) : toLocalDateInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

      if (!(await chooseCustomDate(startDate))) {
        setChoice(inferExpiryPreset(share));
      }
      return;
    }

    if (!(await updateSettings({ expiry: next }))) {
      setChoice(inferExpiryPreset(share));
    }
  }

  async function chooseCustomDate(value: string) {
    setCustomDate(value);
    const iso = endOfLocalDayIso(value);

    if (!iso || new Date(iso).getTime() <= Date.now()) {
      toast.error("Pick a date in the future.");
      return false;
    }

    return updateSettings({ expiry: "custom", customExpiresAt: iso });
  }

  async function toggleEnabled() {
    await updateSettings({ isEnabled: !share.isEnabled });
  }

  async function regenerate() {
    if (!confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }

    setConfirmRegenerate(false);

    if (await updateSettings({ regenerate: true })) {
      toast.success("New link created. The old link no longer works.");
    }
  }

  return (
    <section aria-label="Link settings" className="grid gap-3 rounded-2xl border border-zinc-200/80 bg-white/50 p-3.5 sysdark:border-white/10 sysdark:bg-white/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="share-enabled-label" className="text-sm font-bold text-zinc-900 sysdark:text-zinc-50">Link sharing</p>
          <p className="text-xs font-medium text-zinc-500 sysdark:text-zinc-400">
            {share.isEnabled ? "Anyone with the link can view this invoice." : "Turned off. The link shows “Sharing Disabled”."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={share.isEnabled}
          aria-labelledby="share-enabled-label"
          disabled={isUpdating}
          onClick={() => void toggleEnabled()}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60",
            share.isEnabled ? "bg-emerald-500" : "bg-zinc-300 sysdark:bg-zinc-600"
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform",
              share.isEnabled && "translate-x-5"
            )}
          />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
        <label htmlFor={expiryId} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500 sysdark:text-zinc-400">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          Link expires
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id={expiryId}
            value={choice}
            disabled={isUpdating}
            onChange={(event) => void chooseExpiry(event.target.value as ShareExpiryPreset)}
            className={cn(fieldClass, "min-w-0 flex-1 sm:flex-none")}
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {choice === "custom" && (
            <>
              <label htmlFor={dateId} className="sr-only">Custom expiry date</label>
              <input
                id={dateId}
                type="date"
                min={today}
                value={customDate}
                disabled={isUpdating}
                onChange={(event) => void chooseCustomDate(event.target.value)}
                className={cn(fieldClass, "min-w-0 flex-1 sm:flex-none")}
              />
            </>
          )}
          {isUpdating && <Loader2 className="size-4 animate-spin text-zinc-400" aria-label="Saving" />}
        </div>
      </div>

      <p className={cn("text-xs font-semibold", expired ? "text-amber-600 sysdark:text-amber-400" : "text-zinc-500 sysdark:text-zinc-400")} aria-live="polite">
        {expired ? `Expired. ${formatExpiry(share.expiresAt)}. Choose a new expiry to reactivate.` : formatExpiry(share.expiresAt)}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 pt-3 sysdark:border-white/10">
        <p className="text-xs font-medium text-zinc-500 sysdark:text-zinc-400">
          {confirmRegenerate ? "The current link will stop working. Continue?" : "Link leaked? Create a new one."}
        </p>
        <div className="flex gap-2">
          {confirmRegenerate && (
            <button type="button" onClick={() => setConfirmRegenerate(false)} className={smallButton}>
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => void regenerate()}
            className={cn(smallButton, confirmRegenerate && "border-red-300 text-red-600 hover:border-red-500 hover:text-red-700")}
          >
            <RefreshCcw className="size-3.5" aria-hidden="true" />
            {confirmRegenerate ? "Yes, replace link" : "New link"}
          </button>
        </div>
      </div>
    </section>
  );
}

const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sysdark:border-white/15 sysdark:bg-white/10 sysdark:text-zinc-100";
