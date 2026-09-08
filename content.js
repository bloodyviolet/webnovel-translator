(() => {
  if (globalThis.__wntReader) { globalThis.__wntReader.refresh(); return; }
  const U = WNT, X = WNTExtract;
  let host, shadow, state, root, snapshot, currentJob, showingOriginal = false, panelEl, resizedForJob = null;
  let busy = false, refreshBusy = false, refreshAgain = false, navigating = false, generation = 0, initialized = false;
  let debounce, maxDebounce, navigationTimer, pollTimer, lastURL = location.href, lastDetected = X.detectStory(), lastAuto = '', lastJobRender = '';
  let picker = null, outline, panelReady = false, drag = null, layoutFrame;
  let preferredSize = {}, prefsRevision = 0;
  const ui = id => shadow?.getElementById(id);
  async function send(type, values = {}) {
    const res = await chrome.runtime.sendMessage({ type, ...values });
    if (!res?.ok) throw Error(res?.error || 'Extension unavailable. Reload this page after updating the extension.');
    return res;
  }
  function status(text) { if (ui('status')) ui('status').textContent = text; }
  function build() {
    if (host) return;
    host = document.createElement('div'); host.dataset.wntUi = 'reader';
    host.style.cssText = 'all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;display:block!important;visibility:hidden!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('link');
    const cssReady = new Promise((resolve, reject) => { css.onload = resolve; css.onerror = () => reject(Error('Reader stylesheet failed to load. Reload this page.')); });
    css.rel = 'stylesheet'; css.href = chrome.runtime.getURL('panel.css'); shadow.append(css);
    const panel = document.createElement('section'); panel.id = 'panel'; panel.setAttribute('aria-label', 'Webnovel translator');
    panel.innerHTML = `<header><strong>Webnovel Translator 2.1.7</strong><button id="min" aria-label="Minimize reader">−</button><button id="hide" aria-label="Hide reader on this site">×</button></header>
      <div id="body"><label>Story ID<input id="story" type="text"></label><label>Genre<select id="mode"></select></label><label id="customLabel" hidden>Custom instructions<textarea id="custom" maxlength="8000"></textarea></label><label class="row"><input id="auto" type="checkbox">Auto-translate new chapters</label>
      <div class="buttons"><button id="translate">Translate / resume</button><button id="stop" disabled>Stop</button><button id="toggle" disabled>Read original</button><button id="pick">Pick content area</button><select id="fontSize" aria-label="Reader font size"><option value="14">Font: Small</option><option value="16" selected>Font: Medium</option><option value="18">Font: Large</option><option value="22">Font: X-Large</option><option value="26">Font: Huge</option></select><button id="resetView">Reset view</button></div><p id="status" role="status" aria-live="polite"></p><p id="identity"></p><div id="reader" tabindex="0" aria-label="Chapter text"></div></div>`;
    shadow.append(panel); document.documentElement.append(host);
    panelEl = panel;
    ui('min').onclick = () => { ui('body').hidden = !ui('body').hidden; panelEl.classList.toggle('minimized', ui('body').hidden); clampToViewport(); };
    ui('hide').onclick = () => send('SITE_HIDE').catch(e => status(e.message));
    ui('translate').onclick = () => translate(true);
    ui('stop').onclick = async () => { if (currentJob) { await send('JOB_STOP', { id: currentJob.id }).catch(e => status(e.message)); await poll(); } };
    ui('toggle').onclick = () => { showingOriginal = !showingOriginal; lastJobRender = ''; renderJob(); };
    ui('pick').onclick = startPicker;
    ui('fontSize').onchange = () => { const px = Number(ui('fontSize').value); prefsRevision++; applyFontSize(px); clampToViewport(); savePrefs({ fontSize: px }); };
    wireDrag(panel.querySelector('header'));
    ui('resetView').onclick = resetView;
    for (const id of ['story', 'mode', 'custom', 'auto']) ui(id).onchange = async () => {
      try {
        if (currentJob && ['running', 'queued'].includes(currentJob.status)) await detach();
        state = await send('STORY_SETTINGS', { detected: lastDetected, story: ui('story').value, patch: { mode: ui('mode').value, customInstructions: ui('custom').value, auto: ui('auto').checked } });
        applyState(); lastAuto = ''; scheduleCheck();
      } catch (e) { status(e.message); }
    };
    loadPanelPrefs(cssReady);
    new ResizeObserver(() => { cancelAnimationFrame(layoutFrame); layoutFrame = requestAnimationFrame(clampToViewport); }).observe(panel);
  }
  // all:initial!important also resets every inset. Override ALL four with equal priority.
  function position(left, top) {
    for (const [key, value] of Object.entries({ left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' })) host.style.setProperty(key, value, 'important');
  }
  function viewport() {
    const v = window.visualViewport;
    return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0, width: v?.width || innerWidth, height: v?.height || innerHeight };
  }
  function clampToViewport() {
    if (!panelReady || !host?.isConnected || !state?.visible) return;
    const v = viewport(), margin = Math.min(12, v.width / 4, v.height / 4);
    const maxW = Math.max(1, v.width - 2 * margin), maxH = Math.max(1, v.height - 2 * margin);
    panelEl.style.maxWidth = maxW + 'px'; panelEl.style.maxHeight = maxH + 'px';
    panelEl.style.width = Math.min(preferredSize.width || 470, maxW) + 'px';
    panelEl.classList.toggle('sized', !!preferredSize.height);
    panelEl.style.height = preferredSize.height && !ui('body').hidden ? Math.min(preferredSize.height, maxH) + 'px' : '';
    const rect = panelEl.getBoundingClientRect();
    const explicit = host.style.left && host.style.left !== 'auto';
    const left = explicit ? parseFloat(host.style.left) : v.left + v.width - rect.width - margin;
    const top = explicit ? parseFloat(host.style.top) : v.top + v.height - rect.height - margin;
    position(Math.min(Math.max(Number.isFinite(left) ? left : v.left, v.left + margin), Math.max(v.left + margin, v.left + v.width - rect.width - margin)),
      Math.min(Math.max(Number.isFinite(top) ? top : v.top, v.top + margin), Math.max(v.top + margin, v.top + v.height - rect.height - margin)));
  }
  function savePrefs(patch) { return send('PANEL_PREFS_SAVE', { patch }).catch(e => status('View preference was not saved: ' + e.message)); }
  function geometryPrefs() {
    const rect = panelEl.getBoundingClientRect();
    return { left: parseFloat(host.style.left), top: parseFloat(host.style.top), width: rect.width,
      ...(preferredSize.height ? { height: ui('body').hidden ? Math.min(preferredSize.height, 20000) : rect.height } : {}), geometryVersion: 2 };
  }
  function applyFontSize(px) {
    if (![14, 16, 18, 22, 26].includes(px)) px = 16;
    ui('reader').style.fontSize = px + 'px'; ui('fontSize').value = String(px);
  }
  async function loadPanelPrefs(cssReady) {
    const revision = prefsRevision;
    try {
      const [{ prefs }] = await Promise.all([send('PANEL_PREFS_GET'), cssReady]);
      if (revision === prefsRevision && prefs) {
        const finite = key => typeof prefs[key] === 'number' && Number.isFinite(prefs[key]) && prefs[key] >= 0 && prefs[key] <= 20000;
        if (finite('width') && prefs.width > 0) preferredSize.width = prefs.width;
        if (finite('height') && prefs.height > 0) {
          // Debug releases stored reader height, not outer panel height.
          const chromeHeight = panelEl.getBoundingClientRect().height - ui('reader').getBoundingClientRect().height;
          preferredSize.height = prefs.height + (prefs.geometryVersion === 2 ? 0 : chromeHeight);
        }
        if (finite('left') && finite('top')) position(prefs.left, prefs.top);
        applyFontSize(prefs.fontSize);
      }
      panelReady = true; clampToViewport();
      host.style.setProperty('visibility', 'visible', 'important');
      renderJob();
      if (prefs && revision === prefsRevision) savePrefs(geometryPrefs());
    } catch (error) {
      panelReady = true; clampToViewport(); host.style.setProperty('visibility', 'visible', 'important'); status(error.message);
    }
  }
  function resetView() {
    prefsRevision++; preferredSize = {}; resizedForJob = currentJob?.id || null;
    ui('body').hidden = false; panelEl.classList.remove('minimized'); applyFontSize(16);
    for (const k of ['left', 'top']) host.style.setProperty(k, 'auto', 'important');
    clampToViewport(); savePrefs({ reset: true });
  }
  function wireDrag(header) {
    header.addEventListener('pointerdown', event => {
      if (!panelReady || event.button !== 0 || event.target.closest('button,select,input,textarea')) return;
      event.preventDefault(); prefsRevision++;
      const rect = panelEl.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
      header.setPointerCapture(event.pointerId); header.style.cursor = 'grabbing';
    });
    header.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      position(event.clientX - drag.x, event.clientY - drag.y); clampToViewport();
    });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      const id = drag.id; drag = null; header.style.cursor = 'grab';
      if (header.hasPointerCapture(id)) header.releasePointerCapture(id);
      clampToViewport(); savePrefs(geometryPrefs());
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(type, finish);
  }
  function applyState() {
    if (!host) return;
    host.style.setProperty('display', state.visible ? 'block' : 'none', 'important');
    ui('story').value = state.story;
    ui('mode').replaceChildren(...state.modes.map(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; return o; }));
    ui('mode').value = state.settings.mode || 'general'; ui('custom').value = state.settings.customInstructions || '';
    ui('customLabel').hidden = ui('mode').value !== 'custom'; ui('auto').checked = !!state.settings.auto;
    ui('identity').textContent = state.targetLang + ' · ' + (state.engineName || '') + ' · Source page is preserved';
    if (!state.visible) stopPicker();
    else clampToViewport();
  }
  async function refresh() {
    if (refreshBusy) { refreshAgain = true; return; }
    refreshBusy = true;
    try {
      const next = await send('SITE_STATE', { detected: X.detectStory() });
      if (state && (next.story !== state.story || next.targetLang !== state.targetLang)) { generation++; await detach(); snapshot = null; lastAuto = ''; }
      state = next;
      if (state.visible) build();
      applyState(); initialized = true;
      if (state.visible) { startWatching(); scheduleCheck(); } else stopWatching();
    } catch (error) { build(); status(error.message); }
    finally { refreshBusy = false; if (refreshAgain) { refreshAgain = false; refresh(); } }
  }
  function capture() {
    root = X.findRoot(state.selector, root);
    if (!root) return null;
    const paragraphs = X.paragraphs(root);
    return { root, paragraphs, url: location.href, story: state.story, signature: JSON.stringify(paragraphs.map(p => p.text)) };
  }
  function unchanged(saved) {
    if (!saved || saved.url !== location.href || saved.story !== state.story || !saved.root.isConnected) return false;
    const now = X.paragraphs(saved.root);
    return saved.signature === JSON.stringify(now.map(p => p.text)) && saved.paragraphs.every(p => p.nodes.every(n => n.isConnected));
  }
  async function detach() {
    const job = currentJob; currentJob = null; lastJobRender = ''; clearTimeout(pollTimer);
    if (job) await send('JOB_DETACH', { id: job.id }).catch(() => {});
    if (ui('stop')) ui('stop').disabled = true;
    if (ui('toggle')) ui('toggle').disabled = true;
    resetSize();
  }
  function resetSize() { resizedForJob = null; } // Keep the saved site size during subsequent work.
  function matchSizeToRoot() {
    if (!panelReady || !panelEl || !root) return false;
    const rect = root.getBoundingClientRect();
    preferredSize = { width: Math.max(rect.width, 300), height: Math.max(rect.height, 320) };
    clampToViewport(); savePrefs(geometryPrefs()); return true;
  }
  async function navigationCheck() {
    if (navigating) return;
    const detected = X.detectStory();
    if (lastURL === location.href && lastDetected === detected) return;
    navigating = true; generation++;
    try {
      lastURL = location.href; lastDetected = detected; root = null; snapshot = null; lastAuto = '';
      await detach(); if (ui('reader')) ui('reader').replaceChildren(); await refresh();
    } finally { navigating = false; }
  }
  async function check() {
    clearTimeout(debounce); clearTimeout(maxDebounce); debounce = maxDebounce = null;
    if (!initialized || !state?.visible) return;
    await navigationCheck();
    if (snapshot && !unchanged(snapshot)) {
      generation++; await detach(); snapshot = null; root = null; lastAuto = ''; status('Source changed. Previous results remain in the jobs tab.');
      ui('reader').replaceChildren();
    }
    if (state.settings.auto && !busy && !currentJob) {
      const next = capture();
      if (next?.paragraphs.length && next.signature !== lastAuto) { lastAuto = next.signature; await translate(false); }
    }
  }
  function scheduleCheck() {
    if (!state?.visible) return;
    clearTimeout(debounce); debounce = setTimeout(() => check().catch(e => status(e.message)), 700);
    if (!maxDebounce) maxDebounce = setTimeout(() => check().catch(e => status(e.message)), 2000);
  }
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target === host || host?.contains(r.target) || r.target instanceof Element && r.target.closest('[data-wnt-ui]'))) return;
    // Changes outside the chosen reader root need only navigation/root checks.
    if (!root?.isConnected || records.some(r => root.contains(r.target) || r.target.contains?.(root))) scheduleCheck();
  });
  function startWatching() {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    if (!navigationTimer) navigationTimer = setInterval(() => navigationCheck().catch(e => status(e.message)), 750);
  }
  function stopWatching() { observer.disconnect(); clearInterval(navigationTimer); navigationTimer = null; clearTimeout(debounce); clearTimeout(maxDebounce); }
  async function translate(manual) {
    if (busy || !state?.visible) return;
    busy = true; ui('translate').disabled = true;
    resetSize();
    try {
      await navigationCheck();
      const token = generation;
      const saved = capture(); if (!saved?.paragraphs.length) throw Error('No readable text found. Pick the chapter content area.');
      snapshot = saved; lastAuto = saved.signature;
      status('Preparing translation…');
      const sourceHash = await U.hash([saved.url, saved.story, saved.signature]);
      if (token !== generation || !unchanged(saved)) throw Error('Page changed while preparing. Try again.');
      const result = await send('JOB_START', { detected: lastDetected, sourceHash, paragraphs: saved.paragraphs.map(p => p.text), manual });
      currentJob = result.job;
      if (token !== generation || !unchanged(saved)) { await detach(); throw Error('Page changed. Translation was detached.'); }
      showingOriginal = false; lastJobRender = ''; renderJob(); poll();
    } catch (error) { status(error.message); }
    finally { busy = false; ui('translate').disabled = false; }
  }
  function renderJob() {
    if (!currentJob || !snapshot || !unchanged(snapshot)) return;
    const job = currentJob;
    ui('stop').disabled = !['running', 'queued'].includes(job.status);
    ui('toggle').disabled = !job.completed;
    ui('toggle').textContent = showingOriginal ? 'Read translation' : 'Read original';
    status(`${job.status}: ${job.completed}/${job.units.length} units` + (job.progress ? ` · ${job.progress.elapsedSec}s · ${job.progress.outputChars} output characters` : '') + (job.error ? ' · ' + job.error : ''));
    if (job.status === 'done' && resizedForJob !== job.id) { if (matchSizeToRoot()) resizedForJob = job.id; }
    const signature = JSON.stringify([showingOriginal, job.results]); if (signature === lastJobRender) return;
    lastJobRender = signature;
    const scroll = ui('reader').scrollTop;
    const grouped = new Map();
    job.units.forEach((unit, i) => {
      if (!grouped.has(unit.paragraph)) grouped.set(unit.paragraph, []);
      grouped.get(unit.paragraph).push(showingOriginal ? unit.text : job.results[i] ?? '[Pending] ' + unit.text);
    });
    ui('reader').replaceChildren(...Array.from(grouped.values(), parts => { const p = document.createElement('p'); p.textContent = parts.join(''); return p; }));
    ui('reader').scrollTop = scroll;
  }
  async function poll() {
    clearTimeout(pollTimer);
    const jobId = currentJob?.id; if (!jobId) return;
    try {
      if (!unchanged(snapshot)) { scheduleCheck(); return; }
      const { job } = await send('JOB_GET', { id: jobId });
      if (currentJob?.id !== jobId) return;
      currentJob = job; renderJob();
      if (['running', 'queued'].includes(job.status)) pollTimer = setTimeout(poll, 1000);
    } catch (error) { status(error.message); }
  }
  function stopPicker() {
    if (!picker) return;
    document.removeEventListener('mousemove', picker.move, true); document.removeEventListener('click', picker.click, true); document.removeEventListener('keydown', picker.key, true);
    outline?.remove(); outline = null; picker = null;
  }
  function startPicker() {
    stopPicker();
    const mark = document.createElement('div'); mark.dataset.wntUi = 'picker'; mark.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #6ba0ff;z-index:2147483646;'; document.documentElement.append(mark); outline = mark;
    const candidate = event => event.composedPath().find(el => el instanceof Element && !el.closest('[data-wnt-ui]') && X.visible(el));
    picker = {
      move(event) { const el = candidate(event); if (!el) return; const r = el.getBoundingClientRect(); Object.assign(mark.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); },
      async click(event) {
        let el = candidate(event); if (!el) return;
        event.preventDefault(); event.stopImmediatePropagation(); stopPicker();
        if (el.matches('p,sentence,.sentence')) el = el.parentElement;
        try { const selector = X.selectorFor(el); await send('SELECTOR_SAVE', { selector }); state.selector = selector; root = el; lastAuto = ''; generation++; await detach(); snapshot = null; status('Content area saved.'); scheduleCheck(); }
        catch (error) { status(error.message); }
      },
      key(event) { if (event.key === 'Escape') { event.preventDefault(); stopPicker(); status('Selection cancelled.'); } },
    };
    document.addEventListener('mousemove', picker.move, true); document.addEventListener('click', picker.click, true); document.addEventListener('keydown', picker.key, true);
    status('Click the chapter container. Escape cancels.');
  }
  chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'STATE_CHANGED') refresh(); });
  window.addEventListener('popstate', navigationCheck); window.addEventListener('hashchange', navigationCheck);
  window.addEventListener('resize', clampToViewport);
  window.visualViewport?.addEventListener('resize', clampToViewport);
  window.visualViewport?.addEventListener('scroll', clampToViewport);
  window.addEventListener('pagehide', () => { stopWatching(); stopPicker(); detach(); });
  globalThis.__wntReader = { refresh };
  refresh();
})();
