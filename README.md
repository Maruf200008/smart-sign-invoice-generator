# Smart Sign Invoice Generator

A production-oriented Next.js invoice generator with a Smart Sign branded A4 invoice template, live editing, login-protected invoice history, direct print, PDF export, and Supabase database sync for long-term storage.

## Features

- Smart Sign branded A4 invoice layout with red-black styling and print-safe spacing.
- Live invoice editing for customer name, SL number, date, item rows, size, SQF, quantity, rate, total, advance, and tax.
- Invoice item table with Description, Size, SQF, Qty, Rate, and Total columns.
- Width and Height auto-calculate SQF, while SQF and Total remain manually editable.
- Total supports Qty x Rate, SQF x Rate, or SQF x Qty x Rate calculation.
- Comma-formatted Total input for easier amount reading.
- Default 10-row invoice template with compact table spacing for larger invoices.
- Drag-and-drop item row reordering, add row, remove row, refresh current invoice, new invoice, and new SL number actions.
- Automatic subtotal, tax, total, advance, and remaining balance calculation.
- Browser draft persistence with migration support so unfinished invoices stay saved locally.
- Login and signup with username, email, and password, plus Gmail OTP login recovery.
- Auto-saved invoice sidebar with one-year retention, date-wise grouping, search by name/date/SL number/creator, click-to-edit, single delete confirmation, bulk select/delete, and "See More Menu" expansion.
- Supabase-backed shared invoice storage with `created_by` tracking for the user who first created each invoice.
- Bangla-friendly text rendering with Nirmala and Noto Sans Bengali support.
- Direct print support plus share/copy invoice actions that generate a PDF or clipboard-friendly invoice image.
- Smart Sign web app manifest for desktop install and mobile Add to Home Screen shortcuts.
- Brand-loader overlay animation using the Smart Sign icon during loading and long-running actions.

## Install

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase Storage And Auth

The app works with local browser storage by default. To store invoice history in a database for at least one year, configure Supabase:

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL Editor.
3. Add these environment variables locally and in Netlify:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are also supported as aliases. The service role key must only be used on the server.

The `SUPABASE_SERVICE_ROLE_KEY` must stay private. Do not commit `.env.local`; it is ignored by git.

When Supabase is configured, the app auto-syncs saved invoices through the server API route at `src/app/api/invoices/route.ts`. Saved invoices are shared across browsers and devices.

The same schema also creates `smart_sign_users` for app login/signup, `smart_sign_login_otps` for OTP login recovery, and adds `created_by` to `smart_sign_invoices`. Re-run `supabase-schema.sql` after pulling schema changes.

Forgot-password login uses a Gmail OTP. Add `GMAIL_USER` and a Gmail App Password as `GMAIL_APP_PASSWORD` in `.env.local` and deployment environment variables.

## Desktop and Mobile Shortcut

The app includes a web app manifest with the Smart Sign icon. Open the deployed site in Chrome/Edge and use Install app, or on mobile use Add to Home Screen. The shortcut opens the site directly with the Smart Sign logo.

## Netlify Deployment

This repo includes `netlify.toml` for deploying the Next.js app on Netlify. Set the Supabase environment variables in Netlify under Site settings > Environment variables, then redeploy.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
```

## Architecture

```text
src/
  app/                 App Router entry, API routes, global styles, page shell
  components/
    controls/          Editor inputs, upload controls, summary widgets
    invoice/           A4 preview template components
    layout/            Dashboard shell
  hooks/               Reusable hooks
  lib/                 Cloud sync, labels, sample data, and utilities
  store/               Zustand invoice state and saved invoice history
  types/               Type-safe invoice models
```

The preview uses exact A4 dimensions (`210mm x 297mm`) with dedicated `@media print` rules. The editor is responsive: controls stack above the invoice on smaller screens while desktop uses a two-panel dashboard.
