-- Run as owner after migration 009 for existing installations.
GRANT SELECT,INSERT,UPDATE ON user_pins TO buymore_app;
-- Required by the enrollment SELECT FOR UPDATE; no password write access.
GRANT UPDATE(id) ON users TO buymore_app;