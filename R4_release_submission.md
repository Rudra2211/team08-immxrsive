# Release Submission

Release: R4
Team: team-08
Project Option: Project 1 — ImmXrsive Talent and Industry Platform
Deployment: https://team08-r1-frontend.onrender.com
Repository: https://github.com/Rudra2211/team08-immxrsive
Release tag: R4-submission
Commit: the commit the R4-submission tag points to (full SHA in the Moodle submission)
Adapter: evaluation_adapter.json
Known issues: see KNOWN_ISSUES.md. The Render free tier sleeps after about 15
minutes idle, so the first request can take up to a minute. Title-similarity
duplicate warnings are advisory. The GitHub import uses unauthenticated API
calls and shares a 60-requests-per-hour IP budget.
Test notes: API base is https://team08-r1-backend.onrender.com; health is
https://team08-r1-backend.onrender.com/health. Schema migrations run
automatically on boot, so no manual database step is needed.

## Release 4 requirements status

As of **Mon Nov 16 2026, 15:35 Toronto time**, no Release 4 requirements were
published: the Project 1 book ends at *7. Release 3 – Peer QA Test Plan*, the
Release 4 section contains only the two assignments, there is no Release 4
fixtures folder, and the course Announcements forum has no posts. When asked,
the instructor said everything needed is already in Moodle.

Because requirements for a release are not part of the current requirement set
until they are published (Operations Handbook, *Source of truth*), this R4
freeze is our **cumulative R1–R3 product**, verified working on the deployed
site before freezing. No product behaviour changed after `R3-submission`. The
only code change is a presentation-only visual redesign, made with the
instructor's permission: a new `frontend/style.css` ("Northern Lights" dark
theme with aurora, 3D card tilt, scroll reveal and cross-page transitions) and
a small presentation-only block at the end of `frontend/app.js` (scroll reveal
and pointer glow). All motion stops under `prefers-reduced-motion`, nothing is
hidden without JavaScript, and focus outlines remain. Before freezing we re-ran
`tests/r3-ui.js` (27/27, including 0px sideways scroll at 390px) and
`tests/e2e.js` (26/26 R1 regression) against the redesign.

## Test accounts

**No account of ours is required, and we are not supplying any password.**

A reviewer creates their own verified student in about a minute:

1. Open https://team08-r1-frontend.onrender.com/account.html in a normal
   browser window (strict third-party-cookie blocking, e.g. Edge InPrivate,
   discards the session cookie because the frontend and API are separate
   services).
2. **Sign in with GitHub** (no scopes requested).
3. Enter an **@algomau.ca** address you control and submit the six-digit code
   emailed to it (check Spam if needed).
4. **Open the profile editor** and create a profile.
5. **Your projects** is then reachable from the account page.

| Role | How a reviewer obtains it |
|---|---|
| Public visitor | Any browser, signed out |
| Verified student | The five steps above |
| Project maintainer | Add a project — the creator becomes its maintainer |
| Accepted contributor | Be invited by another student and accept |
| Unrelated student | Any verified student, against a project they are not on |

## Release-specific evidence

No Release 4 *Required Release Evidence* list was published, so the cumulative
evidence from R3 still applies and was re-checked on the live deployment on
Nov 16 2026 at 15:35 Toronto time:

- **Health:** `/health` returns `{"status":"ok","database":"connected"}`.
- **Shared published project with two accepted contributors:**
  https://team08-r1-frontend.onrender.com/project.html?id=proj_e8af7eb93cb98fd52ce900e9
  — Rudra (Backend Developer, maintainer) and Nihar (Frontend Developer, with
  his own contribution statement), technologies listed separately from
  personal skills, Play demo and fallback evidence shown.
- **Working demo and fallback:**
  https://team08-r1-frontend.onrender.com/demo/working_demo.html and
  https://team08-r1-frontend.onrender.com/demo/fallback.svg.
- **GitHub import repository:** https://github.com/Rudra2211/team08-immxrsive.
- **Peer QA follow-up:** the only R3-cycle issue on our tracker (#1, multi-word
  skill search) is closed.
- **Automated suites** (in `tests/`): `r3-api.js` (50 checks), `r3-ui.js`
  (27 checks) and `e2e.js` (26 R1 regression checks).

## Deployment notes

- Two Render free-tier services (Static Site for `frontend/`, Web Service for
  `backend/`), deployed with **Manual Deploy → Deploy latest commit**.
- PostgreSQL on Supabase; `schema.sql`, `schema_r2.sql` and `schema_r3.sql` run
  idempotently on every boot.
- All secrets live only as Render environment variables; only
  `backend/.env.example` with placeholders is committed.
