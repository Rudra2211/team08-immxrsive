# Scale evidence (F.27 – F.29)

## Dataset

`scale_fixture.json` from the Final Release fixtures (220 students, 110 projects, 25 partners) is checked in at `tests/fixtures/final/scale_fixture.json`. Its content is identical to the Moodle file: the SHA-256 of the compact JSON is `953004cc8a867a86feee3c604df90e1a6f8184e8f47449a40f8208058f3d1a6f` for both.

## Same import and query path (F.27)

- The file is imported through the same staff screen, route and code as the legacy export: `/admin-records.html` → `POST /api/staff/migrations` → `runMigration()`.
- Its students, projects, skills and availability land in the same tables that self-service profiles use. The directory and filters read them with the same query as any other student.
- No separate loader exists.

## Bounded directory loading (F.28)

`GET /api/students` returns one page: `limit` defaults to 24 (maximum 100) and `offset` selects the page. The body stays a plain array, and the total arrives in the `X-Total-Count` header. The directory page shows **Show more students** for the next page.

| Database | Students published | First directory request | Records in it |
|---|---|---|---|
| Release 1 seed only (local) | 17 | 6,762 bytes | 17 |
| Seed + legacy + scale fixture (local) | 230 | 8,502 bytes | 24 |
| Live site before the Final imports | 22 | 8,269 bytes | 22 |
| Live site after the legacy and scale imports (Nov 26, 17:34 UTC) | 235 | 8,540 bytes | 24 |

The first request stays about the same size, while the database grows tenfold. Measured by `tests/final-api.js` ("the first load is about the same size as with 20 students") and `tests/final-ui.js` (8,457 bytes with 241 students).

## Heavy media deferred (F.29)

- Directory and listing responses carry no resume, video, playable or full-size media URLs, and their cards render text only.
- `tests/final-ui.js` watches every network request while the directory loads and pages, and fails if any `.mp4/.webm/.pdf/.wasm/.glb/.unityweb` file or demo URL is requested.
- Demos open only when **Play demo** is clicked (F.33). Fallback images on a project page use `loading="lazy"`.

## Search and filters at scale

- `GET /api/students?skill=Blender&availability=contract` returns only students holding Blender who are Active Talent with fresh contract availability. Every result is checked in `tests/final-api.js`.
- Paging is stable: results are ordered by name, then id, and `offset=24` continues with no overlap.
