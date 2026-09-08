// Run with: node --test tests/background.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy.js'), 'utf8');
const modesSource = fs.readFileSync(path.join(__dirname, '..', 'modes.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function runtime(initial = {}, fetchImpl) {
  let store = clone(initial), writes = 0, failWrite = false;
  let messageListener;
  const context = {
    console, setTimeout, clearTimeout,
    fetch: fetchImpl || (() => { throw new Error('Unexpected network request'); }),
    chrome: {
      storage: { local: {
        async get(keys) {
          await Promise.resolve();
          if (keys === null) return clone(store);
          if (typeof keys === 'string') return Object.hasOwn(store, keys) ? { [keys]: clone(store[keys]) } : {};
          const result = clone(keys);
          for (const key of Object.keys(result)) if (Object.hasOwn(store, key)) result[key] = clone(store[key]);
          return result;
        },
        async set(values) {
          await Promise.resolve();
          if (failWrite) throw new Error('Simulated storage quota error');
          store = { ...store, ...clone(values) }; writes++;
        },
      } },
      runtime: { onMessage: { addListener(fn) { messageListener = fn; } },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    },
  };
  vm.createContext(context);
  vm.runInContext(modesSource + '\n' + source + '\nglobalThis.api={ensureMigration,canonicalStoryKey,withStorageLock};', context);
  return { api: context.api, get store() { return store; }, get writes() { return writes; },
    set failWrite(value) { failWrite = value; },
    request(msg) { return new Promise(resolve => messageListener(msg, {}, resolve)); },
  };
}
const prefix = 'glossary:lnmtl.com/';

test('merges numeric chapter order; existing canonical terms win; sources and ambiguities preserved', async () => {
  const input = {
    [prefix + 'other-story-chapter-3']: { A: 'Other novel' },
    [prefix + 'sword-god-chapter-10']: { A: 'Later', B: 'New' },
    [prefix + 'sword-god-chapter-2']: { A: 'Earlier', C: 'Old C' },
    [prefix + 'sword-god']: { C: 'Chosen C' },
    'glossary:lnmtl.com': { unknown: 'Mixed novel terms' },
    'glossary:lnmtl.com/novel': { unknown: 'Unknown story' },
    'glossary:example.com/story-chapter-1': { A: 'Unrelated site' },
    'settings:lnmtl.com/sword-god-chapter-2': { mode: 'general', auto: false },
    'settings:lnmtl.com/sword-god-chapter-10': { mode: 'xianxia', auto: true },
  };
  const app = runtime(input);
  const report = await app.api.ensureMigration();
  assert.deepEqual(app.store[prefix + 'sword-god'], { C: 'Chosen C', A: 'Earlier', B: 'New' });
  assert.deepEqual(app.store[prefix + 'other-story'], { A: 'Other novel' });
  assert.equal(app.store['settings:lnmtl.com/sword-god'].mode, 'xianxia');
  assert.equal(report.ambiguousKeys.length, 2);
  assert.equal(report.stories.find(s => s.storyKey === 'lnmtl.com/sword-god').conflicts.length, 2);
  for (const [key, value] of Object.entries(input)) {
    if (key !== prefix + 'sword-god') assert.deepEqual(app.store[key], value, 'retained ' + key);
  }
  assert.equal(app.writes, 1);
});

test('migration is idempotent within worker and after worker restart', async () => {
  const app = runtime({ [prefix + 'novel-name-chapter-4']: { A: 'A' } });
  await Promise.all([app.api.ensureMigration(), app.api.ensureMigration()]);
  const snapshot = clone(app.store);
  await app.api.ensureMigration(); assert.equal(app.writes, 1);
  const restarted = runtime(snapshot);
  await restarted.api.ensureMigration(); assert.equal(restarted.writes, 0);
  assert.deepEqual(restarted.store, snapshot);
});

test('failed save does not mark migration complete and can be retried', async () => {
  const app = runtime({ [prefix + 'novel-name-chapter-1']: { A: 'A' } });
  app.failWrite = true;
  await assert.rejects(app.api.ensureMigration(), /quota/);
  assert.equal(app.store['migration:lnmtl-glossaries:v1'], undefined);
  app.failWrite = false; await app.api.ensureMigration();
  assert.deepEqual(app.store[prefix + 'novel-name'], { A: 'A' });
});

test('malformed glossaries are preserved and reported; canonical settings are retained', async () => {
  const app = runtime({
    [prefix + 'story-chapter-1']: ['bad'],
    [prefix + 'story-chapter-2']: { good: 'valid' },
    'settings:lnmtl.com/story': { mode: 'custom', auto: false },
    'settings:lnmtl.com/story-chapter-9': { mode: 'general', auto: true },
  });
  const report = await app.api.ensureMigration();
  assert.equal(report.skipped.length, 1);
  assert.deepEqual(app.store[prefix + 'story'], { good: 'valid' });
  assert.deepEqual(app.store[prefix + 'story-chapter-1'], ['bad']);
  assert.equal(app.store['settings:lnmtl.com/story'].mode, 'custom');
});

test('prototype-like terms remain plain data', async () => {
  const app = runtime({ [prefix + 'story-chapter-1']: JSON.parse('{"__proto__":"Name","constructor":"Title"}') });
  await app.api.ensureMigration();
  assert.equal(Object.hasOwn(app.store[prefix + 'story'], '__proto__'), true);
  assert.equal(app.store[prefix + 'story'].__proto__, 'Name');
  assert.equal({}.polluted, undefined);
});
