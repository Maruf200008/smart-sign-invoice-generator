import "server-only";

import tls from "tls";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 15_000;

export function isMailerConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** Strips CR/LF so user-controlled values can never inject extra SMTP headers or commands. */
function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendOtpEmail(to: string, username: string, otp: string, expiryMinutes: number) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    throw new Error("Gmail SMTP is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD.");
  }

  const recipient = singleLine(to);
  const message = [
    `From: Smart Sign Invoice <${singleLine(gmailUser)}>`,
    `To: ${recipient}`,
    "Subject: Smart Sign login OTP",
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Hi ${singleLine(username)},`,
    "",
    `Your Smart Sign login OTP is ${otp}.`,
    `This OTP will expire in ${expiryMinutes} minutes. If you did not request it, you can ignore this email.`,
    "",
    "Smart Sign Invoice"
  ]
    .join("\r\n")
    // SMTP dot-stuffing: a line that starts with "." must be escaped or it can end the DATA section early.
    .replace(/\r\n\./g, "\r\n..");

  await sendSmtpMail({ username: gmailUser, password: gmailAppPassword, to: recipient, message });
}

function sendSmtpMail({ username, password, to, message }: { username: string; password: string; to: string; message: string }) {
  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect(SMTP_PORT, SMTP_HOST, { servername: SMTP_HOST });
    let buffer = "";
    let settled = false;
    let pending: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      pending?.reject(error ?? new Error("SMTP connection closed."));
      pending = null;
      socket.destroy();

      if (error) reject(error);
      else resolve();
    }

    socket.setTimeout(SMTP_TIMEOUT_MS, () => finish(new Error("SMTP connection timed out.")));

    function readResponse() {
      return new Promise<string>((responseResolve, responseReject) => {
        pending = { resolve: responseResolve, reject: responseReject };
      });
    }

    async function command(value: string, expectedPrefix: string) {
      socket.write(`${value}\r\n`);
      const response = await readResponse();

      if (!response.startsWith(expectedPrefix)) {
        throw new Error(`SMTP command failed: ${response.slice(0, 200)}`);
      }
    }

    socket.on("data", (data) => {
      buffer += data.toString("utf8");

      if (!buffer.endsWith("\r\n")) {
        return;
      }

      const lines = buffer.trimEnd().split(/\r\n/);
      const lastLine = lines[lines.length - 1] ?? "";

      // Multi-line replies use "250-..." until the final "250 ..." line.
      if (/^\d{3}-/.test(lastLine)) {
        return;
      }

      const response = lastLine;
      buffer = "";
      const current = pending;
      pending = null;
      current?.resolve(response);
    });

    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(settled ? undefined : new Error("SMTP connection closed unexpectedly.")));

    socket.on("secureConnect", async () => {
      try {
        const greeting = await readResponse();

        if (!greeting.startsWith("220")) {
          throw new Error(`SMTP greeting failed: ${greeting.slice(0, 200)}`);
        }

        await command("EHLO smart-sign-invoice.local", "250");
        await command("AUTH LOGIN", "334");
        await command(Buffer.from(username).toString("base64"), "334");
        await command(Buffer.from(password).toString("base64"), "235");
        await command(`MAIL FROM:<${username}>`, "250");
        await command(`RCPT TO:<${to}>`, "250");
        await command("DATA", "354");
        await command(`${message}\r\n.`, "250");
        socket.write("QUIT\r\n");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("SMTP failed."));
      }
    });
  });
}
