# Release Submission

Release: FINAL
Team: team-08
Project Option: Project 1 — ImmXrsive Talent and Industry Platform
Deployment: https://team08-r1-frontend.onrender.com
Repository: https://github.com/Rudra2211/team08-immxrsive
Release tag: FINAL-submission
Commit: the commit the FINAL-submission tag points to (the full SHA is in the Moodle submission text)
Adapter: evaluation_adapter.json
Known issues: see docs/final/LAUNCH_NOTES.md. In short:

- The free-tier cold start can take up to a minute.
- Legacy records that share a name with Release 1 seed records are reported, not auto-merged.
- LS04 and LC02 are left unmerged for peer QA Scenario D.
- The scale fixture stays loaded for Scenario G.
- Demos open in a new tab rather than embedding.

Test notes:

- The API base is https://team08-r1-backend.onrender.com, and health is at `/health`.
- `schema.sql` … `schema_final.sql` run on boot.
- The legacy export and the scale fixture are already imported on the live site (evidence below).
- Use a normal browser window. The session cookie crosses sites, so strict third-party-cookie blocking (for example Edge InPrivate) prevents signing in.

## Test accounts

| Role | How a reviewer gets it |
|---|---|
| Public visitor / employer | Any browser, signed out |
| Staff | Staff test account: username `immxrsive.staff`. The password is in the Moodle **Reviewer test access** text and the private course email thread, and is never committed. Sign in at `/staff-login.html`. |
| Verified student / alumni / project maintainer | Your own GitHub account: `/account.html` → **Sign in with GitHub** → verify an `@algomau.ca` address with the emailed six-digit code → create a profile and add a project. You become its maintainer. |
| Second student (contributor and authorization checks) | A second reviewer's GitHub account, or any verified student who is not on the project |
| Claimant (Scenario C) | Any verified student. On `/account.html`, under **Already had a profile on the old ImmXrsive site?**, search for **Unclaimed Alum** (LS05) or **Daniel Kim** (LS02, the legacy copy) and claim it. Your verified address does not match the legacy email, so the claim waits for staff, who resolve it on `/admin-records.html`. Please do not claim a real person's profile. |

### Staff paths for each scenario (`/admin-records.html`)

| Scenario | What to do there |
|---|---|
| B: alumni status | **Profiles** → search by name → **Student status** → Alumni → **Save status** |
| C: claims | **Profile claims** → **Approve claim** / **Reject claim** (a rejection needs a note) |
| C: migration report | **Import history** → **View report**. Re-importing `tests/fixtures/final/legacy_export.json` is safe and shows created 0 / skipped. |
| D: merge a duplicate | **Profiles** → search `LS04` → **Use as duplicate** → search `LS01` → **Use as surviving profile** → **Merge profiles**. For partners, use **Duplicate partners** (North Shore Simulation Inc. → North Shore Simulations, legacy). |
| D: maintainer | **Project maintainers** → search `XR Anatomy` → pick a contributor → reason → **Make maintainer** |
| Diagnostics | **Diagnostics** (recent errors and every record change) |

## Release-specific evidence

All of this was run and checked on the deployed site on Thu Nov 26 2026, 12:33–12:40 Toronto time.

- **Migration tool and instructions:** `docs/final/MIGRATION.md`. Use the staff page at `/admin-records.html` → **Import legacy data**, or the CLI `node backend/migrate.js <file>`.
- **Migration report for the supplied legacy fixture** (`docs/final/migration_report_live.json`, also under **Import history** → **View report**):
  - Run 1 (17:33:32 UTC): created 6 students, 3 projects, 3 companies and 4 collaborations, with 0 conflicts. Duplicate LS04 → LS01 (same email). Broken reference LP02/LS99. Unclaimed LS02, LS05, LS06. These match `legacy_expected_results.json` exactly. The run also reported:
    - duplicate company LC02 → LC01 (same domain);
    - stale availability for LS02;
    - LS01 and LS03 were claimed on the old site but have no account here;
    - seven possible matches with existing records: three Release 1 seed students, two seed projects, and LC01/LC02 sharing a domain with the R4 partner North Shore Simulations.
  - Run 2 (17:33:47 UTC), same file: created 0, skipped 6/3/3/4. Re-import is idempotent.
- **Live records to inspect:**
  - LP01 "XR Anatomy Lab", one shared project with both contributors (Avery Chen, XR Developer; Daniel Kim, Interaction Developer): https://team08-r1-frontend.onrender.com/project.html?id=proj_c29dcde72c1983bcf4dff3a4
  - LS05 "Unclaimed Alum", public with no owner: https://team08-r1-frontend.onrender.com/student.html?id=P_08428334466d74ed025d3cf6
  - LS02 (legacy) Daniel Kim, availability "Not recently confirmed": https://team08-r1-frontend.onrender.com/student.html?id=P_f33bbdf549d45e70c6850ced
  - LS06, retired, its page says archived: https://team08-r1-frontend.onrender.com/student.html?id=P_51127b448d3f7eab7c3af660. It is still credited on LP03 as "(profile archived)": https://team08-r1-frontend.onrender.com/project.html?id=proj_f7612399d54dd4f040aa8318
  - LC01 North Shore Simulations (legacy) with past and current collaborations: https://team08-r1-frontend.onrender.com/partner.html?id=co_654d5d79e78845921d5beb83
  - LC03 Superior Immersive Labs (legacy). Its private "Confidential Prototype" is absent from the page and the API: https://team08-r1-frontend.onrender.com/partner.html?id=co_3ccae02d57b3d78e36774158
  - Merge candidates left for Scenario D: LS04 `P_b48602cc191dce0b8ebd6ebc` → LS01 `P_5cce3c2ece144415636d05c8`, and LC02 `co_d2c808ec2c6d0b09e1c9f1e7` → LC01 `co_654d5d79e78845921d5beb83`.
- **Scale-fixture test** (`docs/final/SCALE_EVIDENCE.md`). Run 3 (17:34:01 UTC) imported `scale_fixture.json` through the same staff page: 220 students, 110 projects, 25 partners. The directory now holds 235 published students, and its first request still returns 24 records (8,540 bytes, against 8,269 bytes with 22 students before). No media, resume or playable runtime is requested.
- **Launch notes and known issues:** `docs/final/LAUNCH_NOTES.md`.
- **Completed team regression checklist:** `docs/final/REGRESSION_CHECKLIST.md`. All suites pass: e2e 26/26, r3-api 50/50, r3-ui 27/27, r4-api 70/70, final-api 81/81, final-ui 29/29.
- **Operational note:** `docs/final/OPERATIONS.md` (summary below).
- **Evaluation adapter:** `evaluation_adapter.json` (F.01–F.41 added; the R4 and R3 checks kept for regression).

## Operational note (Final Release only)

See docs/final/OPERATIONS.md. In brief:

- **Deployment.** Two Render free-tier services, frontend and API, are deployed with Manual Deploy → Deploy latest commit. PostgreSQL is on Supabase. Additive, idempotent migrations run on every boot, and secrets live only in Render environment variables.
- **External dependencies.** These are GitHub OAuth, Brevo email, the unauthenticated GitHub API, company websites and student-hosted demos and media. Each failure gives a readable message with a manual or retry path, and none of them blocks public browsing.
- **Diagnostics.** Staff use `/admin-records.html` → **Diagnostics** (`GET /api/staff/diagnostics`). It lists every 5xx and every failed integration with time and context, plus an audit trail of ownership, claim, merge, maintainer and status changes. No secrets, codes or cookies are recorded. Render's service logs hold the timestamped process log.
