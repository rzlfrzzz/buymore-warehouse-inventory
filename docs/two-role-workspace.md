# Current business workflow: Admin and User

This document supersedes the former five-role operating model. The main application now opens the inspection workspace, not the legacy transaction menu.

## Reviewable assumptions (not approved business decisions)

1. User submits observed stock with a live photo. Official stock changes only after Admin approval. The user requested suggestions before final agreement; retain this safe provisional behavior until reviewed.
2. User chooses PCS or the product unit defined by Admin. User cannot edit unit names, conversion factors, SKU, or product names.
3. Product identity/name/conversion are shared catalog data, as in the existing schema. Admin membership authorizes shared master maintenance; inventory, user creation, photos and approvals remain scoped to the selected warehouse. Review whether separate per-warehouse product ownership is required.
4. A unit conversion with historical movements, legacy count lines, transaction lines, or inspections cannot be changed. Create a new SKU for a different base-unit meaning. Existing immutable ledger and posted history remain intact.

## Initial setup and BigSeller import

Provision the first Admin with the existing owner-controlled CLI (`ADMIN_ROLE=Admin`). Admin creates locations and users through the workspace. User creation requires a new username and a 16-256 character password; passwords are scrypt-hashed, never returned or stored in audit payloads. Creating users only grants membership to the currently authorized warehouse; it cannot attach an existing account from another warehouse.

Choose a BigSeller **product master export**, XLSX or CSV. Preview the first ten rows, map SKU/name and optional unit/quantity headers, explicitly select a default unit and PCS conversion. Default import mode is master-only: no fabricated stock. Optional opening stock requires a location, numeric nonnegative integer quantity, and no previous movement for that SKU in the warehouse. Opening quantities are converted to PCS. Every row must validate, duplicate SKUs fail, and all master/stock/audit/receipt writes commit atomically. Duplicate file checksums are rejected, while an identical retry key returns its original result. Limits: 2 MB encoded file input, 2,000 product rows, 100 columns, bounded XLSX expansion. SKU identifiers are text; leading zeros are preserved. Allowed SKU characters currently follow the pre-existing uppercase ASCII/digit/dot/dash/underscore schema, maximum 64 characters. Export SKU columns as text; numbers already rounded or zeros stripped in the source cannot be reconstructed. Import conversion is one explicitly chosen factor for the file; split different conversions into separate files or edit unused products individually.

The supplied files in `bigseller-format-ekspor-impor` are PO and stock-reduction transaction templates, **not a master export**. They are unchanged. Parser and import tests use explicitly synthetic examples; compatibility with an actual customer master export remains to be verified. Known transaction headers are rejected with a clear error. No claim is made that official master headers have been validated.

## Inspections

User searches the read-only SKU/name list, selects location and existing batch, sees official PCS balance, selects Admin-defined unit, enters observed quantity, and captures a live camera frame. The UI uses `getUserMedia` with rear-camera preference and canvas JPEG capture. There is deliberately no gallery/file-upload fallback. Camera access requires HTTPS or localhost, browser permission, and actual camera hardware. API signature/size checks cannot prove the physical origin of a client-provided image; live-capture enforcement is a browser workflow, not device attestation.

Photos are persisted privately as database bytes (maximum 2 MB), authenticated by owner+warehouse; Admin can view evidence in their warehouse. User can see only their own inspection history. A photograph can be attached to only one inspection. Upload and inspection retries preserve identity. No public storage URL is exposed. Backup the database to retain evidence; no automatic evidence deletion is introduced.

Admin reviews the photo, supplies a reason, and approves or rejects. Approval locks the location, compares current balance with the inspection snapshot, checks legacy freezes/reserved-stock/nonnegative/integer guards, and appends a ledger delta in the same transaction as status, audit and retry receipt. Stale evidence must be rejected and re-inspected. The new inspection itself does not freeze an entire location. Posted evidence and inventory history cannot be edited or deleted. Legacy in-progress counts must be finished or cancelled before inspecting the location.

## Roles and migration

Run the normal migrations as database owner; **do not reset the database**. Migration 006 maps Head/Admin/System Admin to Admin and Checker/Staff to User, constrains memberships to the two new roles, invalidates existing sessions, and adds new tables/guards. Historical actor IDs and audit records are not rewritten. Users must sign in again. Migrations execute transactionally and are versioned.

Apply `deploy/inspection-grants.sql` as owner after migration 006, in addition to existing grants. `buymore_app` is a limited PostgreSQL login, not an application Admin role. The existing `deploy/roles.sql` contains pre-existing local edits and was not overwritten by this implementation.

Only Admin can access the retained legacy operations/count/report/export APIs. Admin can create, submit, verify, approve, post and cancel permitted-state documents, including their own documents; former creator/verifier/approver segregation is explicitly superseded by the requested Admin-all-permissions model. State, warehouse, reservation, posted-history and immutable audit protections remain. User access is limited to the new catalog, private photo and inspection routes plus session/logout endpoints. The old UI modules remain for history/regression reference but are not the production entry point.

## Validation and remaining acceptance checks

Run backend tests, backend build, frontend tests and frontend build. New HTTP tests cover role/scope boundaries, user creation, synthetic CSV/XLSX parsing, leading-zero SKUs, import rollback/retries, photo ownership, approval retries, stale evidence, unit history and immutable inspection history. Perform device camera acceptance over HTTPS and a real BigSeller master-export acceptance import in a nonproduction database before rollout. This is not a production-readiness or penetration-test certification.
