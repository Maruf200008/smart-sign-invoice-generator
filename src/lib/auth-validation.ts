export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value = "") {
  return value.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username);
}

/** Returns a user-facing error for an invalid sign-up, or null when it is valid. */
export function validateNewAccount({ email, username, password }: { email: string; username: string; password: string }) {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }

  if (!isValidUsername(username)) {
    return "Username must be 3-32 characters: letters, numbers, dot, dash or underscore.";
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return null;
}

/**
 * Sign-up allowlist from SIGNUP_ALLOWED_EMAILS: a comma-separated list of exact emails and/or "@domain.com"
 * entries. Unset means anyone may sign up. SIGNUP_DISABLED=true closes sign-up entirely.
 */
export function isSignupAllowed(email: string, env: Record<string, string | undefined> = process.env) {
  if (env.SIGNUP_DISABLED?.trim().toLowerCase() === "true") {
    return false;
  }

  const entries = (env.SIGNUP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (entries.length === 0) {
    return true;
  }

  const normalized = normalizeEmail(email);
  const domain = normalized.slice(normalized.lastIndexOf("@"));

  return entries.some((entry) => (entry.startsWith("@") ? entry === domain : entry === normalized));
}
