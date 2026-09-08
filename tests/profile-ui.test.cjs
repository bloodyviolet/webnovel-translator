const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { parseHTML } = require('linkedom');
const root = path.join(__dirname, '..');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
function ui(file, chrome) {
  const { document, window } = parseHTML(fs.readFileSync(path.join(root, file + '.html'), 'utf8'));
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true,
    get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) { for (const o of this.querySelectorAll('option')) { if (o.value === value) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } },
  });
  function Option(label, value) { const o = document.createElement('option'); o.textContent = label; o.value = value; return o; }
  const ctx = vm.createContext({ document, chrome, Option, URL, console, setTimeout, clearTimeout, navigator: {}, Blob });
  vm.runInContext(fs.readFileSync(path.join(root, 'shared.js'), 'utf8'), ctx);
  return { ctx, document, run() { vm.runInContext(fs.readFileSync(path.join(root, file + '.js'), 'utf8'), ctx); } };
}
test('popup engine switch works even on restricted browser pages and reverts on failure', async () => {
  let selected = 'local', fail = false;
  const chrome = { runtime: { sendMessage: async msg => {
    if (msg.type === 'PROFILE_LIST') return { ok: true, activeProfileId: selected, profiles: [{ id: 'local', name: 'Local', model: 'Qwen' }, { id: 'cloud', name: 'Cloud', model: 'GPT' }] };
    if (msg.type === 'PROFILE_SELECT') { if (fail) return { ok: false, error: 'Permission revoked' }; selected = msg.id; return { ok: true, activeProfileId: selected }; }
  } }, tabs: { query: async () => [{ url: 'chrome://settings', id: 1 }] }, storage: { onChanged: { addListener() {} } } };
  const app = ui('popup', chrome); app.run(); await settle();
  const engine = app.document.getElementById('engine'); assert.equal(engine.disabled, false);
  engine.value = 'cloud'; await engine.onchange(); assert.equal(selected, 'cloud');
  fail = true; engine.value = 'local'; await engine.onchange(); assert.equal(engine.value, 'cloud');
  assert.match(app.document.getElementById('engineStatus').textContent, /Permission revoked/);
});
test('Options creates a named engine with its key and restores saved profiles into the form', async () => {
  let configs, active = 'local', saved;
  const chrome = { permissions: { request: async () => true }, runtime: { sendMessage: async msg => {
    if (msg.type === 'CONFIG_GET') return { ok: true, legacyConfig: null };
    if (msg.type === 'PROFILE_LIST') return { ok: true, activeProfileId: active, profiles: Object.entries(configs).map(([id, p]) => ({ id, name: p.name })) };
    if (msg.type === 'PROFILE_GET') return { ok: true, profile: { id: msg.id, ...configs[msg.id] } };
    if (msg.type === 'PROFILE_SAVE') { saved = msg; active = 'cloud'; configs.cloud = { name: msg.name, config: msg.config }; return { ok: true, savedId: active }; }
    if (msg.type === 'LEGACY_LIST' || msg.type === 'GLOSSARY_LIST') return { ok: true, items: [] };
  } } };
  const app = ui('options', chrome);
  configs = { local: { name: 'My local model', config: { ...app.ctx.WNT.DEFAULTS, apiKey: 'local-key' } } };
  app.run(); await settle(); const $ = id => app.document.getElementById(id);
  assert.equal($('apiKey').value, 'local-key');
  $('newProfile').onclick(); $('profileName').value = 'DeepSeek account'; $('provider').value = 'deepseek'; $('provider').onchange();
  $('apiKey').value = 'cloud-key'; $('chunkChars').value = '777'; $('save').onclick(); await settle();
  assert.equal(saved.name, 'DeepSeek account'); assert.equal(saved.config.apiKey, 'cloud-key'); assert.equal(saved.config.chunkChars, 777);
  $('profiles').value = 'local'; $('profiles').onchange(); await settle(); assert.equal($('apiKey').value, 'local-key');
  $('profiles').value = 'cloud'; $('profiles').onchange(); await settle(); assert.equal($('apiKey').value, 'cloud-key'); assert.equal($('chunkChars').value, '777');
});
