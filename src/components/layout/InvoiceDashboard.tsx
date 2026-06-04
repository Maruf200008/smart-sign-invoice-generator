"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, FileText, LogOut, RefreshCw, RotateCcw, Search, Trash2, Wand2, X } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ActionButton } from "@/components/controls/ActionButton";
import { BrandLoader } from "@/components/brand/BrandLoader";
import { ShareInvoiceButton } from "@/components/controls/PDFExportButton";
import { PrintButton } from "@/components/controls/PrintButton";
import backgroundPattern from "@/assets/background_pattern.jpg";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { deleteCloudInvoice, loadCloudInvoices, saveCloudInvoice } from "@/lib/invoice-cloud-storage";
import { useInvoiceStore } from "@/store/invoice-store";
import type { AuthUser } from "@/types/auth";

const SAVED_INVOICE_PREVIEW_LIMIT = 10;

export function InvoiceDashboard({ currentUser, onSignOut }: { currentUser: AuthUser; onSignOut: () => void }) {
  const [isMounted, setIsMounted] = useState(false);
  const [showSavedInvoices, setShowSavedInvoices] = useState(false);
  const invoice = useInvoiceStore((state) => state.invoice);
  const refreshCurrentInvoice = useInvoiceStore((state) => state.refreshCurrentInvoice);
  const resetDraft = useInvoiceStore((state) => state.resetDraft);
  const newInvoiceNumber = useInvoiceStore((state) => state.newInvoiceNumber);
  const savedInvoices = useInvoiceStore((state) => state.savedInvoices);
  const activeSavedInvoiceId = useInvoiceStore((state) => state.activeSavedInvoiceId);
  const loadSavedInvoice = useInvoiceStore((state) => state.loadSavedInvoice);
  const deleteSavedInvoice = useInvoiceStore((state) => state.deleteSavedInvoice);
  const mergeSavedInvoices = useInvoiceStore((state) => state.mergeSavedInvoices);
  const refreshCloudInvoices = useCallback(() => {
    return loadCloudInvoices()
      .then((result) => {
        if (result.configured) {
          mergeSavedInvoices(result.invoices);
        }
      })
      .catch((error) => {
        console.error("Unable to load cloud invoices.", error);
        // Local storage remains the fallback when cloud sync is unavailable.
      });
  }, [mergeSavedInvoices]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    refreshCloudInvoices();
  }, [isMounted, refreshCloudInvoices]);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    const intervalId = window.setInterval(() => {
      refreshCloudInvoices();
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [isMounted, refreshCloudInvoices]);

  useEffect(() => {
    if (!isMounted || !activeSavedInvoiceId) {
      return;
    }

    const activeSavedInvoice = savedInvoices.find((savedInvoice) => savedInvoice.id === activeSavedInvoiceId);

    if (!activeSavedInvoice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      saveCloudInvoice(activeSavedInvoice, currentUser.username)
        .then(() => refreshCloudInvoices())
        .catch((error) => {
          console.error("Unable to save cloud invoice.", error);
          // Keep local auto-save working even if database sync fails.
        });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [activeSavedInvoiceId, currentUser.username, isMounted, refreshCloudInvoices, savedInvoices]);

  function handleDeleteSavedInvoice(id: string) {
    deleteSavedInvoice(id);
    deleteCloudInvoice(id)
      .then(() => refreshCloudInvoices())
      .catch((error) => {
        console.error("Unable to delete cloud invoice.", error);
        // Local delete is immediate; cloud delete will succeed once configured/available.
      });
  }

  if (!isMounted) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#e8e8e8]">
        <BrandLoader />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#e8e8e8] text-zinc-950">
      <div
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
          <ActionButton icon={<RefreshCw className="size-4" />} onClick={refreshCurrentInvoice}>Refresh</ActionButton>
          <ActionButton icon={<FileText className="size-4" />} onClick={() => setShowSavedInvoices((isVisible) => !isVisible)}>
            {showSavedInvoices ? "Hide Saved Invoice" : "Show Saved Invoice"}
          </ActionButton>
          <ActionButton icon={<Wand2 className="size-4" />} onClick={newInvoiceNumber}>New SL</ActionButton>
          <ActionButton icon={<RotateCcw className="size-4" />} onClick={resetDraft}>New Invoice</ActionButton>
          <PrintButton />
          <ShareInvoiceButton />
          <ActionButton icon={<LogOut className="size-4" />} onClick={onSignOut}>{currentUser.username}</ActionButton>
        </motion.div>

        <AnimatePresence>
          {showSavedInvoices && (
            <motion.div
              initial={{ opacity: 0, x: -300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -300 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="no-print fixed inset-y-0 left-0 z-30 flex w-[320px] max-w-[86vw] justify-center overflow-y-auto bg-white px-4 py-24 shadow-[8px_0_30px_rgba(0,0,0,0.12)]"
            >
              <SavedInvoiceSidebar
                activeInvoiceNumber={invoice.customer.invoiceNumber}
                savedInvoices={savedInvoices}
                onLoad={loadSavedInvoice}
                onDelete={handleDeleteSavedInvoice}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid w-full gap-4 xl:grid-cols-1 xl:items-start">

          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full overflow-x-hidden pb-8 sm:overflow-auto">
            <InvoicePreview />
          </motion.section>
        </div>
      </div>
    </main>
  );
}

function SavedInvoiceSidebar({
  activeInvoiceNumber,
  savedInvoices,
  onLoad,
  onDelete
}: {
  activeInvoiceNumber: string;
  savedInvoices: ReturnType<typeof useInvoiceStore.getState>["savedInvoices"];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
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
      const date = formatInvoiceDateHeading(savedInvoice.invoice.customer.date || savedInvoice.savedAt);
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

  function handleSingleDelete(id: string, name: string) {
    setDeleteDialog({ ids: [id], title: name });
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

    deleteDialog.ids.forEach(onDelete);
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
          className="min-w-0 flex-1 bg-transparent outline-none"
          placeholder="Search name or date"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {filteredInvoices.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-200 px-3 py-4 text-center text-xs font-semibold text-zinc-400">
          No saved invoices
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
                  const isActive = savedInvoice.invoice.customer.invoiceNumber === activeInvoiceNumber;
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
                        className="min-w-0 flex-1 px-2.5 py-1.5 text-left"
                        onClick={(event) => handleInvoiceClick(event, savedInvoice.id)}
                      >
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-sm font-bold text-zinc-900">{savedInvoice.name}</span>
                          {savedInvoice.createdBy && <span className="truncate text-[11px] font-semibold text-zinc-500">Created by: {savedInvoice.createdBy}</span>}
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-label={`Delete ${savedInvoice.name}`}
                        title="Delete saved invoice"
                        className="mr-1 inline-grid size-7 shrink-0 place-items-center rounded text-zinc-400 transition hover:bg-red-100 hover:text-[#e01b24]"
                        onClick={() => handleSingleDelete(savedInvoice.id, savedInvoice.name)}
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
      <section className="w-full max-w-[460px] rounded-xl border border-[#e01b24] bg-white p-4 text-center shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-5">
        <button
          type="button"
          aria-label="Close delete dialog"
          className="ml-auto grid size-7 place-items-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onCancel}
        >
          <X className="size-5" />
        </button>

        <h2 className="mt-1 text-xl font-black text-slate-950">Delete invoice?</h2>
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
  const date = new Date(value);

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
  const date = new Date(value);

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

function compareSavedInvoicesByInvoiceDate(
  first: ReturnType<typeof useInvoiceStore.getState>["savedInvoices"][number],
  second: ReturnType<typeof useInvoiceStore.getState>["savedInvoices"][number]
) {
  const firstInvoiceDate = dateTimeOrZero(first.invoice.customer.date);
  const secondInvoiceDate = dateTimeOrZero(second.invoice.customer.date);

  if (firstInvoiceDate !== secondInvoiceDate) {
    return secondInvoiceDate - firstInvoiceDate;
  }

  return dateTimeOrZero(second.savedAt) - dateTimeOrZero(first.savedAt);
}

function dateTimeOrZero(value: string) {
  const time = new Date(value).getTime();

  return Number.isFinite(time) ? time : 0;
}
