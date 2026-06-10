import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import tls from "tls";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/types/auth";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_REST_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const USERS_TABLE_NAME = "smart_sign_users";
const OTP_TABLE_NAME = "smart_sign_login_otps";
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const OTP_EXPIRY_MINUTES = 10;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store"
    }
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_REST_KEY);
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  if (!isConfigured()) {
    throw new Error("Supabase is not configured.");
  }

  const supabaseUrl = SUPABASE_URL?.replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_REST_KEY ?? "",
      Authorization: `Bearer ${SUPABASE_REST_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    const schemaHint = message.includes("PGRST205") || message.includes("smart_sign_users")
      ? " Database schema is not ready. Run the updated supabase-schema.sql in Supabase SQL Editor."
      : "";

    throw new Error(`${message || "Supabase request failed."}${schemaHint}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "signup" | "login" | "request-otp" | "verify-otp";
      email?: string;
      username?: string;
      password?: string;
      identifier?: string;
      otp?: string;
    };

    if (body.action === "signup") {
      return await signup(body);
    }

    if (body.action === "login") {
      return await login(body);
    }

    if (body.action === "request-otp") {
      return await requestOtp(body);
    }

    if (body.action === "verify-otp") {
      return await verifyOtp(body);
    }

    return jsonResponse({ error: "Invalid auth action." }, 400);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Database schema is not ready")) {
      console.warn(error.message);
    } else {
      console.error("Authentication request failed.", error);
    }
    return jsonResponse({ error: error instanceof Error ? error.message : "Authentication request failed." }, 500);
  }
}

async function signup(body: { email?: string; username?: string; password?: string }) {
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const password = body.password ?? "";

  if (!email || !username || password.length < 6) {
    return jsonResponse({ error: "Email, username, and 6+ character password are required." }, 400);
  }

  const existingUsers = await findUsersByIdentifier(username, email);

  if (existingUsers.length > 0) {
    return jsonResponse({ error: "Email or username already exists." }, 409);
  }

  const rows = await supabaseRequest(USERS_TABLE_NAME, {
    method: "POST",
    body: JSON.stringify({
      email,
      username,
      password_hash: hashPassword(password)
    })
  });
  const userRow = Array.isArray(rows) ? rows[0] : null;

  if (!userRow) {
    return jsonResponse({ error: "Unable to create account." }, 500);
  }

  return jsonResponse({ user: userFromRow(userRow) });
}

async function login(body: { identifier?: string; password?: string }) {
  const identifier = normalizeIdentifier(body.identifier);
  const password = body.password ?? "";

  if (!identifier || !password) {
    return jsonResponse({ error: "Username/email and password are required." }, 400);
  }

  const users = await findUsersByIdentifier(identifier);
  const userRow = users[0];

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    return jsonResponse({ error: "Invalid username/email or password." }, 401);
  }

  return jsonResponse({ user: userFromRow(userRow) });
}

async function requestOtp(body: { email?: string; username?: string }) {
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);

  if (!email || !username) {
    return jsonResponse({ error: "Username and Gmail/email are required." }, 400);
  }

  const user = await findUserByUsernameAndEmail(username, email);

  if (!user) {
    return jsonResponse({ error: "No account matches that username and email." }, 404);
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await supabaseRequest(OTP_TABLE_NAME, {
    method: "POST",
    body: JSON.stringify({
      user_id: user.id,
      username,
      email,
      otp_hash: hashPassword(otp),
      expires_at: expiresAt
    })
  });
  await sendOtpEmail(email, username, otp);

  return jsonResponse({ ok: true });
}

async function verifyOtp(body: { email?: string; username?: string; otp?: string }) {
  const email = normalizeEmail(body.email);
  const username = normalizeUsername(body.username);
  const otp = (body.otp ?? "").trim();

  if (!email || !username || !otp) {
    return jsonResponse({ error: "Username, Gmail/email, and OTP are required." }, 400);
  }

  const user = await findUserByUsernameAndEmail(username, email);

  if (!user) {
    return jsonResponse({ error: "No account matches that username and email." }, 404);
  }

  const rows = await supabaseRequest(
    `${OTP_TABLE_NAME}?user_id=eq.${encodeURIComponent(user.id)}&email=eq.${encodeURIComponent(email)}&used_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=1`
  );
  const otpRow = Array.isArray(rows) ? rows[0] as { id: string; otp_hash: string } | undefined : undefined;

  if (!otpRow || !verifyPassword(otp, otpRow.otp_hash)) {
    return jsonResponse({ error: "Invalid or expired OTP." }, 401);
  }

  await supabaseRequest(`${OTP_TABLE_NAME}?id=eq.${encodeURIComponent(otpRow.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ used_at: new Date().toISOString() })
  });

  return jsonResponse({ user: userFromRow(user) });
}

async function findUsersByIdentifier(identifier: string, email?: string) {
  const usernameValue = encodeURIComponent(normalizeUsername(identifier));
  const emailValue = encodeURIComponent(normalizeEmail(email ?? identifier));
  const rows = await supabaseRequest(`${USERS_TABLE_NAME}?or=(username.eq.${usernameValue},email.eq.${emailValue})&limit=1`);

  return Array.isArray(rows)
    ? (rows as Array<{ id: string; email: string; username: string; password_hash: string }>)
    : [];
}

async function findUserByUsernameAndEmail(username: string, email: string) {
  const rows = await supabaseRequest(
    `${USERS_TABLE_NAME}?username=eq.${encodeURIComponent(username)}&email=eq.${encodeURIComponent(email)}&limit=1`
  );

  return Array.isArray(rows)
    ? (rows[0] as { id: string; email: string; username: string; password_hash: string } | undefined)
    : undefined;
}

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

function normalizeUsername(value = "") {
  return value.trim().toLowerCase();
}

function normalizeIdentifier(value = "") {
  return value.trim().toLowerCase();
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString("hex");

  return `${PASSWORD_ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [iterationsValue, salt, hash] = passwordHash.split(":");
  const iterations = Number(iterationsValue);

  if (!iterations || !salt || !hash) {
    return false;
  }

  const expectedHash = Buffer.from(hash, "hex");
  const actualHash = pbkdf2Sync(password, salt, iterations, expectedHash.length, PASSWORD_DIGEST);

  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

function userFromRow(row: { id: string; email: string; username: string }): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username
  };
}

async function sendOtpEmail(to: string, username: string, otp: string) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    throw new Error("Gmail SMTP is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD.");
  }

  const subject = "Smart Sign login OTP";
  const message = [
    `From: Smart Sign Invoice <${gmailUser}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Hi ${username},`,
    "",
    `Your Smart Sign login OTP is ${otp}.`,
    `This OTP will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
    "",
    "Smart Sign Invoice"
  ].join("\r\n");

  await sendSmtpMail({
    username: gmailUser,
    password: gmailAppPassword,
    to,
    message
  });
}

function sendSmtpMail({
  username,
  password,
  to,
  message
}: {
  username: string;
  password: string;
  to: string;
  message: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
    let buffer = "";
    let pendingResolve: ((line: string) => void) | null = null;
    let pendingReject: ((error: Error) => void) | null = null;

    function cleanup(error?: Error) {
      socket.end();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function readResponse() {
      return new Promise<string>((responseResolve, responseReject) => {
        pendingResolve = responseResolve;
        pendingReject = responseReject;
      });
    }

    async function command(value: string, expectedPrefix: string) {
      socket.write(`${value}\r\n`);
      const response = await readResponse();

      if (!response.startsWith(expectedPrefix)) {
        throw new Error(`SMTP command failed: ${response}`);
      }
    }

    socket.on("data", (data) => {
      buffer += data.toString("utf8");

      if (!buffer.endsWith("\r\n")) {
        return;
      }

      const lines = buffer.trimEnd().split(/\r\n/);
      const lastLine = lines[lines.length - 1] ?? "";

      if (/^\d{3}-/.test(lastLine)) {
        return;
      }

      const response = buffer;
      buffer = "";
      pendingResolve?.(response);
      pendingResolve = null;
      pendingReject = null;
    });

    socket.on("error", (error) => {
      pendingReject?.(error);
      cleanup(error);
    });

    socket.on("secureConnect", async () => {
      try {
        const greeting = await readResponse();

        if (!greeting.startsWith("220")) {
          throw new Error(`SMTP greeting failed: ${greeting}`);
        }

        await command("EHLO smart-sign-invoice.local", "250");
        await command("AUTH LOGIN", "334");
        await command(Buffer.from(username).toString("base64"), "334");
        await command(Buffer.from(password).toString("base64"), "235");
        await command(`MAIL FROM:<${username}>`, "250");
        await command(`RCPT TO:<${to}>`, "250");
        await command("DATA", "354");
        socket.write(`${message}\r\n.\r\n`);
        const dataResponse = await readResponse();

        if (!dataResponse.startsWith("250")) {
          throw new Error(`SMTP DATA failed: ${dataResponse}`);
        }

        await command("QUIT", "221");
        cleanup();
      } catch (error) {
        cleanup(error instanceof Error ? error : new Error("SMTP failed."));
      }
    });
  });
}
