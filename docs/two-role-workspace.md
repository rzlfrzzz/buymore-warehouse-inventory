# Current business workflow: Admin and User

This document supersedes the former five-role operating model. The main application now opens the inspection workspace, not the legacy transaction menu.

## Logout and master-list regression fixes

The active entry remains `frontend/src/main.tsx` -> `InspectionWorkspace` with the original green/sidebar layout.

- Reproduced: logout previously required a still-valid session; after 30 minutes idle it returned 401 and left the UI signed in. Logout now revokes the supplied session and clears its cookie even after expiry or cookie removal. Origin checks remain mandatory; origin/network failures remain visible rather than pretending server logout succeeded.
- Reproduced: catalog rendering waited for inspection history in one `Promise.all`. A history error hid a successful catalog response. Resources now load independently, with labeled failures. Warehouse/session changes invalidate older responses and clear search, editor, import, capture and review state; master-only items do not require locations or stock to appear.
- Reproduced: delete was available only after selecting an existing SKU in the editor. Admin master rows now expose Edit and Hapus SKU directly, alongside the selected-item action and explicit confirmation. This still archives globally, preserves history, and rejects nonzero stock or unfinished work. User has no master actions.

Regression commands: frontend `npm test` exercises actual DOM clicks with jsdom; `npm run test:integration` additionally requires backend dependencies and runs real HTTP login/logout/re-login, Admin create/CSV import, User catalog visibility in the same warehouse, and archive against a fresh in-memory PGlite database. Backend `npx tsx --test test/logout.test.ts test/workspace.test.ts` covers expired cookies, origin rejection, permissions and archival guards. Fixtures close their own servers and databases; no live database or migrations are touched. These tests verify reproducible code defects, not a diagnosis of any particular live deployment. Existing installations must still apply the documented migration 006/007 runtime grants; failures are no longer masked by an empty master list.

## Reviewable assumptions (not approved business decisions)

1. User submits observed stock with a live photo. Official stock changes only after Admin approval. The user requested suggestions before final agreement; retain this safe provisional behavior until reviewed.
2. User chooses PCS or the product unit defined by Admin. User cannot edit unit names, conversion factors, SKU, or product names.
3. Product identity/name/conversion are shared catalog data, as in the existing schema. Admin membership authorizes shared master maintenance; inventory, user creation, photos and approvals remain scoped to the selected warehouse. Review whether separate per-warehouse product ownership is required.
4. A unit conversion with historical movements, legacy count lines, transaction lines, or inspections cannot be changed. Create a new SKU for a different base-unit meaning. Existing immutable ledger and posted history remain intact.

## Initial setup and BigSeller import

Provision the first Admin with the existing owner-controlled CLI (`ADMIN_ROLE=Admin`). Admin creates locations and users through the workspace. User creation requires a new username and a 16-256 character password; passwords are scrypt-hashed, never returned or stored in audit payloads. Creating users only grants membership to the currently authorized warehouse; it cannot attach an existing account from another warehouse.

Choose a BigSeller **product master export** or the supplied official **PO / SR template** filled with product rows, XLSX or CSV. Preview the first ten rows, map SKU/name and optional unit/quantity headers, explicitly select a default unit and PCS conversion. Default import mode is master-only: no fabricated stock. Optional opening stock requires a location, numeric nonnegative integer quantity, and no previous movement for that SKU in the warehouse. Opening quantities are converted to PCS. Every row must validate; duplicate SKUs fail in product-master imports, while identical PO/SR identities deduplicate without summing quantities, and all master/stock/audit/receipt writes commit atomically. Duplicate file checksums are rejected, while an identical retry key returns its original result. Limits: 2 MB encoded file input, 2,000 product rows, 100 columns, bounded XLSX expansion. SKU identifiers are text; leading zeros are preserved. Allowed SKU characters are ASCII letters (case preserved), digits, dot, dash and underscore, maximum 64 characters. Export SKU columns as text; numbers already rounded or zeros stripped in the source cannot be reconstructed. Import conversion is one explicitly chosen factor for the file; split different conversions into separate files or edit unused products individually.

The supplied files in `bigseller-format-ekspor-impor` remain unchanged. PO (51 columns) and SR (3 columns) headers are detected and validated. They import **master identities only**: purchase/reduction quantities cannot initialize stock. Preview auto-maps the SKU column; name is optional for these templates. Missing names preserve the existing name, or use the exact SKU as an explicitly temporary name that Admin can edit. Existing units remain unchanged for PO/SR imports. Remove example rows first; blank workbooks report no product rows. No customer product-master sample has been supplied.

## Catalog photos and deletion

Admin uploads/replaces/removes a JPEG or PNG reference image (maximum 2 MB) per SKU and warehouse. A selected product loads this reference privately on demand for any authenticated member of that warehouse; image bytes are not included in catalog listings. References are separate from immutable inspection evidence. Removing a reference never removes a historical inspection photograph.

Hapus SKU archives the global catalog entry rather than deleting ledger/history. The command locks the product and refuses nonzero balances in any warehouse, pending inspections, active reservations, unfinished operation documents or counts. New movements/evidence cannot use archived products. Clear stock and outstanding work first; global scope is shown before confirmation.

## Manual PO / SR export

Admin's Ekspor PO / SR menu downloads either a blank official workbook or a filled workbook with explicitly selected SKU and positive **transaction PCS quantities**. PO requires a supplier and temporary purchase reference and means purchase quantities, not counted stock or automatically inferred receipts. SR means intended stock reduction, never an absolute balance. The screen previews the selected SKU count and PCS total and requires acknowledgement. Workbooks preserve official headers/dropdown sheets and contain no photo columns or image media.

This is manual transfer, not a stock synchronizer: it does not mutate application stock, infer inspection deltas, claim BigSeller registration/import success, or mark inspection/legacy documents exported. Confirm SKU registration in BigSeller and never import a file twice. Filled exports use atomic audit/command receipts; identical retries return the same file. Legacy verified-document export jobs and their durable duplicate guards are unchanged.

## Inspections

User searches the read-only SKU/name list, selects location and existing batch, sees official PCS balance, selects Admin-defined unit, enters observed quantity, and captures a live camera frame. The UI uses `getUserMedia` with rear-camera preference and canvas JPEG capture. There is deliberately no gallery/file-upload fallback. Camera access requires HTTPS or localhost, browser permission, and actual camera hardware. API signature/size checks cannot prove the physical origin of a client-provided image; live-capture enforcement is a browser workflow, not device attestation.

Photos are persisted privately as database bytes (maximum 2 MB), authenticated by owner+warehouse; Admin can view evidence in their warehouse. User can see only their own inspection history. A photograph can be attached to only one inspection. Upload and inspection retries preserve identity. No public storage URL is exposed. Backup the database to retain evidence; no automatic evidence deletion is introduced.

Admin reviews the photo, supplies a reason, and approves or rejects. Approval locks the location, compares current balance with the inspection snapshot, checks legacy freezes/reserved-stock/nonnegative/integer guards, and appends a ledger delta in the same transaction as status, audit and retry receipt. Stale evidence must be rejected and re-inspected. The new inspection itself does not freeze an entire location. Posted evidence and inventory history cannot be edited or deleted. Legacy in-progress counts must be finished or cancelled before inspecting the location.

## Roles and migration

Run the normal migrations as database owner; **do not reset the database**. Migration 006 maps Head/Admin/System Admin to Admin and Checker/Staff to User, constrains memberships to the two new roles, invalidates existing sessions, and adds new tables/guards. Historical actor IDs and audit records are not rewritten. Users must sign in again. Migrations execute transactionally and are versioned.

Migration 007 adds warehouse reference photos, case-preserving SKU validation and archive safety guards. Apply `deploy/inspection-grants.sql` and `deploy/catalog-tools-grants.sql` as owner after migrations, in addition to existing grants. `buymore_app` is a limited PostgreSQL login, not an application Admin role. The existing `deploy/roles.sql` contains pre-existing local edits and was not overwritten by this implementation.

Only Admin can access the retained legacy operations/count/report/export APIs. Admin can create, submit, verify, approve, post and cancel permitted-state documents, including their own documents; former creator/verifier/approver segregation is explicitly superseded by the requested Admin-all-permissions model. State, warehouse, reservation, posted-history and immutable audit protections remain. User access is limited to the new catalog, private photo and inspection routes plus session/logout endpoints. The production InspectionWorkspace reuses ConnectedLayout and the original sidebar, green hero, typography, login composition and responsive navigation; no mock role selector or demo data is mounted.

## Validation and remaining acceptance checks

Run backend tests, backend build, frontend tests and frontend build. New HTTP tests cover role/scope boundaries, user creation, synthetic CSV/XLSX parsing, leading-zero SKUs, import rollback/retries, photo ownership, approval retries, stale evidence, unit history and immutable inspection history. Perform device camera acceptance over HTTPS and a real BigSeller master-export acceptance import in a nonproduction database before rollout. This is not a production-readiness or penetration-test certification.
