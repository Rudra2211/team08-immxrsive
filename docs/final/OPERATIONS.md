# Operational note (Final Release)

## Deployment

| Part | Where | How it is deployed |
|---|---|---|
| Frontend: static HTML/CSS/JS, no build step | Render Static Site `team08-r1-frontend`, https://team08-r1-frontend.onrender.com | Render → Manual Deploy → Deploy latest commit (`main`). Publish directory `frontend/`. |
| API: Node 18+ / Express | Render Web Service `team08-r1-backend`, https://team08-r1-backend.onrender.com | Same. Start command `npm start` in `backend/`. |
| Database: PostgreSQL | Supabase (session pooler) | `schema.sql`, then `schema_r2.sql` … `schema_final.sql`, run on every boot. They are additive and idempotent. |

- The only browser-side configuration is `frontend/config.js`, which holds just the API URL (F.23).
- After the first deploy of a release, staff run the legacy import once from **Records, claims and recovery** (`MIGRATION.md`).
- Rolling back means choosing an earlier deploy in Render. The schema changes only add things, so the previous build runs against the newer schema.

### Server environment variables (Render only, never committed)

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_SSL` | Database connection |
| `CORS_ORIGIN`, `FRONTEND_URL`, `APP_BASE_URL` | Cross-origin cookie session |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in |
| `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` | Verification email |
| `SEED_ON_BOOT` | Loads the Release 1 fixture into an empty database |
| `STAFF_USERNAME`, `STAFF_PASSWORD` | The staff test account. The password is stored as a salted scrypt hash at boot. |

## External dependencies and what happens when they fail (F.30, F.31)

| Dependency | Used for | On failure |
|---|---|---|
| GitHub OAuth | Student sign-in | The account page shows the error and the visitor can retry. Public pages need no sign-in. |
| Brevo email | Verification codes | "Could not issue a verification code", with retry. Logged as `verification_delivery_failed`. |
| GitHub REST API (unauthenticated) | Optional project import | "GitHub could not be reached… enter the project manually". Logged as `github_import_failed`. |
| Company websites | Optional partner import (R4) | A readable error and manual entry. The form keeps what was typed. Logged as `company_import_failed`. |
| Student demo, video and image URLs | Project evidence | A demo opens in a new tab and never runs inside our page. A broken image is replaced by text. Maintainers can mark a demo unavailable, archived or replaced. |
| Supabase | All data | `/health` returns 503 and pages show "could not load… please retry". |

## Diagnostics (F.32)

- **Staff screen:** `/admin-records.html` → **Diagnostics**. It shows:
  - **Recent errors**: every API response with status ≥ 500 (method, path, status, time) and every failed integration (kind, context such as the repository slug or source URL, message);
  - **Record changes**: every ownership change, claim decision, merge, maintainer change, status change and batch archive (who, when, from, to, note).
- **API:** `GET /api/staff/diagnostics` (staff only: 401 or 403 otherwise).
- **Never recorded:** passwords, verification codes, session ids, cookies, request bodies or email addresses.
- **Process logs:** Render → service → Logs. These are timestamped `console.error` lines naming the route that failed.
- **Liveness:** `GET /health` returns the database state and the student count.
