-- Run as database owner for existing installs; supplements roles.sql.
-- SELECT FOR UPDATE requires UPDATE on at least one column.
GRANT UPDATE(id) ON locations TO buymore_app;