# FlowStock — Trading Operations Frontend (V1.2)

A standalone, responsive **HTML + CSS + JavaScript** application for Buyer/Supplier orders, warehouse stock, reservations, and export dispatch tracking. Includes dual database modes, modal data entry, search and CSV reporting.

**Live repository:** https://github.com/krvasanth64/inventory-tracker

## Features

- Overview dashboard, outstanding PO lines, inventory availability, reorder warnings, data-quality checks.
- Master CRUD: Buyers, Suppliers, Warehouses, Items, per-SKU UOM conversions.
- Transaction CRUD: Buyer and Supplier PO headers/lines, receipts, adjustments, reservations, containers and loading lines.
- Manual container planning: 20FT / 40FT / 40HC / LCL with linked allocation lines.
- Base UOM calculations and partial shipment balances; no incompatible UOM totals.
- Posted receipts, adjustments, confirmed dispatches remain immutable; use correcting/reversing documents.
- Sample dataset: 30 Buyer POs, 60 Buyer lines, 24 Supplier POs, 48 Supplier lines, receipts, stock, 31 reservations and 19 containers.
- Direct local Excel file linking on supported browsers, plus XLSX import/export and browser IndexedDB.
- Google Sheets OAuth connect/create and publish an existing local snapshot to a **blank** Google Sheets database.

## Run locally

Opening `index.html` with the `file://` protocol is **not supported** because browsers restrict JavaScript module imports. Use a static web server.

On Windows with Python installed:

```powershell
git clone https://github.com/krvasanth64/inventory-tracker.git
cd inventory-tracker
py -m http.server 5173
```

Open **http://localhost:5173**. Alternatively, host the repository using GitHub Pages (Settings → Pages → Deploy from a branch → `main` / root).

The Excel import/export library is loaded from a CDN; it needs network access. Core local UI functionality works without Google.

## Local Excel setup

1. Open **Database & settings**.
2. **Load sample data** to explore safely, or **Import snapshot** to read an existing Excel V1 workbook.
3. **Download blank template** for a fresh normalized database.
4. For automatic file synchronization, select **Save as linked Excel**, creating a **new .xlsx** in your chosen folder.
5. On each subsequent successful local CRUD operation, the browser writes the updated database to that linked .xlsx. This feature is supported in Chrome/Edge on HTTPS or localhost, where the File System Access API is available.
6. On a later session, use **Open live Excel file** to grant access again.

**File safety:** Opening a legacy/formula-rich Excel workbook as a live database is blocked to avoid silently destroying reports and styling. Import it as a snapshot and save under a **new linked filename**. If the file was modified outside FlowStock, the next save is blocked to avoid overwriting external edits. Do not edit the same file simultaneously in Excel and the web app.

In other browsers, use IndexedDB + manual XLSX export/import.

## Google Sheets setup

1. Open the Google Cloud Console, create/select a project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen and any needed test users.
3. Create an OAuth 2.0 **Web application** client.
4. Add authorized JavaScript origins, e.g. `https://krvasanth64.github.io` for GitHub Pages and `http://localhost:5173` when testing locally. Do not include URL paths under origins.
5. In **Database & settings**, enter the OAuth **client ID only** (`*.apps.googleusercontent.com`). Never paste a client secret.
6. Choose **Create new sheet** for a fresh database or paste an existing native Google Sheets URL and choose **Sign in & connect**.
7. For an existing V1 workbook, upload it to Drive and convert to a native Google Sheet first. The app detects its row-6 headers. A source `.xlsx` stored in Drive is **not** a native Google Sheet.
8. To migrate local records, connect a blank created database and select **Upload local data to blank Sheet**. The operation refuses any destination that already contains a source record.

**OAuth:** Granting the requested `https://www.googleapis.com/auth/spreadsheets` scope is required. Access is controlled by the signed-in user's Google Sheets Editor rights. OAuth tokens are held in memory and are not committed or exported.

**Important security limitation:** This is a static browser frontend with direct Google Sheets API calls. There is no trusted server; client validations and role labels can be bypassed by any user with direct spreadsheet edit access. There are no atomic multi-user posting transactions. Do not rely on this implementation as a tamper-proof accounting ledger or strict approval system. For production multi-user inventory, use a backend (such as authenticated Apps Script/Cloud Run/ERP) for authorization, locks, audit, posting and reconciliation.

## Core business rules

| Metric | Calculation |
| --- | --- |
| Buyer PO outstanding | Ordered base − cancelled base − confirmed dispatched base |
| Supplier pending | Ordered base − accepted, posted received base (for active POs) |
| Physical stock | Posted receipts + posted signed adjustments − confirmed dispatched quantities |
| Open reserved | Allocation base − confirmed dispatch against allocation |
| Available | Physical stock − open reserved |
| Suggested sourcing shortage | max(0, open PO demand + min stock − physical − supplier pending) |
| Dispatch recognition | Only containers in **Dispatched** or **Arrived** count as dispatched |
| UOM | Conversion factor is specific to SKU/UOM, never global |

If a Buyer PO is cancelled, any remaining reservations must be released first. Dispatched shipments may advance to Arrived, but not be rolled back from the UI. Draft transactions can be deleted only when no dependent records exist.

## Database tables

`BUYERS`, `SUPPLIERS`, `WAREHOUSES`, `ITEMS`, `UOM_MAP`, `BUYER_PO`, `BUYER_LINES`, `SUPPLIER_PO`, `SUPPLIER_LINES`, `RECEIPTS`, `ADJUSTMENTS`, `ALLOCATIONS`, `CONTAINERS`, `DISPATCH`.

The app uses matching names and row 6 headers for the previously designed China Trading workbook, but frontend reports are derived in JS rather than reusing the original Excel formula-based report tabs.

## Tests

Run `npm test` with Node.js 22+. GitHub Actions runs the core tests and syntax checks on every commit.

## Files

- `index.html` — accessible application shell
- `styles.css` — responsive desktop/mobile interface
- `core.js` — schema, base UOM, inventory/PO calculations, posting validation
- `storage.js` — IndexedDB, XLSX, live local file and Google Sheets adapters
- `app.js` — navigation, data-entry forms, interactive reports, sample data
- `tests/core.test.js` — regression tests
