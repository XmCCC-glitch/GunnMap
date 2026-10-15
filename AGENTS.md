# Repository guide for coding agents

## Project layout

This file documents the TypeScript application in this repository.

```text
GunnMap/
├── AGENTS.md, README.md, PLAN.md  # Agent guidance and project documentation
├── package.json, package-lock.json # npm commands and dependency lockfile
├── tsconfig*.json, vite.config.ts   # TypeScript and browser build configuration
├── src/
│   ├── web_app.ts                   # Node HTTP server and API routes
│   ├── project.ts, evacuation.ts    # Inventory loading and evacuation rules
│   ├── map_highlighter.ts, map_cli.ts
│   ├── build_*.ts, validate_map_data.ts, n_floor_validation.ts
│   ├── data/                        # Room polygons, CSV index, evacuation data
│   ├── domain/                      # Room matching shared with the browser
│   ├── map/                         # Source and working map images and overlays
│   └── tests/                       # Node, browser, rendering, and offline tests
├── web/
│   ├── index.html, style.css, icons and manifest
│   ├── offline/                     # Service worker source and policy
│   └── src/
│       ├── app/                     # React entry, routes, and shell
│       ├── pages/                   # Schedule, evacuation, room, generated map
│       ├── features/                # Reusable feature behavior and controls
│       └── shared/                  # Shared UI, types, and notifications
├── public/assets/                   # Navigation and control SVGs
├── output/                          # Rendered maps and documentation demos
└── dist/                            # Generated server and browser output
```

- `src/map_highlighter.ts` is the Sharp renderer for building and room polygons, including color strips for repeated rooms.
- `src/web_app.ts` serves the React SPA shell and JSON APIs, attaches assembly information, and atomically writes unique per-render PNGs. `src/output_retention.ts` manages expiry. Never write or expose a shared latest-map URL.
- `web/src/app/` contains the React bootstrap, route table, and persistent navigation shell. `web/src/pages/` contains the four route pages; reusable schedule, room, map, and evacuation behavior belongs under `web/src/features/`; shared controls and notifications belong in `web/src/shared/`.
- `src/domain/room-matching.ts` contains room identity matching shared by the browser and Node server. Keep cross-runtime domain rules outside `web/src/`.
- `web/index.html` is the shared SPA shell. Vite builds the browser entry from `web/src/app/main.tsx` into `dist/web/main.js` and `dist/web/ui.css`; the server returns the same shell for `/`, `/evacuation`, `/find-room`, and `/generate-map`.
- `src/evacuation.ts` and `src/data/evacuation_data.json` keep evacuation assignments unconfirmed until a verified plan for the 2026 map is available.
- `src/project.ts` loads the inventory and resolves room IDs and aliases.
- `src/schedule_preview.ts` renders the example schedule; `src/build_n_map.ts` refreshes the working map from the clean September 2026 PNG, which already includes the N-building second floor.
- `src/data/room_regions.json` contains selectable room polygons; `src/data/room_index.csv` is the human-readable index. `src/data/building_regions.json` contains building-level polygons.
- `src/map/` contains source and working map assets. Deliberate `output/demo_*.png` and `output/demo_*.webp` previews may be tracked.
- All code that needs a campus map must use the map assets in this repository's `src/map/`. Server code should resolve files there, and browser code should request the routes or built derivatives backed by those files. Keep generated personal maps in `output/` and built display assets in `dist/web/`.

## Working conventions

- Use Node.js 22.12 or newer, React, and strict TypeScript for browser, server, rendering, and test code. Install dependencies with `npm ci`; keep application source in TypeScript/TSX and do not add a Python runtime. Generated JavaScript belongs in ignored `dist/`.
- Preserve room IDs for identifiable existing rooms and keep `src/data/room_index.csv` aligned with inventory changes. Historical `R069` selections resolve to the printed K5 (`R068`) polygon; lower K6 remains `R070`. Duplicate upper K1/K2/K6 labels stay unselectable until their identities are confirmed.
- Polygon coordinates refer to the 2448 × 1584 map. Keep PNG legends within those dimensions so interactive room targets remain aligned.
- Do not overwrite the source PDF or clean page-one PNG when rebuilding the working map.
- Retain the documented selection scope: V rooms and most athletic spaces are excluded; selectable Bow Gym rooms are BG111, BG138, and BG117.
- Schedule drafts and templates use cookies. Every schedule edit or load must invalidate generated map previews, and stale async results must not navigate to an outdated image.
- Each rendered image has its own URL. Never replace a previous tab's image with another tab's generated map.
- Personal images use no-store and enter the offline cache only after explicit Save offline. Keep public cache upgrades separate from the saved personal image. `src/build_offline.ts` builds a versioned worker from `web/offline/`; include new public dependencies in its precache inputs.
- Build lossless display WebP derivatives with `src/build_map_assets.ts`; never overwrite the source PNGs. Preserve offline Download PNG by encoding the cached display copy on demand. Keep every displayed map's original pixel dimensions.
- Public precache revisions are per resource; reuse only matching revisions from complete previous caches. Retain bounded network fallback and atomic cache activation. Personal maps must never enter the public asset manifest.
- Render requests must pass JSON and same-origin checks, bounded admission and storage reservations before expensive work. Do not trust forwarded client headers implicitly or bypass the generated-image store in HTTP routes.
- Keep browser scripts compatible with the server CSP. Public API/image fetches omit credentials; JavaScript-readable schedule cookies use Secure on HTTPS while localhost development remains usable.
- Use v2 draft/template cookies and keep legacy cookies read-only. Temporary shared schedules must stay separate from the local draft until explicitly saved.
- Do not infer evacuation routes or destinations from the September 2026 site map. All room assignments remain unconfirmed until a current school evacuation plan is verified.
- Put temporary renders in `output/` or a temporary directory; commit only deliberate `demo_*.png` or `demo_*.webp` files for documentation.

## GitHub account and main branch

- For requests involving a pull request (for example, “help me create PR”), merging, or changing `main`, check the currently authenticated GitHub account with `gh api user --jq .login` before taking any action that would merge into or directly update `main`.
- Only merge a pull request into `main` or push changes directly to `main` when that command returns exactly `Ijustneedanid` or `XmCCC-glitch`. Check again immediately before the merge or push; a Git commit author, email address, or remote URL is not proof of the authenticated account.
- If the account cannot be verified or does not match either allowed login, do not merge or push to `main`. Explain the result to the user and leave any prepared pull request open for an authorized account to merge.

## Verification

- Run `npm run typecheck`, `npm test`, and `npm run build`.
- `npm run dev` builds the browser modules before starting the TypeScript server. Run `npm run build:web` after browser source edits, or restart the development server. `npm start` uses the compiled server and requires `npm run build` first.
- For rendering changes, generate a representative map including a repeated room and N214, and inspect the PNG and legend.
- For interface changes, run `npm run dev -- --port 8000` and check draft restoration, templates, sharing, generation, download, classroom evacuation details, and invalidation after edits.
