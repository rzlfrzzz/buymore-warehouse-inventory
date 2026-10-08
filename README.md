# Buymore Warehouse Inventory

React/Vite workspace with a TypeScript HTTP API, server-managed authentication, and transactional PostgreSQL stock-count/adjustment service. Business requirements remain in `docs`.

## Integrated scope

The default frontend is now the connected workspace, not the role-switching browser demo. It supports real login/logout, authorized warehouse selection, blind count creation/submission, additional discovered products, recount requests, variance reasons, Admin verification, Head count approval, separate adjustment posting, cancellation, corrections linked to completed counts, and read-only inventory/location/product data.

Staff only sees their assigned counts; system quantities, inventory balances and adjustments are not sent to Staff. Roles and warehouse memberships come from database records, never request bodies or browser role selectors. Approval with no variance completes the count without adjustment; variance approval alone does not change inventory. Posting does.

Receiving and issue documents, stock/activity reports, warehouse settings, supplier creation, and existing product configuration are integrated with the authenticated central backend. Checker-created documents post only upon authorized verification; pending issues reserve stock and share count freezes and ledger protections. The original count workflow remains available. See [operations architecture, data flow, rollout and limitations](docs/operations-integration.md).

The BigSeller page creates durable template-backed XLSX exports with atomic document claims and checksum-verified downloads. Deploy original official workbooks through `BIGSELLER_TEMPLATE_DIR`; missing or invalid templates fail closed without claims. Real BigSeller import acceptance remains a deployment gate. Uploads, full master/user CRUD and shift scheduling remain outside the integrated scope. Existing localStorage demo data is untouched and never loaded into the connected workspace. Count lists show the latest 200 authorized documents.

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

The Compose database binds `127.0.0.1:5432` and stores data in `postgres_data`. Do not run `docker compose down -v` unless you intend to delete that data. The seed creates `staff`, `admin`, `head` with their respective roles and membership only in `GDG-01`, locations `A-01`/`A-02`, and 100 base units of `MAT-001` batch `LOT-01`. It also creates an unassigned `GDG-02` location for isolation checks. Seed does not reset existing passwords. Production users/memberships and opening ledger must be provisioned by an operator; there is no public signup or automatic production seed.

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

Open **http://127.0.0.1:5173**, not `localhost` (the exact origin is checked). Vite proxies `/api` to `127.0.0.1:3001`. Sign in with the explicitly seeded password. Use Staff to start/submit, logout and use Admin to verify/recount, then Head to approve and separately post. The browser never stores the session token in localStorage/sessionStorage. Set `APP_ORIGIN` on the API to the exact frontend origin if changing the port. Restart Vite after configuration changes.

## API and security

- `POST /api/login` `{username,password}`; `GET /api/session`; `POST /api/logout`.
- Protected reads: `GET /api/master`, `/api/inventory` (Admin/Head), `/api/counts`, `/api/counts/:id`.
- `POST /api/counts` `{location,correctionOf?}`; `/api/counts/:id/submit` and `/verify` `{lines:[{product,batch,quantity,reason?,explanation?}]}`; `/recount` and `/cancel` `{reason}`; `/approve` `{}`; `POST /api/adjustments/:id/post` `{}`.
- Domain requests require `X-Warehouse` matching a current membership. Commands require `Idempotency-Key` (maximum 128 characters); persist/reuse that key when retrying an identical command. Keys are scoped by authenticated user and warehouse. The UI sends unique keys; after uncertain network errors, reload the count before retrying. It does not implement an offline/retry queue.
- JSON bodies are limited to 64 KiB and 500 lines. Unknown fields, invalid quantities/UUIDs and unsupported reasons are rejected. Errors use `{error}` with 400/401/403/404/409/413/415/429/500 statuses; database internals are not returned.
- Passwords use salted scrypt; 256-bit random session tokens are hashed in DB. Cookies are HttpOnly, SameSite=Strict, expire after eight hours, and become Secure with a `__Host-` name in production. Logout deletes the session. Disabled users and changed memberships take effect on the next request.
- Every mutation, including login/logout, requires exact trusted `Origin`; cross-site fetches are rejected. No permissive CORS. Login throttling persists in DB (10 attempts per IP or username per 15 minutes, including successful logins). Local development HTTP is loopback only.

Production requires PostgreSQL, `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and a same-origin HTTPS reverse proxy serving `frontend/dist` and forwarding `/api` to the localhost API. Build/start backend with `npm run build` / `npm start` (keep `migrations` alongside `dist`). Vite preview is not a production API deployment. Rate limiting uses the direct socket IP, intentionally not untrusted forwarded headers: behind a proxy it is shared across clients and requires deployment-specific trusted proxy/rate-limit configuration. Password reset, MFA, account administration, audit-read API, session management UI, monitoring, backup/restore and full production deployment hardening are outside this scope.

## Validation

```powershell
Set-Location backend
npm test
npm run build
Set-Location ..\frontend
npm test
npm run build
```

Backend tests run actual PGlite SQL transactions and an ephemeral localhost HTTP listener, exercise authentication failures, trusted-origin rejection, roles, warehouse/owner isolation, blind payloads, input validation, session expiry/logout, throttling, recount/verify/approve/post/cancel, retry receipts, rollback/immutability, and close/reopen disk persistence. Test directories are project-local and removed after successful runs. Existing frontend tests cover the retained legacy demo domain, not browser UI automation.

Verified in this environment: backend 4 tests passed, frontend 17 tests passed, both builds, compiled API health and Vite proxy health. Docker/psql are unavailable here, so real PostgreSQL multi-connection locking remains unverified. Integrated browser tools have no connected client; interactive browser login was not executed. HTTP login/workflow integration is tested end-to-end with cookie handling.

## Structure

`backend/src/api.ts` HTTP/auth boundary; `auth.ts` password helpers; `runtime.ts` PostgreSQL/PGlite migrations; `stock-count.ts` transactional domain; `server.ts` localhost entry; `seed.ts` explicit development provisioning. `frontend/src/pages/ConnectedWorkspace.tsx` is the active application, with `services/api.ts` handling HTTP. The earlier `App.tsx` and demo screens are retained but not routed. Fonts follow the existing design; offline fallbacks apply.

## Production hardening
Lihat [panduan deployment dan batas verifikasi](docs/production-hardening.md). Panduan ini menggantikan batas katalog/throttle/deployment lama; jangan memakai compose development untuk produksi.
