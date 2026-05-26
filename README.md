# Smart Invoice Generator

A production-oriented Next.js invoice generator with a red-black premium A4 invoice template, live editing, local draft persistence, direct print, and PDF export.

## Features

- Smart Sign branded A4 invoice layout with red-black styling and print-safe spacing.
- Live invoice editing for customer name, SL number, date, item rows, quantity, price, advance, discount, and tax.
- Default 10-row invoice template with compact table spacing for larger invoices.
- Drag-and-drop item row reordering, add row, remove row, duplicate invoice, reset draft, and new SL number actions.
- Automatic subtotal, discount, tax, total, advance, and remaining balance calculation.
- Browser draft persistence with migration support so unfinished invoices stay saved locally.
- Bangla-friendly text rendering with Nirmala and Noto Sans Bengali support.
- Direct print support plus share/copy invoice actions that generate a PDF or clipboard-friendly invoice image.

## Install

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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
  app/                 App Router entry, global styles, page shell
  components/
    controls/          Editor inputs, upload controls, summary widgets
    invoice/           A4 preview template components
    layout/            Dashboard shell
  hooks/               Reusable hooks
  lib/                 Sample data and utilities
  store/               Zustand invoice state
  types/               Type-safe invoice models
```

The preview uses exact A4 dimensions (`210mm x 297mm`) with dedicated `@media print` rules. The editor is responsive: controls stack above the invoice on smaller screens while desktop uses a two-panel dashboard.
