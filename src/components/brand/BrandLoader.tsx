"use client";

import Image from "next/image";
import favIcon from "@/assets/fav_icon.svg";

export function BrandLoader({ label = "Loading", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={`grid place-items-center ${compact ? "gap-2" : "gap-4"}`} role="status" aria-live="polite">
      <div className={`brand-loader relative grid place-items-center ${compact ? "size-8 [--loader-orbit:18px]" : "size-20 [--loader-orbit:42px]"}`}>
        <span className="brand-loader-ring absolute inset-0 rounded-full border border-[#e01b24]/25" />
        <span className="brand-loader-orbit absolute rounded-full bg-[#e01b24]" />
        <Image
          src={favIcon}
          alt=""
          width={compact ? 28 : 56}
          height={compact ? 28 : 56}
          aria-hidden="true"
          className={`brand-loader-logo object-contain ${compact ? "size-6" : "size-14"}`}
        />
      </div>
      {label && <span className={`${compact ? "text-[11px]" : "text-sm"} font-bold text-zinc-500`}>{label}</span>}
    </div>
  );
}

export function BrandLoaderOverlay({ label = "Loading" }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-[9998] grid place-items-center bg-white/55 backdrop-blur-md">
      <BrandLoader label={label} />
    </div>
  );
}
