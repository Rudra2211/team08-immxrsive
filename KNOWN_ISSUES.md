# Known issues — Release 1

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | The free Render web service sleeps after about 15 minutes idle. The first request afterwards can take up to ~60 seconds, during which the directory shows a loading message. | Minor — delay only, no data loss. | Documented; accepted for this release. |
| 2 | Fixture external links point at `example.com` and `example.invalid` and do not resolve. | Minor — these are synthetic fixtures. Links open in a new tab and a malformed or missing URL renders as plain text, so no page breaks. | By design (R1.24). |
| 3 | The skill filter is a native multi-select, which needs Ctrl/Cmd-click for more than one choice on desktop. | Minor — the on-screen help explains it, and it is fully keyboard operable. | Candidate for a checkbox or combobox control in R2. |
| 4 | The directory loads all published students in one request with no pagination. | None at fixture scale (17 students). | Revisit if the dataset grows. |
| 5 | Inquiries are stored in our own `inquiries` table rather than being forwarded to the production Google intake form, which has not been supplied. | None for this release. | Simulated per `company_intake_simulation.md`; swap in the real form when provided. |
