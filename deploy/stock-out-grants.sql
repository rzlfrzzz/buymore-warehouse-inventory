-- Run as database owner after migration 010, for existing and new installations.
GRANT SELECT,INSERT ON stock_outs,stock_out_movements TO buymore_app;
-- SELECT FOR SHARE requires UPDATE privilege on at least one column.
GRANT UPDATE(user_id) ON memberships TO buymore_app;