import type { AuthUser } from "@/types/auth";

const AUTH_USER_KEY = "smart-sign-auth-user";

export function getStoredAuthUser() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawUser = window.localStorage.getItem(AUTH_USER_KEY);

  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as AuthUser;
  } catch {
    window.localStorage.removeItem(AUTH_USER_KEY);
    return null;
  }
}

export function storeAuthUser(user: AuthUser) {
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearStoredAuthUser() {
  window.localStorage.removeItem(AUTH_USER_KEY);
}

export async function signupUser(input: { email: string; username: string; password: string }) {
  return authRequest("signup", input);
}

export async function loginUser(input: { identifier: string; password: string }) {
  return authRequest("login", input);
}

export async function requestLoginOtp(input: { username: string; email: string }) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: "request-otp", ...input })
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to send OTP.");
  }

  return data;
}

export async function verifyLoginOtp(input: { username: string; email: string; otp: string }) {
  return authRequest("verify-otp", input);
}

async function authRequest(action: "signup" | "login" | "verify-otp", body: Record<string, string>) {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, ...body })
  });
  const data = (await response.json()) as { user?: AuthUser; error?: string };

  if (!response.ok || !data.user) {
    throw new Error(data.error || "Authentication failed.");
  }

  storeAuthUser(data.user);
  return data.user;
}
