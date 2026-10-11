# GunnMap agent guide

This file applies to the `GunnMap/` TypeScript repository. The parent `YearLongProject/` has a separate Python prototype, and `../infinite-campus-mcp/` is a separate optional companion service. Read the parent `../AGENTS.md` when working across those directories. Preserve unrelated working-tree changes.

## Find the owning code

| Area | Source |
| --- | --- |
| Node HTTP routes, rendering, limits, retention | `src/web_app.ts`, `src/schedule_render.ts`, `src/server_policy.ts`, `src/generated_map_store.ts` |
| Room identity and inventory | `src/domain/room-matching.ts`, `src/domain/room-contracts.ts`, `src/project.ts`, `src/data/` |
| Map images and polygon rendering | `src/map/`, `src/map_highlighter.ts`, `src/build_map_assets.ts` |
| React routes and layout | `web/src/app/`, `web/src/pages/`, `web/style.css` |
| Schedule editor and Campus sync | `web/src/features/schedule/` |
| Room and building search | `web/src/features/rooms/` |
| Offline worker and precache | `web/offline/`, `src/build_offline.ts` |
| Static GitHub Pages build | `src/build_pages.ts`, `web/src/features/pages/` |
| Tests | `src/tests/` |

`dist/` and most of `output/` are generated. Keep application code in TypeScript/TSX, use Node.js 22.12 or newer, and install with `npm ci`. The optional Campus companion has its own Python environment; the GunnMap server does not need Python.

## Map and inventory rules

- Use source and working campus maps from this repository's `src/map/`. Resolve paths from that directory. Never overwrite the source PDF or clean page-one PNG when rebuilding. Keep map overlays within the 2448 × 1584 coordinate space so browser targets align.
- Keep existing room IDs stable and `src/data/room_index.csv` aligned with `room_regions.json`. `building_regions.json` supplies whole-building search polygons and aliases; keep its image size and coordinates aligned with the working map. Some building outlines are approximate.
- The September 2026 site map includes the N-building second floor and omits V building. Historical `R069` selections point to printed K5 (`R068`); lower K6 remains `R070`. Leave duplicate upper K1/K2/K6 labels unselectable until their identities are confirmed. Preserve the current athletic-space exclusions; BG111, BG138, and BG117 are the selectable Bow Gym rooms.
- `src/evacuation.ts` and `src/data/evacuation_data.json` must report assignments as unconfirmed until a current school plan verifies them. Do not infer routes, assembly points, or room destinations from the site map.

## Browser and server behavior

- Keep room normalization in `src/domain/room-matching.ts` and API types in `src/domain/room-contracts.ts` so the browser, server, and Pages build agree. Campus `H-03` style inputs must resolve to printed `H3` without changing stable `R` IDs. Find a Room accepts both rooms and whole buildings; the Node and Pages room directories include building polygons and map size.
- The Schedule Map shows new generated images below its editor. Keep legacy `/generate-map?image=…` links working. Every render must have its own image URL; never use a shared latest-map path. A schedule edit, load, date change, or Campus refresh must invalidate stale previews and async renders.
- Drafts and templates use versioned cookies. Preserve read-only compatibility with old cookie versions. Keep temporary shared schedules separate from the device draft until the user saves them.
- Saved selections include room IDs and map revisions. Preserve review of older schedules before using them with a changed map or inventory. Keep the Pages browser renderer and Node renderer aligned.
- The optional Campus connector is a local service at `127.0.0.1:8765`. GunnMap fetches period JSON when the page opens or regains focus. Date filters, multiple-course choices, and PRIME/SELF/Study Hall cards live in `web/src/features/schedule/campus-sync.ts` and the schedule editor. Keep Campus credentials and sessions out of this repository and do not make GunnMap write course selections. The connector currently permits `http://127.0.0.1:8000` as its local GunnMap origin.
- Keep render request JSON and same-origin checks, bounded admission, queue and storage reservations, and generated-image retention. The CSP permits the specific loopback connector; do not widen it without need. Public API and image fetches omit credentials. JavaScript-readable schedule cookies use Secure on HTTPS while localhost remains usable.
- Personal generated images use `no-store` and enter the offline cache only after an explicit **Save offline**. Keep them out of the public asset manifest. Public precache versions must include every response dependency, including building-region data for `/api/rooms`. Build lossless WebP display assets without replacing source PNGs; preserve offline PNG downloads.
- Put temporary renders in `output/` or a temporary directory. Commit only deliberate `demo_*.png` or `demo_*.webp` documentation images.

## Code design

- Keep modules responsible for one concrete concern. Route pages compose feature behavior; HTTP handlers manage requests and responses. Put rules shared by the server, browser, and offline worker in `src/domain/`.
- Use the implemented API and data contracts. Validate at their boundaries and report errors rather than guessing fields or silently changing business state.
- Preserve saved user data and rollback compatibility when refactoring storage. Remove unused code only after checking its callers. Test affected user flows and boundaries instead of mirroring implementation details.

## Verify the change

Run the checks that cover the edited area. Before finishing a code change, run:

```sh
npm run typecheck
npm test
npm run build
```

`npm run dev -- --port 8000` rebuilds browser modules before starting the server. After later browser edits, run `npm run build:web` and reload or restart. For rendering work, inspect a generated PNG and legend with a repeated room and N214. For UI work, check schedule editing and preview invalidation, Find a Room, offline save/download, and the relevant narrow-screen layout. For Campus work, test the connector flow at `127.0.0.1:8000` as well as a disconnected manual schedule.

## GitHub account

Before any GitHub write with `gh` or `git`, including push, pull request creation, merge, release, or repository settings, run `gh api user --jq .login` in the environment that will write. For the user's repositories expect `XmCCC-glitch` unless the user explicitly specifies another account. Do not proceed under a different or unverified account. Check again immediately before a merge or direct push to `main`. A commit author, email, or remote URL does not verify the authenticated account.

If sandbox DNS or network access blocks `gh`, retry the specific command with approved sandbox escalation. Do not treat that failure alone as an invalid saved token. Never print, copy, or store GitHub authentication tokens in a repository or task artifact.

After creating a pull request, post a separate comment containing exactly `@codex review` to request Codex review. Do not put that trigger in the pull request description.
