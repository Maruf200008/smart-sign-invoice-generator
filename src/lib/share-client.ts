import { notifySessionExpired } from "@/lib/auth-client";
import type { ShareSettings, ShareUpsertInput } from "@/types/share";

async function shareRequest(method: "GET" | "POST" | "PATCH", input: ShareUpsertInput) {
  const isGet = method === "GET";
  const response = await fetch(isGet ? `/api/shares?invoiceId=${encodeURIComponent(input.invoiceId)}` : "/api/shares", {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Cache-Control": "no-cache",
      ...(isGet ? {} : { "Content-Type": "application/json" })
    },
    body: isGet ? undefined : JSON.stringify(input)
  });
  const data = (await response.json().catch(() => ({}))) as { share?: ShareSettings | null; error?: string };

  if (response.status === 401) {
    notifySessionExpired();
  }

  if (!response.ok) {
    throw new Error(data.error || "Unable to update sharing.");
  }

  return data.share ?? null;
}

/** Creates the share link if the invoice has none yet; otherwise returns (and optionally updates) the existing one. */
export function ensureShare(input: ShareUpsertInput) {
  return shareRequest("POST", input) as Promise<ShareSettings>;
}

export function updateShare(input: ShareUpsertInput) {
  return shareRequest("PATCH", input) as Promise<ShareSettings>;
}
