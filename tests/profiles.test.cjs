const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { webcrypto } = require('node:crypto');
function fixture(initial = {}) {
  let store = structuredClone(initial), permitted = true, tail = Promise.resolve();
  const ctx = vm.createContext({ crypto: webcrypto, URL, TextEncoder, TextDecoder, console,
    withStorageLock(work) { const result = tail.then(work); tail = result.catch(() => {}); return result; },
    chrome: { permissions: { contains: async () => permitted }, storage: { local: {
      async get(defaults) { const result = structuredClone(defaults); for (const key of Object.keys(result)) if (Object.hasOwn(store, key)) result[key] = structuredClone(store[key]); return result; },
      async set(value) { store = { ...store, ...structuredClone(value) }; },
    } } },
  });
  for (const name of ['shared.js', 'profiles.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx);
  return { api: ctx.WNTProfiles, u: ctx.WNT, get store() { return store; }, set permitted(value) { permitted = value; } };
}
const json = value => JSON.parse(JSON.stringify(value));
test('existing configuration and key migrate once into a saved engine', async () => {
  const app = fixture({ configV2: { baseUrl: 'http://localhost:8080/v1/chat/completions', model: 'My Qwen', chunkChars: 700 }, credentials: { 'http://localhost:8080/v1/chat/completions': 'old-secret' } });
  await app.api.initialize(); const first = json(app.store);
  await app.api.initialize(); assert.deepEqual(json(app.store), first);
  const { profile } = await app.api.get(first.activeProfileId);
  assert.equal(profile.config.model, 'My Qwen'); assert.equal(profile.config.chunkChars, 700); assert.equal(profile.config.apiKey, 'old-secret');
  assert.ok(!JSON.stringify(await app.api.list()).includes('old-secret'));
  assert.equal(app.store.configV2.apiKey, undefined);
});
test('switching engines restores every saved setting and the matching key', async () => {
  const app = fixture(); await app.api.initialize(); const local = app.store.activeProfileId;
  const cloudCfg = { ...app.u.DEFAULTS, provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'my-model', apiKey: 'cloud-secret', chunkChars: 1500, maxTokens: 3000, contextTokens: 20000, temperature: 0.2, targetLang: 'Portuguese', tokenize: false };
  const cloud = (await app.api.save({ name: 'Gemini', config: cloudCfg })).savedId;
  const cloudSnapshot = json(app.store.configV2);
  await app.api.select(local); assert.equal(app.store.configV2.provider, 'llamacpp'); assert.equal(app.u.jobApiKey(app.store.configV2, app.store), '');
  await app.api.select(cloud); assert.deepEqual(json(app.store.configV2), cloudSnapshot); assert.equal(app.u.jobApiKey(app.store.configV2, app.store), 'cloud-secret');
});
test('profiles sharing an endpoint retain different keys and old jobs retain their original credential', async () => {
  const app = fixture(); await app.api.initialize();
  const cfg = { ...app.u.DEFAULTS, apiKey: 'account-one' };
  const a = (await app.api.save({ name: 'Account one', config: cfg })).savedId;
  const jobSnapshot = json(app.store.configV2);
  const b = (await app.api.save({ name: 'Account two', config: { ...cfg, apiKey: 'account-two' } })).savedId;
  assert.equal(app.u.jobApiKey(jobSnapshot, app.store), 'account-one');
  assert.equal(app.u.jobApiKey(app.store.configV2, app.store), 'account-two');
  await app.api.save({ id: a, name: 'Account one renamed', config: { ...cfg, apiKey: 'rotated-key' } });
  assert.equal(app.u.jobApiKey(jobSnapshot, app.store), 'account-one');
  await app.api.select(b); await app.api.remove(a);
  assert.equal(app.u.jobApiKey(jobSnapshot, app.store), 'account-one');
});
test('unknown profiles, denied permissions and duplicate names leave the active selection intact', async () => {
  const app = fixture(); await app.api.initialize(); const id = app.store.activeProfileId;
  await assert.rejects(app.api.select('missing'), /not found/);
  await assert.rejects(app.api.save({ name: 'My current engine', config: app.u.DEFAULTS }), /already exists/);
  await assert.rejects(app.api.remove(id), /Switch to another/);
  app.permitted = false; await assert.rejects(app.api.select(id), /revoked/);
  await assert.rejects(app.api.save({ name: 'New', config: app.u.DEFAULTS }), /permission/);
  assert.equal(app.store.activeProfileId, id); assert.equal(Object.keys(app.store.engineProfiles).length, 1);
});
test('concurrent saves preserve both profiles and user input cannot inject credential references', async () => {
  const app = fixture(); await app.api.initialize();
  const cfg = { ...app.u.DEFAULTS, engineCredentialId: 'injected', engineProfileId: 'wrong' };
  await Promise.all([app.api.save({ name: 'One', config: cfg }), app.api.save({ name: 'Two', config: cfg })]);
  assert.equal(Object.keys(app.store.engineProfiles).length, 3);
  assert.notEqual(app.store.configV2.engineCredentialId, 'injected');
  assert.throws(() => app.u.jobApiKey({ ...app.store.configV2, baseUrl: 'https://unrelated.example/chat/completions' }, app.store), /unavailable/);
});
test('cloud model discovery retains provider-specific API prefixes', async () => {
  let endpoint;
  const ctx = vm.createContext({ URL, AbortSignal, fetch: async url => { endpoint = url; return { ok: true, json: async () => ({ data: [{ id: 'model' }] }) }; } });
  for (const name of ['shared.js', 'provider.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx);
  for (const [baseUrl, expected] of [
    ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models'],
    ['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/models'],
  ]) { await ctx.WNTProvider.discover({ provider: 'openai', baseUrl }, ''); assert.equal(endpoint, expected); }
});
