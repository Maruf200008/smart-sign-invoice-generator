"use client";

import { motion } from "framer-motion";
import { Copy, Facebook, Link2, Linkedin, Mail, MessageCircle, MessageCircleMore, Send, Share2, X as XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  buildMessengerUrl,
  buildShareTargetUrl,
  copyTextToClipboard,
  isMobileDevice,
  SHARE_TITLE,
  type ShareMessageInput
} from "@/lib/share-utils";
import { toast } from "@/store/toast-store";

type LinkTargetId = Parameters<typeof buildShareTargetUrl>[0];

type ShareTile = { label: string; color: string; icon: ReactNode } & (
  | { kind: "link"; id: LinkTargetId }
  | { kind: "action"; id: "messenger" | "copy" | "native"; onClick: () => void | Promise<unknown> }
);

interface ShareTargetsProps {
  message: ShareMessageInput;
  /** Short sentence for the native share sheet; the URL is passed separately so apps don't print it twice. */
  nativeText: string;
  disabled: boolean;
}

const tileClass =
  "group flex h-full w-full min-w-0 flex-col items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white/70 px-2 py-3 text-center text-xs font-bold text-zinc-800 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-accent/50 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-40 sysdark:border-white/10 sysdark:bg-white/5 sysdark:text-zinc-100 sysdark:hover:border-white/30";

function TileBody({ icon, label, color }: { icon: ReactNode; label: string; color: string }) {
  return (
    <>
      <span className={cn("grid size-11 place-items-center rounded-full text-white shadow-md transition-transform duration-200 group-hover:scale-110", color)}>
        {icon}
      </span>
      <span className="w-full truncate">{label}</span>
    </>
  );
}

export function ShareTargets({ message, nativeText, disabled }: ShareTargetsProps) {
  const [canNativeShare, setCanNativeShare] = useState(false);

  // navigator is only available in the browser, and support must not affect the server-rendered markup.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function copyLink(successMessage = "Invoice link copied successfully.") {
    const copied = await copyTextToClipboard(message.url);

    if (copied) {
      toast.success(successMessage);
    } else {
      toast.error("Couldn't copy automatically. Select the link above and copy it manually.");
    }

    return copied;
  }

  async function shareNatively() {
    try {
      await navigator.share({ title: SHARE_TITLE, text: nativeText, url: message.url });
    } catch (error) {
      // AbortError just means the user dismissed the sheet.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("The share sheet couldn't be opened. Try another option.");
      }
    }
  }

  async function shareViaMessenger() {
    const messengerUrl = buildMessengerUrl(message.url, isMobileDevice(), window.location.origin);
    // Always copy first: if the deep link can't open an app, the user can still paste the link into Messenger.
    const copied = await copyTextToClipboard(message.url);

    if (messengerUrl) {
      window.open(messengerUrl, "_blank", "noopener,noreferrer");
      if (copied) {
        toast.success("Link copied too, in case Messenger doesn't open.");
      }
      return;
    }

    window.open("https://www.messenger.com/", "_blank", "noopener,noreferrer");
    toast[copied ? "success" : "error"](
      copied ? "Link copied. Paste it into Messenger to send." : "Open Messenger and paste the invoice link manually."
    );
  }

  const tiles: ShareTile[] = [
    { id: "whatsapp", label: "WhatsApp", color: "bg-[#25D366]", icon: <MessageCircle className="size-5" />, kind: "link" },
    { id: "facebook", label: "Facebook", color: "bg-[#1877F2]", icon: <Facebook className="size-5" />, kind: "link" },
    {
      id: "messenger",
      label: "Messenger",
      color: "bg-gradient-to-br from-[#00B2FF] to-[#A334FA]",
      icon: <MessageCircleMore className="size-5" />,
      kind: "action",
      onClick: shareViaMessenger
    },
    { id: "telegram", label: "Telegram", color: "bg-[#229ED9]", icon: <Send className="size-5" />, kind: "link" },
    { id: "email", label: "Email", color: "bg-zinc-700", icon: <Mail className="size-5" />, kind: "link" },
    { id: "x", label: "X (Twitter)", color: "bg-black", icon: <XIcon className="size-5" />, kind: "link" },
    { id: "linkedin", label: "LinkedIn", color: "bg-[#0A66C2]", icon: <Linkedin className="size-5" />, kind: "link" },
    { id: "copy", label: "Copy Link", color: "bg-accent", icon: <Copy className="size-5" />, kind: "action", onClick: () => copyLink() }
  ];

  if (canNativeShare) {
    tiles.push({
      id: "native",
      label: "More…",
      color: "bg-gradient-to-br from-zinc-700 to-zinc-900",
      icon: <Share2 className="size-5" />,
      kind: "action",
      onClick: shareNatively
    });
  }

  return (
    <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" aria-label="Share options">
      {tiles.map((tile, index) => {
        const body = <TileBody icon={tile.icon} label={tile.label} color={tile.color} />;
        let control: ReactNode;

        if (tile.kind === "link" && !disabled) {
          control = (
            <a
              href={buildShareTargetUrl(tile.id, message)}
              // mailto: must open in the same browsing context or some browsers leave a blank tab behind.
              {...(tile.id === "email" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              aria-label={`Share via ${tile.label}`}
              className={tileClass}
            >
              {body}
            </a>
          );
        } else {
          control = (
            <button
              type="button"
              disabled={disabled}
              aria-label={tile.kind === "action" ? tile.label : `Share via ${tile.label}`}
              onClick={tile.kind === "action" ? () => void tile.onClick() : undefined}
              className={tileClass}
            >
              {body}
            </button>
          );
        }

        return (
          <motion.li
            key={tile.id}
            className="min-w-0"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * index, duration: 0.2 }}
          >
            {control}
          </motion.li>
        );
      })}
    </ul>
  );
}

export function ShareLinkField({ url, disabled }: { url: string; disabled: boolean }) {
  async function copy() {
    const copied = await copyTextToClipboard(url);

    if (copied) {
      toast.success("Invoice link copied successfully.");
    } else {
      toast.error("Couldn't copy automatically. Select the link and copy it manually.");
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 p-1.5 pl-3 sysdark:border-white/10 sysdark:bg-white/5">
      <Link2 className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
      <input
        readOnly
        aria-label="Shareable invoice link"
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-zinc-800 outline-none sysdark:text-zinc-100"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => void copy()}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Copy className="size-3.5" aria-hidden="true" />
        Copy
      </button>
    </div>
  );
}
