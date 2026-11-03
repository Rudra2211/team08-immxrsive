# Release Submission

Release: R3
Team: team-08
Project Option: Project 1 — ImmXrsive Talent and Industry Platform
Deployment: https://team08-r1-frontend.onrender.com
Repository: https://github.com/Rudra2211/team08-immxrsive
Release tag: R3-submission
Commit: `<FILL IN FULL COMMIT SHA>`
Adapter: evaluation_adapter.json
Known issues: see KNOWN_ISSUES.md — the Render free tier sleeps after ~15 minutes
idle so the first request can take up to a minute; title-similarity duplicate
warnings are deliberately advisory and will occasionally be uninteresting; the
GitHub import uses unauthenticated API calls and so shares a 60-requests-per-hour
IP budget.
Test notes: API base is https://team08-r1-backend.onrender.com and the health
endpoint is https://team08-r1-backend.onrender.com/health. The root of the API
reports `"release":"R3"`. All three schema migrations run automatically on boot
and are additive and idempotent, so no manual database step is needed to assess
this release.

## Test accounts

**No account of ours is required, and we are not supplying any password.**

A reviewer creates their own verified student in about a minute:

1. Open https://team08-r1-frontend.onrender.com/account.html in a **normal**
   browser window. Strict third-party-cookie blocking (for example Edge
   InPrivate) silently discards the session cookie, because the frontend and the
   API are separate Render services.
2. **Sign in with GitHub.** We request no scopes — public profile only, never
   repository access.
3. Enter any **@algomau.ca** address you control and submit the six-digit code
   that is emailed to it. Algoma runs Google Workspace, so the mail arrives in
   Gmail; check Spam if it is not in the inbox.
4. **Open the profile editor** and create a profile. A project belongs to a
   student profile, so this step is required before adding projects.
5. **Your projects** is then reachable from the account page.

Roles this release needs, and how to reach each one:

| Role | How a reviewer obtains it |
|---|---|
| Public visitor | Use any browser, signed out |
| Verified student | The five steps above |
| Project maintainer | Add a project — the creator becomes its maintainer |
| Accepted contributor | Be invited by another student and accept, or use our QA project below |
| Unrelated student | Any verified student, tested against a project id they are not on |

Two reviewers with two GitHub accounts can exercise the whole invite → accept →
contribute → transfer cycle between themselves without us.

## Release-specific evidence

Checklist taken from the Release 3 **Required Release Evidence** list.

### Deployed URL
https://team08-r1-frontend.onrender.com

### Repository URL
https://github.com/Rudra2211/team08-immxrsive

### R3-submission tag
Tagged on the commit recorded above.

### Release notes and known issues
`RELEASE_NOTES.md` (Release 3 section) and `KNOWN_ISSUES.md`. The release notes
state the two decisions R3 explicitly required us to make and record:

- **Authorized editor (R3.06).** The maintainer is the only person who may edit
  shared project fields. Accepted contributors always control their own
  contribution statement and their own featured flag.
- **Removal recovery (R3.13).** Maintainer removal is a **reversible soft
  delete** — the relationship and the contribution statement survive and the
  maintainer can restore them. Contributor self-removal clears only that
  student's own featured flag and never touches the canonical relationship.

### One shared published project with at least two accepted contributors
**Project:** *ImmXrsive Talent Platform*
**Public URL:** `<FILL IN THE PUBLIC PROJECT URL FROM TURN 1>`
Maintainer: Rudra (Backend Developer). Accepted contributor: Nihar (Frontend
Developer), with his own contribution statement. Both profiles link to this one
project record — there is no per-contributor copy.

### One project containing a working demo and fallback
The same project. Playable URL
https://team08-r1-frontend.onrender.com/demo/working_demo.html and fallback image
https://team08-r1-frontend.onrender.com/demo/fallback.svg, both served from our
own static site rather than a local path or a Moodle-protected download. The
public page offers a **Play demo** action and shows the fallback image and note
alongside it, because a playable demo may not run on every device.

### One public repository used to demonstrate GitHub import
https://github.com/Rudra2211/team08-immxrsive — our own repository, imported
through **Fetch suggestions** on the Add Project form. The import proposes title,
description, repository URL and language evidence as editable suggestions and
saves nothing by itself.

### release_submission.md
This file.

### Completed evaluation_adapter.json
`evaluation_adapter.json`, submitted alongside this file. It is the
implementation-neutral template from the Bootcamp templates ZIP with
`release` set to `R3` and one mapping per requirement R3.01–R3.27, naming the
entry point, action, role, fixture setup and expected result for each. It also
names the routes this release adds — project creation and claiming, contributor
roles, the duplicate-warning path, and the demo/fallback surface.

## How the R3 behaviour was verified

Three suites, all in `tests/`. They are evidence of our own testing, not a
claim on the marker's judgement.

| Suite | Checks | Covers |
|---|---|---|
| `tests/r3-api.js` | 50 | Authorization boundaries, the lost-update conflict, invitation visibility before acceptance, soft-delete and restore, URL rejection, and all three rows of `project_duplicate_cases.json` asserted verbatim |
| `tests/r3-ui.js` | 27 | Add Project, GitHub import, invite, accept, contribution statement, publish, Play demo, broken-demo isolation, and the 390px layout |
| `tests/e2e.js` | 26 | The Release 1 requirements, used as the R3.25 regression gate |

All 103 checks pass against a local deployment of this commit with the r1-v1
fixtures loaded. `tests/r3-api.js` and `tests/r3-ui.js` remove the synthetic
students they create, so running them does not disturb the fixture data or the
directory count.

One point worth stating plainly for the marker: the R3 migration's column
defaults were chosen so that the nine Release 1 fixture projects stay
`published` and all twenty-four Release 1 contributor rows stay `accepted` and
`featured`. R3.25 is therefore satisfied by the schema rather than by
application code compensating for it, and we verified it by applying the
migration to a database already holding the R1 and R2 data.

## Deployment notes

Only what is needed to operate and test the assessed release.

- Two Render free-tier services: a Static Site for `frontend/` and a Web Service
  for `backend/`. Auto-deploy is off; both are deployed with **Manual Deploy →
  Deploy latest commit**.
- PostgreSQL on Supabase. `schema.sql`, `schema_r2.sql` and `schema_r3.sql` run
  in that order on every boot via `initDb()`; each is idempotent and additive,
  so a redeploy is safe and no migration is run by hand.
- Session cookies are `Secure; HttpOnly; SameSite=None` because the frontend and
  API are different origins, and every browser request sends
  `credentials: "include"`.
- All secrets live only as Render environment variables. `.env` is git-ignored
  and only `backend/.env.example`, with placeholders, is committed. No long-lived
  secret appears in this file, in the adapter, or anywhere in the repository.
- The GitHub import calls `api.github.com` unauthenticated, which is enough for
  public repositories and needs no token.
