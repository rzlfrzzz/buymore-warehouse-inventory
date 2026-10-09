# Buymore Warehouse Inventory

React/Vite workspace with a TypeScript HTTP API, server-managed authentication, and transactional PostgreSQL stock-count/adjustment service. Business requirements remain in `docs`.

## Current business workflow

The production entry point is now the **two-role inspection workspace**: Admin maintains product masters, imports BigSeller XLSX/CSV master data, creates warehouse users, and reviews inspections. User sees read-only SKU/name and current stock, selects Admin-defined units, enters observed stock, and captures a live camera photo. There is no obsolete transaction menu for User.

**Provisional decisions for user review:** Admin approval remains required before official stock changes; User selects units but cannot change conversion. Official PO/SR templates now import master identities only, with detected headers and optional names; their transaction quantities never initialize stock. Actual customer product-master compatibility still awaits a sample. The importer supports explicit header mapping, preview, atomic validation, duplicate protection, and optional opening ledger stock only for SKUs without earlier warehouse movements.

Migration 006 converts legacy memberships deterministically (Head/Admin/System Admin -> Admin; Checker/Staff -> User), expires sessions, preserves all history, and adds private photos/inspections/import records. Run migrations without resetting data, then apply `deploy/inspection-grants.sql` and `deploy/catalog-tools-grants.sql` as database owner. Migration 007 adds private reference photos and safe global SKU archival without deleting history. For existing installations, also apply the additive `deploy/location-lock-grants.sql` as database owner: `UPDATE(id)` on `locations` allows `SELECT ... FOR UPDATE` without table-wide UPDATE permission. Fresh installations already receive this grant through `deploy/roles.sql`; do not rerun that role-creation script on existing installations. Admin can perform all valid-state legacy operations, including verifying their own documents; immutable posted records remain immutable.

See [current requirements, implementation, assumptions, migration and acceptance checks](docs/two-role-workspace.md). Earlier documents describe historical workflows only where explicitly superseded. Legacy transaction/report/export APIs remain Admin-only for continuity; the new main UI focuses on the requested business process.

## Connected UI and demo parity

The active entrypoint is `InspectionWorkspace`, backed by authenticated APIs and the original `ConnectedLayout` sidebar, typography, green hero, login composition and responsive navigation. It uses only Admin/User membership, never a mock role selector. Counts display actual loaded catalog data. Opening Stock count or Tinjau inspeksi refreshes the catalog and inspection history; successful master imports also clear the inspection search filter. Master-only imports add selectable products, not inspection records: a User must submit an inspection before it appears for review. Admin must enter an Alasan review for either Setujui or Tolak; clicking without a reason displays a validation message instead of silently disabling the action.

Admin can upload/remove warehouse reference photos and archive zero-stock SKUs with no pending work in any warehouse. User sees the reference photo when selecting a product; immutable inspection evidence remains separate. The Admin PO/SR export menu produces blank or filled official templates without photos. Filled exports use explicitly entered positive transaction quantities (PO purchase quantities with supplier/reference; SR reductions), **not absolute balances or automatic inspection adjustments**. Export does not change application stock or mark historical documents exported; verify SKU registration and avoid importing a file twice. Existing verified-document export job APIs remain unchanged.

## Prerequisites

Node.js 22.20+ and npm. PostgreSQL 17 is the preferred database. All development listeners bind localhost. Scripts read environment variables from the shell; they do not automatically load `.env` (Docker Compose does).

### PostgreSQL with Docker

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD`, then:

```powershell
docker compose up -d postgres
Set-Location backend
npm ci
$env:DATABASE_URL = 'postgresql://buymore:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/buymore'
npm run migrate
# Optional explicit development seed, never production:
$env:DEV_SEED = 'true'
$env:DEV_SEED_PASSWORD = 'YOUR_OWN_12_OR_MORE_CHARACTER_PASSWORD'
npm run seed:dev
Remove-Item Env:DEV_SEED_PASSWORD
npm run dev
```

The Compose database binds `127.0.0.1:5432` and stores data in `postgres_data`. Do not run `docker compose down -v` unless you intend to delete that data. For newly created accounts, `backend/src/seed.ts` maps `staff` to User and both `admin` and `head` to Admin, with membership only in `GDG-01`. It creates locations `A-01`/`A-02` and seeds 100 base units of `MAT-001` batch `LOT-01` only if that warehouse has no ledger entries. It also creates an unassigned `GDG-02` location for isolation checks. Seed does not reset existing passwords or memberships. Production users/memberships and opening ledger must be provisioned by an operator; there is no public signup or automatic production seed.

### Explicit local PGlite alternative

When PostgreSQL/Docker is unavailable, use the bundled development-only PostgreSQL WASM engine. It persists to `backend/.data/warehouse` when commands run from `backend`:

```powershell
Set-Location backend
npm ci
$env:DB_MODE = 'pglite'
$env:DEV_SEED = 'true'
$env:DEV_SEED_PASSWORD = 'YOUR_OWN_12_OR_MORE_CHARACTER_PASSWORD'
npm run seed:dev
Remove-Item Env:DEV_SEED_PASSWORD
npm run dev
```

Only one process may own this directory: stop the API before running seed/migrate against it. Restarting preserves users, sessions, counts, audit and ledger. `PGLITE_PATH` optionally selects another project-local directory. PGlite is explicitly rejected when `NODE_ENV=production`; it is not a multi-process PostgreSQL deployment.

### Frontend

In a second terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**, not `localhost` (the exact origin is checked). Vite proxies `/api` to `127.0.0.1:3001`. Sign in with the explicitly seeded password: use `staff` (User) to submit a stock inspection with a live photo, then `admin` or `head` (Admin) to review it with a reason. The browser never stores the session token in localStorage/sessionStorage. Set `APP_ORIGIN` on the API to the exact frontend origin if changing the port. Restart Vite after configuration changes.

## API and security

- `POST /api/login` `{username,password}`; `GET /api/session`; `POST /api/logout`.
- The active Admin/User inspection UI uses `/api/workspace/*` with role-specific permissions.
- Retained legacy APIs are Admin-only: reads `GET /api/master`, `/api/inventory`, `/api/counts`, `/api/counts/:id`; commands `POST /api/counts` `{location,correctionOf?}`, `/api/counts/:id/submit` and `/verify` `{lines:[{product,batch,quantity,reason?,explanation?}]}`, `/recount` and `/cancel` `{reason}`, `/approve` `{}`, and `POST /api/adjustments/:id/post` `{}`. This separate count/adjustment lifecycle is not the main inspection UI.
- Domain requests require `X-Warehouse` matching a current membership. Commands require `Idempotency-Key` (maximum 128 characters); persist/reuse that key when retrying an identical command. Keys are scoped by authenticated user and warehouse. The UI sends unique keys; after uncertain network errors, reload the count before retrying. It does not implement an offline/retry queue.
- JSON bodies are limited to 64 KiB and 500 lines. Unknown fields, invalid quantities/UUIDs and unsupported reasons are rejected. Errors use `{error}` with 400/401/403/404/409/413/415/429/500 statuses; database internals are not returned.
- Passwords use salted scrypt; 256-bit random session tokens are hashed in DB. Cookies are HttpOnly, SameSite=Strict, expire after eight hours, and become Secure with a `__Host-` name in production. Sessions also expire after 30 minutes without an authenticated request. Logout revokes the session and is idempotent after expiry; `/api/logout-all` revokes all sessions for the authenticated user. Disabled users and changed memberships take effect on the next request.
- Every mutation, including login/logout, requires exact trusted `Origin`; cross-site fetches are rejected. No permissive CORS. Login throttling persists in DB: 10 failed attempts per username or 100 per direct socket IP per 15-minute window. Successful login clears the username counter, not the IP counter, and does not increment either. Local development HTTP is loopback only.

Production requires PostgreSQL, `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and a same-origin HTTPS reverse proxy serving `frontend/dist` and forwarding `/api` to the localhost API. Build/start backend with `npm run build` / `npm start` (keep `migrations` alongside `dist`). Vite preview is not a production API deployment. Rate limiting uses the direct socket IP, intentionally not untrusted forwarded headers: behind a proxy it is shared across clients and requires deployment-specific trusted proxy/rate-limit configuration. See the production-hardening guide for deployment controls and remaining limitations.

## Validation

```powershell
Set-Location backend
npm test
npm run build
Set-Location ..\frontend
npm test
npm run build
```

Backend tests cover PGlite transactions and HTTP authentication/domain workflows. Frontend tests include inspection static rendering, DOM interactions, API services and retained legacy behavior; `npm run test:integration` in `frontend` runs the separate integration suite (backend dependencies required). These are coverage descriptions, not recorded execution results or proof of live-browser/camera behavior.

`backend/test/production-role.test.ts` is opt-in via `TEST_POSTGRES_URL` and otherwise skipped by `npm test`. Use only a **dedicated disposable PostgreSQL instance with an empty database and no existing `buymore_app` cluster role**, never development or production data. The connection needs owner/role-creation privileges and permission to `SET ROLE buymore_app`. The test applies migrations, `deploy/roles.sql` and all additive `*-grants.sql` scripts, then checks location locking and least-privilege grants, the retained count lifecycle, idempotent posting and ledger immutability under the runtime role. It leaves database objects and the role in place; discard the instance afterward and use a fresh one for reruns. CI defines a separate PostgreSQL 17 `production-role` job for this coverage; this does not establish general multi-connection concurrency coverage or claim a successful run.

## Structure

`backend/src/api.ts` HTTP/auth boundary; `auth.ts` password helpers; `runtime.ts` PostgreSQL/PGlite migrations; `workspace.ts` inspection APIs; `stock-count.ts` retained count/adjustment domain; `server.ts` localhost entry; `seed.ts` explicit development provisioning. `frontend/src/main.tsx` mounts `frontend/src/pages/InspectionWorkspace.tsx`, with `services/api.ts` handling HTTP. `ConnectedWorkspace.tsx`, the earlier `App.tsx` and demo screens are retained but are not the main entry. Fonts follow the existing design; offline fallbacks apply.

## Production hardening
Lihat [panduan deployment dan batas verifikasi](docs/production-hardening.md). Panduan ini menggantikan batas katalog/throttle/deployment lama; jangan memakai compose development untuk produksi.
