# Known issues — Release 1

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | The free Render web service sleeps after about 15 minutes idle. The first request afterwards can take up to ~60 seconds, during which the directory shows a loading message. | Minor — delay only, no data loss. | Documented; accepted for this release. |
| 2 | Fixture external links point at `example.com` and `example.invalid` and do not resolve. | Minor — these are synthetic fixtures. Links open in a new tab and a malformed or missing URL renders as plain text, so no page breaks. | By design (R1.24). |
| 3 | The skill filter is a native multi-select, which needs Ctrl/Cmd-click for more than one choice on desktop. | Minor — the on-screen help explains it, and it is fully keyboard operable. | Candidate for a checkbox or combobox control in R2. |
| 4 | The directory loads all published students in one request with no pagination. | None at fixture scale (17 students). | Revisit if the dataset grows. |
| 5 | Inquiries are stored in our own `inquiries` table rather than being forwarded to the production Google intake form, which has not been supplied. | None for this release. | Simulated per `company_intake_simulation.md`; swap in the real form when provided. |

# Known issues — Release 3

Issues 1, 2, 4 and 5 above still apply. Issue 3 was resolved in Release 2.

| # | Issue | Impact | Status |
|---|---|---|---|
| 6 | The GitHub import calls `api.github.com` unauthenticated, sharing a limit of 60 requests per hour per IP address. Heavy use by several reviewers at once can return "GitHub could not be reached just now". | Minor — the message says so and manual entry is always available, so no workflow is blocked. | Accepted. A server-side token would raise the limit but adds a long-lived secret for a feature that works without one. |
| 7 | The title-similarity duplicate warning is advisory and uses word overlap, so it will occasionally flag a genuinely unrelated project. | Minor — the warning states that nothing has been merged or changed, and creation is never blocked. R3.16 asks for a warning, not a classifier, and forbids automatic merging. | By design. |
| 8 | `project_contributors.role` has no database CHECK constraint, because the Release 1 fixture rows hold free-text roles outside the twelve-value vocabulary. New and updated roles are validated against `standard_roles.json` in the API instead. | None observable — every role set through the product is standardized, and legacy fixture roles display as they always did. | Deliberate. A constraint would have required migrating fixture data and risked an R3.25 regression for no behavioural gain. Tighten when the fixtures are reseeded. |
| 9 | Only the maintainer can edit shared project fields, so if a maintainer becomes unreachable the other contributors cannot update the shared record themselves — the maintainer has to transfer maintenance. | Minor for this release; no staff/admin override exists, and staff workflows are an explicit R3 non-requirement. | Known limitation of the authorized-editor model we chose and recorded in `RELEASE_NOTES.md`. |
| 10 | A project's `fallback_image_url` loads from whatever host the student supplies, so a slow third-party host makes the fallback image slow to appear. | Minor — the rest of the page, including the fallback note and all project details, renders immediately and never waits for it. | Accepted; `loading="lazy"` is set and a load failure degrades to a text message. |
