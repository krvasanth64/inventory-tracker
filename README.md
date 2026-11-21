# Inventory Tracker — Buyer PO, Stock & Export

Browser-based, static-hosted inventory and shipment tracker.

- Local workspace (IndexedDB) with Excel import/export.
- Google Sheets database via Google OAuth (client ID, no client secret).
- Buyer & Supplier master CRUD, Item/UOM, Purchase Orders, Receipts, reservations, containers, dispatch.
- Outstanding lines, stock by SKU, alerts, dashboard and CSV exports.
- Item-specific UOM conversion, partial dispatch, manual container planning.

## Quick start

Open `index.html` in a current browser for local mode, or host using GitHub Pages. No server/build is required.

## Google Sheets connection

1. Create a Google Cloud OAuth **Web application** client. Add your GitHub Pages URL to **Authorized JavaScript origins**.
2. Enable the **Google Sheets API** for that Google Cloud project.
3. Open **Settings → Google Sheets** and paste the OAuth **client ID only**, never a client secret.
4. Choose **Create spreadsheet** for a fresh empty database, or paste an existing Google Sheets URL and select **Connect**.
5. The app requests `https://www.googleapis.com/auth/spreadsheets`, so the signed-in Google user must have Editor rights to write.
6. The app expects row 6 headers for compatibility with the supplied China Trading V1 workbook and only edits input columns.

> Security: This static frontend does not enforce server-side user roles, tamper-proof approvals or database transactions. Google Drive sharing determines sheet access. Test with a copy; do not use for regulated/financial posting without a trusted backend and audit controls.

## Data integrity model

* Every SKU has a base UOM; conversions are per SKU.
* Buyer outstanding = ordered base − cancelled base − dispatched base.
* Supplier pending = ordered base − received accepted/posted base.
* Physical stock = posted opening/adjustments + posted accepted receipts − dispatched/arrived loading.
* Open reservations = reserved base − shipped against the same allocation.
* Planning/Loaded containers don't reduce physical stock. Only Dispatched/Arrived do.
* Posted stock transactions are not physically deleted. Manage status/reversal with a new correcting transaction.
* Container planning is manual; CBM/weight are reference information.

## Project files

- `index.html` UI shell and external libraries
- `styles.css` responsive interface
- `app.js` CRUD, validation, calculations and data adapters

## Hosting

Repository Settings → Pages → Deploy from branch → main / root.

Note: Google OAuth is only available on authorized HTTPS origins (e.g. GitHub Pages); localhost testing may require a registered localhost origin.

## Excel compatibility

Use **Download template** to generate a matching XLSX with row 6 headers, then **Import Excel** to open a local database. Existing Version 1/1.1 workbook tabs can be imported; formula-derived columns are recalculated in the app, not treated as authoritative input. Export creates a data workbook, not the original styled report workbook. Reports remain available in the frontend.

All demonstration data is fictional; never connect a demonstration sheet as production.
