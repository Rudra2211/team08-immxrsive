# Team 08 — ImmXrsive Talent & Industry Platform (Release 1)

COSC-3506-F03-26F · Project 1 · Team 08 — Rudra, Nihar, Hemil

Public talent discovery: an employer can find a student, inspect the project
evidence behind the match, and start an inquiry without creating an account.

  
## Live links
- Frontend: https://team08-r1-frontend.onrender.com
- API: https://team08-r1-backend.onrender.com
- Health: https://team08-r1-backend.onrender.com/health

## Stack
| Part | Technology | Hosting |
|---|---|---|
| Frontend | Static HTML / CSS / vanilla JS (no build step) | Render Static Site (free) |
| API | Node.js 18+ and Express | Render Web Service (free) |
| Database | PostgreSQL | Supabase (free, session pooler) |

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service and database status |
| GET | `/api/skills` | Standardized skill set for the filter |
| GET | `/api/students` | Directory with `q`, `skill`, `availability`, `status` |
| GET | `/api/students/{id}` | Published profile plus project evidence |
| GET | `/api/projects` | All projects |
| GET | `/api/projects/{id}` | Project with contributors, roles, technologies |
| POST | `/api/inquiries` | Simulated company intake |

### Filter semantics
- `q` — case-insensitive substring over name, headline and standardized skill names (R1.04)
- `skill` — repeatable; a student must hold **every** selected skill (R1.06)
- `availability` — repeatable; any selected value may match (R1.07)
- `status` — repeatable; any selected value may match (R1.08)
- Categories combine with **AND**; results are ordered by name then id, so an
  unchanged query always returns the same set in the same order (R1.10)
- Only `profile_status = 'published'` rows are ever returned (R1.01, R1.20)

## Data model
The fixtures are imported into PostgreSQL by `backend/import.js`; the JSON files
are seed data only (R1.03). `student_skills` and `project_technologies` are
separate tables, so a project's technology never becomes a contributor's skill
(R1.15). `project_contributors` is a join table, so one canonical project can
have many contributors with their own roles and appear on several profiles
(R1.16).

## Deployment
1. Push to `main` on GitHub.
2. Render rebuilds and redeploys the API and the static site automatically.
3. On first boot against an empty database the API creates the schema and
   imports the fixtures. Re-import at any time with `npm run import`.

### Backend service settings (Render)
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment: `DATABASE_URL` (Supabase **session pooler** string), `CORS_ORIGIN` (the exact frontend URL, no trailing slash)

### Frontend service settings (Render Static Site)
- Root directory: `frontend`
- Build command: _empty_
- Publish directory: `.`
- Set the API URL in `frontend/config.js` — the single place it appears.

## Configuration and secrets
`DATABASE_URL` and `CORS_ORIGIN` exist only as Render environment variables.
`.env` is git-ignored; `backend/.env.example` lists the variable names with
placeholder values. The browser never receives database credentials — it only
knows the public API URL.

## Routing
Student and project pages use query-string identifiers
(`student.html?id=S01`, `project.html?id=P04`). They are shareable, resolve when
pasted into a fresh tab, and survive a reload on any static host without
rewrite rules. Unknown or unpublished ids render a not-found page (R1.21).

## Accessibility and mobile
A skip link, labelled form controls, a visible focus outline, live-region result
counts, and a layout that works at 390 CSS pixels with no horizontal scrolling.

## Known limitations
- The free Render web service sleeps after inactivity; the first request can
  take up to about a minute.
- Fixture external links point at `example.com` / `example.invalid` and are not
  expected to resolve. A dead link degrades to plain text and never breaks a page.

## Local development
```bash
cd backend
cp .env.example .env     # fill in real values; never commit .env
npm install
npm run import           # load the fixtures
npm start                # http://localhost:3000/health
```
Then point `frontend/config.js` at `http://localhost:3000` and serve the
`frontend` folder with any static server.
