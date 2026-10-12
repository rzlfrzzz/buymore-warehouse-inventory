# Stock Out

Stock Out and Ringkasan are available under WORKSPACE in the active InspectionWorkspace to User employees and Admins. Either role can record production directly; this does not grant access to other Admin operations or arbitrary ledger writes.

- Production posts one negative movement. Transfer posts a negative source and positive destination movement in one transaction, with zero net change across warehouses.
- Transfer destinations are existing locations where the recorder has User or Admin membership in both warehouses. Memberships are revalidated and share-locked inside the posting transaction, before idempotency receipt lookup, including retries. Destination catalogs exclude unapproved warehouses; history hides destination identifiers when destination membership is absent. External/unmanaged warehouse transfers are not supported.
- SKU name and conversion are catalog snapshots. Quantity is a positive integer, in PCS or the catalog unit. Archived products, unknown batches, reserved stock and locations with active legacy stock counts are rejected.
- The actual taker is required text, separate from the authenticated recorder. Taken time is entered in the device timezone and submitted with an explicit offset/UTC. Recorded time is assigned by the database. History displays device-local times with timezone information.
- Headers, movement links, ledger and audit events are immutable. Command receipts make identical retries safe; reuse with different input returns 409. Location locks are acquired in deterministic order. Existing database ledger guards remain in force; a deferred constraint validates complete linked movements at commit.
- History returns the latest 200 outgoing records for the selected source warehouse. The destination balance changes immediately, but the source owns the outgoing history.

## Deployment

Back up and follow the existing owner-run migration process. Migration 010 must run before the new production server starts (schema gate 10). For an existing database, apply `deploy/stock-out-grants.sql` as owner after migration. Fresh deployments use the updated `deploy/roles.sql` in addition to existing inspection/catalog grants. Do not run migrations using the restricted application role.

No live database migration is performed during implementation. PGlite tests are isolated; they do not replace a PostgreSQL concurrency or restricted-role deployment smoke test. The two transfer warehouses must be represented by existing memberships and locations; this feature creates neither.

API: User/Admin GET/POST `/api/workspace/stock-outs`, selected warehouse via `X-Warehouse`, POST requires `Idempotency-Key`. POST fields: `product`, `location`, `batch`, `unit`, `quantity`, `purpose` (`PRODUCTION` or `TRANSFER`), `taker`, `takenAt` (ISO timestamp with timezone); transfers additionally require `destinationWarehouse` and `destinationLocation`.

## Ringkasan and search

GET `/api/workspace/stock-out-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&search=...` returns server aggregates for the authorized current source warehouse. Defaults to today and the preceding 29 days. Date boundaries use UTC taken time, with inclusive final date. Counts and PCS totals include all matching records, split into production and transfer; the material list is explicitly limited to the top 200 SKU/name groups. Search matches taker, SKU, snapshotted name and purpose. Totals are not calculated from the latest-200 history list.

Stock Out provides SKU/name material selection search and taker/SKU/name/purpose filtering within the latest 200 outgoing records. Operational history includes other recorders in the same warehouse, never other source warehouses.

## Product photos

ProductThumbnail and `/api/workspace/thumbnails/:product` use only warehouse-specific Admin-uploaded reference photos. Missing or removed references show a placeholder even when inspection evidence exists. There is no evidence fallback or automatic promotion. Admins manage default/reference photos in Master & impor after selecting a product; Users cannot upload, replace or remove references. Inspection review separately labels actual historical captures as Bukti inspeksi. Stock Out and Ringkasan currently show text-only materials.