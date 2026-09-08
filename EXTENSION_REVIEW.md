# Version 2.1.7 implementation checklist

All changes below implement the previous review's proposed fixes/redesign. The previous v1.1 review remains in the file's version history; this document describes the delivered v2 behavior. Target: llama.cpp with SYCL. No special SYCL transport is required; hardware-specific acceleration stays in llama-server.

| Previous finding | Implemented response | Main files |
|---|---|---|
| Unstable story IDs, including names beginning with `ch` | Exact route filtering, chapter suffix stripping, book-link preference, persisted novel overrides, SPA identity refresh | `shared.js`, `extract.js`, `content.js`, `background.js` |
| Fragmented legacy glossaries | Non-destructive legacy merge retained; report and manual host-only assignment; explicit language assignment avoids relabeling unknown data | `legacy.js`, `options.js` |
| Concurrent writes and overwritten terminology | IndexedDB transactions for result/glossary/cache; established definitions win; edit revisions stop stale commits | `db.js`, `runner.js` |
| MV3 long-request lifetime | Dedicated extension job tab owns fetches; background handles only short control/storage operations | `runner.html`, `runner.js`, `background.js` |
| Streaming and interruptions | SSE and NDJSON parsers; cancellation, stall/total deadlines, finish validation, durable completed batches, explicit resume | `provider.js`, `db.js`, `runner.js` |
| Nested duplicate extraction / destructive BR fallback | Read-only text-node traversal, one visit per text node, real entity decoding, no source-node replacement | `extract.js` |
| Stale delayed results / SPA navigation | URL/story/source snapshot/node-connectivity checks, generation guards, detach on changes, old results retained outside current page | `content.js` |
| Failed retry loses original/toggle state | Immutable source job units; commit only valid complete batches; originals and previous translations remain available | `db.js`, `content.js` |
| Oversized paragraphs/context overflow | Unicode-safe splitting, source-based batching, llama tokenizer with margin or explicit conservative fallback, budget-driven batch/unit reduction | `shared.js`, `provider.js`, `runner.js` |
| Growing glossary / mixed output languages | Story-and-language namespace, budgeted relevant and pinned terms, review candidates, per-language editor/import/export | `shared.js`, `options.js`, `db.js` |
| Concurrent local GPU generation | One runner lock and shared generation lock; one queued job at a time; test probes use same lock | `runner.js`, `options.js` |
| Repeated work across tabs and retries | Persistent job IDs, ownership tracking, completed-unit resume, bounded batch cache keyed by source/model/settings/relevant glossary | `background.js`, `runner.js` |
| Expensive/unbounded DOM scanning | Cached chosen root, bounded fallback candidates, semantic selectors, scoped mutation relevance and maximum debounce delay | `extract.js`, `content.js` |
| Settings races and blank IDs | Centralized serialized writes and common canonicalization; full validated form saved atomically | `background.js`, `shared.js` |
| Panel initialization and visibility | Cross-tab state messages, repeatable initialization, explicit Stop separated from Hide, recoverable state loading | `content.js`, `popup.js` |
| Picker usability and copied event handlers | Escape cancellation and separate pointer overlay; no source attribute copying or source rewriting | `content.js` |
| Provider setup and validation | Presets, endpoint/model/numeric validation, model discovery, real short protocol probe, auth optional and endpoint-scoped | `options.html`, `options.js`, `provider.js` |
| Popup response races and unclear errors | Controls disabled during operations; restricted-page and permission errors distinguished | `popup.js`, `popup.html` |
| Broad automatic site injection | Optional host permissions and registered scripts only for enabled sites; scripting permission now actively used | `manifest.json`, `background.js` |
| API credentials accessible to content scripts | Trusted storage access level; job payloads omit credentials; only trusted pages change server configuration | `background.js` |
| Panel style interference and small viewports | Shadow DOM, viewport bounds, scrollable reader, keyboard focus, labels and live status | `panel.css`, `content.js` |
| Outdated provider documentation | Complete v2 setup, SYCL guidance, migration/assignment semantics, lifecycle limits | `README.md` |

## Saved-engine profiles added in 2.1

- Automatic migration of the active v2 configuration and credential to a named profile.
- Options supports creating, editing, renaming, and deleting inactive engine profiles.
- Popup dropdown selects a complete saved profile, including its model, endpoint, target language, generation settings, and API key.
- Profile lists contain no keys. Trusted settings requests can load the chosen profile's key into the editor.
- Profiles on the same endpoint can use different keys; new immutable credential references preserve the engine/key used by existing jobs.
- Provider presets now explicitly cover Gemini, OpenAI, and DeepSeek; model discovery preserves the correct API prefix.
- Profile operations use the existing serialized writer. Unknown profiles, duplicate names, or revoked permissions cannot partially switch active configuration.
- The popup engine switcher remains usable on restricted pages, independently of reader controls.

## llama.cpp compatibility choices

The current server documentation supports `reasoning_effort: "none"`, schema-constrained `response_format`, `/tokenize`, and streaming. Older builds may use `chat_template_kwargs.enable_thinking` instead. Both client controls are available; no silent guess/retry switches between them. `reasoning_format: "none"` is not used as an off switch. See the [official server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

The dedicated job tab avoids depending on MV3 worker fetch lifetime. A closed/discarded tab still interrupts generation; completed transactional commits survive and Resume is explicit. This is deliberate behavior, not a persistent-worker workaround.

All original-site markup stays on the page. Translation appears in the isolated reader rather than replacing paragraph nodes; this prevents the earlier framework-binding and toggle-restoration problems at their source.

## Known boundaries

- Actual SYCL hardware throughput, server/template compatibility, and translation quality still require testing on the user's setup.
- Token counts have a template/schema margin rather than exact server-rendered chat-template accounting. Server context must match the configured budget.
- No heuristic can infer the novel or language of mixed host-only legacy data. The assignment editor is provided; unknown data is not silently mixed into a novel.
- Relevant-term filtering requires exact source occurrence; inflected or variant spellings may need pinned terms or manual correction.
- Generic content selection remains heuristic. The picker handles unusual layouts; iframe/shadow-root readers need a future site-specific adapter.
- A schema controls structure, not fidelity. The glossary editor is the authority for correcting established terminology.
- Active queued jobs keep their submitted model/configuration. To adopt changed settings or glossary edits, submit again from the page; completed older jobs remain readable.

## Validation

The included tests cover legacy migration, `ch` titles, config limits, lossless Unicode splitting, language namespaces, relevant glossary selection, provider request formats, fragmented SSE/NDJSON, malformed/truncated streams, cancellation/deadlines, transactional commits, stale glossary edits, and nested/BR/entity extraction.

Browser integration uses real Chromium DOM, IndexedDB, streaming fetch, and the supplied UI, with a local simulated inference server and mocked Chrome extension APIs. It is not an actual installed-extension or live-SYCL benchmark. Detailed final results are in `TEST_RESULTS.md`.

## 2.1.7 follow-up

The user’s shared-modes change is retained. The disappearing/undraggable reader introduced by subsequent feature changes is repaired while preserving completion fit, header dragging, font selection and per-site preferences. Detailed confirmed causes, release provenance and acceptance checks are in `REPAIR_NOTES.md`.
