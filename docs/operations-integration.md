# Connected warehouse operations

## Architecture and data flow

`frontend/src/pages/ConnectedWorkspace.tsx` is the authenticated operations workspace. It integrates receiving, issue, reports, export readiness, settings, inventory and the original count workflow in `CountWorkspace.tsx`. The browser uses the existing session cookie and warehouse header; roles and warehouse membership are resolved by the server, never accepted from request payloads. No BigSeller credentials or direct API integration are used.

`backend/src/api.ts` dispatches `/api/operations/*` to `operations.ts`. PostgreSQL remains the source of truth. Migration `004-operations.sql` adds operational documents and lines, warehouse suppliers/settings, reservations, and export job infrastructure without deleting inventory or count data. Products, batches, locations, authentication, inventory ledger, audit events and count adjustments are shared with the existing application.

1. Head creates warehouse suppliers and configures warehouse-specific BigSeller SKU mappings with explicit registered confirmation. Global tracking and unit conversion are immutable through this API; changes require separately authorized catalog administration.
2. A Checker creates a multi-line receiving or issue draft with document and actual quantities. Quantities are integer units, converted using the product's configured factor; PCS is base quantity. Each line is validated against the warehouse location and product/batch configuration.
3. Submission marks the document pending. Pending issues reserve available stock with location locks. Reservations do not change physical stock. Rejection releases reservations.
4. A different authorized actor verifies: Admin or Head for receiving, Admin for issue. Verification consumes an issue's reservations and inserts actual base quantity movements into the central ledger in the same transaction. Draft/submitted documents never change on-hand stock.
5. The ledger guard serializes location changes, prevents negative/over-reserved stock and honors active stock-count freezes. Count adjustments use the same guard; a downward adjustment cannot consume reserved stock.
6. Idempotency receipts and audit writes commit with operation mutations. The frontend retains a key for a retried request. Reports read the committed ledger immediately; the active operational UI periodically refreshes and also reloads after changes.

## API and settings

All routes below are under `/api/operations`; warehouse membership is required. Mutations require the existing origin checks, session and idempotency header.

- `GET /master`: active products, warehouse locations/suppliers and settings.
- `GET/POST /documents`: bounded paginated listing or draft creation; POST `/:id/submit`, `/:id/verify`, `/:id/reject` performs a transition.
- `GET /reports?kind=stock|activity`: paginated central data. Stock is lifetime on-hand, with reservations/availability; date and actor filters apply only to activity, not physical balances. Activity includes ledger postings and count adjustments. Product/location filters narrow both reports. Activity accepts `from`, `to`, `actor`.
- `GET /reports?...&format=csv`: the currently requested page, not an unbounded full export. Cells are quoted and spreadsheet formula prefixes escaped. This is a report CSV, NOT a BigSeller import file.
- `GET/PATCH /settings`: warehouse report page size (1-500), default report window (1-365 days), supported CSV delimiter and external warehouse display name. Unknown writable keys are rejected. Admin/Head may update settings.
- `POST /suppliers`: Head creates a warehouse supplier.
- `PATCH /products/:id`: Head updates only `bigsellerSku` and `bigsellerRegistered` in the active warehouse. Global product definitions cannot be mutated.
- `/exports`: Head-only creation/listing and checksum-verified downloads. `GET /exports/eligible?type=PO|SR` lists up to 200 unclaimed eligible documents.

The document and export list indexes support warehouse-scoped pagination. Active reservations have a partial lookup index. Keep deployment-specific volume/load testing separate from functional validation.

## BigSeller template-backed export

Set BIGSELLER_TEMPLATE_DIR to an operator-controlled directory containing original, unmodified official workbooks named impor_pesanan_pembelian_in.xlsx and impor_daftar_pengurangan_stok_in.xlsx. Templates are deployment assets, not synthesized from incomplete documentation. No original workbook is included here.

The server loads templates with ExcelJS, validates exact known headers at documented positions, 51 PO or 3 SR columns, and the PO dropdown sheet. Unknown header text, column definitions, supporting sheets, styles and supported data validations are retained; example row values are cleared. ExcelJS does not guarantee preservation of every proprietary Excel extension: deployment acceptance must compare original/output workbooks and actual BigSeller imports. Readiness is computed from files, never a writable confirmation flag. The UUID document ID is the stable PO number; supplier reference is the note. Production date is blank because it is not captured. BASE_ONLY quantities are actual base units, not document quantities.

PO groups by receiving/SKU/batch; SR groups by SKU across issues and wholly negative POSTED adjustments. Mixed-sign or positive adjustments fail closed rather than inventing purchase orders or silently dropping positive lines. Serial and MULTI_UNIT export are not exposed. At most 200 whole documents and 10,000 grouped rows are accepted per job; oversized requests must select fewer whole documents.

A single transaction locks selected documents in sorted order, validates warehouse/status/registered mappings, generates bytes, saves SHA-256 and source-line snapshots, acquires unique claims and writes the audit/idempotency receipt. Any failure rolls back everything. Retrying the same idempotency key returns the same job; another key cannot claim its documents. Downloads use stored bytes, not regenerated workbooks, and verify checksums. READY means generated, not accepted by BigSeller. Claimed source documents remain VERIFIED/POSTED and disappear from eligible selection. There is intentionally no automatic release or re-export on a reported import error, avoiding duplicate external imports.

Only remaining deployment gates for generating supported exports are supplying the original workbooks and completing document 08's BigSeller acceptance checks. Synthetic test workbooks validate mechanics only, not official compatibility.

## Deployment and validation

Back up the database before migration. Run migrations as the owner, not the restricted application account. Existing production databases must receive migrations 004 and 005 before the new server starts. Apply the additional grants in `deploy/roles.sql`; that file's initial CREATE ROLE statement is for initial setup, so do not blindly rerun it against an existing role. No live database was modified to validate this work.

From `backend`:

```powershell
npm run migrate
npm run build
npm test
npm run format:check
npm audit --audit-level=moderate
```

Provision a Checker with the existing provisioning command by setting `ADMIN_ROLE=Checker` alongside `ADMIN_USERNAME`, `ADMIN_PASSWORD` (16-256 characters), and `ADMIN_WAREHOUSE`, then run `npm run provision:admin`. Keep credentials out of source control and shell history where possible. The command name is retained for compatibility; the default role remains Head.

From `frontend`:

```powershell
npm run build
npm test
npm run format:check
npm audit --audit-level=moderate
```

`backend/test/operations.test.ts` runs HTTP against an isolated in-memory PGlite database, exercising transitions, reservations, reports, permissions, settings, template-backed creation, retry/duplicate claims, downloads and fail-closed rejection. `backend/test/bigseller.test.ts` checks synthetic workbook grouping, text SKU preservation, styles, dropdowns and unknown headers. Existing count/auth/hardening tests remain enabled. This is not a substitute for concurrent multi-connection PostgreSQL load tests, browser accessibility checks, deployment rehearsal, or BigSeller import acceptance. See `production-hardening.md` for the unchanged production checklist.

## First data entry (existing database, no reset)

Sign in with an actual warehouse membership; no demo data or role switching is used.

1. **Head** opens Ringkasan (or Pengaturan) and uses **Master data awal** to create products and warehouse locations. Choose document UOM, its base-unit multiplier, and batch/expiry tracking at creation; these global catalog properties are immutable. Products and batches are global, locations and suppliers are warehouse-scoped. A product without batch tracking receives its empty batch atomically.
2. **Head** creates tracked batches with required expiry and adds a supplier from Ringkasan or Pengaturan. Checker receiving also registers new batches through the existing guarded transaction. Configure warehouse BigSeller SKU mappings in Pengaturan before exports.
3. **Checker** opens Penerimaan, chooses the supplier, product and location, enters document/actual quantities (and batch/expiry if tracked), saves the draft and submits it. **Admin/Head** verifies it; only verification posts stock. Head does not impersonate Checker to enter transactions.
4. **Staff** starts Stock count for a configured location and enters blind quantities. Follow the existing separate approval/posting workflow.

New Head-only endpoints are `POST /api/operations/products`, `/locations`, and `/batches`. They require authenticated warehouse membership, origin validation and an idempotency key; catalog writes, audit and receipt are atomic. Duplicate identifiers return conflict rather than overwrite.

No migration or database reset is required for these entry forms. For an existing restricted production runtime role, the database owner must apply `GRANT INSERT ON locations TO buymore_app;` once (also included in deploy/roles.sql for new installations). Do not rerun CREATE ROLE on an existing role. Tests migrate only isolated PGlite fixtures, never the user's database.

### Original BigSeller templates

The backend defaults to the repository's `bigseller-format-ekspor-impor` directory, resolved relative to the source/built module rather than the shell working directory. Keep the original `impor_pesanan_pembelian_in.xlsx` and `impor_daftar_pengurangan_stok_in.xlsx` unchanged. An explicit `BIGSELLER_TEMPLATE_DIR` overrides this default; missing/invalid override files fail closed and do not silently use the repository copies.

Production Compose mounts this directory read-only at `/app/bigseller-templates`. Copy the original directory alongside docker-compose.production.yml on deployment, or set host `BIGSELLER_TEMPLATE_DIR` to its absolute location. The API container receives the fixed mounted path. Standalone backend images must mount/provide originals and set the variable explicitly. Do not reset volumes. Header/workbook regression tests cover both actual originals, but BigSeller's external importer acceptance still requires an operator smoke test.
