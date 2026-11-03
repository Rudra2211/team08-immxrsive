# Release 1 — Public Talent Discovery

**Team 08** (Rudra, Nihar, Hemil) · Project 1 — ImmXrsive Talent & Industry Platform
**Tag:** `R1-submission`

## What this release delivers
An unauthenticated visitor can complete the full employer workflow:

> Talent Directory → search / filter → open a student → inspect project evidence → start a contextual inquiry

### Included
- **Talent directory** listing every published fixture student, with a card
  showing name, headline, key skills, availability and a count of project evidence.
- **Search** across name, headline and standardized skill names, case-insensitive
  and substring-based.
- **Filters** for skill (AND across multiple selections), availability and status
  (OR within each category). Active filters are listed and can be cleared in one click.
- **Student profiles** with status, program, availability, standardized skills,
  professional links and the projects they contributed to, each with their role.
- **Project pages** with description, technologies, public links and every
  published contributor with their role. A shared project is one canonical page
  reachable from each contributor's profile.
- **Contextual employer inquiry.** From a profile the inquiry carries that
  student's identity; from a project page it identifies the project itself, not
  one arbitrary contributor. Follows `company_intake_simulation.md`.
- **Mobile and keyboard support** at 390 CSS pixels, with labelled controls and a
  visible focus indicator.

### Data
The supplied fixtures are imported into PostgreSQL and served through the API.
No page is hard-coded per student. Students whose `profile_status` is not
`published` appear nowhere in public discovery — not in the directory, not by
direct URL, and not in any project's contributor list.

### Not in this release (explicit non-requirements)
Student login, GitHub OAuth, resume upload, student self-editing, project
invitations, partner administration, playable XR embedding, staff/admin workflow.

---

# Release 3 — Shared Projects, Contributor Evidence and Basic Playable Demos

**Team 08** (Rudra, Nihar, Hemil) · **Tag:** `R3-submission`

Release 1 and Release 2 requirements remain in force and unchanged.

## Two decisions this release required us to make

Release 3 asks each team to decide these for itself and to state the decision.
Both are enforced on the server, not merely in the interface.

### Who may edit shared project fields (R3.06)

**The maintainer only.** The creator of a project becomes its initial
maintainer, and maintenance can be transferred to any accepted contributor
without changing the project's identity or URL.

Accepted contributors are never read-only on their *own* part of the record.
Every accepted contributor controls:

- their own contribution statement, which no maintainer and no other
  contributor can rewrite (R3.11) — there is no route that accepts another
  student's statement, so this is a property of the API surface rather than a
  permission check that could be mis-set;
- whether the project appears in their own portfolio presentation (R3.12).

A contributor opening the project editor sees the shared fields populated but
read-only, with a line explaining that a teammate maintains the project. We
chose a visible read-only view over hiding the panel so a contributor can still
see what the shared record says about work they did.

### How a disputed removal is recovered (R3.13)

**A reversible soft delete that the maintainer can undo.** Removing a
contributor sets `removed_at`: the row, the role and the contribution statement
all survive, the person stops appearing on public pages, and **Restore** returns
them with their statement intact. No single unilateral action destroys an
accepted relationship.

Contributor self-removal is a different thing, deliberately: it clears only that
student's own featured flag, taking the project off their profile while leaving
them credited on the project itself.

Removing the maintainer is refused until maintenance has been transferred, so a
project cannot be left with nobody able to maintain it.

## What this release delivers

### Projects a student actually owns
- **One Add Project workflow**, reachable from the account page via
  **Your projects**. New projects are private drafts; nothing is public until
  the student publishes it.
- **Manual entry** of title, description, domain/type, technologies,
  date/status, public links and demo/media information.
- **GitHub import** that proposes a title, description, repository URL and
  language evidence from a public repository. Imported values are editable
  suggestions — the import saves nothing by itself.
- **Repositories are not project identity.** A project holds zero, one or many
  repository links and stays valid when one is disconnected or changed.

### Collaboration on one shared record
- A collaborative project is **one record** that several profiles point at, not
  a copy per contributor. This is true by construction: R3 extends the Release 1
  `projects` table rather than introducing a parallel one.
- **Invitations** propose one of the twelve standardized roles from
  `standard_roles.json`. An invited student is **not** represented publicly as a
  contributor until they accept.
- **Maintenance transfer** to any accepted contributor, keeping the same record
  and the same public URL.

### Evidence a visitor can understand
- Public project pages credit each accepted contributor with their standardized
  role and their own contribution statement, and identify the maintainer.
- **Project technologies stay project-level.** They never become a contributor's
  personal skill — `student_skills` and `project_technologies` are separate
  tables and no route writes one into the other. The project page says so in
  words.

### Demos that fail safely
- Playable URL, video/demo URL and source repositories are stored in
  **separate** slots. A project may have any subset, including none.
- Where a playable URL exists, the public page offers a clear **Play demo**
  action.
- **We accept URLs, never embed code.** Only `http(s)` URLs are stored;
  `javascript:`, `data:` and raw iframe or script text are rejected rather than
  sanitised-and-kept, and markup in text fields is stripped to inert text.
- **Nothing is iframed.** The demo opens in its own tab, so a demo that is dead,
  slow or unsupported on the visitor's device cannot take down the project page,
  the profile or site navigation. Fallback image, fallback note and the project
  details remain available, and a fallback image that itself fails to load is
  replaced by a sentence rather than a broken-image icon.

### Concurrent editing
- Shared-field saves carry the version they were read at. A save built on a
  stale copy is refused with a conflict that shows the current record, and the
  editor keeps what the student typed so they can merge and save again. No save
  silently overwrites a newer one.

### Mobile
- Project details, contributor roles and fallback evidence remain usable at 390
  CSS pixels, with no horizontal scrolling, even where the interactive demo
  itself is unsuitable for a phone.

## Regression

The migration's column defaults were chosen so the Release 1 fixtures keep
working without application code compensating: the nine fixture projects remain
`published` and all twenty-four fixture contributor rows remain `accepted` and
`featured`. Verified by applying `schema_r3.sql` to a database already holding
the R1 and R2 data, then running the Release 1 browser suite (26/26).

## Not in this release (explicit non-requirements)

Staff verification of official projects, company/partner administration, a full
audit-history UI, sophisticated duplicate merging, universal XR/device support,
and advanced capability detection or heavy-runtime performance work.
