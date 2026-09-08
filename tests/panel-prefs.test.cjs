const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function runtime() {
  let store = { enabledSites: { 'https://lnmtl.com': true } };
  const event = { addListener() {} };
  const ctx = vm.createContext({ URL, console, chrome: {
    storage: { local: { async get(keys) { return typeof keys === 'string' ? { [keys]: structuredClone(store[keys]) } : { ...structuredClone(keys), ...structuredClone(store) }; }, async set(patch) { store = { ...store, ...structuredClone(patch) }; } } },
    runtime: { getURL: p => 'chrome-extension://test/' + p, onMessage: event, onInstalled: event, onStartup: event }, tabs: { onRemoved: event },
  } });
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), ctx);
  vm.runInContext('readyPromise = Promise.resolve(); globalThis.call = route;', ctx);
  return { call: (msg, hostname='lnmtl.com') => ctx.call(msg, { url: 'https://' + hostname + '/chapter/story', tab: { id: 1, url: 'https://' + hostname + '/chapter/story' } }), get store() { return store; } };
}
test('view preferences merge concurrently per site without altering enabled state', async () => {
 const app = runtime();
 await Promise.all([app.call({type:'PANEL_PREFS_SAVE',patch:{left:40,top:50}}),app.call({type:'PANEL_PREFS_SAVE',patch:{fontSize:22}})]);
 await app.call({type:'PANEL_PREFS_SAVE',patch:{width:600,height:500,geometryVersion:2}});
 assert.deepEqual(app.store.panelPrefs['lnmtl.com'],{left:40,top:50,fontSize:22,width:600,height:500,geometryVersion:2});
 assert.equal((await app.call({type:'PANEL_PREFS_GET'},'other.example')).prefs,null);
 assert.deepEqual(app.store.enabledSites,{'https://lnmtl.com':true});
});
test('invalid dimensions/fonts fail and Reset view clears only this site', async () => {
 const app = runtime();
 for (const patch of [{width:0},{height:-1},{left:Infinity},{geometryVersion:3},{fontSize:17}]) await assert.rejects(app.call({type:'PANEL_PREFS_SAVE',patch}));
 await app.call({type:'PANEL_PREFS_SAVE',patch:{fontSize:22}});
 await app.call({type:'PANEL_PREFS_SAVE',patch:{fontSize:18}},'other.example');
 await app.call({type:'PANEL_PREFS_SAVE',patch:{reset:true}});
 assert.equal((await app.call({type:'PANEL_PREFS_GET'})).prefs,null);
 assert.equal(app.store.panelPrefs['other.example'].fontSize,18);
 assert.deepEqual(app.store.enabledSites,{'https://lnmtl.com':true});
});
