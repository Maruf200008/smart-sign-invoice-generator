import type { AuthUser } from "@/types/auth";

/** Older versions stored the user object here and trusted it; it is no longer used for anything. */
const LEGACY_AUTH_USER_KEY = "smart-sign-auth-user";
export const SESSION_EXPIRED_EVENT = "smart-sign:session-expired";

interface AuthResponse {
  user?: AuthUser | null;
  ok?: boolean;
  error?: string;
}

async function readJson(response: Response): Promise<AuthResponse> {
  return (await response.json().catch(() => ({}))) as AuthResponse;
}

function clearLegacyUser() {
  try {
    window.localStorage.removeItem(LEGACY_AUTH_USER_KEY);
  } catch {
    // Storage can be unavailable (private mode); nothing to clean up then.
  }
}

/** Asks the server who is signed in. Returns null when there is no valid session cookie. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  clearLegacyUser();
  const response = await fetch("/api/auth", { cache: "no-store", credentials: "same-origin" });

  if (response.status === 401) {
    return null;
  }

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(data.error || "Unable to check your session.");
  }

  return data.user ?? null;
}

export async function signOutUser() {
  await fetch("/api/auth", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
}

/** Lets any API caller report an expired session so the app returns to the sign-in screen. */
export function notifySessionExpired() {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export function signupUser(input: { email: string; username: string; password: string }) {
  return authRequest("signup", input);
}

export function loginUser(input: { identifier: string; password: string }) {
  return authRequest("login", input);
}

export async function requestLoginOtp(input: { username: string; email: string }) {
  const response = await postAuth({ action: "request-otp", ...input });
  const data = await readJson(response);

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to send OTP.");
  }
}

export function verifyLoginOtp(input: { username: string; email: string; otp: string }) {
  return authRequest("verify-otp", input);
}

function postAuth(body: Record<string, string>) {
  return fetch("/api/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function authRequest(action: "signup" | "login" | "verify-otp", body: Record<string, string>) {
  const response = await postAuth({ action, ...body });
  const data = await readJson(response);

  if (!response.ok || !data.user) {
    throw new Error(data.error || "Authentication failed.");
  }

  return data.user;
}
