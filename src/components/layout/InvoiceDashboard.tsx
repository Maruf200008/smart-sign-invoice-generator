"use client";

import { motion } from "framer-motion";
import { FileText, RefreshCw, RotateCcw, Search, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionButton } from "@/components/controls/ActionButton";
import { ShareInvoiceButton } from "@/components/controls/PDFExportButton";
import { PrintButton } from "@/components/controls/PrintButton";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";
import { deleteCloudInvoice, loadCloudInvoices, saveCloudInvoice } from "@/lib/invoice-cloud-storage";
import { formatMoney, lineTotal } from "@/lib/invoice-utils";
import { useInvoiceStore } from "@/store/invoice-store";

export function InvoiceDashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const invoice = useInvoiceStore((state) => state.invoice);
  const refreshCurrentInvoice = useInvoiceStore((state) => state.refreshCurrentInvoice);
  const resetDraft = useInvoiceStore((state) => state.resetDraft);
  const newInvoiceNumber = useInvoiceStore((state) => state.newInvoiceNumber);
  const savedInvoices = useInvoiceStore((state) => state.savedInvoices);
  const activeSavedInvoiceId = useInvoiceStore((state) => state.activeSavedInvoiceId);
  const loadSavedInvoice = useInvoiceStore((state) => state.loadSavedInvoice);
  const deleteSavedInvoice = useInvoiceStore((state) => state.deleteSavedInvoice);
  const mergeSavedInvoices = useInvoiceStore((state) => state.mergeSavedInvoices);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    loadCloudInvoices()
      .then((result) => {
        if (result.configured) {
          mergeSavedInvoices(result.invoices);
        }
      })
      .catch(() => {
        // Local storage remains the fallback when cloud sync is unavailable.
      });
  }, [isMounted, mergeSavedInvoices]);

  useEffect(() => {
    if (!isMounted || !activeSavedInvoiceId) {
      return;
    }

    const activeSavedInvoice = savedInvoices.find((savedInvoice) => savedInvoice.id === activeSavedInvoiceId);

    if (!activeSavedInvoice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      saveCloudInvoice(activeSavedInvoice).catch(() => {
        // Keep local auto-save working even if database sync fails.
      });
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [activeSavedInvoiceId, isMounted, savedInvoices]);

  function handleDeleteSavedInvoice(id: string) {
    deleteSavedInvoice(id);
    deleteCloudInvoice(id).catch(() => {
      // Local delete is immediate; cloud delete will succeed once configured/available.
    });
  }

  if (!isMounted) {
    return <main className="min-h-screen bg-[#e8e8e8]" />;
  }

  return (
    <main className="min-h-screen bg-[#e8e8e8] text-zinc-950">
      <div className="mx-auto flex w-full flex-col items-center gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-7">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="no-print grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center sm:gap-3"
        >
          <ActionButton variant="ghost" icon={<RefreshCw className="size-4" />} onClick={refreshCurrentInvoice}>Refresh</ActionButton>
          <PrintButton />
          <ShareInvoiceButton />
          <ActionButton icon={<Wand2 className="size-4" />} onClick={newInvoiceNumber}>New SL</ActionButton>
          <ActionButton icon={<RotateCcw className="size-4" />} onClick={resetDraft}>New Invoice</ActionButton>
        </motion.div>

        <div className="grid w-full gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
          <SavedInvoiceSidebar
            activeInvoiceNumber={invoice.customer.invoiceNumber}
            savedInvoices={savedInvoices}
            onLoad={loadSavedInvoice}
            onDelete={handleDeleteSavedInvoice}
          />

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
        savedInvoice.invoice.customer.invoiceNumber,
        invoiceDate,
        savedDate,
        ...dateSearchTokens(invoiceDate),
        ...dateSearchTokens(savedInvoice.savedAt)
      ].join(" ");

      return normalizeSearchText(searchable).includes(normalizedQuery);
    });
  }, [query, savedInvoices]);
  const hasMoreInvoices = filteredInvoices.length > 5;
  const visibleInvoices = isExpanded ? filteredInvoices : filteredInvoices.slice(0, 5);
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

  return (
    <aside className="no-print w-full rounded-md border border-zinc-200 bg-white p-3 shadow-sm xl:sticky xl:top-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">Saved Invoices</h2>
          <p className="text-xs font-semibold text-zinc-500">Last 1 year</p>
        </div>
        <FileText className="size-4 text-[#e01b24]" />
      </div>

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
                  const total = savedInvoice.invoice.items.reduce((sum, item) => sum + lineTotal(item), 0);

                  return (
                    <li key={savedInvoice.id} className={`rounded border transition ${isActive ? "border-[#e01b24] bg-red-50" : "border-zinc-200 bg-white hover:border-[#e01b24] hover:bg-red-50"}`}>
                      <button
                        type="button"
                        className="grid w-full gap-1 px-3 py-2 text-left"
                        onClick={() => onLoad(savedInvoice.id)}
                      >
                        <span className="truncate text-sm font-bold text-zinc-900">{savedInvoice.name}</span>
                        <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-500">
                          <span>{formatSavedDate(savedInvoice.savedAt)}</span>
                          <span>{formatMoney(total, savedInvoice.invoice.settings.currency)}</span>
                        </span>
                        <span className="truncate text-[11px] font-semibold text-zinc-400">{savedInvoice.invoice.customer.invoiceNumber}</span>
                      </button>

                      <div className="flex items-center justify-end gap-1 border-t border-zinc-100 px-2 py-1">
                        <button
                          type="button"
                          aria-label={`Delete ${savedInvoice.name}`}
                          title="Delete saved invoice"
                          className="inline-grid size-7 place-items-center rounded text-zinc-400 transition hover:bg-red-100 hover:text-[#e01b24]"
                          onClick={() => onDelete(savedInvoice.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
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
    </aside>
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
