# Optional employee PIN login

Employees may sign in with username and a six-digit PIN instead of their password.
Passwords remain valid. There is no default PIN. Only accounts with at least one
membership and exclusively User memberships may enroll or use PINs; an Admin
membership in any warehouse disables PIN access immediately.

The active entry point, frontend/src/main.tsx, renders InspectionWorkspace.
Its login offers explicit **Password** / **PIN** buttons; both require a username.
Switching methods clears credentials. PIN login is available without a frontend
role check; the backend enforces eligibility.

In the active inspection workspace, eligible users open the collapsed
**Akun saya / Atur PIN login** account section and enter the current
password, new PIN, and confirmation. This also resets an existing PIN. Leading
zeros are significant. PINs are exact ASCII digit strings, never numbers, and
are stored only as individually salted scrypt hashes in user_pins.

POST /api/login accepts username and exactly one of password or pin.
POST /api/account/pin requires an active session, trusted origin, password and pin.
Login failures use the same generic response for absent, disabled or ineligible
accounts. Missing PINs use dummy scrypt verification. Cookies, session expiry,
origin validation and security-event logging are unchanged; secrets are not logged.

Both password and PIN login now share a persisted five-failure per-username
15-minute window (including bad enrollment passwords). Login also retains the
100-failure IP window. Switching methods cannot bypass a lockout. Enrollment
does not clear counters. Successful login clears the username counter only.

Deployment: back up the database, run the existing migration command as the owner
to apply migration 009, then apply deploy/pin-login-grants.sql for existing
buymore_app installations. Fresh role setup uses deploy/roles.sql. Production
startup requires schema version 9. Do not run migrations under the runtime role.
No live migration is performed by this code change. Users promoted then demoted
retain their previously enrolled PIN; reset it if account access is in doubt.