# GunnWatt Campus Connector

Import an Infinite Campus schedule through the official student portal, then use the saved import on this device. This optional extension supports desktop Chrome and Edge. The website now offers an install-free **Import into GunnWatt** bookmark as its default connection method; use that when extension setup is inconvenient.

## Install

1. Unzip `dist/gunnwatt-campus-connector.zip`, or use the built `dist/campus-extension` directory.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. Enable **Developer mode**.
3. Select **Load unpacked**, then select the folder containing `manifest.json`.
4. Reload GunnWatt. Choose **Connect Infinite Campus** and sign in on the official IC/ClassLink page.

The connector returns to GunnWatt after it reads the schedule. Use **Update saved schedule** when classes change. An expired IC login does not expire the saved import. **Forget Campus import** removes the connector's copy and stops date-based Campus updates; existing room choices remain in the schedule editor.

The toolbar popup can start an import, export the saved JSON, or forget it. The extension works with `https://xmccc-glitch.github.io/GunnMap/` and the development site on port 8000 at `127.0.0.1` or `localhost`. The website source in this change supplies the matching extension integration; an older deployed website needs that update before it can display the import.

## What stays on the device

You enter credentials on the official school site. The connector lets the browser attach its existing login cookies to three fixed, read-only resources:

- `/campus/resources/portal/roster`
- `/campus/resources/calendar/instructionalDay`, with the structure ID from that roster
- `/campus/resources/portal/dayEvent/byEnrollment`

The content script projects the responses to course names/numbers, section labels, rooms, period names, times, term dates and calendar dates. It omits student IDs, roster IDs, teacher names, contact details and the raw API objects. The extension stores this projected JSON in `chrome.storage.local`, outside browser-account sync storage. GunnWatt reads it through local extension messages. The website retains its existing room-draft/template cookies; it does not put the imported course metadata in those cookies.

The extension reads IC only after you start an import. Opening or refocusing GunnWatt reads the saved extension data. There is no connection to a Python companion, localhost API, cloud function or remote sync server.

## Build and test

```sh
npm ci
npm run build:extension
```

The build creates the unpacked extension and ZIP in `dist/`. Normal website and Pages builds include the ZIP download.

```sh
npm run typecheck
npm test
npm run build
npm run test:extension:browser
```

The browser test uses a disposable Chromium profile, a local static Pages build and synthetic IC responses. Install the test browser with `npx playwright install chromium`, or set `CAMPUS_BROWSER_PATH` to a compatible Chromium executable. It covers extension import, browser restart, expired sessions, offline date changes, failed updates, cancellation, origin/tab restrictions, and manual entry. It also verifies the install-free bookmark handoff, persistence, popup fallback, rejection of unsolicited messages and cross-tab forgetting during an import. Screenshots go to `output/playwright/`.

For a static development preview:

```sh
npm run build:pages
npm run preview:pages
```

Open `http://127.0.0.1:8000/GunnMap/`. This serves static files; the extension makes the IC requests on the user's device.

## Limits

These Campus Student resources are implementation details rather than a published integration contract. A portal change may require a connector update. The collector accepts JSON only from the fixed IC host and returns results only for the import's login tab or its child tabs.

The import includes every term present in the roster, so the website can switch semesters without reconnecting. Responsive sessions such as PRIME/SELF can change more often than the semester schedule; refresh the import when those selections change.

Safari/iPad distribution needs a Safari extension package and Apple signing. A managed school device may restrict extension installation. This ZIP is a desktop Chrome/Edge package.
