"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { InvoiceData } from "@/types/invoice";
import { useInvoiceStore } from "@/store/invoice-store";

export function useInvoiceForm() {
  const invoice = useInvoiceStore((state) => state.invoice);
  const setInvoice = useInvoiceStore((state) => state.setInvoice);

  const form = useForm<InvoiceData>({
    defaultValues: invoice,
    mode: "onChange"
  });

  useEffect(() => {
    form.reset(invoice);
  }, [form, invoice]);

  useEffect(() => {
    const subscription = form.watch((value) => {
      setInvoice(value as InvoiceData);
    });

    return () => subscription.unsubscribe();
  }, [form, setInvoice]);

  return form;
}
