# Version 2.1.7 verification

## Automated regression suite

Run `npm install` and `npm test` from the extension source folder. Development dependencies are used only for tests; the installed extension does not load npm packages.

The suite contains 29 checks covering:

- Numeric-order legacy glossary merging, conflict precedence, data retention, malformed records, idempotence, and storage failure recovery.
- Novel titles beginning with `ch`, exact route filtering, and stable chapter IDs.
- Endpoint/numeric configuration validation and optional local authentication.
- Lossless Unicode-safe splitting and language-separated glossary retrieval.
- llama.cpp modern/legacy request controls, JSON schemas, and native Ollama options.
- Fragmented SSE/UTF-8/CRLF and native NDJSON parsing.
- Truncated/malformed/incomplete streams, cancellation, stall limits, and total deadlines.
- Transactional job/glossary/cache commits and rejection of cancelled or glossary-stale results.
- Nested sentence markup, BR-heavy text, entity handling, and preservation of source markup.
- Interrupted-runner recovery preserving completed batches and leaving queued/finished jobs unchanged.

## Engine profile verification (2.1)

Eight additional regression checks cover automatic configuration/key migration, full settings restoration, same-endpoint account isolation, old-job credentials after key edits/deletion, rejected changes, concurrent saves, API-prefix-correct model discovery, and popup/Options interactions. UI checks use a DOM test implementation and mocked Chrome APIs, not a live installed-extension session. Cloud model calls were not made with real credentials.

## Browser integration (v2.0 baseline)

Completed a separate Chromium integration run using a local simulated inference server and mocked Chrome extension APIs. This exercised real browser DOM, IndexedDB, streaming fetch, and the supplied reader/settings/job pages.

Verified:

1. Translation leaves source HTML unchanged.
2. Original/translation toggles issue no model requests.
3. Identical submissions reuse persisted completed jobs.
4. A failed batch can resume; committed results remain unchanged, and only missing/uncached work reaches the server.
5. Changing source text inside the same connected DOM node pauses the detached job and prevents a delayed result from entering the current reader.
6. SPA navigation updates identity to another novel beginning with `ch`.
7. Settings load and model discovery succeed against the simulated endpoint.

No uncaught page errors occurred in the successful run. The transient integration harness used simulated permission/tab/messaging APIs; this is not an installed-extension permission test. Runner recovery is covered by the included database regression test, not claimed as a completed live-browser close/reopen test.

## Static/package checks

All shipped JavaScript is checked with `node --check`. Manifest entrypoints, local HTML script/style references, ZIP integrity, and packaged source bytes are checked before delivery.

## Not measured here

No inference request was sent to the user's llama.cpp/SYCL hardware, and no live authenticated LNMTL session was used. Real throughput, translation quality, exact server/template compatibility, browser permission prompts, and GPU memory behavior still require the user's installation. The built-in protocol test provides a short first check against that installation.

## 2.1.7 panel regression verification

The supplied 27 tests and two new preference regressions pass (29 total). A separate real Chromium layout/input harness reproduces the old important-inset failure and verifies the repaired reader, dragging, completion sizing, restored oversized preferences, font persistence, narrow viewports, minimize/reset and source preservation. Chrome messaging and inference replies are simulated. See `REPAIR_NOTES.md` and `tests/panel-browser.cjs`; no installed Opera or live LNMTL/inference test is claimed.
