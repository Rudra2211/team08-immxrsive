# Release 1 — who does what (Team 08)

Deadline: **Friday 2 October, 11:59 p.m. Toronto.** Freeze by 6 p.m. and submit by 9 p.m.

The code in this repository is complete and tested locally. What remains is
deployment, verification on the deployed URLs, and the submission package.

## Nihar — database and API
1. Create a Supabase project. Save the password privately. Copy the
   **Session pooler** connection string (not Direct connection — Render's free
   tier cannot reach the IPv6 address it uses).
2. Render → New → Web Service → this repo.
   Root directory `backend`, build `npm install`, start `npm start`, Free plan.
3. Environment variables: `DATABASE_URL` = the pooler string.
   Add `CORS_ORIGIN` once Rudra has the frontend URL, then redeploy.
4. Open `/health`. It should report `"database":"connected"` and
   `"students":18` (18 imported, 17 published — S16 is deliberately unpublished).
5. Spot-check in the browser:
   - `/api/students` → 17 records
   - `/api/students?skill=Unity&skill=C%23` → 5 records
   - `/api/students?skill=React` → must **not** include Noah Williams
   - `/api/students/S16` → 404

## Rudra — frontend, release engineering and submission
1. Edit `frontend/config.js` so `API_BASE_URL` is Nihar's backend URL, no
   trailing slash. Commit.
2. Render → New → Static Site → this repo. Root directory `frontend`,
   build command empty, publish directory `.`.
3. Send the frontend URL to Nihar for `CORS_ORIGIN`.
4. Fill the real URLs into `README.md` and `evaluation_adapter.json`
   (`frontend_base_url`, `api_base_url`).
5. Tag the frozen build: GitHub → Releases → Create a new release → tag
   `R1-submission`, target `main`, publish. Record the commit SHA.
6. Submit on Moodle (Release 1 Product Result) with the deployed URL, repo,
   tag, commit SHA, `RELEASE_NOTES.md`, `KNOWN_ISSUES.md`, `TECH_SUMMARY.md`,
   the simulated intake configuration, and `evaluation_adapter.json`.
   **Click Submit** — a draft is not a submission.

## Hemil — verification on the deployed site
Walk the employer scenario on the live URLs, exactly as a peer tester would,
and screenshot each step:
1. Open the directory. 17 students load.
2. Search `accessib` → Isabella Moore and Leila Ahmed appear.
3. Select skills Unity **and** C# → 5 students; confirm Maya Patel is absent
   (she has Unity but not C#).
4. Clear filters → back to 17.
5. Open Avery Chen → status, program, availability, skills, links and two
   projects with her role on each.
6. Open XR Anatomy Lab → three contributors with distinct roles; open it again
   from Emma Wilson's profile and confirm it is the same page.
7. Open Museum Quest Experience → Nora Evans must **not** be listed.
8. Paste `/student.html?id=S01` into a fresh tab → loads. Reload → still loads.
9. Visit `/student.html?id=S999` and `/project.html?id=P999` → not-found pages.
10. From Sofia Martin's profile, send an inquiry → the form already names her.
11. From a project page, send an inquiry → it names the project, not a contributor.
12. Resize to 390px wide → no horizontal scrolling on any page.
13. Tab through the directory with the keyboard → every control is reachable and
    the focused control is clearly outlined.

Optional automated pass (same checks, from your machine):
```bash
npm i -D playwright && npx playwright install chromium
BASE_URL=https://your-frontend.onrender.com node tests/e2e.js
```

## Everyone — individual accountability
Each of you should be able to explain, without notes:
- where the frontend, API and database are hosted, and how a push reaches production;
- where `DATABASE_URL` lives and why the browser never sees it;
- why a project's technology is not treated as a contributor's skill, and where
  that is enforced in the code;
- how an unpublished student is kept out of the directory, direct URLs and
  contributor lists;
- what the inquiry carries from a profile versus from a project page.

## After submission
- **Sat 3 Oct – Tue 6 Oct:** you review another team's release (Peer QA, due Tue 6 Oct).
- **Wed 7 Oct:** peer and instructor findings arrive by 4 p.m.
- **Fri 9 Oct:** respond to every finding with Accept / Reject / Defer, link
  fixes to issues, redeploy, and ask the reviewer to retest. This is worth
  10 of the 100 release points — do not go quiet after Friday.
