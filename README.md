# Webnovel Translator 2.1.7

A personal browser extension for novel translation using **llama.cpp (including SYCL)**, LM Studio, Ollama native, or an OpenAI-compatible endpoint. It preserves the website's original content and displays translated text in an isolated floating reader.

## Saved engines and popup switching (2.1)

1. In **Settings and glossaries**, click **New engine**.
2. Name it (for example, Local Qwen, Gemini, OpenAI, or DeepSeek), choose its provider preset, and enter its model/API key. Set the batch, sampling, language, context, and timeout values you want for that engine.
3. Click **Save engine and use it**. Repeat for the other engines.
4. Click the extension icon and use the **Translation engine** dropdown to switch. All saved settings and the key are restored automatically; you do not need to reopen Options.

Your current configuration/key become **My current engine** automatically on update. Select a saved engine in Options to edit or rename it. Selecting it there loads the form; **Save engine and use it** applies it. The popup selects a profile immediately. Switching works even when the active tab is a browser settings page.

Keys are stored separately for each profile, including two accounts sharing one endpoint. New jobs capture the selected profile's configuration and credential reference. Existing jobs continue/resume with their original engine and credential, even if you switch profiles or subsequently edit a key. Historical credential records are retained for those jobs; deleting an inactive profile removes it from the switcher but does not invalidate saved jobs. Select another engine before deleting the active one.

The switcher lists names/models only, never API keys. A revoked server permission must be granted again by saving that engine in Options. No provider requests run just because you open the dropdown; the next translation uses the selected engine.

Presets include llama.cpp/SYCL, LM Studio, native Ollama, Gemini, OpenAI/custom compatible APIs, and DeepSeek. Preset model IDs are editable examples; use model discovery to choose a model available to your account. Gemini uses Google's [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai); DeepSeek uses its [chat-completions endpoint](https://api-docs.deepseek.com/api/create-chat-completion/). OpenAI's preset uses [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), with supported streaming/schema output.

## Update without losing your data

1. Extract this package into the **same folder** used by your existing unpacked extension.
2. On `chrome://extensions` (or the equivalent Chromium browser page), click **Reload**. Do not uninstall the extension: uninstalling removes its local data.
3. Refresh existing novel tabs. This release replaces the old content script and permissions model.
4. Open the extension → **Settings and glossaries**. The initial v2 preset is llama.cpp at `http://localhost:8080/v1/chat/completions`, model `qwen3-8b`. Enter your actual address and model alias.
5. **Connect and list models**, optionally run **Test translation protocol**, then **Save engine and use it**. Browser permission prompts are initiated only by these explicit actions. A local unauthenticated server needs no dummy API key.
6. On a novel page, click the extension icon → **Enable reader on this site**. Access and injection are limited to enabled sites. Browser host permissions cover a hostname's ports; the extension's enable state distinguishes origins, and credentials are scoped to an exact endpoint.

Previous provider settings and credentials are retained in trusted extension storage. **Load previous provider settings** restores them into the options form if needed. Changing the endpoint or selecting another provider preset clears the displayed key. Saving affects new jobs; resumed jobs keep their original generation settings.

## llama.cpp with SYCL

SYCL is the inference backend inside llama.cpp; the extension still speaks the server's HTTP API. No SYCL-specific JSON or browser GPU setting is needed. Keep your existing working GPU/device/offload flags. See the official [SYCL backend guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md).

For a recent `llama-server` build, this is a starting command (replace the model path; keep your known working SYCL device flags):

```text
llama-server -m "Qwen3-8B.gguf" --alias qwen3-8b --host 127.0.0.1 --port 8080 -c 8192 -np 1 --jinja --reasoning off
```

Check your build's `--help`: flags and template controls evolve. The **Off** client setting sends `reasoning_effort: "none"`; the **Legacy** setting instead sends `chat_template_kwargs: {"enable_thinking": false}`. Do not confuse `reasoning_format: "none"` with disabling thinking: that controls parsing. Server flags, model template, and your installed build must support the selected control. These are documented by the [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

The llama.cpp adapter requests streamed SSE and a constrained JSON response schema. It can call `/tokenize` before generation. The measured text-token count includes an additional 512-token template/schema margin; it is not an exact tokenization of the fully rendered chat template. If tokenizer support is unavailable, you can explicitly turn it off to use a conservative UTF-8-byte estimate. Oversized batches are reduced or their source units split without breaking Unicode characters. An instruction prompt too large even for a small unit stops with an error.

Defaults to evaluate at your reported ~50 tokens/s:

| Setting | Default |
|---|---:|
| Source characters per batch | 1,000 |
| Output-token ceiling | 2,048 |
| Context budget | 8,192 |
| Temperature / top-p | 0.7 / 0.8 |
| Top-k / min-p | 20 / 0 |
| Thinking | Off |
| Total batch deadline | 180 seconds |
| No-data timeout | 60 seconds |
| Glossary text budget | 3,000 characters |
| Concurrent generation | One across the extension |

These are configurable starting values, not a measured optimum for your GPU. At 50 generated tokens/s, 2,000 tokens take about 40 seconds plus loading/prompt processing. Match context settings to the actual server allocation. If VRAM is tight, retain the smaller working server context and reduce batch/output budgets. SYCL device flags, quantization, flash attention, and GPU memory tuning remain server responsibilities.

## Reader and job behavior

- The source page is **never rewritten** for translation. The floating reader uses Shadow DOM and displays completed translations; **Read original** toggles its text with no model call. Original website markup, event listeners, entities, and formatting remain in the website.
- The picker saves a content selector per hostname. Escape cancels selection. Generic detection is heuristic: check it and use the picker if navigation/comments were selected. Select LNMTL's raw-language display before translating it.
- Story identity updates on ordinary and SPA navigation. Only exact route tokens and numbered chapter suffixes are removed; titles starting with `ch`, such as **Chaotic Sword God**, **Chasing…**, and **Chronicles…**, are retained. Manual overrides are saved against the detected novel key.
- **Auto-translate new chapters** watches source changes with bounded debounce. It does not automatically retry failed generation. Hiding the reader stops automatic starts but does not cancel an already queued/running job; use **Stop** for that.
- A **Translation jobs** extension tab opens when needed. Keep it open during inference. It owns long network requests, separate from the short-lived MV3 background worker. It also contains saved translations and metrics.
- **Stop** aborts the current request and preserves committed batches. **Resume missing batches** continues only the missing work; failed/partial JSON never overwrites saved results. Changed source text, disconnected nodes, or a different page/novel detach the old job from the page. Its saved results remain in the jobs tab.
- Job data, source units, completed batches, glossary updates, and cache entries are stored in IndexedDB. Completed batch/result/glossary commits are transactional. If the runner is interrupted, reopening it marks unfinished running jobs paused; explicitly Resume. Do not expect a generation in flight to survive closing the browser or jobs tab.
- Duplicate submissions share a persisted job when story, source, language, instructions, model/settings, and glossary edit revision match. Stopping a shared job stops it for all attached readers. Navigation detaches one reader and pauses work only when no attached source tabs remain.
- Cache entries include the relevant glossary content and generation settings. Manual glossary edits invalidate jobs built against an earlier edit revision; start a new translation from the page to use the edits. Existing completed batches are retained for reference.
- Cache is bounded to 300 batch entries. Job history is retained until you remove finished/stopped jobs in settings. Source text and results are local data; ordinary cache clearing does not erase glossaries.

## Glossary migration and language assignment

The v1.1 migration still runs before glossary operations. It combines identifiable old LNMTL chapter glossaries under stable novel keys, keeps original keys, preserves existing stable definitions, and records conflicts. Otherwise, the lowest numbered chapter's definition wins. Stable story settings are preserved; absent settings inherit from the highest numbered chapter. Download the migration report in settings.

The oldest `ch` prefix filter could collapse **Chaotic Sword God** and other titles to `glossary:lnmtl.com`; generic route keys such as `glossary:lnmtl.com/novel` were also ambiguous. They are retained for assignment rather than guessed.

**v2 glossaries include both story and target language. Old data did not record its language reliably, so choose it once:**

1. In **Glossary editor and legacy assignment**, select the merged stable legacy glossary (or an ambiguous host-only one).
2. Enter the correct Story ID and the language of its existing translations.
3. Click **Merge terms**. Existing target definitions win; conflicts remain reviewable. Do this for each legacy story you want to reuse.

If a host-only glossary contains multiple novels, edit the JSON to include only terms belonging to the chosen story before merging; repeat for the other story. All original legacy records remain saved.

Use the editor to correct terms, pin recurring terminology, inspect conflicts, and import/export JSON backups. **Save edited glossary** replaces the selected story/language terms; **Merge terms** preserves established definitions. Source-absent model suggestions and conflicting alternatives are recorded for review. New terms are accepted only when the source spelling occurs in the translated batch. This checks relevance, not linguistic accuracy.

Language names are trimmed/case-normalized identifiers: consistently use the same label (for example, `English`, not alternating `English` and `en`). API keys are omitted from glossary exports and job data. Content scripts cannot read trusted extension storage.

## Other servers

| Provider | Example endpoint | Notes |
|---|---|---|
| llama.cpp / SYCL | `http://localhost:8080/v1/chat/completions` | SSE; llama.cpp schema format, sampler and thinking controls; optional tokenizer. |
| LM Studio | `http://localhost:1234/v1/chat/completions` | SSE; standard JSON schema format. Configure thinking in the loaded model/server. |
| Ollama native | `http://localhost:11434/api/chat` | NDJSON; `think: false`, schema `format`, runtime options, model kept warm for 10 minutes. |
| OpenAI-compatible | Provider's full `/chat/completions` path | SSE; schema/JSON/prompt-only choices. API compatibility varies; protocol test before long jobs. |

Provider/model discovery preserves the chat endpoint API prefix and replaces `/chat/completions` with `/models`; native Ollama uses `/api/tags`. Generation never silently falls back to another provider or retries a paid request. Tests and jobs share the generation lock to avoid simultaneous inference on the local GPU. [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output), [Ollama chat API](https://docs.ollama.com/api/chat).

## Verification and limitations

Run `npm install` then `npm test` for the regression suite. Test dependencies are development-only; the extension has no runtime npm dependencies. Browser integration uses a local simulated server and mocked Chrome APIs; see the release checklist for its command and results.

This release was not tested against your physical SYCL GPU, your exact llama.cpp build, or a live authenticated LNMTL page. JSON schemas do not guarantee good translation. Unusual site layouts may still need the picker. Browser discard/close interrupts the job tab; saved work can be resumed, but there is no claim of uninterrupted background execution.

## Reader layout repair (2.1.7)

See `REPAIR_NOTES.md` for the reproduced disappearing-panel cause, release comparison, changes and QC evidence. Drag the header to move the reader. Font size and panel geometry are saved per hostname. Completion fits the whole panel to the selected source area, constrained to the viewport; a saved site size is retained during subsequent work. Reset view clears only this site’s reader geometry/font. The displayed header and manifest identify 2.1.7. Update in place, reload the extension, and refresh novel tabs.
