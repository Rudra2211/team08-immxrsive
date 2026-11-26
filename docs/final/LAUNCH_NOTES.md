# Launch notes and known issues: Final Release (F.40)

**Could this replace the existing ImmXrsive site?**

Yes, for the public directory, student portfolios, shared projects and partner history, with the limits below. The old site's data comes in through a repeatable import (`MIGRATION.md`). Staff can claim, merge, recover and archive records without deleting anything. Every earlier release journey still passes its automated suite (`REGRESSION_CHECKLIST.md`).

## What changed in the Final Release

- **Legacy import** (F.01 – F.06): staff page and CLI, with a validation report and stable legacy-id mapping.
- **Profile claims** (F.07 – F.10):
  - automatic only when the verified Algoma email equals the email on the legacy record; everything else goes to staff;
  - staff can approve, reject (with a note the student sees), reassign or clear an owner;
  - every change is logged.
- **Alumni and availability** (F.11 – F.14):
  - status (current/alumni) is separate from publication, and staff can change it;
  - verification never expires;
  - each profile is either **Active Talent** or **Showcase Only**;
  - availability carries a last-confirmed date, and anything older than 365 days is shown as "not recently confirmed" and left out of availability searches.
- **Lifecycle** (F.15, F.16): owners can **retire** (archive) and restore their profile. Shared projects still credit a retired contributor by name, without a link.
- **Merge and recovery** (F.17 – F.19):
  - staff merge duplicate students or partners, and every relationship moves to the surviving record;
  - the old URL redirects to the surviving record with a notice;
  - staff can assign a new project maintainer from the accepted contributors.
- **Scale** (F.27 – F.29): the directory is paged (24 per page, **Show more students**). The first request is about 8.5 KB with 230+ students, against about 6.8 KB with 17. Listing pages load no video, playable or full-size media.
- **Diagnostics** (F.32): server errors and failed GitHub, email-verification, company-import and migration attempts are recorded with time and context, but never secrets, codes or cookies. Staff see them on the records page.
- **Demo state** (F.37): maintainers can mark a demo Unavailable, Archived or Replaced. The Play action is withdrawn with an explanation, and the project and its fallback evidence stay public.

## Known limitations

| # | Limitation | Impact | Decision |
|---|---|---|---|
| 1 | The Render free tier sleeps after about 15 idle minutes, so the first request can take up to a minute. | Delay only. | Accepted for the course deployment. A paid instance removes it. |
| 2 | Legacy records that match Release 1 seed records by name or title (for example two "Avery Chen" profiles) are **reported**, not merged. | Visitors may see two similar profiles until staff merge them. | By design (F.06): a name is never an identity key. The report lists every match. |
| 3 | LS04 → LS01 and LC02 → LC01 are left unmerged on the live site. | Two near-duplicate records are visible. | Deliberate, so peer QA Scenario D has a real merge to perform. |
| 4 | Profiles marked "claimed" on the old site (LS01, LS03) have no owner here until that person signs in and claims them. Their verified email must match, or staff review the claim. | The profile is public but unmaintained until claimed. | Accepted: we cannot carry old-site accounts over. |
| 5 | Merging is supported for students and partners. Duplicate **projects** are not merged; they are archived. | Staff resolve a duplicate project by archiving one copy. | Within F.17, which needs students or companies. |
| 6 | The scale fixture's 220 synthetic students, 110 projects and 25 partners stay on the live site so reviewers can test Scenario G. | The directory shows "Synthetic Student …" entries. | Staff can archive the batch in one step from **Import history**; nothing is deleted. |
| 7 | Demos open in a new browser tab; nothing is embedded in our pages. | No in-page player. | Deliberate (F.33, F.35, F.36): no third-party runtime runs on our origin, and nothing asks for device permissions on page load. Closing the tab returns the visitor to an unchanged project page (F.38). |
| 8 | Staff accounts come from server environment variables, and there is one staff test account. | No screen for managing staff accounts. | Not required. |
| 9 | Email verification codes are sent through Brevo. If delivery fails, the student sees a retry message and the failure is logged. | That student cannot verify until delivery works again. Browsing is unaffected (F.30). | Accepted. |
| 10 | The GitHub repository import is unauthenticated (60 requests an hour per IP address). | When the limit is reached, the student enters project details by hand, as the message says. | Accepted, as in R3. |
| 11 | Cross-site cookies: the frontend and API are on different Render hosts, so strict third-party-cookie blocking (for example Edge InPrivate) prevents signing in. | Signed-in journeys need a normal browser window. | Documented in the test access. |

## Migration issues found in the supplied data

The details are in `MIGRATION.md`:

- LP02 lists LS99, who does not exist. The reference is reported, and LP02 keeps only Maya Patel.
- LS04 duplicates LS01 (same email), and LC02 duplicates LC01 (same domain).
- LS02's availability (2024-06-01) is stale, so it is not shown as current.
- LS05 has no email, so only staff can approve a claim on it.
- LS06 is retired. It stays credited on LP03.

## Operational assumptions

- Database migrations (`schema*.sql`) are additive and idempotent and run on every boot. No data is dropped.
- Secrets exist only as Render environment variables. The repository holds placeholders only (`backend/.env.example`), and we checked the git history for real values (F.23).
- Staff run the legacy import once after deploying. Re-running it is safe.

## Remaining risks

- The free-tier database (Supabase) and hosting have no uptime guarantee.
- Peer QA will change live data (claims, merges, demo state). The audit log on the records page shows who changed what and when.
