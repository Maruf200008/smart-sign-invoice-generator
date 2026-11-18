import { ApiError, assertSameOrigin, jsonResponse, readJsonBody, requireSessionUser } from "@/lib/api-http";
import { SessionConfigError } from "@/lib/auth-session";
import { ACTIVE_LOCK_MS } from "@/lib/invoice-lock";
import { InvoiceValidationError, sanitizeInvoiceData } from "@/lib/invoice-normalize";
import { describeStorageError, isSupabaseServiceConfigured, SupabaseRequestError, supabaseServiceRequest } from "@/lib/supabase-rest";
import { MAX_SYNC_BODY_BYTES, parseSyncSaveRequest, type SyncSaveFailure, type SyncSaveSuccess } from "@/lib/sync/sync-protocol";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Result of public.smart_sign_save_invoice (see supabase-schema.sql). */
type SaveFunctionResult =
  | { status: "saved" | "duplicate"; version: number; server_updated_at: string; created_by: string }
  | { status: "conflict"; reason: "stale" | "deleted" | "exists"; version: number | null; server?: Record<string, unknown> }
  | { status: "locked"; locked_by: string | null };

function failure(body: Omit<SyncSaveFailure, "success">, status: number) {
  // `error` mirrors `message` for clients that read the older error shape.
  return jsonResponse({ success: false, error: body.message, ...body }, status);
}

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse({ success: false, message: error.message, error: error.message }, error.status, error.headers);
  }

  if (error instanceof InvoiceValidationError) {
    return failure({ message: error.message }, 400);
  }

  if (error instanceof SupabaseRequestError) {
    console.error("Sync save storage request failed.", error.status, error.message);
    return failure({ message: describeStorageError(error) }, 502);
  }

  if (error instanceof SessionConfigError) {
    console.error("Auth session misconfigured.", error.message);
    return failure({ message: "Sign-in is not configured on the server (AUTH_SECRET)." }, 500);
  }

  console.error("Sync save failed.", error);
  return failure({ message: "Save failed on the server. Please try again." }, 500);
}

function conflictMessage(reason: string) {
  if (reason === "deleted") return "This invoice was deleted on another device.";
  if (reason === "exists") return "An invoice with this id already exists on the server.";
  return "Newer version exists on server";
}

/**
 * POST /api/v1/sync/save -> save one invoice snapshot.
 *
 * 200 saved (or an idempotent replay of an already-applied syncId), 409 version conflict, 423 another
 * device holds the edit lock, 400 invalid body, 401 no session, 502/500 storage failure (client retries).
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireSessionUser(request);

    if (!isSupabaseServiceConfigured()) {
      return failure({ configured: false, message: "Cloud storage is not configured on the server." }, 503);
    }

    const body = parseSyncSaveRequest(await readJsonBody(request, MAX_SYNC_BODY_BYTES));
    const result = await supabaseServiceRequest<SaveFunctionResult>("rpc/smart_sign_save_invoice", {
      method: "POST",
      body: JSON.stringify({
        p_sync_id: body.syncId,
        p_invoice_id: body.documentId,
        p_client_id: body.clientId,
        p_username: user.username,
        p_name: body.changes.name,
        p_invoice: body.changes.invoice,
        p_base_version: body.baseVersion,
        p_lock_window_ms: ACTIVE_LOCK_MS,
        p_prior_sync_ids: body.priorSyncIds ?? []
      })
    });

    if (!result || typeof result !== "object" || !("status" in result)) {
      throw new Error("Unexpected response from smart_sign_save_invoice.");
    }

    if (result.status === "saved" || result.status === "duplicate") {
      const success: SyncSaveSuccess = {
        success: true,
        serverUpdatedAt: new Date(result.server_updated_at).toISOString(),
        version: result.version,
        createdBy: result.created_by,
        duplicate: result.status === "duplicate",
        message: "Saved successfully"
      };
      return jsonResponse(success);
    }

    if (result.status === "locked") {
      const who = result.locked_by ? ` by ${result.locked_by}` : "";
      return failure({ locked: true, lockedBy: result.locked_by, message: `This invoice is open${who} on another device right now.` }, 423);
    }

    if (result.status !== "conflict") {
      throw new Error(`Unexpected status from smart_sign_save_invoice: ${String((result as { status: unknown }).status)}`);
    }

    const server = result.server;
    return failure(
      {
        conflict: true,
        reason: result.reason,
        serverVersion: result.version,
        message: conflictMessage(result.reason),
        ...(server
          ? {
              server: {
                id: String(server.id),
                name: String(server.name ?? ""),
                savedAt: new Date(String(server.savedAt)).toISOString(),
                createdBy: typeof server.createdBy === "string" ? server.createdBy : undefined,
                version: typeof server.version === "number" ? server.version : undefined,
                invoice: sanitizeInvoiceData(server.invoice)
              }
            }
          : {})
      },
      409
    );
  } catch (error) {
    return handleError(error);
  }
}
