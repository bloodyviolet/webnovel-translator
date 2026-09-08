# Changelog

This changelog records the work from the original supplied extension through version 2.1.7. Earlier stages are reconstructed from the supplied source, implementation records and development archives; their headings do not imply that corresponding GitHub tags or public releases already exist. Unverified historical release dates are omitted.

## [2.1.7] — 2026-09-08

### Fixed

- Fixed the disappearing and undraggable reader introduced by the layout feature builds. The host's `all: initial !important` reset overrode normal-priority drag/restoration coordinates. All four positioning insets now use consistent priority.
- Wait for the stylesheet and saved preferences before revealing the initial reader layout, preventing incorrect measurements and the initial positioning flash.
- Constrain panel dimensions and coordinates after restoration, dragging, layout changes and viewport changes, including small windows and oversized saved preferences.
- Size the outer panel on translation completion instead of estimating reader height with a fixed control-height allowance. Flex layout accounts for the actual controls.
- Migrate older saved reader-height preferences to versioned outer-panel geometry; ignore invalid legacy geometry and validate supported font sizes.
- Replace mouse-only drag handling with pointer capture and cancellation handling. Preserve the website's own text-selection styles.
- Keep a usable text area in narrow windows and preserve saved site size during subsequent jobs.
- Make preference-save failures visible and remove temporary debug/watchdog logging.
- Set the manifest, package metadata and reader header to 2.1.7 so the installed build can be identified reliably.
- Correct the model-discovery documentation to describe provider-specific API prefixes.

### Added

- Reset view control to clear only the current site's reader position, size and font preferences.
- Background regression tests for concurrent preference updates, site isolation, validation, reset and preservation of site-enabled state.
- A reproducible Chromium layout/input harness and detailed investigation notes in `REPAIR_NOTES.md`.

### Validation

- All 29 automated regression tests passed.
- Real Chromium tests reproduced the old off-screen positioning failure and verified restoration, dragging before/after completion, completion sizing, font persistence, narrow viewports, minimize/restore, reload and reset.
- Browser tests verified source HTML preservation, no unintended site-hide request and no uncaught page errors. Chrome messaging and inference replies were simulated.
- JavaScript syntax, local references, manifest entrypoints and packaged source bytes were checked.
- The user subsequently confirmed the repaired extension was working. This is not a quantified benchmark or a claim of exhaustive Opera/LNMTL acceptance testing.

## Layout feature and diagnostic builds — archive labels 2.1.2–2.1.6

These were development iterations, not reliably distinct installed extension versions: all supplied feature/debug archives retained manifest version 2.1.0. The 2.1.2 behavior is described in the supplied conversation; no 2.1.2 archive was supplied for direct comparison.

### Added

- Resize the reader after translation completes to follow the selected content area's dimensions.
- Drag the reader by its header before and after resizing.
- Select reader font size beside the translation controls.
- Persist position, size and font preferences per hostname through trusted background message handling.

### Changed

- Added viewport clamping in the archive labeled 2.1.4.
- Added visibility/registration diagnostics in 2.1.5-debug and DOM/geometry watchdog diagnostics in 2.1.6-debug2.

### Known regression in these builds

- Coordinate writes conflicted with the host's important CSS reset. Additional size/restoration issues compounded the symptoms. These defects are repaired in 2.1.7; the diagnostic builds did not establish an Opera-specific root cause.

## Shared genre catalog correction — after 2.1.0

### Fixed

- Removed duplicated genre definitions from `legacy.js` and retained `modes.js` / `WNT_MODES` as the single source for both background dropdown/validation data and provider prompt guidance.
- Updated worker imports and migration test setup to load the shared catalog.
- The user's supplied shared-modes correction is preserved in 2.1.7.

## [2.1.0] — Saved translation engines

### Added

- Named engine profiles storing provider, endpoint, model, API key, target language, generation settings, context/output budgets, timeouts and glossary/tokenizer preferences.
- A Translation engine dropdown in the extension popup to switch complete saved configurations without re-entering settings.
- Options controls to create, edit, rename and delete inactive profiles.
- Automatic migration of the current configuration and credential into My current engine.
- Explicit Gemini, OpenAI and DeepSeek presets alongside llama.cpp, LM Studio and native Ollama.

### Fixed

- Preserve provider-specific prefixes when discovering cloud models.
- Isolate credentials for profiles sharing one endpoint.
- Give submitted jobs immutable credential references so switching profiles or editing a key does not silently change an existing job's engine/account.
- Serialize profile writes and reject duplicate names, unknown profiles, invalid internal references and revoked endpoint access without partially changing the active configuration.
- Keep popup engine selection usable on restricted browser pages; revert the selection when switching fails.

### Data behavior

- Profile summaries omit API keys. Keys are available only through trusted extension contexts.
- Deleting an inactive profile removes it from the switcher; historical credentials remain available to saved jobs. Deletion does not revoke a key at the provider.

### Validation

- Expanded the regression suite from 19 to 27 tests, including profile storage, credential continuity, API discovery and mocked popup/Options interactions.

## [2.0.0] — Reader and translation-runtime redesign

### Fixed

- Replace unconditional panel creation with persisted enabled-site visibility and cross-tab state updates.
- Eliminate the DOM-replacement feedback path that allowed translation to trigger its own MutationObserver and submit partially translated content.
- Use stable novel identity across numbered chapter slugs and SPA navigation; preserve novel names beginning with `ch` through exact route filtering.
- Prevent delayed results from entering a reader after its URL, story, source text or source-node connectivity changes.
- Extract nested text, line-break content and entities without duplicate traversal or destructive source-node replacement.
- Reject malformed, truncated, incomplete and cancelled output before committing a batch.
- Protect glossary edits and established terminology against stale model results and concurrent writes.
- Validate complete settings, Story IDs, provider endpoints, numeric limits and context/output headroom.

### Added

- An isolated Shadow DOM reader with original/translation switching, responsive bounds, keyboard labels/focus and live status.
- A content-area picker with saved selectors and Escape cancellation.
- A dedicated Translation jobs tab to own long inference requests independently of the Manifest V3 worker's short-lived control operations.
- IndexedDB persistence for jobs, source units, completed batches, glossaries and cache entries.
- Transactional batch/result/glossary/cache commits, explicit Stop and Resume missing batches, and interrupted-runner recovery.
- Persistent job reuse, source-tab ownership tracking and a bounded 300-entry batch cache.
- Separate streamed SSE and native Ollama NDJSON parsing, request cancellation, stall limits and total deadlines.
- Unicode-safe source splitting, context-driven batch reduction, optional llama.cpp tokenization with a template/schema margin, and an explicit conservative estimate fallback.
- A story-and-target-language glossary namespace, relevant/pinned-term prompt retrieval, conflict candidates, a glossary editor and JSON import/export.
- Provider presets, model discovery and a short translation-protocol test.
- llama.cpp thinking/schema/sampler controls, native Ollama options and one-at-a-time generation shared with protocol probes.

### Changed

- Preserve original website markup and interactions; show translated text in the reader instead of rewriting site paragraphs.
- Bound repeated DOM scanning and debounce relevant source changes. Do not automatically retry failed generation.
- Separate Hide from Stop: hiding prevents future automatic starts but does not cancel a submitted job.
- Restrict automatic injection to enabled sites with optional host access, restrict storage to trusted contexts, and omit API keys from jobs and glossary exports.
- Rewrite setup and lifecycle documentation for local models, llama.cpp/SYCL, glossary migration and recovery.

### Validation and limitations

- Established 19 regression checks and a separate Chromium integration baseline using simulated inference and Chrome extension APIs.
- SYCL acceleration remains a llama.cpp server responsibility. Client defaults are starting values, not a measured GPU optimum.
- Closing/discarding the jobs tab or browser interrupts in-flight generation; committed batches survive for explicit resume.
- Generic extraction and automatic terminology suggestions still require human review. No schema guarantees translation fidelity.

## Legacy repair stage — recorded as v1.1

### Fixed

- Consolidate identifiable LNMTL chapter-specific glossary keys under stable novel keys instead of creating an independent glossary for every chapter.
- Preserve existing canonical definitions; otherwise resolve duplicate terms in numeric chapter order, with the earliest chapter taking precedence.
- Preserve canonical story settings, inheriting missing settings from the highest numbered chapter where appropriate.
- Retain original records, report conflicts and malformed data, and make migration idempotent and recoverable after a failed write.
- Retain ambiguous host-only or generic-route glossaries for explicit assignment rather than guessing their novel.

### Migration note

The later story/language namespace requires the user to assign the target language of legacy translations. Ambiguous records containing several novels must be separated manually before assignment. An automatic legacy-key merge does not imply automatic language identification.

## Original supplied extension — comparison baseline

The initial working files were `background.js`, `content.js`, `manifest.json`, `options.html`, `options.js`, `popup.html`, `popup.js`, `panel.css` and `README.md`.

The initial user-reported defects were unconditional panel display, a translation-triggered mutation loop and chapter-specific LNMTL Story IDs. The subsequent work also addressed overbroad `ch` filtering, data consistency, extraction, request lifecycle, provider setup and local-model usability as described above.
