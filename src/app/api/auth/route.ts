import { ApiError, assertSameOrigin, getClientIp, jsonResponse, rateLimit, readJsonBody } from "@/lib/api-http";
import { clearSessionCookieHeader, getSessionUser, SessionConfigError, sessionCookieHeader } from "@/lib/auth-session";
import { isSignupAllowed, normalizeEmail, normalizeUsername, validateNewAccount } from "@/lib/auth-validation";
import { sendOtpEmail } from "@/lib/mailer";
import { generateOtp, hashSecret, verifySecret } from "@/lib/password";
import { describeStorageError, SupabaseRequestError, supabaseServiceRequest } from "@/lib/supabase-rest";
import type { AuthUser } from "@/types/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const USERS_TABLE = "smart_sign_users";
const OTP_TABLE = "smart_sign_login_otps";
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_WINDOW = 3;
const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_AUTH_BODY_BYTES = 4 * 1024;
const MINUTE = 60 * 1000;

type UserRow = { id: string; email: string; username: string; password_hash: string };
type OtpRow = { id: string; otp_hash: string; attempts: number | null };

interface AuthBody {
  action?: unknown;
  email?: unknown;
  username?: unknown;
  password?: unknown;
  identifier?: unknown;
  otp?: unknown;
}

function text(value: unknown, maxLength = 512) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function userFromRow(row: Pick<UserRow, "id" | "email" | "username">): AuthUser {
  return { id: row.id, email: row.email, username: row.username };
}

function signedIn(user: AuthUser, status = 200) {
  return jsonResponse({ user }, status, { "Set-Cookie": sessionCookieHeader(user) });
}

function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message }, error.status, error.headers);
  }

  if (error instanceof SupabaseRequestError) {
    console.error("Auth storage request failed.", error.status, error.message);
    return jsonResponse({ error: describeStorageError(error) }, error.status === 503 ? 503 : 502);
  }

  if (error instanceof SessionConfigError) {
    console.error("Auth session misconfigured.", error.message);
    return jsonResponse({ error: "Sign-in is not configured on the server (AUTH_SECRET)." }, 500);
  }

  console.error("Authentication request failed.", error);
  return jsonResponse({ error: "Authentication request failed. Please try again." }, 500);
}

/** GET /api/auth -> the signed-in user (re-checked against the database), or 401. */
export async function GET(request: Request) {
  try {
    const session = getSessionUser(request);

    if (!session) {
      return jsonResponse({ user: null }, 401);
    }

    const rows = await supabaseServiceRequest<UserRow[]>(
      `${USERS_TABLE}?id=eq.${encodeURIComponent(session.id)}&select=id,email,username&limit=1`
    );
    const row = rows?.[0];

    if (!row) {
      return jsonResponse({ user: null }, 401, { "Set-Cookie": clearSessionCookieHeader() });
    }

    // Sliding session: refresh the cookie once it is more than a day old.
    const user = userFromRow(row);
    const isStale = Date.now() - session.issuedAt > 24 * 60 * MINUTE;
    return jsonResponse({ user }, 200, isStale ? { "Set-Cookie": sessionCookieHeader(user) } : {});
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/auth -> sign out. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ip = getClientIp(request);
    rateLimit(`auth:${ip}`, 30, 10 * MINUTE);

    const body = await readJsonBody<AuthBody>(request, MAX_AUTH_BODY_BYTES);

    switch (body.action) {
      case "signup":
        rateLimit(`signup:${ip}`, 5, 60 * MINUTE);
        return await signup(body);
      case "login":
        return await login(body, ip);
      case "request-otp":
        rateLimit(`otp-request:${ip}`, 5, 15 * MINUTE);
        return await requestOtp(body);
      case "verify-otp":
        rateLimit(`otp-verify:${ip}`, 10, 15 * MINUTE);
        return await verifyOtp(body);
      default:
        throw new ApiError("Invalid auth action.", 400);
    }
  } catch (error) {
    return handleError(error);
  }
}

async function findUserByEmail(email: string) {
  const rows = await supabaseServiceRequest<UserRow[]>(`${USERS_TABLE}?email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows?.[0];
}

async function findUserByUsername(username: string) {
  const rows = await supabaseServiceRequest<UserRow[]>(`${USERS_TABLE}?username=eq.${encodeURIComponent(username)}&limit=1`);
  return rows?.[0];
}

async function signup(body: AuthBody) {
  const email = normalizeEmail(text(body.email));
  const username = normalizeUsername(text(body.username));
  const password = text(body.password, 1024);
  const validationError = validateNewAccount({ email, username, password });

  if (validationError) {
    throw new ApiError(validationError, 400);
  }

  if (!isSignupAllowed(email)) {
    throw new ApiError("Sign up is restricted. Ask an administrator for access.", 403);
  }

  const [byEmail, byUsername] = await Promise.all([findUserByEmail(email), findUserByUsername(username)]);

  if (byEmail || byUsername) {
    throw new ApiError("Email or username already exists.", 409);
  }

  try {
    const rows = await supabaseServiceRequest<UserRow[]>(USERS_TABLE, {
      method: "POST",
      body: JSON.stringify({ email, username, password_hash: await hashSecret(password) })
    });
    const row = rows?.[0];

    if (!row) {
      throw new ApiError("Unable to create account.", 500);
    }

    return signedIn(userFromRow(row), 201);
  } catch (error) {
    // Two sign-ups racing for the same email/username: the unique constraint decides.
    if (error instanceof SupabaseRequestError && error.hasCode("23505")) {
      throw new ApiError("Email or username already exists.", 409);
    }

    throw error;
  }
}

async function login(body: AuthBody, ip: string) {
  const identifier = text(body.identifier).trim().toLowerCase();
  const password = text(body.password, 1024);

  if (!identifier || !password) {
    throw new ApiError("Username/email and password are required.", 400);
  }

  rateLimit(`login:${ip}:${identifier}`, 8, 15 * MINUTE);

  const user = identifier.includes("@") ? await findUserByEmail(normalizeEmail(identifier)) : await findUserByUsername(normalizeUsername(identifier));
  // Always run the hash so response time doesn't reveal whether the account exists.
  const isValid = await verifySecret(password, user?.password_hash);

  if (!user || !isValid) {
    throw new ApiError("Invalid username/email or password.", 401);
  }

  return signedIn(userFromRow(user));
}

async function findUserByUsernameAndEmail(username: string, email: string) {
  const rows = await supabaseServiceRequest<UserRow[]>(
    `${USERS_TABLE}?username=eq.${encodeURIComponent(username)}&email=eq.${encodeURIComponent(email)}&limit=1`
  );
  return rows?.[0];
}

async function requestOtp(body: AuthBody) {
  const email = normalizeEmail(text(body.email));
  const username = normalizeUsername(text(body.username));

  if (!email || !username) {
    throw new ApiError("Username and Gmail/email are required.", 400);
  }

  const user = await findUserByUsernameAndEmail(username, email);

  // The response is identical whether or not the account exists, so this can't be used to discover accounts.
  if (!user) {
    return jsonResponse({ ok: true });
  }

  const since = new Date(Date.now() - OTP_REQUEST_WINDOW_MS).toISOString();
  const recent = await supabaseServiceRequest<Array<{ id: string }>>(
    `${OTP_TABLE}?user_id=eq.${encodeURIComponent(user.id)}&created_at=gte.${encodeURIComponent(since)}&select=id`
  );

  if ((recent?.length ?? 0) >= OTP_MAX_REQUESTS_PER_WINDOW) {
    return jsonResponse({ ok: true });
  }

  const otp = generateOtp();

  await supabaseServiceRequest(OTP_TABLE, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: user.id,
      username: user.username,
      email: user.email,
      otp_hash: await hashSecret(otp),
      expires_at: new Date(Date.now() + OTP_EXPIRY_MINUTES * MINUTE).toISOString()
    })
  });

  try {
    await sendOtpEmail(user.email, user.username, otp, OTP_EXPIRY_MINUTES);
  } catch (error) {
    console.error("Unable to send OTP email.", error instanceof Error ? error.message : error);
    throw new ApiError("Unable to send the OTP email right now. Please try again later.", 502);
  }

  return jsonResponse({ ok: true });
}

async function verifyOtp(body: AuthBody) {
  const email = normalizeEmail(text(body.email));
  const username = normalizeUsername(text(body.username));
  const otp = text(body.otp, 16).trim();
  const invalid = new ApiError("Invalid or expired OTP.", 401);

  if (!email || !username || !otp) {
    throw new ApiError("Username, Gmail/email, and OTP are required.", 400);
  }

  if (!/^\d{6}$/.test(otp)) {
    throw invalid;
  }

  const user = await findUserByUsernameAndEmail(username, email);

  if (!user) {
    throw invalid;
  }

  const rows = await supabaseServiceRequest<OtpRow[]>(
    `${OTP_TABLE}?user_id=eq.${encodeURIComponent(user.id)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=1&select=id,otp_hash,attempts`
  );
  const otpRow = rows?.[0];

  if (!otpRow || (otpRow.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    throw invalid;
  }

  if (!(await verifySecret(otp, otpRow.otp_hash))) {
    const attempts = (otpRow.attempts ?? 0) + 1;
    // Burn the code after too many wrong guesses so a 6-digit code can't be brute forced.
    await supabaseServiceRequest(`${OTP_TABLE}?id=eq.${encodeURIComponent(otpRow.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(attempts >= OTP_MAX_ATTEMPTS ? { attempts, used_at: new Date().toISOString() } : { attempts })
    });
    throw invalid;
  }

  // Conditional update: only one concurrent request can consume the code.
  const consumed = await supabaseServiceRequest<Array<{ id: string }>>(
    `${OTP_TABLE}?id=eq.${encodeURIComponent(otpRow.id)}&used_at=is.null&select=id`,
    { method: "PATCH", body: JSON.stringify({ used_at: new Date().toISOString() }) }
  );

  if (!consumed?.length) {
    throw invalid;
  }

  return signedIn(userFromRow(user));
}
