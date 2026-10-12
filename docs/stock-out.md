# Stock Out

Stock Out is available in the active inspection workspace to Admins only. Users retain their existing inspection permissions; this feature does not grant User ledger writes or add an approval workflow.

- Production posts one negative movement. Transfer posts a negative source and positive destination movement in one transaction, with zero net change across warehouses.
- Transfer destinations are existing locations in other warehouses where the recorder has Admin membership. External/unmanaged warehouse transfers are not supported.
- SKU name and conversion are catalog snapshots. Quantity is a positive integer, in PCS or the catalog unit. Archived products, unknown batches, reserved stock and locations with active legacy stock counts are rejected.
- The actual taker is required text, separate from the authenticated recorder. Taken time is entered in the device timezone and submitted with an explicit offset/UTC. Recorded time is assigned by the database. History displays device-local times with timezone information.
- Headers, movement links, ledger and audit events are immutable. Command receipts make identical retries safe; reuse with different input returns 409. Location locks are acquired in deterministic order. Existing database ledger guards remain in force; a deferred constraint validates complete linked movements at commit.
- History returns the latest 200 outgoing records for the selected source warehouse. The destination balance changes immediately, but the source owns the outgoing history.

## Deployment

Back up and follow the existing owner-run migration process. Migration 010 must run before the new production server starts (schema gate 10). For an existing database, apply `deploy/stock-out-grants.sql` as owner after migration. Fresh deployments use the updated `deploy/roles.sql` in addition to existing inspection/catalog grants. Do not run migrations using the restricted application role.

No live database migration is performed during implementation. PGlite tests are isolated; they do not replace a PostgreSQL concurrency or restricted-role deployment smoke test. The two transfer warehouses must be represented by existing memberships and locations; this feature creates neither.

API: Admin-only GET/POST `/api/workspace/stock-outs`, selected warehouse via `X-Warehouse`, POST requires `Idempotency-Key`. POST fields: `product`, `location`, `batch`, `unit`, `quantity`, `purpose` (`PRODUCTION` or `TRANSFER`), `taker`, `takenAt` (ISO timestamp with timezone); transfers additionally require `destinationWarehouse` and `destinationLocation`.