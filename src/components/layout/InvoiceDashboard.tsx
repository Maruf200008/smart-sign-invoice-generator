"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CloudOff, FileText, Loader2, Lock, LogOut, Plus, Search, Trash2, X } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActionButton } from "@/components/controls/ActionButton";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { DownloadPdfButton } from "@/components/controls/DownloadPdfButton";
import { LanguageToggleButton } from "@/components/controls/LanguageToggleButton";
import { ShareButton } from "@/components/controls/ShareButton";
import { ShareModal } from "@/components/share/ShareModal";
import backgroundPattern from "@/assets/background_pattern.jpg";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { deleteCloudInvoice, loadCloudInvoices, releaseCloudInvoiceLock, SessionExpiredError, touchCloudInvoiceLock } from "@/lib/invoice-cloud-storage";
import { createSaveShortcutHandler, saveShortcutLabel } from "@/lib/sync/save-shortcut";
import { getInvoiceSyncManager } from "@/lib/sync/invoice-sync-client";
import type { FlushOutcome, SyncStatus } from "@/lib/sync/sync-manager";
import { getCurrentInvoiceDocument } from "@/store/invoice-language-store";
import { useInvoiceStore } from "@/store/invoice-store";
import { toast } from "@/store/toast-store";
import type { AuthUser } from "@/types/auth";
import type { SavedInvoice } from "@/types/invoice";

const SAVED_INVOICE_PREVIEW_LIMIT = 10;
/** Edits are saved on Ctrl+S, when the page is left, and by this periodic auto-save — never per keystroke. */
const AUTO_SAVE_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 10_000;
const LOCK_REFRESH_MS = 10_000;
const SIGN_OUT_SAVE_TIMEOUT_MS = 3000;

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function withoutPeriod(message: string) {
  return message.trim().replace(/\.+$/, "");
}

function activeSavedInvoiceSnapshot() {
  const { savedInvoices, activeSavedInvoiceId } = useInvoiceStore.getState();
  return savedInvoices.find((savedInvoice) => savedInvoice.id === activeSavedInvoiceId);
}

export function InvoiceDashboard({ currentUser, onSignOut }: { currentUser: AuthUser; onSignOut: () => void }) {
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [isCloudEnabled, setIsCloudEnabled] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null | undefined>(undefined);
  const [showSavedInvoices, setShowSavedInvoices] = useState(false);
  const savedInvoiceSidebarRef = useRef<HTMLDivElement>(null);
  const savedInvoiceToggleRef = useRef<HTMLSpanElement>(null);
  const lockNoticeShownRef = useRef(new Set<string>());
  const refreshInFlightRef = useRef(false);
  /** The first cloud load failed, so the next successful contact should merge the cloud list in. */
  const needsCloudMergeRef = useRef(false);
  const [syncManager] = useState(getInvoiceSyncManager);
  const syncStatus = useSyncExternalStore(syncManager.subscribe, syncManager.getStatus, syncManager.getStatus);
  const resetDraft = useInvoiceStore((state) => state.resetDraft);
  const savedInvoices = useInvoiceStore((state) => state.savedInvoices);
  const activeSavedInvoiceId = useInvoiceStore((state) => state.activeSavedInvoiceId);
  const loadSavedInvoice = useInvoiceStore((state) => state.loadSavedInvoice);
  const deleteSavedInvoice = useInvoiceStore((state) => state.deleteSavedInvoice);
  const mergeSavedInvoices = useInvoiceStore((state) => state.mergeSavedInvoices);
  const loadCloudSavedInvoices = useInvoiceStore((state) => state.loadCloudSavedInvoices);
  const applyServerInvoice = useInvoiceStore((state) => state.applyServerInvoice);
  const undoLastChange = useInvoiceStore((state) => state.undoLastChange);
  const redoLastChange = useInvoiceStore((state) => state.redoLastChange);
  const activeSavedInvoice = useMemo(
    () => savedInvoices.find((savedInvoice) => savedInvoice.id === activeSavedInvoiceId),
    [activeSavedInvoiceId, savedInvoices]
  );

  const showLockedNotice = useCallback((id: string, who: string | null) => {
    setLockedBy(who);

    if (!lockNoticeShownRef.current.has(id)) {
      lockNoticeShownRef.current.add(id);
      toast.error(`This invoice is open${who ? ` by ${who}` : ""} on another device. Your changes are kept on this device and will sync once it is free.`);
    }
  }, []);

  const refreshCloudInvoices = useCallback(async () => {
    if (refreshInFlightRef.current || !isPageVisible()) {
      return;
    }

    refreshInFlightRef.current = true;

    try {
      const result = await loadCloudInvoices();

      if (result.configured) {
        needsCloudMergeRef.current = false;
        syncManager.recordServerCopies(result.invoices);
        mergeSavedInvoices(result.invoices, syncManager.pendingIds());
      }
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        console.warn("Unable to refresh cloud invoices.", error);
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [mergeSavedInvoices, syncManager]);

  // Initial load: the cloud is the source of truth; local storage is the fallback when it is unavailable.
  useEffect(() => {
    let isCancelled = false;

    loadCloudInvoices()
      .then((result) => {
        if (isCancelled) return;

        if (result.configured) {
          syncManager.recordServerCopies(result.invoices);
          loadCloudSavedInvoices(result.invoices, syncManager.pendingIds());
          syncManager.setEnabled(true);
          setIsCloudEnabled(true);

          // Edits queued in an earlier session (closed offline, crashed) go up now.
          if (syncManager.getStatus().pendingCount > 0) void syncManager.flush();
        } else {
          syncManager.setEnabled(false);
        }
      })
      .catch((error) => {
        if (isCancelled || error instanceof SessionExpiredError) return;
        console.error("Unable to load cloud invoices.", error);
        // Keep syncing enabled: saves queue up locally and go out (and the list is merged) once the server answers.
        needsCloudMergeRef.current = true;
        setIsCloudEnabled(true);
        toast.error("Couldn't reach cloud storage. You're working on this device's copy; changes will sync when it's back.");
      })
      .finally(() => {
        if (!isCancelled) setIsCloudReady(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [loadCloudSavedInvoices, syncManager]);

  // Every edit marks the open invoice dirty (local only). Nothing is sent until a save trigger fires.
  useEffect(() => {
    if (isCloudReady && activeSavedInvoice) {
      syncManager.track(activeSavedInvoice);
    }
  }, [activeSavedInvoice, isCloudReady, syncManager]);

  const saveNow = useCallback(async (): Promise<FlushOutcome> => {
    const active = activeSavedInvoiceSnapshot();
    if (active) syncManager.track(active);

    const outcome = await syncManager.flush();

    if (outcome.status === "saved" && needsCloudMergeRef.current) {
      void refreshCloudInvoices();
    }

    return outcome;
  }, [refreshCloudInvoices, syncManager]);

  const saveWithFeedback = useCallback(async () => {
    const outcome = await saveNow();

    switch (outcome.status) {
      case "saved":
      case "nothing":
        toast.success("Saved successfully");
        break;
      case "disabled":
        toast.success("Saved on this device. Cloud storage isn't configured on the server.");
        break;
      case "conflict":
        toast.error(`${withoutPeriod(outcome.conflict.message)}. Choose which copy to keep.`);
        break;
      case "failed":
        if (outcome.error.kind !== "auth") {
          toast.error(`Save failed (${withoutPeriod(outcome.error.message)}). Your changes are stored locally. Retry?`, {
            action: { label: "Retry", onClick: () => void saveWithFeedbackRef.current() }
          });
        }
        break;
    }
  }, [saveNow]);
  const saveWithFeedbackRef = useRef(saveWithFeedback);
  saveWithFeedbackRef.current = saveWithFeedback;

  // Ctrl+S / Cmd+S saves straight to the server instead of opening the browser's "Save page" dialog.
  useEffect(() => {
    const handleSaveShortcut = createSaveShortcutHandler(() => void saveWithFeedbackRef.current());

    window.addEventListener("keydown", handleSaveShortcut, true);
    return () => window.removeEventListener("keydown", handleSaveShortcut, true);
  }, []);

  // Auto-save interval, reconnect retry, and saving when the page is hidden or closed.
  useEffect(() => {
    if (!isCloudEnabled) return;

    syncManager.startAutoSave(AUTO_SAVE_INTERVAL_MS);

    const onOnline = () => {
      syncManager.handleOnline();
      void refreshCloudInvoices();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden" && syncManager.getStatus().pendingCount > 0) void syncManager.flush();
    };
    const onPageHide = () => syncManager.flushOnExit();

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      syncManager.dispose();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [isCloudEnabled, refreshCloudInvoices, syncManager]);

  // Keep the list fresh, but only while the tab is visible (no background traffic).
  useEffect(() => {
    if (!isCloudEnabled) return;

    const intervalId = window.setInterval(() => void refreshCloudInvoices(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (isPageVisible()) void refreshCloudInvoices();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isCloudEnabled, refreshCloudInvoices]);

  // Hold the edit lock for the open invoice while this tab is visible; release it when switching away.
  useEffect(() => {
    if (!isCloudEnabled || !activeSavedInvoiceId) return;

    const id = activeSavedInvoiceId;
    setLockedBy(undefined);

    const touchLock = () => {
      if (!isPageVisible()) return;

      touchCloudInvoiceLock(id)
        .then((result) => {
          if (result.locked) {
            showLockedNotice(id, result.lockedBy ?? null);
          } else {
            lockNoticeShownRef.current.delete(id);
            setLockedBy(undefined);
          }
        })
        .catch((error) => {
          if (!(error instanceof SessionExpiredError)) console.warn("Unable to refresh invoice lock.", error);
        });
    };

    touchLock();
    const intervalId = window.setInterval(touchLock, LOCK_REFRESH_MS);
    document.addEventListener("visibilitychange", touchLock);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", touchLock);
      releaseCloudInvoiceLock(id);
    };
  }, [activeSavedInvoiceId, isCloudEnabled, showLockedNotice]);

  async function handleResolveConflict(choice: "keep-local" | "use-server") {
    const conflict = syncStatus.conflict;
    if (!conflict) return;

    const serverCopy = await syncManager.resolveConflict(conflict.documentId, choice);

    if (choice === "use-server") {
      if (serverCopy) {
        applyServerInvoice(serverCopy);
        toast.success("Loaded the server copy.");
      } else {
        deleteSavedInvoice(conflict.documentId);
        toast.success("Removed the invoice that was deleted on another device.");
      }
    } else if (syncManager.getStatus().phase === "saved") {
      toast.success("Saved successfully");
    }
  }

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const isUndoKey = key === "z" && !event.shiftKey;
      // Ctrl+Y (Windows / Excel) and Ctrl+Shift+Z (macOS) both redo.
      const isRedoKey = (key === "y" && !event.shiftKey) || (key === "z" && event.shiftKey);

      if (isUndoKey) {
        event.preventDefault();
        undoLastChange();
      } else if (isRedoKey) {
        event.preventDefault();
        redoLastChange();
      }
    };

    window.addEventListener("keydown", handleUndoShortcut, true);
    return () => window.removeEventListener("keydown", handleUndoShortcut, true);
  }, [undoLastChange, redoLastChange]);

  useEffect(() => {
    if (!showSavedInvoices) {
      return;
    }

    function hideOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSavedInvoices(false);
      }
    }

    function hideOnOutsideClick(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      // Clicks inside dialogs rendered from the sidebar (delete confirmation) must not close it.
      if (target instanceof Element && target.closest("[role='alertdialog'], [role='dialog']")) {
        return;
      }

      if (savedInvoiceSidebarRef.current?.contains(target) || savedInvoiceToggleRef.current?.contains(target)) {
        return;
      }

      setShowSavedInvoices(false);
    }

    document.addEventListener("keydown", hideOnEscape);
    document.addEventListener("pointerdown", hideOnOutsideClick);

    return () => {
      document.removeEventListener("keydown", hideOnEscape);
      document.removeEventListener("pointerdown", hideOnOutsideClick);
    };
  }, [showSavedInvoices]);

  async function handleDeleteSavedInvoices(ids: string[]) {
    let deletedCount = 0;
    let firstError = "";

    // Sequential, so each delete sees the state left by the previous one.
    for (const id of ids) {
      try {
        if (isCloudEnabled) {
          await deleteCloudInvoice(id);
        }

        syncManager.discard(id);
        deleteSavedInvoice(id);
        deletedCount += 1;
      } catch (error) {
        if (error instanceof SessionExpiredError) return;
        firstError ||= error instanceof Error ? error.message : "Unable to delete the invoice.";
      }
    }

    if (firstError) {
      toast.error(deletedCount > 0 ? `Deleted ${deletedCount} of ${ids.length}. ${firstError}` : firstError);
    } else {
      toast.success(deletedCount === 1 ? "Invoice deleted." : `${deletedCount} invoices deleted.`);
    }
  }

  async function handleSignOut() {
    if (isCloudEnabled) {
      await Promise.race([saveNow(), new Promise((resolve) => window.setTimeout(resolve, SIGN_OUT_SAVE_TIMEOUT_MS))]);
    }

    if (activeSavedInvoiceId && isCloudEnabled) {
      releaseCloudInvoiceLock(activeSavedInvoiceId);
    }

    // The cloud keeps everything, so don't leave the shared invoice list behind in this browser —
    // unless some edits never reached the server: then the local copy is all there is, so keep it.
    if (isCloudEnabled && syncManager.getStatus().pendingCount === 0) {
      useInvoiceStore.persist.clearStorage();
    } else if (syncManager.getStatus().pendingCount > 0) {
      toast.error("Some changes haven't reached the server yet. They're kept on this device and will sync after you sign in again.");
    }

    onSignOut();
  }

  if (!isCloudReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#e8e8e8]">
        <BrandLoader />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#e8e8e8] text-zinc-950">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-center bg-no-repeat opacity-50"
        style={{
          backgroundImage: `url(${backgroundPattern.src})`,
          backgroundSize: "cover"
        }}
      />

      <div className="relative z-10 mx-auto flex w-full flex-col items-center gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-7">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="no-print grid w-full grid-cols-2 justify-items-center gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center sm:gap-3"
        >
          <span ref={savedInvoiceToggleRef} className="contents">
            <ActionButton
              icon={<FileText className="size-4" />}
              aria-expanded={showSavedInvoices}
              onClick={() => setShowSavedInvoices((isVisible) => !isVisible)}
            >
              {showSavedInvoices ? "Hide Saved Invoice" : "Show Saved Invoice"}
            </ActionButton>
          </span>
          <ActionButton icon={<Plus className="size-4" />} onClick={resetDraft}>New Invoice</ActionButton>
          <LanguageToggleButton />
          {/* Reads the latest invoice (in the current language) at click time, so the button never re-renders on edits. */}
          <DownloadPdfButton getDocument={getCurrentInvoiceDocument} />
          <ShareButton />
          <ActionButton icon={<LogOut className="size-4" />} aria-label={`Sign out ${currentUser.username}`} title="Sign out" onClick={() => void handleSignOut()}>
            {currentUser.username}
          </ActionButton>
        </motion.div>

        <SyncIndicator
          status={syncStatus}
          lockedBy={lockedBy}
          onSave={() => void saveWithFeedback()}
          onRetry={() => void saveWithFeedback()}
          onResolveConflict={(choice) => void handleResolveConflict(choice)}
        />

        <AnimatePresence>
          {showSavedInvoices && (
            <motion.div
              ref={savedInvoiceSidebarRef}
              initial={{ opacity: 0, x: -300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -300 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="no-print fixed inset-y-0 left-0 z-30 flex w-[320px] max-w-[86vw] justify-center overflow-y-auto bg-white px-4 py-24 shadow-[8px_0_30px_rgba(0,0,0,0.12)]"
            >
              <SavedInvoiceSidebar
                activeSavedInvoiceId={activeSavedInvoiceId}
                savedInvoices={savedInvoices}
                onLoad={loadSavedInvoice}
                onDelete={(ids) => void handleDeleteSavedInvoices(ids)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid w-full gap-4 xl:grid-cols-1 xl:items-start">
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full overflow-x-hidden pb-8 sm:overflow-auto">
            <InvoicePreview key={activeSavedInvoiceId} />
          </motion.section>
        </div>
      </div>

      <ShareModal />
    </main>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

function savedAgo(lastSavedAt: number | null, now: number) {
  if (lastSavedAt === null) return "All changes saved";

  const seconds = Math.max(0, Math.round((now - lastSavedAt) / 1000));
  if (seconds < 45) return "Saved just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Saved ${minutes} min ago`;

  return `Saved at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(lastSavedAt)}`;
}

const DOT_CLASS = {
  amber: "bg-amber-400",
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  red: "bg-red-600",
  gray: "bg-zinc-400"
} as const;

function StatusDot({ tone }: { tone: keyof typeof DOT_CLASS }) {
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />;
}

function IndicatorButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full border border-current px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition hover:bg-white/70"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Save status: 🟡 Unsaved changes · 🔵 Saving… · 🟢 Saved just now · 🔴 Sync failed – Retry · conflict choices. */
function SyncIndicator({
  status,
  lockedBy,
  onSave,
  onRetry,
  onResolveConflict
}: {
  status: SyncStatus;
  /** undefined: not locked; null/name: another device holds the edit lock. */
  lockedBy: string | null | undefined;
  onSave: () => void;
  onRetry: () => void;
  onResolveConflict: (choice: "keep-local" | "use-server") => void;
}) {
  const now = useNow(15_000);
  const base = "no-print -mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] font-bold sm:-mt-3";

  if (status.phase === "conflict" && status.conflict) {
    const deleted = status.conflict.reason === "deleted";

    return (
      <div role="alert" className={`${base} text-red-700`}>
        <StatusDot tone="red" />
        <span>{deleted ? "This invoice was deleted on another device" : "Newer version exists on server"}</span>
        <IndicatorButton onClick={() => onResolveConflict("keep-local")}>{deleted ? "Restore mine" : "Keep mine"}</IndicatorButton>
        <IndicatorButton onClick={() => onResolveConflict("use-server")}>{deleted ? "Discard mine" : "Use server copy"}</IndicatorButton>
      </div>
    );
  }

  if (status.phase === "error") {
    const offline = status.error?.kind === "offline";

    return (
      <div role="alert" className={`${base} text-red-700`}>
        <StatusDot tone="red" />
        <span>{offline ? "Offline — changes stored on this device" : "Sync failed"}</span>
        {status.error?.message && !offline && <span className="font-semibold text-red-600">({status.error.message})</span>}
        <IndicatorButton onClick={onRetry}>Retry</IndicatorButton>
      </div>
    );
  }

  if (lockedBy !== undefined && (status.phase === "dirty" || status.phase === "saved")) {
    return (
      <p role="status" aria-live="polite" className={`${base} text-amber-700`}>
        <Lock className="size-3.5" aria-hidden="true" />
        Open{lockedBy ? ` by ${lockedBy}` : ""} on another device — changes kept here
      </p>
    );
  }

  const labels: Record<"disabled" | "saving" | "dirty" | "saved", { dot: JSX.Element; label: string; className: string }> = {
    disabled: { dot: <CloudOff className="size-3.5" aria-hidden="true" />, label: "Saved on this device only", className: "text-zinc-500" },
    saving: { dot: <Loader2 className="size-3.5 animate-spin text-sky-600" aria-hidden="true" />, label: "Saving…", className: "text-sky-700" },
    dirty: { dot: <StatusDot tone="amber" />, label: "Unsaved changes", className: "text-amber-700" },
    saved: { dot: <StatusDot tone="green" />, label: savedAgo(status.lastSavedAt, now), className: "text-emerald-700" }
  };
  // "conflict" without details can't happen; fall back to the saved look rather than crash.
  const phase = status.phase === "conflict" ? "saved" : status.phase;
  const content = labels[phase];

  return (
    <p role="status" aria-live="polite" className={`${base} ${content.className}`}>
      {content.dot}
      {content.label}
      {status.phase === "dirty" && (
        <button type="button" className="font-black underline-offset-2 hover:underline" onClick={onSave} title="Save to the server now">
          Save ({saveShortcutLabel()})
        </button>
      )}
    </p>
  );
}

function SavedInvoiceSidebar({
  activeSavedInvoiceId,
  savedInvoices,
  onLoad,
  onDelete
}: {
  activeSavedInvoiceId: string;
  savedInvoices: SavedInvoice[];
  onLoad: (id: string) => void;
  onDelete: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [deleteDialog, setDeleteDialog] = useState<{ ids: string[]; title: string } | null>(null);
  const filteredInvoices = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) {
      return savedInvoices;
    }

    return savedInvoices.filter((savedInvoice) => {
      const invoiceDate = savedInvoice.invoice.customer.date;
      const savedDate = formatSavedDate(savedInvoice.savedAt);
      const searchable = [
        savedInvoice.name,
        savedInvoice.createdBy ?? "",
        savedInvoice.invoice.customer.invoiceNumber,
        invoiceDate,
        savedDate,
        ...dateSearchTokens(invoiceDate),
        ...dateSearchTokens(savedInvoice.savedAt)
      ].join(" ");

      return normalizeSearchText(searchable).includes(normalizedQuery);
    });
  }, [query, savedInvoices]);
  const sortedInvoices = useMemo(() => {
    return [...filteredInvoices].sort(compareSavedInvoicesByInvoiceDate);
  }, [filteredInvoices]);
  const hasMoreInvoices = sortedInvoices.length > SAVED_INVOICE_PREVIEW_LIMIT;
  const visibleInvoices = isExpanded ? sortedInvoices : sortedInvoices.slice(0, SAVED_INVOICE_PREVIEW_LIMIT);
  const groupedInvoices = useMemo(() => {
    return visibleInvoices.reduce<Array<{ date: string; invoices: typeof visibleInvoices }>>((groups, savedInvoice) => {
      const date = formatInvoiceDateHeading(savedInvoice.invoice.customer.date);
      const group = groups.find((item) => item.date === date);

      if (group) {
        group.invoices.push(savedInvoice);
      } else {
        groups.push({ date, invoices: [savedInvoice] });
      }

      return groups;
    }, []);
  }, [visibleInvoices]);

  function toggleSelectedInvoice(id: string) {
    setSelectedInvoiceIds((ids) => (ids.includes(id) ? ids.filter((invoiceId) => invoiceId !== id) : [...ids, id]));
  }

  function handleSingleDelete(id: string) {
    const invoiceToDelete = savedInvoices.find((savedInvoice) => savedInvoice.id === id);
    setDeleteDialog({ ids: [id], title: invoiceToDelete?.name || "this invoice" });
  }

  function handleBulkDelete() {
    if (selectedInvoiceIds.length === 0) {
      return;
    }

    setDeleteDialog({ ids: selectedInvoiceIds, title: `${selectedInvoiceIds.length} selected invoice${selectedInvoiceIds.length > 1 ? "s" : ""}` });
  }

  function handleInvoiceClick(event: MouseEvent<HTMLButtonElement>, id: string) {
    if (isSelecting || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setIsSelecting(true);
      toggleSelectedInvoice(id);
      return;
    }

    onLoad(id);
  }

  useEffect(() => {
    if (!isSelecting || deleteDialog) {
      return;
    }

    function clearSelectionOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedInvoiceIds([]);
        setIsSelecting(false);
      }
    }

    document.addEventListener("keydown", clearSelectionOnEscape);

    return () => document.removeEventListener("keydown", clearSelectionOnEscape);
  }, [deleteDialog, isSelecting]);

  function confirmDelete() {
    if (!deleteDialog) {
      return;
    }

    onDelete(deleteDialog.ids);
    setSelectedInvoiceIds((ids) => ids.filter((invoiceId) => !deleteDialog.ids.includes(invoiceId)));
    setIsSelecting(false);
    setDeleteDialog(null);
  }

  return (
    <aside className="no-print w-full max-w-[280px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">Saved Invoices</h2>
          <p className="text-xs font-semibold text-zinc-500">Last 1 year</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-[11px] font-black uppercase text-zinc-500 transition hover:bg-red-50 hover:text-[#e01b24]"
            onClick={() => {
              setIsSelecting((selecting) => !selecting);
              setSelectedInvoiceIds([]);
            }}
          >
            {isSelecting ? "Cancel" : "Select"}
          </button>
          <FileText className="size-4 text-[#e01b24]" />
        </div>
      </div>

      {isSelecting && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded border border-red-100 bg-red-50 px-2.5 py-2">
          <span className="text-xs font-bold text-red-700">{selectedInvoiceIds.length} selected</span>
          <button
            type="button"
            className="rounded bg-[#e01b24] px-2.5 py-1 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedInvoiceIds.length === 0}
            onClick={handleBulkDelete}
          >
            Delete Selected
          </button>
        </div>
      )}

      <label className="mb-3 flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs font-semibold text-zinc-500 focus-within:border-[#e01b24] focus-within:bg-white">
        <Search className="size-3.5 shrink-0" />
        <input
          type="search"
          aria-label="Search saved invoices"
          className="min-w-0 flex-1 bg-transparent outline-none"
          placeholder="Search name or date"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filteredInvoices.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-200 px-3 py-4 text-center text-xs font-semibold text-zinc-400">
          {query.trim() ? "No invoices match your search" : "No saved invoices"}
        </p>
      ) : (
        <div className={`grid gap-3 pr-1 ${isExpanded ? "max-h-[70vh] overflow-y-auto" : ""}`}>
          {groupedInvoices.map((group) => (
            <section key={group.date} className="grid gap-2">
              <h3 className="sticky top-0 z-10 rounded bg-white py-1 text-[11px] font-black uppercase tracking-wide text-zinc-500">
                {group.date}
              </h3>

              <ul className="grid gap-2">
                {group.invoices.map((savedInvoice) => {
                  const isActive = savedInvoice.id === activeSavedInvoiceId;
                  const isChecked = selectedInvoiceIds.includes(savedInvoice.id);

                  return (
                    <li key={savedInvoice.id} className={`flex items-center gap-1 rounded border transition ${isActive ? "border-[#e01b24] bg-red-50" : "border-zinc-200 bg-white hover:border-[#e01b24] hover:bg-red-50"}`}>
                      {isSelecting && (
                        <label className="grid size-8 shrink-0 place-items-center">
                          <input
                            type="checkbox"
                            className="size-4 accent-[#e01b24]"
                            checked={isChecked}
                            onChange={() => toggleSelectedInvoice(savedInvoice.id)}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                        onClick={(event) => handleInvoiceClick(event, savedInvoice.id)}
                      >
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-sm font-bold text-zinc-900">{savedInvoice.name}</span>
                          {savedInvoice.createdBy && <span className="truncate text-[11px] font-semibold text-zinc-500">Created by: {savedInvoice.createdBy}</span>}
                          <span className="truncate text-[11px] font-semibold text-zinc-500">Edited: {formatEditedDate(savedInvoice.savedAt)}</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Delete ${savedInvoice.name}`}
                        title={isActive ? "Delete current invoice and open a new one" : "Delete saved invoice"}
                        className={`mr-1 inline-grid size-7 shrink-0 place-items-center rounded transition ${
                          isActive ? "text-amber-500 hover:bg-amber-50 hover:text-amber-600" : "text-zinc-400 hover:bg-red-100 hover:text-[#e01b24]"
                        }`}
                        onClick={() => handleSingleDelete(savedInvoice.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hasMoreInvoices && !isExpanded && (
            <button
              type="button"
              className="rounded border border-dashed border-zinc-300 px-3 py-2 text-xs font-black uppercase tracking-wide text-zinc-500 transition hover:border-[#e01b24] hover:text-[#e01b24]"
              onClick={() => setIsExpanded(true)}
            >
              See More Menu
            </button>
          )}
        </div>
      )}

      {deleteDialog && (
        <DeleteInvoiceDialog
          title={deleteDialog.title}
          count={deleteDialog.ids.length}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={confirmDelete}
        />
      )}

    </aside>
  );
}

function DeleteInvoiceDialog({
  title,
  count,
  onCancel,
  onConfirm
}: {
  title: string;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/25 px-4 backdrop-blur-sm">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-invoice-title"
        className="w-full max-w-[460px] rounded-xl border border-[#e01b24] bg-white p-4 text-center shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-5">
        <button
          type="button"
          aria-label="Close delete dialog"
          className="ml-auto grid size-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onCancel}
        >
          <X className="size-5" />
        </button>

        <h2 id="delete-invoice-title" className="mt-1 text-xl font-black text-slate-950">Delete invoice?</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm font-medium leading-relaxed text-slate-900">
          Are you sure you want to delete “{title}”?<br />
          You can’t undo this action.
        </p>

        <div className="mx-auto mt-5 flex max-w-sm gap-3 rounded-md border-l-4 border-[#f15a24] bg-orange-50 px-4 py-3 text-left">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#f15a24]" />
          <div>
            <p className="text-sm font-black text-red-900">Warning</p>
            <p className="mt-1 text-sm font-medium leading-relaxed text-red-800">
              Deleting {count > 1 ? `${count} selected invoices` : "this invoice"} will permanently remove it from saved invoices.
            </p>
          </div>
        </div>

        <div className="mx-auto mt-5 grid max-w-sm gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="h-11 rounded-full bg-slate-500 px-5 text-sm font-black text-white transition hover:bg-slate-600"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#e92335] px-5 text-sm font-black text-white transition hover:bg-[#c91525]"
            onClick={onConfirm}
          >
            Delete invoice
            <Trash2 className="size-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/[\s_/.,]+/g, "-");
}

function dateSearchTokens(value: string) {
  const date = parseInvoiceDate(value);

  if (!Number.isFinite(date.getTime())) {
    return [];
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const shortMonthName = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);

  return [
    `${day}-${month}-${year}`,
    `${month}-${day}-${year}`,
    `${year}-${month}-${day}`,
    `${monthName}-${year}`,
    `${shortMonthName}-${year}`,
    `${monthName} ${year}`,
    `${shortMonthName} ${year}`
  ];
}

function formatInvoiceDateHeading(value: string) {
  const date = parseInvoiceDate(value);

  if (!Number.isFinite(date.getTime())) {
    return "No Date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatSavedDate(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatEditedDate(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function compareSavedInvoicesByInvoiceDate(first: SavedInvoice, second: SavedInvoice) {
  const firstInvoiceDate = dateTimeOrZero(first.invoice.customer.date);
  const secondInvoiceDate = dateTimeOrZero(second.invoice.customer.date);

  if (firstInvoiceDate !== secondInvoiceDate) {
    return secondInvoiceDate - firstInvoiceDate;
  }

  return dateTimeOrZero(second.savedAt) - dateTimeOrZero(first.savedAt);
}

function dateTimeOrZero(value: string) {
  const time = parseInvoiceDate(value).getTime();

  return Number.isFinite(time) ? time : 0;
}

function parseInvoiceDate(value: string) {
  const trimmedValue = value.trim();
  const dayMonthYearMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (dayMonthYearMatch) {
    const [, day, month, year] = dayMonthYearMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(value);
}
