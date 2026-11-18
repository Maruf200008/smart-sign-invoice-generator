import { Clock3, FileQuestion, ShieldOff, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

type StatusKind = "expired" | "disabled" | "not-found" | "unavailable";

const STATUS_CONTENT: Record<StatusKind, { icon: ReactNode; title: string; description: string }> = {
  expired: {
    icon: <Clock3 className="size-7" aria-hidden="true" />,
    title: "This shared invoice has expired.",
    description: "Ask the sender to share a new link."
  },
  disabled: {
    icon: <ShieldOff className="size-7" aria-hidden="true" />,
    title: "Sharing Disabled",
    description: "The owner has turned off sharing for this invoice."
  },
  "not-found": {
    icon: <FileQuestion className="size-7" aria-hidden="true" />,
    title: "Invoice not found",
    description: "This link is incorrect or no longer exists."
  },
  unavailable: {
    icon: <WifiOff className="size-7" aria-hidden="true" />,
    title: "Invoice temporarily unavailable",
    description: "Please try again in a few minutes."
  }
};

export function ShareStatusCard({ kind }: { kind: StatusKind }) {
  const { icon, title, description } = STATUS_CONTENT[kind];

  return (
    <main className="grid min-h-screen place-items-center bg-[#e8e8e8] px-4 py-10 sysdark:bg-zinc-950">
      <section
        role="status"
        className="w-full max-w-md rounded-3xl border border-white/60 bg-white/80 p-8 text-center shadow-premium backdrop-blur-xl sysdark:border-white/10 sysdark:bg-zinc-900/80"
      >
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent/10 text-accent">{icon}</span>
        <h1 className="mt-4 text-xl font-black text-zinc-950 sysdark:text-white">{title}</h1>
        <p className="mt-2 text-sm font-medium text-zinc-600 sysdark:text-zinc-400">{description}</p>
        <p className="mt-6 text-xs font-bold uppercase tracking-wide text-zinc-400">Smart Sign Invoice</p>
      </section>
    </main>
  );
}
