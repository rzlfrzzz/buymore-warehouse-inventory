-- Run as owner after migration 006. This database login is NOT an application role.
GRANT SELECT ON inspection_photos,inspections,master_imports TO buymore_app;
GRANT INSERT ON users,memberships,inspection_photos,inspections,master_imports TO buymore_app;
GRANT UPDATE(status,reviewed_by,reason,reviewed_at) ON inspections TO buymore_app;
REVOKE UPDATE,DELETE,TRUNCATE ON inspection_photos,master_imports FROM buymore_app;
REVOKE DELETE,TRUNCATE ON inspections,users,memberships FROM buymore_app;
