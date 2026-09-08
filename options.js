const $ = id => document.getElementById(id);
const fieldSpecs = { targetLang: ['Target language', 'text'], chunkChars: ['Source characters per batch', 'number'], maxTokens: ['Maximum output tokens', 'number'], contextTokens: ['Server context tokens', 'number'], temperature: ['Temperature', 'number'], topP: ['Top-p', 'number'], topK: ['Top-k (llama.cpp / Ollama)', 'number'], minP: ['Min-p (llama.cpp / Ollama)', 'number'], timeoutSec: ['Total batch deadline (seconds)', 'number'], stallSec: ['Silent-server limit (seconds)', 'number'], glossaryChars: ['Glossary prompt characters', 'number'] };
for (const [id, [label, type]] of Object.entries(fieldSpecs)) { const el = document.createElement('label'); el.textContent = label; const input = document.createElement('input'); input.id = id; input.type = type; if (type === 'number') input.step = ['temperature','topP','minP'].includes(id) ? '0.01' : '1'; el.append(input); $('fields').append(el); }
let editingProfileId = '', activeProfileId = '', profileLoading = false;
let loaded, legacyItems = [], glossaryItems = [];
async function send(type, values = {}) { const result = await chrome.runtime.sendMessage({ type, ...values }); if (!result?.ok) throw Error(result?.error || 'Extension unavailable.'); return result; }
function readConfig() { const cfg = {}; for (const key of Object.keys(WNT.DEFAULTS)) cfg[key] = key === 'tokenize' ? $(key).checked : $(key).value; return WNT.validateConfig(cfg); }
function fill(cfg) { for (const key of Object.keys(WNT.DEFAULTS)) { if (key === 'tokenize') $(key).checked = cfg[key]; else $(key).value = cfg[key]; } }
function download(name, data) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function withButton(button, statusId, action) { button.disabled = true; try { await action(); } catch (e) { $(statusId).textContent = e.message; } finally { button.disabled = false; } }
function grant(cfg) { return chrome.permissions.request({ origins: [WNT.permissionPattern(cfg.baseUrl)] }); }
$('baseUrl').addEventListener('input', () => { $('apiKey').value = ''; });
$('provider').onchange = () => {
  const preset = { ...WNT.DEFAULTS, provider: $('provider').value };
  if (preset.provider === 'lmstudio') Object.assign(preset, { baseUrl: 'http://localhost:1234/v1/chat/completions', thinking: 'server', tokenize: false });
  if (preset.provider === 'ollama') Object.assign(preset, { baseUrl: 'http://localhost:11434/api/chat', model: 'qwen3:8b', tokenize: false });
  if (preset.provider === 'openai') Object.assign(preset, { baseUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini', thinking: 'server', tokenize: false });
  if (preset.provider === 'deepseek') Object.assign(preset, { baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', thinking: 'server', tokenize: false, structured: 'json' });
  if (preset.provider === 'gemini') Object.assign(preset, { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.8-flash', thinking: 'server', tokenize: false });
  fill(preset);
};
$('legacyConfig').onclick = () => {
  if (!loaded?.legacyConfig?.baseUrl) { $('connection').textContent = 'No previous provider configuration was found.'; return; }
  fill({ ...WNT.DEFAULTS, ...loaded.legacyConfig, provider: 'openai', thinking: 'server', structured: 'prompt', tokenize: false });
  $('connection').textContent = 'Previous settings loaded into the form. Save to apply them.';
};
async function reloadProfileList(selected) {
  const data = await send('PROFILE_LIST'); activeProfileId = data.activeProfileId;
  $('profiles').replaceChildren(new Option('New unsaved engine', ''), ...data.profiles.map(p => new Option(p.name + (p.id === activeProfileId ? ' (active)' : ''), p.id)));
  $('profiles').value = selected ?? editingProfileId;
  $('profiles').disabled = false;
  $('deleteProfile').disabled = !editingProfileId || editingProfileId === activeProfileId;
}
async function editProfile(id) {
  if (profileLoading) return;
  profileLoading = true; $('profiles').disabled = true; $('save').disabled = true; $('newProfile').disabled = true;
  try {
    const { profile } = await send('PROFILE_GET', { id });
    editingProfileId = id; $('profileName').value = profile.name; fill({ ...WNT.DEFAULTS, ...profile.config });
    await reloadProfileList(id);
    $('profileStatus').textContent = 'Editing ' + profile.name + '. Save engine and use it to apply changes.';
  } catch (error) { $('profileStatus').textContent = error.message; }
  finally { profileLoading = false; $('profiles').disabled = false; $('save').disabled = false; $('newProfile').disabled = false; }
}
$('profiles').onchange = () => { if ($('profiles').value) editProfile($('profiles').value); else newProfile(); };
function newProfile() {
  editingProfileId = ''; $('profiles').value = ''; $('profileName').value = ''; fill(WNT.DEFAULTS);
  $('deleteProfile').disabled = true; $('profileStatus').textContent = 'Choose a preset, name this engine, and save it.';
}
$('newProfile').onclick = newProfile;
$('deleteProfile').onclick = function () {
  const id = editingProfileId;
  withButton(this, 'profileStatus', async () => { await send('PROFILE_DELETE', { id }); editingProfileId = ''; await reloadProfileList(activeProfileId); await editProfile(activeProfileId); }).finally(() => { $('deleteProfile').disabled = !editingProfileId || editingProfileId === activeProfileId; });
};
$('save').onclick = function () {
  let cfg, permission;
  const id = editingProfileId, name = $('profileName').value.trim();
  try { if (!name) throw Error('Give this engine a name first.'); cfg = readConfig(); permission = grant(cfg); }
  catch (e) { $('status').textContent = e.message; return; }
  $('newProfile').disabled = true; $('profiles').disabled = true;
  withButton(this, 'status', async () => {
    try {
      if (!await permission) throw Error('Connection permission was declined.');
      const result = await send('PROFILE_SAVE', { id, name, config: cfg }); editingProfileId = result.savedId;
      await reloadProfileList(editingProfileId);
      $('status').textContent = 'Engine saved and selected. Switch saved engines from the extension popup. Existing jobs retain their original engine.';
    } finally { $('newProfile').disabled = false; $('profiles').disabled = false; }
  });
};
$('discover').onclick = function () {
  let cfg, permission; try { cfg = readConfig(); permission = grant(cfg); } catch (e) { $('connection').textContent = e.message; return; }
  withButton(this, 'connection', async () => {
    if (!await permission) throw Error('Connection permission was declined.'); const models = await WNTProvider.discover(cfg, cfg.apiKey);
    $('models').replaceChildren(...models.map(id => { const option = document.createElement('option'); option.value = id; return option; }));
    if (models.length === 1) $('model').value = models[0];
    $('connection').textContent = 'Connected. Models: ' + (models.join(', ') || 'none reported');
  });
};
$('test').onclick = function () {
  let cfg, permission; try { cfg = readConfig(); permission = grant(cfg); } catch (e) { $('connection').textContent = e.message; return; }
  withButton(this, 'connection', async () => {
    if (!await permission) throw Error('Connection permission was declined.');
    $('connection').textContent = 'Testing streaming, output schema, and thinking control with one short sentence…';
    const job = { language: cfg.targetLang, instruction: { mode: 'general' } };
    const result = await navigator.locks.request('wnt-generation', () => WNTProvider.generate({ ...cfg, maxTokens: 256 }, cfg.apiKey, WNTProvider.messages(job, ['你好，世界。'], {}), 1, new AbortController().signal));
    $('connection').textContent = `Protocol test passed: ${result.translations[0]} (${(result.metrics.elapsedMs / 1000).toFixed(1)}s, ${result.metrics.reasoningChars} reported reasoning characters).`;
  });
};
async function refreshGlossaries() {
  glossaryItems = (await send('GLOSSARY_LIST')).items; const selected = $('glossaries').value;
  $('glossaries').replaceChildren(new Option('New glossary', ''), ...glossaryItems.map((item, i) => new Option(`${item.story} → ${item.language} (${Object.keys(item.terms).length})`, String(i))));
  $('glossaries').value = selected;
}
$('glossaries').onchange = () => {
  const item = glossaryItems[$('glossaries').value]; if (!item) return;
  $('glossaryStory').value = item.story; $('glossaryLanguage').value = item.language; $('terms').value = JSON.stringify(item.terms, null, 2); $('pinned').value = (item.pinned || []).join('\n'); $('candidates').textContent = JSON.stringify(item.candidates || [], null, 2);
};
$('legacy').onchange = () => {
  const item = legacyItems[$('legacy').value]; if (!item) return;
  $('terms').value = JSON.stringify(item.terms, null, 2); $('pinned').value = '';
  const key = item.key.slice('glossary:'.length);
  $('glossaryStory').value = /\/(?!novel$|chapter$).+/.test(key) ? WNT.canonicalStoryKey(key) : '';
  $('glossaryLanguage').value = '';
  $('glossaryStatus').textContent = 'Choose the correct novel and the language of these existing translations before merging.';
};
for (const [id, type] of [['merge', 'GLOSSARY_IMPORT'], ['replace', 'GLOSSARY_SAVE']]) $(id).onclick = function () {
  withButton(this, 'glossaryStatus', async () => {
    const terms = WNT.validGlossary(JSON.parse($('terms').value));
    const result = await send(type, { story: $('glossaryStory').value, language: $('glossaryLanguage').value, terms, pinned: $('pinned').value.split('\n').filter(Boolean) });
    $('glossaryStatus').textContent = `Saved. ${result.conflicts.length} conflicting definitions kept for review.`; await refreshGlossaries();
  });
};
$('export').onclick = async () => { try { download('webnovel-glossaries.json', { format: 'wnt-glossary-v2', items: (await send('GLOSSARY_LIST')).items }); } catch (e) { $('glossaryStatus').textContent = e.message; } };
$('import').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return; if (file.size > 10_000_000) throw Error('Import is limited to 10 MB.');
    const data = JSON.parse(await file.text());
    if (data.format === 'wnt-glossary-v2' && Array.isArray(data.items)) {
      for (const item of data.items) { WNT.canonicalStoryKey(item.story); if (!item.language?.trim()) throw Error('Every imported glossary must specify a language.'); WNT.validGlossary(item.terms); }
      let saved = 0;
      try { for (const item of data.items) { await send('GLOSSARY_IMPORT', item); saved++; } }
      catch (error) { throw Error(`Imported ${saved}/${data.items.length} glossaries before error: ${error.message}`); }
      $('glossaryStatus').textContent = `Merged ${saved} glossaries. Existing definitions were preserved.`; await refreshGlossaries();
    } else { $('terms').value = JSON.stringify(WNT.validGlossary(data.terms || data), null, 2); $('glossaryStatus').textContent = 'File loaded. Choose story/language, then Merge or Save.'; }
  } catch (e) { $('glossaryStatus').textContent = e.message; }
  event.target.value = '';
};
$('migrationReport').onclick = async () => { try { download('lnmtl-migration-report.json', (await send('GET_MIGRATION_REPORT')).report); } catch (e) { $('maintenance').textContent = e.message; } };
$('clearCache').onclick = async () => { try { await send('CACHE_CLEAR'); $('maintenance').textContent = 'Translation cache cleared.'; } catch (e) { $('maintenance').textContent = e.message; } };
$('clearJobs').onclick = async () => { try { await send('JOBS_CLEAR'); $('maintenance').textContent = 'Finished and stopped jobs removed. Glossaries retained.'; } catch (e) { $('maintenance').textContent = e.message; } };
(async () => {
  loaded = await send('CONFIG_GET');
  await reloadProfileList(); await editProfile(activeProfileId);
  legacyItems = (await send('LEGACY_LIST')).items;
  $('legacy').append(...legacyItems.map((item, i) => new Option(item.key, String(i))));
  await refreshGlossaries();
})().catch(e => { $('status').textContent = e.message; });
