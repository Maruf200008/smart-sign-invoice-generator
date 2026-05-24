# Smart Invoice Generator

A production-oriented Next.js invoice generator with a red-black premium A4 invoice template, live editing, local draft persistence, direct print, and PDF export.

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
