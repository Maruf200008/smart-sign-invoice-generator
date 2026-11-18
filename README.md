# Smart Sign Invoice Generator

A Next.js 15 invoice generator for Smart Sign: a branded A4 invoice template with live editing, a shared cloud invoice history (Supabase), sign-in with Gmail OTP recovery, print, and PDF sharing with full Bengali (বাংলা) support.

## Features

- Branded A4 invoice with print-safe layout (`@page A4`, dedicated print CSS).
- Live editing of customer, SL number, date, up to 15 item rows (size × qty × rate, or qty × rate, or SQF × rate, with manual total override), discount, VAT/Tax %, advance and remaining balance.
- Multi-row paste from Excel / Google Sheets, drag-and-drop row reordering, undo (Ctrl/Cmd+Z).
- Shared invoice workspace: every signed-in user sees the last year of invoices, with search, date grouping, bulk delete and `created_by` tracking.
- Auto-save to the cloud with a per-device edit lock, so two devices can't overwrite each other's work; local browser storage is the offline fallback. A status line shows whether changes are saved.
- **Share** button: generates the invoice PDF (named after the recipient, e.g. `Rahim Ahmed.pdf`) and opens the native share sheet on mobile, or downloads it on desktop.
- Bengali text rendered in the PDF with the bundled Noto Sans Bengali font.
- Installable web app (manifest + icons).

## Requirements

- Node.js 18.18+ (20 LTS recommended)
- A Supabase project (for sign-in and cloud history)
- Optional: a Gmail account with an App Password (for OTP "forgot password" login)

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                   # http://localhost:3000
```

Then set up the database (next section).

## Database (Supabase)

1. Create a Supabase project.
2. Open **SQL Editor**, paste the whole of [`supabase-schema.sql`](supabase-schema.sql) and run it.
3. Copy the project URL and the **service_role** secret key (Project Settings → API) into `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

`supabase-schema.sql` is idempotent: it creates a fresh database *and* migrates an existing one. **Re-run it before deploying a new version of the app.** It:

- creates `smart_sign_users`, `smart_sign_login_otps`, `smart_sign_invoices`, `smart_sign_invoice_shares`;
- adds the edit-lock columns (`lock_client_id`, `lock_username`, `lock_touched_at`) and the OTP `attempts` counter;
- enables Row Level Security on every table with **no** policies and revokes `anon`/`authenticated` access, so the public anon/publishable key can read nothing (older versions of this file let the anon key read password hashes and all invoices — re-running it removes those policies).

### Backups

- Supabase Pro and above take daily backups automatically (Database → Backups); enable Point-in-Time Recovery for finer restore points.
- On the free tier, schedule a dump, e.g. `supabase db dump --data-only -f backup.sql` or `pg_dump "$DATABASE_URL" > backup.sql`, and store it off-site.
- Test a restore into a scratch project at least once.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. (`NEXT_PUBLIC_SUPABASE_URL` is accepted as an alias.) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase **service_role** secret key. Server-only. (`SUPABASE_SERVICE_KEY` alias.) The anon/publishable key is not supported. |
| `AUTH_SECRET` | Recommended | ≥ 32 random characters used to sign session cookies (`openssl rand -base64 48`). If unset, one is derived from the service key. Rotating it signs everyone out. |
| `SIGNUP_ALLOWED_EMAILS` | Recommended | Comma-separated emails and/or `@domain` entries allowed to sign up. Empty = anyone. |
| `SIGNUP_DISABLED` | Optional | `true` closes sign-up entirely. |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Optional | Gmail SMTP credentials for OTP login. |
| `NEXT_PUBLIC_SITE_URL` | Optional | Canonical origin used in share links. |
| `NEXT_PUBLIC_FACEBOOK_APP_ID` | Optional | Enables desktop Messenger sharing for share links. |

> **Important:** all signed-in users share one invoice workspace. On a public deployment, set `SIGNUP_ALLOWED_EMAILS` (or `SIGNUP_DISABLED=true` once your team has accounts), otherwise anyone who signs up can see every invoice.

## Security model

- **Sessions**: sign-in sets an `HttpOnly`, `SameSite=Lax` (and `Secure` in production) cookie containing an HMAC-signed session (30 days, refreshed daily). The browser never asserts its own identity; every API route derives the user from this cookie.
- **CSRF**: `SameSite=Lax` cookies, plus mutating requests with a foreign `Origin` header are rejected.
- **Passwords / OTPs**: PBKDF2-SHA256 (310k iterations, per-hash salt; older 120k hashes still verify). OTPs come from `crypto.randomInt`, expire after 10 minutes, are burned after 5 wrong guesses, are limited to 3 per 15 minutes, and are consumed atomically. OTP requests never reveal whether an account exists.
- **Rate limiting**: per-IP limits on sign-in, sign-up and OTP endpoints (in-memory per server instance; OTP brute force is also capped in the database).
- **Input validation**: request bodies are size-capped (1 MB invoices, 4 KB auth) and invoices are sanitized server-side (types, lengths, non-negative amounts, max 50 items, only inline PNG/JPEG/WebP images). Database errors are logged server-side and never returned to the browser.
- **Headers**: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS, strict referrer policy; share pages send `no-referrer` and `noindex`.

## API

All endpoints return JSON with `Cache-Control: no-store`. Errors are `{ "error": "<message>" }`. Every endpoint except `POST /api/auth` requires the session cookie (`401` otherwise). Mutating requests from another origin get `403`.

### `/api/auth`

| Method | Body / effect | Responses |
| --- | --- | --- |
| `GET` | Current user (re-checked against the database). | `200 {user}`, `401 {user: null}` |
| `POST` | `{action: "signup", email, username, password}` | `201 {user}` + cookie, `400`, `403` (sign-up restricted), `409` (taken) |
| `POST` | `{action: "login", identifier, password}` (identifier = username or email) | `200 {user}` + cookie, `401`, `429` |
| `POST` | `{action: "request-otp", email, username}` | Always `200 {ok: true}` (no account enumeration), `429` |
| `POST` | `{action: "verify-otp", email, username, otp}` | `200 {user}` + cookie, `401`, `429` |
| `DELETE` | Signs out (expires the cookie). | `200 {ok: true}` |

### `/api/invoices`

Requires header `x-smart-sign-client-id` (random per-browser id, `[A-Za-z0-9-]{8,64}`) on writes; it identifies the device holding an edit lock.

| Method | Description | Responses |
| --- | --- | --- |
| `GET` | Invoices saved in the last 365 days (max 1000), newest first. | `200 {configured, invoices: SavedInvoice[]}` |
| `POST` | Create/update `{id, name, savedAt, invoice}`. `created_by` is the session user on first save. | `200 {configured, savedAt, createdBy}`, `400`, `409 {locked: true}` if another device is editing, `413` |
| `PATCH` | `{id}` refreshes this device's edit lock; `{id, release: true}` releases it. Only lock columns are written. | `200 {configured, locked, lockedBy?}` |
| `DELETE` | `?id=` deletes an invoice unless another device holds its lock. | `200`, `409 {locked: true}` |

An edit lock lapses 30 seconds after its last refresh; the app refreshes it every 10 seconds while the tab is visible.

### `/api/shares`

Share links for the read-only page `/share/<token>` (the UI for managing links is not currently exposed; the API is available and owner-restricted).

| Method | Description |
| --- | --- |
| `GET ?invoiceId=` | The caller's share settings for an invoice, or `null`. |
| `POST {invoiceId, expiry?, customExpiresAt?, isEnabled?}` | Creates the link if missing (idempotent). Expiry: `never`, `24h`, `7d` (default), `30d`, `custom`. |
| `PATCH {invoiceId, expiry?, isEnabled?, regenerate?}` | Updates the link; only its creator may (`403` otherwise). |

The public page shows only customer name, invoice number, date, items and totals; contact details, notes and internal ids are never exposed.

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm start           # serve the production build
npm run lint        # ESLint (zero warnings allowed)
npm run typecheck   # TypeScript
npm test            # Vitest unit + API tests
npm run check       # all of the above, in order
```

## Deployment (Netlify)

`netlify.toml` builds with Node 20 and the official Next.js plugin.

1. Run `supabase-schema.sql` against the production database **first**.
2. In Netlify → Site settings → Environment variables, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SECRET`, `SIGNUP_ALLOWED_EMAILS` (and the optional ones you use).
3. Deploy. The site must be served over HTTPS (session cookies are `Secure` in production).

Any Node host works the same way (`npm ci && npm run build && npm start`); Vercel needs no extra config.

### Production checklist

- [ ] Schema re-run on the production database
- [ ] `AUTH_SECRET` set (≥ 32 chars) and different from development
- [ ] `SIGNUP_ALLOWED_EMAILS` or `SIGNUP_DISABLED` set
- [ ] Database backups enabled and a restore tested
- [ ] Error monitoring connected (e.g. Sentry for Next.js, or Netlify log drains); the server logs storage/auth failures with `console.error`
- [ ] CI (`.github/workflows/ci.yml`) green: lint, typecheck, tests, build, production `npm audit`

## Architecture

```text
src/
  app/
    api/auth/          Sign-up, sign-in, OTP, session (GET/DELETE)
    api/invoices/      Shared invoice CRUD + edit locks
    api/shares/        Share-link management
    share/[token]/     Public read-only invoice page
  components/          Invoice template, dashboard, auth screen, share UI
  hooks/               Share/PDF hooks, focus trap
  lib/
    api-http.ts        JSON responses, CSRF/origin check, body limits, rate limiting
    auth-session.ts    Signed HttpOnly session cookie
    supabase-rest.ts   Service-role Supabase REST client (server-only)
    invoice-utils.ts   Pricing and totals (the financial source of truth)
    invoice-normalize.ts  Sanitizer shared by the API and the client
    invoice-sync.ts    Cloud/local merge rules
    invoice-pdf.ts     Canvas -> jsPDF A4 renderer (Bengali-safe)
  store/               Zustand stores (invoice editor, share modal, toasts)
tests/                 Vitest suites (calculations, sanitizing, sync, auth, API routes, PDF helpers)
```

Fonts: `public/fonts/NotoSansBengali-*.ttf` are licensed under the SIL Open Font License 1.1 (`public/fonts/NotoSansBengali-OFL.txt`).
