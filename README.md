# GunnMap

GunnMap is an unofficial map for Henry M. Gunn High School. Enter a seven-period schedule to highlight classrooms on the September 2026 campus map, find a room or building, and download a PNG. The app uses React in the browser and a TypeScript Node.js server.

The [district site map](https://resources.finalsite.net/images/v1788460107/pausdorg/fjembaqy0v2pmychgxlp/UpdatedGunncampusMap9-3-26.pdf) is the geographic reference. GunnMap has no verified 2026 evacuation routes or assembly assignments; the Evacuation Status page marks them as unconfirmed.

The [static GitHub Pages version](https://xmccc-glitch.github.io/GunnMap/) is deployed from the `github-page-10/6` branch. It generates images in the browser and has a different offline feature set from the Node server below.

## Run locally

Use Node.js 22.12 or newer. From this repository:

```sh
npm ci
npm run dev -- --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Port 8000 also matches the local origin accepted by the optional Infinite Campus connector. The server binds to `127.0.0.1` by default; `HOST` and `PORT` can change that. `npm run dev` builds the browser app before starting the server. After a browser edit, run `npm run build:web` and reload, or restart the server.

For a compiled build:

```sh
npm run build
npm start -- --port 8000
```

To build the static Pages artifact, run `npm run build:pages` and serve `dist/web` under `/GunnMap/`. The repository's Pages workflow deploys pushes to `github-page-10/6` when GitHub Pages uses **GitHub Actions** as its source. The static version has no Node API or personal-image store; it does not offer the server version's service worker or **Save offline**.

## Use the map

- **Schedule Map (`/`):** Enter up to seven rooms, choose colors, and select **Generate Map**. The PNG appears below the editor with download, zoom, and offline-save controls. Blank periods are allowed. If several periods use the same room, its highlight and legend show each color. **Undo**, **Redo**, examples, named templates, and share links are available in the editor.
- **Find a Room (`/find-room`):** Search a room number, alias such as `library`, or a building such as `N bldg` or `Bow Gym`. Choose a location when a label is ambiguous. The page keeps the map visible and highlights the chosen room or building.
- **Evacuation Status (`/evacuation`):** View the official site map and the current verification status. Period markers show saved classrooms only; they do not identify evacuation destinations.

Room matching ignores case, spaces, common hyphens, full-width characters, and zero padding on single-letter building room numbers. For example, `H-03` resolves to the printed `H3`. Some labels occur more than once, so choose the correct location when prompted. The generated image is unique to each render; existing `/generate-map?image=…` links still open their saved image.

Schedules and templates live in browser cookies on the device. A shared link opens a preview before you decide whether to save it. Editing a schedule clears its previous generated-map preview. The app does not use a GunnMap account or cloud schedule database.

Saved room selections include stable room IDs and a map revision. If the map or room inventory changes, review older saved schedules against the current directory before generating a new map. The editor retains the saved copy while you review it.

### Optional Infinite Campus connection

This feature needs the separate local companion service in `../infinite-campus-mcp`. Follow [its setup guide](../infinite-campus-mcp/README.md), then start it in a second terminal:

```sh
cd ../infinite-campus-mcp
.venv/bin/python server.py --http
```

Return to GunnMap at `http://127.0.0.1:8000/` and choose **Connect Infinite Campus**. The connector opens a local setup page, then an official school sign-in page. It serves current-term period JSON from `127.0.0.1:8765`; the browser fetches it on load and when the page regains focus. The connector allows the `http://127.0.0.1:8000` origin; another local port needs a corresponding connector configuration change.

Choose a schedule date to show that day's numeric periods and active courses. If a period has multiple active courses, select the right one. PRIME, SELF, and Study Hall appear as separate editable cards; recognized rooms can join the generated map. **Open Responsive Schedule** goes to Infinite Campus for choosing those sessions, and **Download period JSON** saves the returned data on request. A later refresh or date change imports Campus rooms again, so review manual edits after either action. Without the connector, you can still enter all seven periods by hand.

### Offline use

On localhost or HTTPS, wait for the “Campus maps are available offline on this device” message before disconnecting. The campus map and room lookup remain available offline; creating a new highlighted image requires the server. **Save offline** keeps one generated personal map in the browser. Saving another replaces it after the new image has downloaded successfully, and **Remove offline copy** deletes it. Browser storage settings can also clear saved data.

Public maps use lossless WebP for display and caching. **Download PNG** converts a display copy to PNG when needed, including offline. Public app updates activate after their complete cache is ready; saved personal maps have a separate cache.

## Map data

The September 2026 map already includes the N-building second floor and omits V building. Source PDF, clean page-one PNG, working PNG, and overlays live in `src/map/`. Room polygons and stable IDs live in `src/data/room_regions.json`; `room_index.csv` is the inventory; `building_regions.json` supplies whole-building polygons for Find a Room. Some boundaries are approximate where the printed map does not show a dividing line.

Duplicate upper K1/K2/K6 labels and central numbered rooms remain unselectable pending identification. The lower K6 is selectable. Historical `R069` selections resolve to the current printed K5 polygon. Titan Gym, Spangenberg Theater S130, the pool, and most athletic spaces are outside the room inventory; Bow Gym rooms BG111, BG138, and BG117 are selectable. `src/data/evacuation_data.json` records map provenance and leaves route assignments unconfirmed.

## Development

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` validates map data, compiles the server, builds the browser, creates lossless map assets, and builds the offline worker. `dist/` is generated. The server also needs `web/index.html`, `web/style.css`, the web manifest and icons, `public/assets/`, `src/map/`, and the `src/data/` JSON/CSV files at runtime. `src/web_app.ts` owns HTTP routes, `src/schedule_render.ts` generates maps, `src/build_pages.ts` prepares the static site, and `src/domain/` shares room and map contracts across runtimes.

The following examples write previews to `output/`; `map:rebuild` refreshes the working PNG in `src/map/`:

```sh
npm run highlight -- --rooms output/example.png 'A134=#ff595e' 'B117=#1982c4'
npm run highlight -- output/buildings.png 'A=red' 'Library=blue'
npm run map:index -- output/numbered_room_index.png
npm run map:preview -- output/schedule_preview.png --bow-gym-room BG111
npm run map:validate
npm run map:rebuild
```

`map:rebuild` copies the clean page-one PNG to the working map; pass an output path to preserve the working image. The schedule preview leaves Bow Gym blank unless you select BG111, BG138, or BG117.

### Server configuration

The server accepts JSON render requests from its own origin. Generated PNGs have unique URLs, `Cache-Control: no-store`, and a default seven-day retention period. `MAP_RETENTION_DAYS` changes that period. Limits below apply per Node process:

| Variable | Default | Controls |
| --- | ---: | --- |
| `RENDER_RATE_LIMIT` | 60 | Accepted renders per client per window |
| `RENDER_RATE_WINDOW_MS` | 60000 | Window length in milliseconds |
| `RENDER_RATE_CLIENTS` | 10000 | Tracked clients |
| `RENDER_CONCURRENCY` | 2 | Concurrent renders |
| `RENDER_QUEUE_LIMIT` | 8 | Waiting renders |
| `RENDER_QUEUE_TIMEOUT_MS` | 10000 | Queue wait in milliseconds |
| `MAP_STORAGE_BYTES` | 536870912 | Completed images and in-flight reservations |
| `MAP_MAX_BYTES` | 16777216 | Reservation and maximum size per image |

The server uses the socket IP for rate limiting and does not trust forwarded client headers. Set `PUBLIC_ORIGIN` to the public HTTPS origin behind a reverse proxy. Enable `ENABLE_HSTS=true` only with an HTTPS `PUBLIC_ORIGIN`. Multiple server processes need shared coordination for rate limits, queues, and generated-image storage. Generated personal images belong in `output/`; do not serve or overwrite a shared latest-map path.
