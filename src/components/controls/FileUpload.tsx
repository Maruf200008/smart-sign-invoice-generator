"use client";

import { ImagePlus, X } from "lucide-react";
import Image from "next/image";
import { readFileAsDataUrl } from "@/lib/invoice-utils";

interface FileUploadProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function FileUpload({ label, value, onChange }: FileUploadProps) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-3 rounded-md border border-dashed border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950">
        <div className="grid size-14 place-items-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
          {value ? (
            <Image src={value} alt={label} width={56} height={56} className="h-full w-full object-contain" unoptimized />
          ) : (
            <ImagePlus className="size-5 text-zinc-400" />
          )}
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-zinc-900 px-3 text-sm font-semibold text-white transition hover:bg-accent">
          Upload
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) onChange(await readFileAsDataUrl(file));
            }}
          />
        </label>
        {value ? (
          <button
            type="button"
            className="grid size-9 place-items-center rounded-md border border-zinc-200 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-800"
            onClick={() => onChange("")}
            aria-label={`Remove ${label}`}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
