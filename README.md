# FlowStock — Trading Operations Frontend (V1.4)

A standalone, responsive **HTML + CSS + JavaScript** application for Buyer/Supplier orders, warehouse stock, reservations, and export dispatch tracking. Includes dual database modes, modal data entry, search and CSV reporting.

**Latest update:** V1.4 — simpler daily workflow, Buyer-wise outstanding and purchasing requirements, guided PO items, inward and outward operations. V1.3 bulk uploads, database selection and user permissions remain available under More Tools.

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


## V1.3: Sign in and role-based interface

On **first run**, use the bootstrap account:

- **Username:** \`admin\`
- **Password:** \`admin\`

The application **requires changing this password immediately** to a password of at least 10 characters. New users are created only by an administrator and must also change their initial password on first login. The password hashes use salted PBKDF2 (SHA-256), stored in this browser's IndexedDB.

Go to **User Management** as admin to add, edit, disable or remove users. Roles can be **multi-selected**:

| Role | Allowed operations |
| --- | --- |
| View Only | Dashboard, tables, reports and exports |
| Data Entry | Transaction drafts: Buyer/Supplier POs, receipts, allocations, loading, adjustments |
| Stock Posting / Dispatch | Confirm posted receipts, adjustments and dispatched containers when combined with Data Entry |
| Master Manager | Create/edit/import Buyers, Suppliers, Items, UOM mappings and Warehouses |
| Administrator | All operations, user setup, database management and connection settings |

The frontend hides or blocks unauthorized CRUD and bulk operations. A confirmed stock posting needs the Stock Posting role, separately from Data Entry. Master Manager and Data Entry can be combined, as can any other non-admin roles. Admin includes every permission.

**Security boundary:** Browser-local credentials, users and permission checks are **not a secure multi-device authentication system**. Any technically capable user with access to browser developer tools or to the actual workbook can bypass browser-side rules. User accounts are *not synchronized across browsers, devices or Google accounts*. Sharing a Google Sheet with Editor access bypasses app permissions. For real employees, deploy a trusted server-side identity and authorization service before treating these controls as secure. In the current Google Sheets connector, only app admins can initiate writes; Google Sheets itself controls underlying access.

## V1.3: Bulk upload for every source table

Every module has **Template** and (for authorized roles) **Bulk upload** actions. The sidebar includes a **Bulk Upload Center** with:

- All Masters, All Orders, Inward/Adjustments, Outward/Dispatch or one specific source table.
- Download a workbook containing matching **row 6 headers**, data-entry notes and a replaceable demonstration row.
- Upload a completed XLSX/CSV; map columns by matching header names, even if columns are reordered.
- Preview every row and receive errors before committing.
- Duplicate policy: **Skip existing** (default) or **Update existing** (subject to posting/locking rules).
- Preflight validation for linked IDs, SKU-specific UOM factors, quantities, negative stock, duplicate IDs, overallocations, status, and assigned user roles.
- Historical confirmed containers are staged before loading lines and confirmed last to preserve stock accuracy.
- Cloud writes use batched Sheets API requests rather than one request per spreadsheet cell or record. There is a 1,500-row/file limit and a 16 MB limit.

**Suggested upload sequence:** Buyer/Supplier/Warehouse/Item/UOM masters → PO headers → PO lines → Goods Receipts → Adjustments → Reservations → Containers → Dispatch lines. Use the grouped all-tables template for a single end-to-end import.

The upload preview is best-effort in Google Sheets mode; the app detects changes since preview, but Google Sheets does not provide an atomic inventory transaction system. Interrupted multi-batch uploads require reconciliation. Do not allow direct workbook editing by untrusted users.

## V1.3: Database Manager and workspaces

The admin-only **Database Manager** is designed to prevent confusion between testing, live data and previous workbooks.

- **New blank database** — clean tables.
- **Copy current data** — a separate local snapshot.
- **Fresh demonstration dataset** — separate test workspace.
- **Load previous Excel file** — imports legacy workbook source tabs into a **new local workspace**, never overwriting the currently selected one.
- **Registered Google Sheet** — reconnect an existing previously registered spreadsheet via Google OAuth.
- Database catalog with name, type, source, local creation date, last app update date, and source-record count.
- Table catalog with per-module record counts, **View**, **Template**, and **Upload** controls.
- An admin-only **quick workspace selector** appears in the application header.
- An active database name, source and app-observed timestamps remain displayed for all users.

**Time semantics:** Local database Created and Updated values reflect this app's local registry. Google Sheets Created/Updated are the time the app first registered the source and last handled an update. They are *not* the original Google Drive document created/modified timestamps; the configured Sheets-only OAuth scope does not provide those.

Workspaces and user accounts are local to one browser. You must explicitly export/import or migrate data when moving to another machine. A connected Google Sheet can be shared for data visibility, but a production multi-user auth gateway is still required for secure role enforcement.

## Browser and deployment notes

- Install via a static server or GitHub Pages; never open ES modules from \`file://\`.
- Google OAuth requires an authorized HTTPS origin, consent screen and Sheets API.
- Live local file access and direct auto-save require Chrome/Edge on HTTPS or localhost.
- Opening an old report/formula workbook for live editing is intentionally blocked: import it as a snapshot and save a **new** linked workbook.
- Never add passwords, OAuth client secrets or production data to this public GitHub repository.
- Run \`npm test\`; GitHub Actions checks all JavaScript modules plus the core and bulk tests.


## V1.4: Simplified daily navigation

For everyday end users, the sidebar contains only:

| Menu label | What users do |
| --- | --- |
| **Overview** | See open Buyer orders, pending items, overdue follow-ups, and shortage SKUs |
| **Buyer Orders** | Create a Buyer PO, add item lines, see Buyer-wise order status and partial fulfilment |
| **Requirements & Pending** | Filter by Buyer, see outstanding items, free stock and reserved stock, and reserve stock for an order |
| **Stock In** | Record goods received against Supplier purchase orders and check supplier-pending quantities |
| **Stock Out** | Reserve stock, create containers, enter manual loading, and confirm dispatch |
| **Stock Balance** | Check physical, reserved, available and incoming stock by item |
| **More Tools** | Masters, UOM conversion, raw registers, bulk imports, admin and data checks |

The header offers a **context-sensitive action button** so users never need to choose a raw transaction DocType during ordinary work. For example, Buyer Orders shows **New Buyer Order**, Stock In shows **Record Stock In**, and Stock Out shows **Plan Container**.

### Guided operations

1. Open Buyer Orders → **New Buyer Order**. Save the header; the **Add PO Item** form opens with its PO already selected.
2. Open Requirements & Pending → filter Buyer → **Reserve** for a specific outstanding order line. The selected line and base UOM are prefilled.
3. Review **Items to Purchase** on the same page; its shortage is calculated **once per SKU across all Buyers**. **Create Purchase** carries the preferred Supplier and SKU into a new Supplier purchase order and item line.
4. Open Stock In → a pending Supplier purchase line → **Record Inward**. The Supplier PO line is prefilled.
5. Open Stock Out → reserve as needed → plan a container → add loading lines against allocations → change container status to **Dispatched** when shipment is confirmed.

### Stock and outstanding rules

- Buyer pending = ordered base units − cancelled base units − **confirmed dispatched** base units.
- Reservations are commitments to an order line; **planned or loaded** containers do not deduct physical stock.
- Stock In counts only **accepted, posted** receipts.
- Stock Out counts only **Dispatched / Arrived** containers.
- Available stock = physical stock − open reservations.
- Purchase requirement (per SKU, all Buyers combined) = max(0, outstanding Buyer demand + min stock − physical stock − active Supplier pending).
- Never add quantities across unrelated UOMs. PCS, KG, MTR, CTN and other conversions remain SKU-specific.
- Free stock shown on several Buyer order lines is **shared** stock, not a guaranteed allocation per line; confirmation uses reservation-level validation.

Daily workflow pages are thin presentation layers over the existing validated records. Existing database tables and Excel/Google Sheets data layouts remain unchanged in this version. Advanced registers and import templates are still available from More Tools.

Run \`npm test\` to exercise existing transaction rules and the new Buyer-wise workflow tests.
