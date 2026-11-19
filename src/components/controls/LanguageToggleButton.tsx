"use client";

import { Languages } from "lucide-react";
import { ActionButton } from "@/components/controls/ActionButton";
import { getInvoiceLabels, nextInvoiceLanguage } from "@/lib/invoice-labels";
import { useInvoiceLanguageStore } from "@/store/invoice-language-store";

/**
 * Switches the invoice between English and বাংলা. The button names the language it switches *to*: "বাংলা" while the
 * invoice is in English, "English" while it is in Bangla.
 *
 * Only the invoice's labels change: nothing is reloaded, recalculated or saved, and the choice is remembered for the
 * next invoice. Mouse clicks don't take focus, so a cell being edited keeps its focus and caret.
 */
export function LanguageToggleButton() {
  const language = useInvoiceLanguageStore((state) => state.language);
  const toggleLanguage = useInvoiceLanguageStore((state) => state.toggleLanguage);
  const target = getInvoiceLabels(nextInvoiceLanguage(language));

  return (
    <ActionButton
      icon={<Languages className="size-4" aria-hidden="true" />}
      aria-label={`Show invoice in ${target.englishName}`}
      title={`Invoice language: ${getInvoiceLabels(language).englishName}. Click for ${target.englishName}.`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggleLanguage}
    >
      <span lang={target.htmlLang}>{target.languageName}</span>
    </ActionButton>
  );
}
