-- Run as database owner. Set runtime password separately using psql password command.
CREATE ROLE buymore_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO buymore_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO buymore_app;
GRANT INSERT,UPDATE ON sessions,login_attempts,products,product_batches,stock_counts,stock_count_lines,adjustments TO buymore_app;
GRANT DELETE ON sessions,login_attempts TO buymore_app;
GRANT INSERT ON inventory_ledger,adjustment_lines,audit_events,security_events,command_receipts TO buymore_app;
REVOKE UPDATE,DELETE,TRUNCATE ON inventory_ledger,adjustment_lines,audit_events,security_events,command_receipts FROM buymore_app;
