import { ApiError, assertSameOrigin, jsonResponse, readJsonBody, requireSessionUser } from "@/lib/api-http";
import { SessionConfigError } from "@/lib/auth-session";
import { getShareForOwner, isShareStorageConfigured, ShareError, upsertShare } from "@/lib/share-server";
import { describeStorageError, SupabaseRequestError } from "@/lib/supabase-rest";
import type { ShareUpsertInput } from "@/types/share";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SHARE_BODY_BYTES = 4 * 1024;

function handleError(error: unknown) {
  if (error instanceof ApiError || error instanceof ShareError) {
    return jsonResponse({ error: error.message }, error.status);
  }

  if (error instanceof SupabaseRequestError) {
    // Never forward Supabase's raw message; it can contain table and column names.
    console.error("Share storage request failed.", error.status, error.message);
    return jsonResponse({ error: describeStorageError(error) }, 502);
  }

  if (error instanceof SessionConfigError) {
    console.error("Auth session misconfigured.", error.message);
    return jsonResponse({ error: "Sign-in is not configured on the server (AUTH_SECRET)." }, 500);
  }

  console.error("Share request failed.", error);
  return jsonResponse({ error: "Share request failed." }, 500);
}

/** The share owner is always the signed-in user from the session cookie, never a client-supplied value. */
function authorize(request: Request, { mutating }: { mutating: boolean }) {
  if (mutating) {
    assertSameOrigin(request);
  }

  const user = requireSessionUser(request);

  if (!isShareStorageConfigured()) {
    throw new ApiError("Sharing needs SUPABASE_SERVICE_ROLE_KEY to be configured on the server.", 503);
  }

  return user;
}

/** GET /api/shares?invoiceId=... -> the owner's current share settings (or null). */
export async function GET(request: Request) {
  try {
    const user = authorize(request, { mutating: false });
    const invoiceId = new URL(request.url).searchParams.get("invoiceId")?.trim();

    if (!invoiceId) {
      throw new ShareError("Missing invoice id.", 400);
    }

    return jsonResponse({ share: await getShareForOwner(invoiceId, user.username) });
  } catch (error) {
    return handleError(error);
  }
}

/** POST creates the share if needed (idempotent) and applies any settings in the body. */
export async function POST(request: Request) {
  try {
    const user = authorize(request, { mutating: true });
    const body = await readJsonBody<Partial<ShareUpsertInput>>(request, MAX_SHARE_BODY_BYTES);
    return jsonResponse({ share: await upsertShare(body, user.username, { createIfMissing: true }) });
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH updates an existing share (expiry, enable/disable, regenerate token). */
export async function PATCH(request: Request) {
  try {
    const user = authorize(request, { mutating: true });
    const body = await readJsonBody<Partial<ShareUpsertInput>>(request, MAX_SHARE_BODY_BYTES);
    return jsonResponse({ share: await upsertShare(body, user.username, { createIfMissing: false }) });
  } catch (error) {
    return handleError(error);
  }
}
