# Archived SKU reconciliation

Admin-only BigSeller MASTER import offers a separate, explicitly confirmed
`ARCHIVED_RECONCILE` mode. Opening stock and master-only retain their existing
behavior. PO/SR cannot reconcile. A nonempty reason and confirmation
`REACTIVATE ARCHIVED SKU` are mandatory.

Every SKU must already exist and be archived. Active, unknown, duplicate, invalid,
or blocked rows roll back the entire file, including reactivation and receipts.
Compatible master fields update; the existing historical unit/conversion trigger
still prohibits changing units with history.

The imported physical quantity multiplied by the conversion factor is the target
for the selected warehouse, selected location, and empty (no-batch) batch only.
Nonzero balances anywhere else are ambiguous and rejected, not reset. Pending
inspections, active reservations, unfinished operation documents and unfinished
count lines in any warehouse block global reactivation. An active legacy count
at the selected location also blocks it.

The import/archive advisory lock, location lock and exclusive product locks are
held in one transaction. Active-product triggers serialize new work against the
product locks. Reactivation precedes ledger insertion. Only target minus current
balance is appended: positive or negative; zero creates no movement. Historical
ledger, audit and command receipts are never deleted or overwritten. Audit records
include reason, original checksum, scope and per-SKU before/target/delta.

The same idempotency key and payload returns the original receipt; a changed
payload conflicts. A separate `archived-reconcile:` checksum namespace permits
one reconciliation per file per warehouse even if the original file was imported
before archive. Further new-key submissions of that reconciliation file conflict,
including after another archive cycle. Original import receipts remain intact.

No schema migration or live database mutation is required by this implementation.