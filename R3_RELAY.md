# Release 3 — team relay

**Due: Wednesday 4 November, 23:59 Toronto.** Peer QA opens Thursday 5 November.

Three turns, one person at a time. Do not start your turn until the person
before you says "turn N done" in the group chat. All the code is already written
and tested — these turns are deployment, evidence and submission, not coding.

Order: **Rudra (turn 1) → Nihar (turn 2) → Hemil (turn 3)**.

---

## Turn 1 — Rudra · deploy the release

### 1.1 Get the code into the repository

The R3 code is **not on GitHub yet** — it arrives as `team08-R3-files.zip`.
Someone has to put it in and push it, and that someone is you.

1. Download `team08-R3-files.zip` from the chat and **extract it straight over
   your local clone** of `team08-immxrsive`. It contains the full folder
   structure (`backend/`, `frontend/`, `tests/` and the root files), so
   extracting it in the repository folder drops every file into the right place.
   Windows will ask whether to replace existing files — say **yes to all**. The
   zip contains only files R3 changed or added; nothing else is touched.
2. Open **GitHub Desktop**. The **Changes** tab should list **24** changed
   files, including these new ones: `backend/schema_r3.sql`,
   `backend/projects.js`, `backend/data/standard_roles.json`,
   `frontend/my-projects.html`, `frontend/my-projects.js`,
   `frontend/project-edit.html`, `frontend/project-edit.js`,
   `frontend/demo/working_demo.html`, `frontend/demo/fallback.svg`,
   `tests/r3-api.js`, `tests/r3-ui.js`, `R3_RELAY.md`,
   `R3_release_submission.md`, `R3_moodle_online_text.md`.
3. Make sure the branch at the top says **main**.
4. In the **Summary** box, type:
   `Release 3: shared projects, contributor evidence and playable demos`
5. Click **Commit to main**, then **Push origin**.
6. Tell Nihar and Hemil it is pushed, so they can pull before their turns.

> If `node_modules` or a `.env` file shows up in the Changes list, **untick
> them** before committing. They are meant to be ignored and must not be pushed.

### 1.2 Deploy the backend

**No Supabase step is needed.** The R3 migration runs itself when the service
boots, exactly as R2's did, and it only adds columns and tables — it deletes
nothing.

1. Go to <https://dashboard.render.com> and sign in.
2. Click the **team08-r1-backend** service (the Web Service, not the Static Site).
3. Top right: **Manual Deploy** → **Deploy latest commit**.
4. Wait until the badge reads **Live** (usually 2–4 minutes).
5. Open the **Logs** tab and read the last lines. You want
   `Backend listening on port ...` and **no** line containing `Startup failed`.
6. Open <https://team08-r1-backend.onrender.com/> in a browser tab.
   It must say `"release":"R3"` and list `/api/my/projects` under `endpoints`.
   If it still says `"release":"R2"`, Render deployed an old commit — repeat
   step 3.
7. Open <https://team08-r1-backend.onrender.com/health>. It must say
   `"status":"ok"` and `"students":18`.

**If step 5 shows `Startup failed`:** paste the whole error line into the group
chat and stop. The migration is the only thing that can fail here and we need to
read the message before anyone retries.

### 1.3 Deploy the frontend

1. Back on the Render dashboard, click **team08-r1-frontend** (Static Site).
2. **Manual Deploy** → **Deploy latest commit**. Wait for **Live**.
3. Open <https://team08-r1-frontend.onrender.com/demo/working_demo.html>.
   You must see **Interactive Demo Fixture** with an **Interact** button. Click
   it — the text counts your clicks.
   *This URL is our public playable demo. R3 requires it to be publicly
   reachable, which is why it ships inside the static site.*
4. Open <https://team08-r1-frontend.onrender.com/demo/fallback.svg>.
   You must see a grey image reading **Interactive demo unavailable**.

### 1.4 Prove R1 and R2 did not break

1. Open <https://team08-r1-frontend.onrender.com/index.html>.
2. Count the student cards: there must be **17**.
3. Type `accessib` in the search box — you should get 3 students.
4. Click a student, then one of their projects. The project page must still list
   contributors with their roles.
5. **Screenshot 1** — the directory showing 17 cards.
   Name it `01-r1-directory-still-works.png`.

### 1.5 Create the shared project QA needs

R3 requires us to hand QA *one shared published project with at least two
accepted contributors*. You create it; Nihar accepts in turn 2.

1. Open <https://team08-r1-frontend.onrender.com/account.html>.
2. Sign in with GitHub and confirm it still shows you as verified.
3. Click **Your projects**.
4. Under **Import from a public GitHub repository**, paste
   `https://github.com/Rudra2211/team08-immxrsive` and click
   **Fetch suggestions**. The title, description and technologies fill in by
   themselves.
   **Screenshot 2** — the filled-in form. Name it `02-github-import.png`.
5. Change **Project title** to `ImmXrsive Talent Platform`.
6. Set **Domain or type** to `Web / Software`.
7. Set **Date or status** to `Fall 2026`.
8. Set **Your role on this project** to `Backend Developer`.
9. Click **Save project**. You land on the project's own editor page.
10. Fill in the demo fields:
    - **Playable web URL**:
      `https://team08-r1-frontend.onrender.com/demo/working_demo.html`
    - **Video or recorded demo URL**: leave blank
    - **Fallback image URL**:
      `https://team08-r1-frontend.onrender.com/demo/fallback.svg`
    - **Fallback note**:
      `Screenshots and project details if the interactive demo will not run on your device.`
11. Click **Save project details** and wait for the green
    "Project details saved."
12. Scroll to **Invite a teammate**. Type `Nihar`, click **Choose Nihar …**
    when it appears, set the role to `Frontend Developer`, click
    **Send invitation**.
    **Screenshot 3** — the contributor list showing Nihar as
    *invited — waiting for their answer*. Name it `03-invitation-pending.png`.
13. Click **Publish this project**.
14. Click **View the public page** and paste that URL into the group chat —
    Nihar and Hemil both need it.
    **Screenshot 4** — the public page.
    Name it `04-public-project-published.png`.

### 1.6 Show that an unaccepted invitation is not public

1. Open the public project URL in a **private/incognito window**, so you are
   signed out.
2. Confirm **Nihar's name appears nowhere** on the page.
   **Screenshot 5** — the signed-out page with only your name under
   Contributors. Name it `05-invited-not-public-yet.png`.

This screenshot is the whole of R3.09's first half. **Do not skip it** — once
Nihar accepts, this state is gone and cannot be photographed again.

### 1.7 Capture the duplicate warning

1. Go back to **Your projects**.
2. In the **Add a project** form, paste the SAME repository into
   **Repository link**: `https://github.com/Rudra2211/team08-immxrsive`
3. Click outside the box — the warning appears when you leave the field.
4. A red warning says the repository is already connected, with a link to the
   existing project.
   **Screenshot 6** — the warning. Name it `06-duplicate-warning.png`.
5. **Do not save.** Reload the page to clear the form.

Post **"turn 1 done"** with the public project URL and screenshots 1–6.

---

## Turn 2 — Nihar · accept, contribute, test the boundaries

Wait for Rudra's "turn 1 done".

### 2.1 Accept the invitation

1. Open <https://team08-r1-frontend.onrender.com/account.html>, sign in with
   GitHub, confirm you are verified.
2. Click **Your projects**.
3. At the top you should see **Invitations waiting for you** —
   *ImmXrsive Talent Platform*, *Proposed role: Frontend Developer*.
   **Screenshot 7** — the invitation. Name it `07-invitation-received.png`.
4. Click **Accept**.

### 2.2 Write your own contribution statement

1. Click the project's name to open its editor.
2. Notice the page says *A teammate maintains this project* and the
   **Project details** fields are greyed out. That is correct — only the
   maintainer edits shared fields.
3. Under **Your contribution** → **What you did on this project**, type:
   `Built the student profile editor and the privacy controls.`
4. Leave **Show this project on my profile** ticked.
5. Click **Save my contribution**.
   **Screenshot 8** — the saved form. Name it `08-contribution-statement.png`.

### 2.3 Check it reached the public page

1. Open the public project URL Rudra posted, in a **private/incognito window**.
2. You must now see **two contributors**: Rudra (marked *maintains this
   project*) and you, with the role **Frontend Developer** and your sentence
   underneath.
   **Screenshot 9** — both contributors.
   Name it `09-two-accepted-contributors.png`.

That is the required *shared published project with at least two accepted
contributors* — the single most important piece of evidence in this release.

### 2.4 Test the playable demo and the fallback

1. On the project page find **Experience this project** and click **Play demo**.
   The fixture opens in a new tab and the Interact button counts clicks.
   **Screenshot 10** — the demo running. Name it `10-play-demo.png`.
2. Return to the project page. Below the Play demo button you should also see
   the grey fallback image and the fallback note.
   **Screenshot 11** — the fallback on the project page.
   Name it `11-fallback-evidence.png`.

### 2.5 Test "hide from my profile"

1. Open your own public profile — easiest route: the directory at
   <https://team08-r1-frontend.onrender.com/index.html>, then click your name.
2. Confirm *ImmXrsive Talent Platform* is listed under **Project evidence**,
   with your role and your contribution sentence.
   **Screenshot 12** — the project on your profile.
   Name it `12-project-on-my-profile.png`.
3. Back in the project editor, untick **Show this project on my profile** and
   click **Save my contribution**.
4. Reload your public profile. The project is **gone**.
5. Reload the public **project** page. You are **still listed** as a contributor.
   **Screenshot 13** — still credited on the project after hiding it from your
   profile. Name it `13-hidden-from-profile-still-credited.png`.
6. **Turn the tick back ON** and save, so the submitted state shows the project
   on your profile.

### 2.6 Test the authorization boundary

This is the check a marker is most likely to try personally.

1. Open <https://team08-r1-frontend.onrender.com/project-edit.html?id=P01>
   (P01 is an R1 fixture project you are not a contributor on).
2. You must see **"Not your project"** with an explanation — not an editor.
   **Screenshot 14** — the refusal. Name it `14-not-your-project.png`.

Post **"turn 2 done"** with screenshots 7–14.

---

## Turn 3 — Hemil · evidence, tag, submit

Wait for Nihar's "turn 2 done".

### 3.1 How to take and save a screenshot on Windows

Press **Windows + Shift + S**. The screen dims and a small toolbar appears at
the top. Choose the **rectangle** option, drag a box round what you want, then
click the preview that pops up bottom-right and press **Ctrl+S** to save.
Save everything into one Desktop folder called `team08-R3-evidence`, using the
file names given above.

### 3.2 Mobile evidence (R3.23)

1. Open the public project URL in **Chrome**.
2. Press **F12** for DevTools.
3. Press **Ctrl+Shift+M** (or click the phone/tablet icon top-left of DevTools).
   A device toolbar appears above the page.
4. In the device dropdown choose **Responsive**, then type **390** in the width
   box and **844** in the height box.
5. Scroll. Check you can read the contributor roles and see the fallback image,
   and that there is **no left-right scrolling**.
   **Screenshot 15** — the project page at 390px. Name it `15-mobile-390.png`.
6. Still at 390px, open
   <https://team08-r1-frontend.onrender.com/my-projects.html>, sign in if asked,
   and confirm it is usable.
   **Screenshot 16** — Your projects at 390px.
   Name it `16-mobile-my-projects.png`.

### 3.3 Run the automated suite (optional)

Only if you have Node installed and ten spare minutes. Skip it if you are short
of time — the screenshots are what gets marked.

```
cd team08-immxrsive
cd backend && npm install && cd ..
set DATABASE_URL=<the Supabase connection string from the group chat>
node tests/r3-api.js
```

Expect `50/50 checks passed`. Screenshot it as `17-api-tests.png`.

> The test cleans up after itself — it deletes the synthetic `t3_` students it
> creates. It is safe against the live database, but skip this step entirely if
> you would rather not touch it.

### 3.4 Tag the release

1. Open **GitHub Desktop** → **Fetch origin** → **Pull origin**, so you have
   Rudra's pushed commit from turn 1.
2. Open `R3_release_submission.md` and replace `<FILL IN FULL COMMIT SHA>` with
   the SHA from step 3.5 below, then **commit and push that change first.**
   Do the tag *after* the push, so the tag lands on the final commit.
3. Choose **History** from the top menu.
4. Right-click the **newest** commit at the top of the list.
5. Choose **Create Tag…**
6. Type exactly: `R3-submission`
7. Click **Create Tag**, then **Push origin** so the tag reaches GitHub.

### 3.5 Record the commit SHA

1. Go to <https://github.com/Rudra2211/team08-immxrsive/commits/main>
2. Click the **newest** commit.
3. Copy the **full 40-character SHA** from the address bar — the long string
   after `/commit/`.
4. That is the value for step 3.4.2. The file and the tag must name the same
   commit; doing the edit-and-push before the tag is what keeps them in step.

### 3.6 Submit on Moodle

1. Moodle → **COSC3506 F03** → **Team Project: Release 3** →
   **Release 3 Product Result (due Wed Nov 4)**.
2. Click **Add submission**.
3. In **Online text**, paste the contents of `R3_moodle_online_text.md`.
4. Under **File submissions**, upload:
   - `R3_release_submission.md`
   - `evaluation_adapter.json`
   - `team08-R3-evidence.zip` — zip the screenshot folder by right-clicking it →
     **Send to** → **Compressed (zipped) folder**
5. Click **Save changes**.
6. Click **Submit assignment**, tick the confirmation box, click **Continue**.
7. Confirm the page reads **Submitted for grading**.
   **Screenshot 18** — the submitted status. Name it `18-moodle-submitted.png`
   and post it in the group chat.

Post **"turn 3 done — submitted"**.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Render logs say `Startup failed` | The migration could not run | Paste the full error in the chat; do not retry blindly |
| The API still says `"release":"R2"` | Render deployed an old commit | Manual Deploy → Deploy latest commit, again |
| Sign-in does nothing and shows no error | Third-party cookies are blocked | Use a normal window, not InPrivate/Incognito |
| The directory shows a loading message for ~60s | The free Render service was asleep | Wait; it wakes up |
| "Create your student profile first" | You have no profile yet | Account → Open the profile editor → create it, then return |
| The invite search finds nobody | That person has no account here yet | They must sign in and verify once first |
| "Someone else saved a newer version" | A teammate saved while you were editing | Expected behaviour (R3.17). Your text is kept — merge it and save again |
