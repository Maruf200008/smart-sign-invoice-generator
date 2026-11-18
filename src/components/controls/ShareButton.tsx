"use client";

import { Loader2, Share2 } from "lucide-react";
import { ActionButton } from "@/components/controls/ActionButton";
import { ShareExportDialog } from "@/components/share/ShareExportDialog";
import { useShareExport } from "@/hooks/use-share-export";

/** Opens the Share dialog: choose PDF or JPEG, then share it (or download where sharing isn't available). */
export function ShareButton() {
  const { state, open, close, setFormat, generate, backToFormats, shareAgain, downloadNow } = useShareExport();
  const isBusy = state.phase === "generating";

  return (
    <>
      <ActionButton
        icon={isBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-busy={isBusy}
        onClick={open}
      >
        {isBusy ? "Preparing..." : "Share"}
      </ActionButton>
      <ShareExportDialog
        state={state}
        onClose={close}
        onFormatChange={setFormat}
        onGenerate={() => void generate()}
        onBack={backToFormats}
        onShare={() => void shareAgain()}
        onDownload={() => void downloadNow()}
      />
    </>
  );
}
