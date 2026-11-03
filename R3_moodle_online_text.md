**Team 08 — Project 1, Release 3: Shared Projects, Contributor Evidence and Basic Playable Demos**

**Deployment:** https://team08-r1-frontend.onrender.com
**API:** https://team08-r1-backend.onrender.com (root reports `"release":"R3"`)
**Repository:** https://github.com/Rudra2211/team08-immxrsive
**Release tag:** R3-submission
**Commit:** `<FILL IN FULL COMMIT SHA>`
**Adapter:** evaluation_adapter.json (attached)

**Test access.** No account of ours is needed and we supply no password. Open
/account.html in a normal browser window (strict third-party-cookie blocking,
such as Edge InPrivate, discards the cross-origin session cookie), sign in with
GitHub — we request no scopes — verify any @algomau.ca address you control, then
create a profile and open **Your projects**. Algoma runs Google Workspace, so
the verification code arrives in Gmail; check Spam.

**Shared project for QA.** *ImmXrsive Talent Platform* —
`<FILL IN THE PUBLIC PROJECT URL>` — maintained by Rudra (Backend Developer)
with Nihar (Frontend Developer) as an accepted contributor who wrote his own
contribution statement. Both profiles link to this one record; there is no
per-contributor copy. The same project carries the playable demo
(/demo/working_demo.html) and the fallback image (/demo/fallback.svg), both
hosted on our own static site.

**Two decisions Release 3 required us to make and state.**
1. *Authorized editor (R3.06):* the maintainer is the only person who may edit
   shared project fields. Accepted contributors always control their own
   contribution statement and whether the project is featured on their profile.
2. *Removal recovery (R3.13):* maintainer removal is a reversible soft delete —
   the relationship and the contribution statement survive and the maintainer
   can restore them. Contributor self-removal clears only that student's own
   featured flag and never touches the canonical relationship.

**Verification.** 103 automated checks pass against this commit:
`tests/r3-api.js` (50 — authorization boundaries, the lost-update conflict,
invitation visibility before acceptance, soft-delete and restore, URL rejection,
and all three rows of project_duplicate_cases.json asserted verbatim),
`tests/r3-ui.js` (27 — Add Project, GitHub import, invite, accept, contribution,
publish, Play demo, broken-demo isolation, 390px), and `tests/e2e.js` (26 — the
Release 1 regression gate). The R3 migration's column defaults keep the nine R1
fixture projects published and all twenty-four R1 contributor rows accepted and
featured, so R3.25 holds at the schema level; we confirmed this by applying the
migration to a database already holding the R1 and R2 data.

**Known issues.** The Render free tier sleeps after about fifteen minutes idle,
so the first request can take up to a minute. Title-similarity duplicate
warnings are advisory by design and will occasionally flag something
uninteresting — they never merge or block. The GitHub import is unauthenticated
and so shares a 60-requests-per-hour IP budget. Full list in KNOWN_ISSUES.md.

**Not built, per the Release 3 explicit non-requirements.** Staff verification of
official projects, company/partner administration, a full audit-history UI,
sophisticated duplicate merging, universal XR/device support, and advanced
capability detection.
