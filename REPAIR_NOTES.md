# Reader regression investigation and repair — 2.1.7

## Finding established by reproduction

The disappearing reader has a reproducible CSS cause. The host starts with `all: initial !important`, plus important fixed positioning and right/bottom anchors. The added drag/restoration code assigns normal-priority `left`/`top`, then clears the original anchors. The important reset defeats the requested coordinates. An element appended after the body can consequently take its static position below the document while still being connected, displayed and error-free.

In a Chromium 149 reproduction with an 800-pixel-high viewport, requesting `left: 50px; top: 60px` through the old code yielded a bounding rectangle at **left 0, top 3040**. The repaired code sets all four insets at the same important priority. This reproduces the symptom without an Opera-specific API fault, a stylesheet transform or a hidden exception.

## Comparison of supplied releases

- **fixed-modes:** retains the user's single shared genre catalog. That change remains intact in this repair.
- **2.1.3:** adds completion sizing, dragging, font selection and per-hostname preferences. Introduces the normal-priority coordinate writes, asynchronous style/prefs measurement and inconsistent reader-versus-panel size model.
- **2.1.4:** adds coordinate clamping, but still writes coordinates at the defeated priority. Clamping before CSS settles and retaining oversized dimensions also remain problems.
- **2.1.5-debug:** adds logs; the geometry defect remains.
- **2.1.6-debug2:** adds a watchdog and removal diagnostics; the geometry defect remains. This is the source baseline used for the repair.
- All five supplied ZIPs declare **2.1.0** in their manifests despite their differing archive names. This makes update identification unnecessarily confusing. The repaired manifest/package and visible reader header identify **2.1.7**.

## Implemented repairs

1. Centralized coordinate writes set `left`, `top`, `right` and `bottom` with `!important`, consistently overriding the host reset.
2. Initial preference restoration waits for both stylesheet loading and the preference response. The host stays visually hidden until the first valid layout, preventing the old default-position flash.
3. Viewport constraints apply to dimensions as well as position. Clamping runs after restoration, drag, font/minimize changes, viewport changes and observed panel-size changes. Bounds cannot become negative when the panel exceeds a small viewport.
4. Completed translations resize the **outer panel** to the selected source area's width/height, capped to the viewport with minimum useful dimensions. Flex layout allocates room for the actual controls; the fixed 170-pixel allowance is removed. Long source containers fit the screen rather than extending below it.
5. Saved geometry has `geometryVersion: 2`. Earlier stored reader heights are converted using measured control height, then constrained. Invalid/non-finite legacy values are ignored. Font choices are validated consistently in the UI and background.
6. Pointer capture supports dragging and handles pointer cancellation/lost capture. The code no longer changes or clears the site's own `body.style.userSelect`. Dragging remains available before and after completion.
7. Previously saved site size is retained during subsequent jobs/navigation; completion fits the newly selected source. Font and position continue to persist per hostname.
8. **Reset view** clears only the current site's panel preferences and restores the default font/position/size. It does not erase profiles, API keys, glossaries or enabled-site state.
9. Preference-save failures are visible in the reader status rather than silently swallowed. Concurrent partial preference writes remain serialized in the background.
10. Routine debug/watchdog logging is removed. Existing trusted-storage restrictions, saved engines, glossary migration, source-preserving translation and the user's modes fix are preserved.
11. Narrow-window layout retains a minimum readable text area within the scrollable controls/body, rather than allowing translated text to collapse to zero height.

## What the attached conversation does and does not establish

Absence of a console exception does not rule out a layout bug. A connected element with `display: block` can still be off-screen. Unregistering a content script does not itself remove an already-created reader node. The supplied registration logs do not establish which action changed site state or prove that registration caused the visual disappearance. The existing preference-save route writes `panelPrefs`, not `enabledSites`; this is also covered by a regression.

The screenshots and source do not establish an Opera-specific failure, nor an actual transformed-root cause on LNMTL. This repair addresses the reproduced CSS/geometry errors rather than presenting those other theories as established diagnoses. Separate installation/browser-specific failures may still need evidence.

## Verification performed

- **29 automated regression tests passed:** the supplied 27 tests plus two background preference tests for concurrent merge, per-site isolation, validation, reset and enabled-state preservation.
- **Real Chromium browser layout/input run passed:** reproduction of old CSS failure; oversized legacy restoration; drag before completion; completion fit; source HTML preservation; drag after completion; font selection; 360 × 420 viewport; minimize/restore; reload; reset; no accidental `SITE_HIDE`; no uncaught page errors.
- The browser harness runs the actual `content.js`, `extract.js`, `shared.js` and `panel.css`. It uses a real DOM, CSS cascade and pointer input. Chrome messaging and translation-job replies are simulated. It obtains the closed shadow root for assertions only through test instrumentation; production keeps it closed.
- No live inference request, authenticated LNMTL session or installed Opera acceptance run was performed. Browser results demonstrate the layout repair, not GPU performance or universal website compatibility.
- Static syntax, local entrypoint references and final archive/source-byte checks are performed for the package.

Run the unit suite with `npm install` then `npm test`. For the separate UI test, install a Playwright Chromium browser (`npx playwright install chromium`) and run `node tests/panel-browser.cjs`, or supply `CHROMIUM_EXECUTABLE=/path/to/chromium`. The browser script starts only a local simulated page/server.

## Update and acceptance on the user's installation

Replace files in the same existing unpacked-extension folder, reload the extension, and refresh novel tabs so they receive the new content script. Confirm **2.1.7** in the browser extension details and the reader header. Do not uninstall as the update method.

On LNMTL: enable the site, verify the raw source selection, drag the panel, complete a chapter, change font size, reload, shrink the window and test Reset view. Previously saved oversized geometry should recover automatically; Reset view is a second recovery path. Keep the jobs tab open during translation as before.
