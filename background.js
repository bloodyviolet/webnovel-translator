importScripts('shared.js', 'modes.js', 'db.js', 'legacy.js', 'profiles.js');
const { WNT: U, WNTDB: DB } = globalThis;
let readyPromise, openingRunner;
const trusted = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await ensureMigration();
  const store = await chrome.storage.local.get(null);
  if (!store.configV2) {
    await chrome.storage.local.set({ configV2: U.DEFAULTS, credentials: {}, legacyConfig: {
      baseUrl: store.baseUrl || '', apiKey: store.apiKey || '', model: store.model || '',
      targetLang: store.targetLang || 'English', chunkChars: store.chunkChars || 6000,
    } });
  }
  if (!store.selectors) {
    const selectors = Object.fromEntries(Object.entries(store).filter(([key]) => key.startsWith('containerSelector:')).map(([key, value]) => [key.slice('containerSelector:'.length), value]));
    await chrome.storage.local.set({ selectors });
  }
  await WNTProfiles.initialize();
  await DB.open();
  await syncRegistrations();
}
function ready() {
  if (!readyPromise) readyPromise = initialize().catch(e => { readyPromise = null; throw e; });
  return readyPromise;
}
async function syncRegistrations() {
  const stored = await chrome.storage.local.get({ enabledSites: {} });
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const desired = [];
  for (const origin of Object.keys(stored.enabledSites)) {
    if (!stored.enabledSites[origin]) continue;
    const hasPermission = await chrome.permissions.contains({ origins: [U.permissionPattern(origin)] });
    if (hasPermission) desired.push({ id: 'site-' + await U.hash(origin), matches: [U.permissionPattern(origin)], js: ['shared.js', 'extract.js', 'content.js'], runAt: 'document_idle', persistAcrossSessions: true });
  }
  const ids = new Set(desired.map(s => s.id));
  const remove = scripts.filter(s => !ids.has(s.id)).map(s => s.id);
  if (remove.length) await chrome.scripting.unregisterContentScripts({ ids: remove });
  const existing = new Set(scripts.map(s => s.id));
  const add = desired.filter(s => !existing.has(s.id));
  if (add.length) await chrome.scripting.registerContentScripts(add);
}
async function openRunner(active = false) {
  if (openingRunner) return openingRunner;
  openingRunner = (async () => {
    const url = chrome.runtime.getURL('runner.html');
    const [tab] = await chrome.tabs.query({ url });
    if (tab) { if (active) await chrome.tabs.update(tab.id, { active: true }); return tab; }
    return chrome.tabs.create({ url, active });
  })().finally(() => { openingRunner = null; });
  return openingRunner;
}
function pageURL(msg, sender) {
  const url = new URL(trusted(sender) ? msg.url : sender.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('This browser page cannot run the reader. Open an HTTP(S) novel page.');
  return url;
}
async function pageState(url, detected) {
  const defaults = { enabledSites: {}, storyOverrides: {}, selectors: {}, configV2: U.DEFAULTS };
  const store = await chrome.storage.local.get(defaults);
  detected = U.canonicalStoryKey(detected || U.storyFromURL(url.href));
  const story = U.canonicalStoryKey(store.storyOverrides[detected] || detected);
  const key = 'settings:' + story;
  const settings = (await chrome.storage.local.get({ [key]: { mode: 'general', customInstructions: '', auto: false } }))[key];
  const result = { visible: !!store.enabledSites[url.origin], detected, story, settings, selector: store.selectors[url.hostname] || null,
    targetLang: store.configV2.targetLang, engineName: store.configV2.engineName || store.configV2.model, modes: Object.entries(WNT_MODES).map(([id, m]) => ({ id, label: m.label })) };
  return result;
}
async function submit(msg, sender) {
  const url = pageURL(msg, sender);
  const state = await pageState(url, msg.detected);
  if (!state.visible) throw Error('Enable this site before translating.');
  if (!Array.isArray(msg.paragraphs) || !msg.paragraphs.length || msg.paragraphs.length > 10000 || msg.paragraphs.some(p => typeof p !== 'string' || !p.trim()) || msg.paragraphs.join('').length > 500000) throw Error('Invalid or oversized chapter input.');
  const cfg = U.validateConfig((await chrome.storage.local.get({ configV2: U.DEFAULTS })).configV2);
  if (!(await chrome.permissions.contains({ origins: [U.permissionPattern(cfg.baseUrl)] }))) throw Error('Open settings and save the server configuration to grant connection access.');
  const glossaryId = U.glossaryId(state.story, cfg.targetLang);
  const glossary = await DB.get('glossaries', glossaryId);
  const units = msg.paragraphs.flatMap((text, paragraph) => U.splitText(text, cfg.chunkChars).filter(text => text.trim()).map(text => ({ text, paragraph })));
  const config = U.publicConfig(cfg);
  const instruction = { mode: state.settings.mode || 'general', customInstructions: state.settings.customInstructions || '' };
  const id = await U.hash([state.story, cfg.targetLang, units, config, instruction, glossary?.editRevision || 0]);
  const tabId = sender.tab?.id;
  const job = await DB.update('jobs', id, old => {
    if (old) {
      old.owners = [...new Set([...(old.owners || []), tabId].filter(Number.isInteger))];
      if (msg.manual && ['paused', 'error', 'cancelled'].includes(old.status)) { old.status = 'queued'; old.error = ''; old.updated = Date.now(); }
      return old;
    }
    return { id, story: state.story, language: cfg.targetLang, glossaryId, glossaryEditRevision: glossary?.editRevision || 0,
      url: url.href, sourceHash: msg.sourceHash, units, results: Array(units.length).fill(null), completed: 0,
      engineName: cfg.engineName || cfg.model, config, instruction, owners: Number.isInteger(tabId) ? [tabId] : [], status: 'queued', created: Date.now(), updated: Date.now(), metrics: [] };
  });
  if (job.status === 'queued' || job.status === 'running') await openRunner();
  return { job: publicJob(job) };
}
function publicJob(job) {
  if (!job) return null;
  const { config, owners, glossaryEditRevision, ...view } = job;
  return view;
}
async function ownedJob(msg, sender) {
  const job = await DB.get('jobs', msg.id);
  if (!job || (!trusted(sender) && !(job.owners || []).includes(sender.tab?.id))) throw Error('Job not available to this tab.');
  return job;
}
async function broadcast() {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED' }).catch(() => {});
  }
}
const privateTypes = new Set(['CONFIG_GET', 'CONFIG_SAVE', 'PROFILE_LIST', 'PROFILE_GET', 'PROFILE_SAVE', 'PROFILE_SELECT', 'PROFILE_DELETE', 'SITE_ENABLE', 'RUNNER_OPEN', 'GLOSSARY_LIST', 'GLOSSARY_SAVE', 'GLOSSARY_IMPORT', 'LEGACY_LIST', 'GET_MIGRATION_REPORT', 'CACHE_CLEAR', 'JOBS_CLEAR']);
async function route(msg, sender) {
  await ready();
  if (privateTypes.has(msg.type) && !trusted(sender)) throw Error('This action requires an extension page.');
  switch (msg.type) {
    case 'CONFIG_GET': return chrome.storage.local.get({ configV2: U.DEFAULTS, credentials: {}, legacyConfig: null });
    case 'PROFILE_LIST': return WNTProfiles.list();
    case 'PROFILE_GET': return WNTProfiles.get(msg.id);
    case 'PROFILE_SAVE': {
      const result = await WNTProfiles.save(msg); await broadcast(); return result;
    }
    case 'PROFILE_SELECT': {
      const result = await WNTProfiles.select(msg.id); await broadcast(); return result;
    }
    case 'PROFILE_DELETE': return WNTProfiles.remove(msg.id);
    case 'CONFIG_SAVE': {
      const { activeProfileId } = await WNTProfiles.list();
      const { profile } = await WNTProfiles.get(activeProfileId);
      const result = await WNTProfiles.save({ id: activeProfileId, name: profile.name, config: msg.config });
      await broadcast(); return result;
    }
    case 'SITE_STATE': return pageState(pageURL(msg, sender), msg.detected);
    case 'SITE_ENABLE': {
      const url = pageURL(msg, sender);
      if (msg.visible && !await chrome.permissions.contains({ origins: [U.permissionPattern(url.href)] })) throw Error('Site permission was not granted.');
      await withStorageLock(async () => {
        const { enabledSites = {} } = await chrome.storage.local.get('enabledSites');
        enabledSites[url.origin] = !!msg.visible;
        await chrome.storage.local.set({ enabledSites });
      });
      await syncRegistrations();
      if (msg.visible && Number.isInteger(msg.tabId)) {
        try { await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['shared.js', 'extract.js', 'content.js'] }); }
        catch { throw Error('Site enabled. Refresh this webpage to attach the reader.'); }
      }
      await broadcast(); return pageState(url);
    }
    case 'SITE_HIDE': {
      const url = pageURL(msg, sender);
      await withStorageLock(async () => {
        const { enabledSites = {} } = await chrome.storage.local.get('enabledSites');
        enabledSites[url.origin] = false; await chrome.storage.local.set({ enabledSites });
      });
      await syncRegistrations(); await broadcast(); return {};
    }
    case 'STORY_SETTINGS': {
      const url = pageURL(msg, sender);
      const detected = U.canonicalStoryKey(msg.detected || U.storyFromURL(url.href));
      await withStorageLock(async () => {
        const { storyOverrides = {} } = await chrome.storage.local.get('storyOverrides');
        const story = U.canonicalStoryKey(msg.story?.trim() || detected);
        storyOverrides[detected] = story;
        const key = 'settings:' + story;
        const current = (await chrome.storage.local.get({ [key]: {} }))[key];
        const patch = msg.patch || {};
        if (patch.mode !== undefined && !Object.hasOwn(WNT_MODES, patch.mode)) throw Error('Unknown genre mode.');
        if (patch.customInstructions !== undefined && (typeof patch.customInstructions !== 'string' || patch.customInstructions.length > 8000)) throw Error('Instructions must be at most 8,000 characters.');
        await chrome.storage.local.set({ storyOverrides, [key]: { ...current, ...Object.fromEntries(['mode', 'customInstructions', 'auto'].filter(k => Object.hasOwn(patch, k)).map(k => [k, k === 'auto' ? !!patch[k] : patch[k]])) } });
      });
      await broadcast(); return pageState(url, detected);
    }
    case 'SELECTOR_SAVE': {
      const url = pageURL(msg, sender);
      if (typeof msg.selector !== 'string' || msg.selector.length > 4000) throw Error('Invalid content selector.');
      await withStorageLock(async () => {
        const { selectors = {} } = await chrome.storage.local.get('selectors'); selectors[url.hostname] = msg.selector;
        await chrome.storage.local.set({ selectors });
      }); return {};
    }
    case 'PANEL_PREFS_GET': {
      const url = pageURL(msg, sender);
      const { panelPrefs = {} } = await chrome.storage.local.get('panelPrefs');
      return { prefs: panelPrefs[url.hostname] || null };
    }
    case 'PANEL_PREFS_SAVE': {
      const url = pageURL(msg, sender);
      const patch = msg.patch || {};
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Invalid view preferences.');
      const clean = {};
      if (patch.geometryVersion !== undefined) { if (patch.geometryVersion !== 2) throw Error('Invalid geometry version.'); clean.geometryVersion = 2; }
      for (const key of ['left', 'top', 'width', 'height']) {
        if (patch[key] === undefined) continue;
        const n = Number(patch[key]);
        if (!Number.isFinite(n) || n < 0 || n > 20000 || (['width', 'height'].includes(key) && n === 0)) throw Error('Invalid panel geometry.');
        clean[key] = n;
      }
      if (patch.fontSize !== undefined) {
        const n = Number(patch.fontSize);
        if (![14, 16, 18, 22, 26].includes(n)) throw Error('Choose a supported reader font size.');
        clean.fontSize = n;
      }
      await withStorageLock(async () => {
        const { panelPrefs = {} } = await chrome.storage.local.get('panelPrefs');
        if (patch.reset === true) delete panelPrefs[url.hostname];
        else panelPrefs[url.hostname] = { ...panelPrefs[url.hostname], ...clean };
        await chrome.storage.local.set({ panelPrefs });
      });
      return {};
    }
    case 'JOB_START': return submit(msg, sender);
    case 'JOB_GET': return { job: publicJob(await ownedJob(msg, sender)) };
    case 'JOB_DETACH': {
      await ownedJob(msg, sender);
      await DB.update('jobs', msg.id, job => {
        job.owners = job.owners.filter(id => id !== sender.tab?.id);
        if (!job.owners.length && ['running', 'queued'].includes(job.status)) { job.status = 'paused'; job.error = 'Source page changed or closed. Resume when ready.'; }
        return job;
      }); return {};
    }
    case 'JOB_STOP': {
      await ownedJob(msg, sender);
      await DB.update('jobs', msg.id, job => ({ ...job, status: 'paused', error: 'Stopped. Completed batches are saved.', updated: Date.now() })); return {};
    }
    case 'RUNNER_OPEN': await openRunner(true); return {};
    case 'GET_MIGRATION_REPORT': return { report: await ensureMigration() };
    case 'LEGACY_LIST': {
      const store = await chrome.storage.local.get(null);
      return { items: Object.entries(store).filter(([key]) => key.startsWith('glossary:')).map(([key, terms]) => ({ key, terms })) };
    }
    case 'GLOSSARY_LIST': return { items: await DB.all('glossaries') };
    case 'GLOSSARY_SAVE':
    case 'GLOSSARY_IMPORT': {
      const story = U.canonicalStoryKey(msg.story), language = String(msg.language || '').trim();
      if (!language) throw Error('Choose the glossary target language.');
      const id = U.glossaryId(story, language), terms = U.validGlossary(msg.terms);
      const pinned = (msg.pinned || []).filter(term => Object.hasOwn(terms, term));
      let conflicts = [];
      await DB.update('glossaries', id, old => {
        const merged = Object.assign(Object.create(null), msg.type === 'GLOSSARY_IMPORT' ? old?.terms : {});
        for (const [key, value] of Object.entries(terms)) {
          if (Object.hasOwn(merged, key) && merged[key] !== value) conflicts.push({ term: key, kept: merged[key], alternative: value });
          else merged[key] = value;
        }
        return { ...old, id, story, language, terms: merged, pinned, candidates: [...(old?.candidates || []), ...conflicts].slice(-200), revision: (old?.revision || 0) + 1, editRevision: (old?.editRevision || 0) + 1, updated: Date.now() };
      });
      return { conflicts };
    }
    case 'CACHE_CLEAR': await DB.clear('cache'); return {};
    case 'JOBS_CLEAR': {
      const jobs = await DB.all('jobs');
      await DB.transaction(['jobs'], 'readwrite', tx => jobs.filter(j => !['running', 'queued'].includes(j.status)).forEach(j => tx.objectStore('jobs').delete(j.id))); return {};
    }
    default: throw Error('Unknown extension message.');
  }
}
chrome.runtime.onMessage.addListener((msg, sender, response) => {
  if (!msg || typeof msg.type !== 'string' || msg.type === 'STATE_CHANGED') return;
  route(msg, sender).then(result => response({ ok: true, ...result })).catch(error => response({ ok: false, error: error.message || String(error) }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => ready().catch(console.error));
chrome.runtime.onStartup.addListener(() => ready().catch(console.error));
chrome.tabs.onRemoved.addListener(async tabId => {
  try {
    await ready();
    for (const job of await DB.all('jobs')) if (job.owners.includes(tabId)) await DB.update('jobs', job.id, latest => {
      latest.owners = latest.owners.filter(id => id !== tabId);
      if (!latest.owners.length && ['running', 'queued'].includes(latest.status)) { latest.status = 'paused'; latest.error = 'Source tab closed.'; }
      return latest;
    });
  } catch (error) { console.error(error); }
});
