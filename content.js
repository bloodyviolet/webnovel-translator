(() => {
  let panel, statusEl, translateBtn, toggleBtn, autoCheckbox, modeSelect, customBox, storyInput, glossaryCountEl;
  let currentParagraphs = []; // { el, original, translated }
  let showingTranslation = false;
  let lastFingerprint = "";
  let modesLoaded = false;

  function sendMessage(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function guessStoryKey() {
    const host = location.hostname;
    const parts = location.pathname.split("/").filter(Boolean);
    const slug = parts.find((p) => /[a-zA-Z]/.test(p) && p.length > 3 && !/^(chapter|ch|page)/i.test(p));
    return host + (slug ? "/" + slug : "");
  }

  function settingsKey(storyKey) {
    return "settings:" + storyKey;
  }

  function containerSelectorKey() {
    return "containerSelector:" + location.hostname;
  }

  async function getSavedSelector() {
    const store = await chrome.storage.local.get({ [containerSelectorKey()]: null });
    return store[containerSelectorKey()];
  }

  async function saveSelector(sel) {
    await chrome.storage.local.set({ [containerSelectorKey()]: sel });
  }

  function cssPath(el) {
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        path.unshift(selector + "#" + CSS.escape(el.id));
        break;
      }
      let sibling = el;
      let nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.nodeName.toLowerCase() === selector) nth++;
      }
      selector += `:nth-of-type(${nth})`;
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(" > ");
  }

  function expandToLikelyContainer(startEl) {
    let el = startEl;
    while (el.parentElement && el.parentElement !== document.body) {
      const elLen = (el.innerText || "").length;
      const parentLen = (el.parentElement.innerText || "").length;
      if (parentLen <= elLen * 1.4) {
        el = el.parentElement;
      } else {
        break;
      }
    }
    return el;
  }

  let picking = false;
  let hoverEl = null;

  function onPickerMouseMove(e) {
    if (hoverEl) hoverEl.classList.remove("wnt-hover-highlight");
    hoverEl = e.target;
    hoverEl.classList.add("wnt-hover-highlight");
  }

  function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();
    stopPicking();
    const target = expandToLikelyContainer(e.target);
    const selector = cssPath(target);
    saveSelector(selector).then(() => {
      setStatus("Content area saved for this site.", false);
      lastFingerprint = ""; 
    });
  }

  function startPicking() {
    picking = true;
    document.body.classList.add("wnt-picking");
    document.addEventListener("mousemove", onPickerMouseMove, true);
    document.addEventListener("click", onPickerClick, true);
    setStatus("Click the raw chapter text on the page…", false);
  }

  function stopPicking() {
    picking = false;
    document.body.classList.remove("wnt-picking");
    document.removeEventListener("mousemove", onPickerMouseMove, true);
    document.removeEventListener("click", onPickerClick, true);
    if (hoverEl) hoverEl.classList.remove("wnt-hover-highlight");
    hoverEl = null;
  }

  async function loadSettings(storyKey) {
    const store = await chrome.storage.local.get({
      [settingsKey(storyKey)]: { mode: "general", customInstructions: "", auto: false },
      targetLang: "English",
    });
    return { ...store[settingsKey(storyKey)], targetLang: store.targetLang };
  }

  async function saveSettings(storyKey, patch) {
    const current = await loadSettings(storyKey);
    const merged = { ...current, ...patch };
    await chrome.storage.local.set({ [settingsKey(storyKey)]: merged });
    return merged;
  }

  function scoreElement(el) {
    const text = el.innerText || "";
    if (text.length < 200) return -1;
    let linkChars = 0;
    el.querySelectorAll("a").forEach((a) => (linkChars += (a.innerText || "").length));
    const density = text.length ? linkChars / text.length : 1;
    if (density > 0.3) return -1;
    return text.length;
  }

  async function findContentContainer() {
    const savedSelector = await getSavedSelector();
    if (savedSelector) {
      try {
        const el = document.querySelector(savedSelector);
        if (el && (el.innerText || "").length > 100) return el;
      } catch (e) {}
    }

    const candidates = document.querySelectorAll("div, article, section, main");
    let best = null;
    let bestScore = -1;
    candidates.forEach((el) => {
      const s = scoreElement(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    });
    return best;
  }

  function extractParagraphs(container) {
    // Looks for standard paragraphs or LNMTL's sentence tags
    let pEls = Array.from(container.querySelectorAll("p, .sentence, sentence"))
      .filter((p) => (p.innerText || "").trim().length > 0);

    // Fallback 1: Direct children (divs containing text)
    if (pEls.length === 0) {
      pEls = Array.from(container.children).filter(c => 
        c.tagName !== 'BR' && c.tagName !== 'HR' && c.tagName !== 'SCRIPT' && (c.innerText || "").trim().length > 0
      );
    }
    
    if (pEls.length >= 2) return pEls;

    // Fallback 2: Synthetic splitting for <br> heavy sites
    const html = container.innerHTML;
    const chunks = html.split(/<br\s*\/?>\s*<br\s*\/?>|\n{2,}/i).map((c) => c.trim().replace(/<[^>]+>/g, '')).filter(Boolean);
    if (chunks.length < 2) return pEls;

    container.innerHTML = "";
    const newEls = [];
    chunks.forEach((chunk) => {
      const p = document.createElement("p");
      p.innerText = chunk;
      container.appendChild(p);
      newEls.push(p);
    });
    return newEls;
  }

  function fingerprintText(pEls) {
    const text = pEls.map((p) => p.innerText).join("|").slice(0, 500);
    return pEls.length + ":" + text.length + ":" + text.slice(0, 100);
  }

  function chunkParagraphs(pEls, maxChars) {
    const chunks = [];
    let current = [];
    let currentLen = 0;
    pEls.forEach((p) => {
      const len = p.innerText.length;
      if (currentLen + len > maxChars && current.length > 0) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(p);
      currentLen += len;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  async function translateCurrentPage() {
    const storyKey = storyInput.value.trim() || guessStoryKey();
    const cfg = await chrome.storage.local.get({ chunkChars: 6000, targetLang: "English" });

    const container = await findContentContainer();
    if (!container) {
      setStatus("Could not find chapter text. Try \"Pick chapter content area\".", true);
      return;
    }
    
    const pEls = extractParagraphs(container);
    if (pEls.length === 0) {
      setStatus("No paragraphs found.", true);
      return;
    }

    lastFingerprint = fingerprintText(pEls);
    currentParagraphs = pEls.map((el) => ({ el, original: el.innerText, translated: null }));

    const chunks = chunkParagraphs(pEls, cfg.chunkChars);
    translateBtn.disabled = true;

    for (let i = 0; i < chunks.length; i++) {
      setStatus(`Translating batch ${i + 1}/${chunks.length}…`, false);
      const chunkEls = chunks[i];
      const paragraphs = chunkEls.map((p) => p.innerText);

      const res = await sendMessage({
        type: "TRANSLATE_TEXT",
        storyKey,
        mode: modeSelect.value,
        customInstructions: customBox.value,
        targetLang: cfg.targetLang,
        paragraphs,
      });

      if (!res || !res.ok) {
        setStatus("Error: " + (res && res.error), true);
        translateBtn.disabled = false;
        return;
      }

      chunkEls.forEach((p, idx) => {
        const translated = res.translations[idx] || p.innerText;
        const entry = currentParagraphs.find((e) => e.el === p);
        if (entry) {
          entry.translated = translated;
          
          // CRITICAL FIX: Replace the entire node to sever Vue.js / React bindings
          const newP = document.createElement(p.tagName === "DIV" || p.tagName === "P" ? p.tagName : "p");
          Array.from(p.attributes).forEach(attr => newP.setAttribute(attr.name, attr.value));
          newP.innerText = translated;
          
          if (p.parentNode) {
            p.parentNode.replaceChild(newP, p);
          }
          entry.el = newP; // Update reference for toggle functionality
        }
      });

      glossaryCountEl.textContent = `Glossary: ${res.glossarySize} terms`;
    }

    showingTranslation = true;
    toggleBtn.disabled = false;
    toggleBtn.textContent = "Show original";
    translateBtn.disabled = false;
    setStatus("Done.", false);
  }

  function toggleOriginal() {
    currentParagraphs.forEach((entry) => {
      if (entry.translated == null) return;
      entry.el.innerText = showingTranslation ? entry.original : entry.translated;
    });
    showingTranslation = !showingTranslation;
    toggleBtn.textContent = showingTranslation ? "Show original" : "Show translation";
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? "#c0392b" : "#aaa";
  }

  async function maybeAutoTranslate() {
    const storyKey = storyInput.value.trim() || guessStoryKey();
    const settings = await loadSettings(storyKey);
    if (!settings.auto) return;

    const container = await findContentContainer();
    if (!container) return;
    const pEls = extractParagraphs(container);
    if (pEls.length === 0) return;

    const fp = fingerprintText(pEls);
    if (fp === lastFingerprint) return;
    translateCurrentPage();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(maybeAutoTranslate, 800);
  });

  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "wnt-panel";
    panel.innerHTML = `
      <div id="wnt-header">
        <span>Webnovel Translator</span>
        <button id="wnt-min">–</button>
      </div>
      <div id="wnt-body">
        <label>Story ID <input id="wnt-story" type="text" /></label>
        <label>Genre mode
          <select id="wnt-mode"></select>
        </label>
        <textarea id="wnt-custom" placeholder="Custom style instructions…" style="display:none"></textarea>
        <label class="wnt-row"><input type="checkbox" id="wnt-auto" /> Auto-translate future chapters</label>
        <button id="wnt-translate">Translate this page</button>
        <button id="wnt-toggle" disabled>Show original</button>
        <button id="wnt-pick">Pick chapter content area</button>
        <div id="wnt-status"></div>
        <div id="wnt-glossary-count">Glossary: 0 terms</div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    statusEl = panel.querySelector("#wnt-status");
    translateBtn = panel.querySelector("#wnt-translate");
    toggleBtn = panel.querySelector("#wnt-toggle");
    autoCheckbox = panel.querySelector("#wnt-auto");
    modeSelect = panel.querySelector("#wnt-mode");
    customBox = panel.querySelector("#wnt-custom");
    storyInput = panel.querySelector("#wnt-story");
    glossaryCountEl = panel.querySelector("#wnt-glossary-count");

    storyInput.value = guessStoryKey();

    panel.querySelector("#wnt-min").addEventListener("click", () => {
      panel.classList.toggle("wnt-minimized");
    });

    translateBtn.addEventListener("click", translateCurrentPage);
    toggleBtn.addEventListener("click", toggleOriginal);
    panel.querySelector("#wnt-pick").addEventListener("click", startPicking);

    modeSelect.addEventListener("change", async () => {
      customBox.style.display = modeSelect.value === "custom" ? "block" : "none";
      await saveSettings(storyInput.value.trim(), { mode: modeSelect.value });
    });

    customBox.addEventListener("change", async () => {
      await saveSettings(storyInput.value.trim(), { customInstructions: customBox.value });
    });

    autoCheckbox.addEventListener("change", async () => {
      await saveSettings(storyInput.value.trim(), { auto: autoCheckbox.checked });
    });

    storyInput.addEventListener("change", async () => {
      await refreshForStory(storyInput.value.trim());
    });

    loadModes();
    refreshForStory(storyInput.value);
  }

  async function loadModes() {
    const res = await sendMessage({ type: "GET_MODES" });
    if (!res || !res.ok) return;
    modeSelect.innerHTML = res.modes.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
    modesLoaded = true;
  }

  async function refreshForStory(storyKey) {
    if (!storyKey) storyKey = guessStoryKey();
    const settings = await loadSettings(storyKey);
    if (modesLoaded) modeSelect.value = settings.mode || "general";
    customBox.value = settings.customInstructions || "";
    customBox.style.display = settings.mode === "custom" ? "block" : "none";
    autoCheckbox.checked = !!settings.auto;

    const glossRes = await sendMessage({ type: "GET_GLOSSARY", storyKey });
    if (glossRes && glossRes.ok) {
      glossaryCountEl.textContent = `Glossary: ${Object.keys(glossRes.glossary).length} terms`;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SHOW_PANEL" && panel) {
      panel.classList.remove("wnt-minimized");
    }
  });

  buildPanel();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setTimeout(async () => {
    const storyKey = storyInput.value.trim() || guessStoryKey();
    const settings = await loadSettings(storyKey);
    if (settings.auto) translateCurrentPage();
  }, 500);
})();