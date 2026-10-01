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
