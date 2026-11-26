# Legacy migration: instructions and results (F.01 – F.06, F.27)

## Where it lives

| Part | File |
|---|---|
| Importer (one code path for every bulk load) | `backend/migrate.js` (`runMigration`) |
| Staff route | `POST /api/staff/migrations` (`backend/final.js`), staff session only |
| Staff screen | `/admin-records.html` → **Import legacy data** |
| Tables | `legacy_ids`, `migration_runs` and import columns in `backend/schema_final.sql` |
| Checks | `tests/final-api.js`, `tests/final-ui.js` |
| Fixtures (copied in unchanged) | `tests/fixtures/final/` |

## How to run it

**From the product (the normal way):**

1. Sign in as staff at `/staff-login.html`.
2. Open **Records, claims and recovery**.
3. Under **Import legacy data**, choose `legacy_export.json` and press **Run import**.

The report appears under the form, and every run is listed in **Import history**, where **View report** shows it again.

**From a shell (operators):**

```
cd backend
DATABASE_URL=postgres://… node migrate.js ../tests/fixtures/final/legacy_export.json
```

The CLI prints the same JSON report and records the run in `migration_runs`. If the database fails, the whole run is rolled back.

**The scale fixture** goes through exactly the same route, screen and code (F.27). No separate loader exists.

## What the importer does

- **Stable identity (F.06).** Each legacy id is mapped to our own internal id in `legacy_ids`, for example `LS01 → P_4496…` and `LP01 → proj_47db…`. A re-run finds records only through that table. It never matches by name, email, GitHub handle, repository URL or company domain, so renaming any of these keeps the same record.
- **Idempotent re-runs (F.02).** A content hash per record decides:
  - **created**: a new legacy id;
  - **updated**: same legacy id, changed content;
  - **skipped**: same legacy id, same content;
  - **conflict**: a record the importer could not use, reported with a reason.

  A profile that has since been claimed, or a record that staff merged, is never overwritten. It is reported as skipped.
- **Validation report (F.03).** Every run reports:
  - possible duplicate students (same email, or flagged in the export);
  - possible duplicate companies (same domain after removing `www.`);
  - broken references, which are reported and get no relationship;
  - unclaimed profiles;
  - profiles that were "claimed" on the old site, whose owners must claim them again here;
  - availability older than 365 days;
  - possible matches with records already on the platform, such as the Release 1 seed.

  Nothing is merged automatically.
- **Shared projects (F.04).** One project row per legacy project, with one accepted contributor relationship per valid contributor and their legacy role. The first valid contributor becomes maintainer, and staff can change that (F.19).
- **Partner history (F.05).** Collaborations keep their `past`/`current` status and their visibility:
  - only **public** collaborations become public project-partner links;
  - a **private** collaboration is stored but never returned by a public route;
  - a "limited" collaboration with no public summary is imported as private and reported.
- **Profiles (F.07, F.13 – F.15).**
  - Imported profiles have no owner until claimed.
  - `publication: retired` becomes a retired (archived) profile, never a deletion.
  - Availability keeps its last-confirmed date.
  - A profile with no availability is imported as Showcase Only.
  - The legacy email is stored privately and used only to decide claims (F.08). No public or student response ever includes it (F.20).
- **Archiving a batch.** **Archive what this import created** retires the batch's unclaimed profiles and archives its projects. It deletes nothing.

## Results for the supplied `legacy_export.json`

Expected values come from `legacy_expected_results.json`.

| Check | Expected | Our report |
|---|---|---|
| Source counts | students 6, projects 3, companies 3, collaborations 4 | same |
| Duplicate student | LS04 → LS01, "same email" | `{"legacy_id":"LS04","possible_duplicate_of":"LS01","reason":"same email"}` |
| Broken reference | LP02 / LS99 | `{"project_legacy_id":"LP02","student_legacy_id":"LS99"}` |
| Unclaimed profiles | LS02, LS05, LS06 | `["LS02","LS05","LS06"]` |
| First run | — | created 6 / 3 / 3 / 4, conflicts 0 |
| Second run, same file | no duplicates | created 0, skipped 6 / 3 / 3 / 4 |

Additional findings reported, but not acted on:

- Company LC02 may be LC01: same domain after removing `www.`.
- LS01 and LS03 were marked claimed on the old site but have no account here yet.
- LS02's availability was last confirmed on 2024-06-01, so it is stale.
- Records that match ones already on the platform are listed as `possible_existing_matches`, for staff to merge if they are the same:
  - on a fresh stack, five Release 1 seed records match by name or title (for example, LS01 "Avery Chen" matches seed `S01`, and LP01 "XR Anatomy Lab" matches seed `P04`);
  - on the live site, LC01 and LC02 also share a domain with the R4 partner North Shore Simulations, making seven matches.

Saved reports:

- `migration_report_local_run1.json` and `migration_report_local_run2.json`: a CLI run against a fresh copy of the stack with the Release 1 seed.
- `migration_report_live.json`: the run on the deployed site (see `release_submission.md`).

## What is shown on the deployed site after migration

| Legacy record | What the site shows |
|---|---|
| LS02 | Public. Its availability shows as "Not recently confirmed". |
| LS05 | Public and unclaimed. |
| LS06 | Its URL says the portfolio is archived. LP03 still credits it as "Retired Contributor (profile archived)". |
| LP01 | One project with both contributors. |
| LC01 | Past and current collaborations. |
| LC03 | Its private collaboration does not appear in any public response. |

LS04 and LC02 are deliberately **left unmerged** on the deployed site, so that peer QA Scenario D can merge them through the staff page. Merging is covered by `tests/final-api.js` and `tests/final-ui.js`.
