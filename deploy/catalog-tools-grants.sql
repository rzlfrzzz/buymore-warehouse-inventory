-- Run as database owner after migrations 006 and 007; supplements roles.sql.
GRANT SELECT,INSERT,UPDATE,DELETE ON product_reference_photos TO buymore_app;
GRANT SELECT,INSERT ON inspection_photos,master_imports TO buymore_app;
GRANT SELECT,INSERT,UPDATE ON inspections,users,memberships TO buymore_app;
