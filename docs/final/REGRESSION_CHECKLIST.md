# Team regression checklist: Final Release (F.39)

**Local runs (Nov 26 2026).** Each suite ran against its own fresh PostgreSQL 16 database, using the same code as `main`, the Release 1 seed loaded at boot, and a Playwright Chromium browser.

| Suite | What it covers | Result |
|---|---|---|
| `tests/e2e.js` | R1 employer journey: directory, search, filters, profile, project, inquiry; 390 px | 26/26 |
| `tests/r3-api.js` | R2/R3 profile, ownership, contributor and maintainer rules, privacy | 50/50 |
| `tests/r3-ui.js` | R3 project creation, invitations, contribution statements, demo fallback | 27/27 |
| `tests/r4-api.js` | R4 staff authorization, fixture imports, R4.10, collaborations, partner requests | 70/70 |
| `tests/final-api.js` | F.01 – F.37: migration, claims, alumni, availability, retirement, merges, maintainer, demo state, scale, diagnostics | 81/81 |
| `tests/final-ui.js` | Staff import, merge and claim pages; directory paging; merged redirect; archived pages; 390 px; demo state | 29/29 |

## Journeys checked on the deployed site

| Journey | Result |
|---|---|
| **Employer**: directory → filter by skill + availability (+ Active Talent only) → profile → project → inquiry with context | Pass |
| **Student**: sign in → verify → edit profile → preview → publish / unpublish / retire / restore | Pass (local suites; live sign-in needs a reviewer's own GitHub) |
| **Contributor**: accept invitation → edit own contribution statement → feature/hide | Pass (r3 suites) |
| **Staff**: verify project, review partner request, import legacy data, decide claim, merge, change maintainer, change status | Pass |
| **Visitor**: project → Play opens a new tab only on click; unavailable demo explains itself; fallback evidence shown | Pass |
| **Partner history**: current and past collaborations; private collaboration absent from the public API | Pass |

## Regression points we checked specifically

- R1.10 ordering is unchanged by paging: it is still name, then id, and `offset` continues without overlap.
- R1.07 availability filter: it now also requires Active Talent with a confirmation in the last 365 days (F.14). The R1 fixture's availability counts as confirmed when it is loaded, so R1 filter results are unchanged.
- R2.19 / F.20: `legacy_email` never appears in public, student or claim-search responses. Only staff routes return it.
- R3.25: R1 fixture projects still credit their contributors. A retired contributor is still credited.
- R4.02 / F.21: every new `/api/staff/*` route returns 401 when signed out and 403 for a student session.
- F.23: we searched the git history for client secrets, API keys, the staff password and database passwords. Only placeholders were found.

## Commands

```
# fresh database per suite; backend env as in OPERATIONS.md, plus ALLOW_PRIVATE_IMPORT=true for r4-api
BASE_URL=http://127.0.0.1:3002 node tests/final-api.js
FRONTEND_URL=http://127.0.0.1:8090 node tests/final-ui.js
BASE_URL=http://127.0.0.1:8090 node tests/e2e.js
BASE_URL=http://127.0.0.1:3002 node tests/r3-api.js
FRONTEND_URL=http://127.0.0.1:8090 BASE_URL=http://127.0.0.1:3002 node tests/r3-ui.js
BASE_URL=http://127.0.0.1:3002 node tests/r4-api.js
```
