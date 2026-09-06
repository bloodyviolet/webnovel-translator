# Webnovel AI Translator (personal use)

Genre-aware AI translation for webnovels, with a persistent per-story glossary
so character names, cultivation ranks, and invented terminology stay
consistent from chapter to chapter — no server needed, runs entirely in the
extension using your own Gemini API key.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this folder.
2. Click the extension icon → **API key / settings** → paste your Gemini key
   (https://aistudio.google.com/apikey), pick a model, save.

## Use

1. Open a webnovel chapter page. A dark floating panel appears bottom-right.
2. Set the **Story ID** if the auto-guessed one looks wrong (it's derived
   from the URL — this is the key used to keep glossary/mode settings tied
   to *this specific novel*, separate from other novels on the same site).
3. Pick a **Genre mode**:
   - Xianxia, Xuanhuan, Wuxia, Murim, Isekai/LitRPG, Western Fantasy,
     Sci-Fi, General/Literal, or Custom (free-text style instructions).
4. Click **Translate this page**.
5. Toggle **Auto-translate future chapters** — after that, every new chapter
   page you load for this Story ID translates automatically using the same
   mode and the glossary built up so far, with no need to click anything.
6. **Show original / Show translation** button flips the visible text back
   and forth without re-calling the API.

## First-time setup on a new site (important for LNMTL)

The extension tries a generic heuristic to guess which part of the page is
the actual chapter text, but sites like LNMTL render their reader with a
JS framework whose exact structure can't be predicted in advance. If
**Translate this page** says it can't find chapter text, or grabs the wrong
thing (nav, comments, etc.):

1. On LNMTL specifically, first click the site's own **ZN** toggle near the
   top of the chapter (switches the display from LNMTL's built-in MTL to
   the raw Chinese/Korean/Japanese source) — you want the raw text on
   screen before picking, since that's what gets sent to Gemini.
2. Click **Pick chapter content area** in the floating panel.
3. Hover over the page — the block under your cursor gets outlined in
   blue. Click directly on the raw chapter text (not the sidebar, comments,
   or nav).
4. The extension remembers that spot **for the whole site** (by hostname),
   so every future chapter on lnmtl.com auto-detects the same area — you
   only need to do this once, not per chapter.
5. If LNMTL updates their template later and detection breaks again, just
   click **Pick chapter content area** again to re-teach it.

## How the glossary works

After every translation call, the model is asked to return any new proper
nouns, titles, or invented terms it introduced. Those get saved (per Story
ID) and included in every subsequent prompt for that story, so once a
character's name or a cultivation rank is translated one way, it stays that
way for the rest of the novel. You can see the running count in the panel;
there's no editor UI for it yet, but it's stored in
`chrome.storage.local` under `glossary:<storyKey>` if you ever want to
inspect or reset it via the extension's storage in DevTools.

## Known limitations

- **Content extraction is heuristic.** It picks the largest low-link-density
  text block on the page as "the chapter." Sites with unusual layouts
  (chapter text split across many small divs, chat-style comment sections
  that outsize the actual text, etc.) may need the extraction logic in
  `content.js` (`findContentContainer` / `extractParagraphs`) tuned for that
  site specifically — happy to adjust once you know which site(s) you're
  using most.
- **Inline formatting is lost.** Paragraphs are replaced by their translated
  text as plain text, so bold/italic emphasis inside a paragraph won't
  survive translation.
- **Very long chapters are batched** (default 6000 characters per API call,
  configurable in options) to avoid truncated responses — you'll see
  "Translating batch 2/4…" for those. Batches are translated in sequence, so
  the glossary from batch 1 is already available to batch 2, keeping names
  consistent even within one long chapter.
- **Auto-continue relies on detecting new chapter content**, either via a
  full page navigation (content script re-runs automatically) or, for
  sites that swap chapter text via JavaScript without reloading, a
  mutation-based fingerprint check. If a site's chapter-swap doesn't trigger
  that check reliably, let me know the site and I can tune the detection.
- **Personal use only** — don't redistribute translated chapters or publish
  this to the Chrome Web Store; that crosses into the same copyright
  territory the manga translator's README flags.
- **LNMTL's own site classes weren't inspected live** (Claude doesn't have
  a live browser to hover-inspect their Vue-rendered DOM), so the picker
  workflow above is the reliable path there rather than a hardcoded
  selector that might silently break.
