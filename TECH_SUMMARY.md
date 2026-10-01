# Technology and deployment summary — Team 08, Release 1

**Stack.** Static HTML/CSS/vanilla JavaScript frontend with no build step;
Node.js 18+ with Express for the API; PostgreSQL on Supabase for persistence.
We kept the frontend dependency-free so that the deployed artifact is exactly
what is in the repository, which makes peer QA and instructor audits
straightforward.

**Deployment.** GitHub is the single source of truth. Pushing to `main` triggers
Render to rebuild and redeploy both services automatically: a Web Service rooted
at `backend/` (`npm install`, `npm start`) and a Static Site rooted at
`frontend/`. The API listens on `process.env.PORT`. The database lives in
Supabase and is reached through the session pooler connection string, so data
survives every restart and redeployment.

**Configuration and secrets.** `DATABASE_URL` and `CORS_ORIGIN` are set only as
Render environment variables. `.env` is git-ignored and `backend/.env.example`
documents the variable names with placeholders. CORS is restricted to the
deployed frontend origin. The browser holds no credentials; it knows only the
public API base URL, configured in the single file `frontend/config.js`.

**Data model.** `backend/import.js` imports `students.json`, `projects.json` and
`skills.json` into normalised tables, and is idempotent so it can be re-run
safely. `student_skills` and `project_technologies` are deliberately separate
tables: filtering reads a student's structured skills only, so a technology used
on a project never becomes a skill claim for every contributor.
`project_contributors` is a join table carrying each contributor's role, which
makes one canonical project reachable from several profiles. Publication status
is enforced in SQL on every public read, so an unpublished student cannot be
reached through the directory, a direct URL, or a project's contributor list.

**Routing.** Student and project pages are identified by query string
(`student.html?id=S01`). This gives shareable URLs that resolve on a fresh load
and after a reload on any static host without rewrite configuration. Unknown ids
return 404 from the API and render an explanatory not-found page.

**Testing.** Alongside manual testing we ran an automated browser pass against a
local PostgreSQL instance covering all 25 Release 1 requirements, including
filter semantics, unpublished-record exclusion, invalid routes, inquiry context,
keyboard reachability and a 390-pixel mobile viewport.
