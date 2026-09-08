/* Trusted background-only engine profiles. Credentials never enter popup lists or job payloads. */
(() => {
  const U = WNT;
  function summary(store) {
    return { activeProfileId: store.activeProfileId, profiles: Object.values(store.engineProfiles || {}).map(p => ({ id: p.id, name: p.name, provider: p.config.provider, model: p.config.model, baseUrl: p.config.baseUrl })) };
  }
  function activeConfig(profile) {
    return { ...profile.config, engineProfileId: profile.id, engineCredentialId: profile.credentialId, engineName: profile.name };
  }
  async function read() { return chrome.storage.local.get({ engineProfiles: {}, activeProfileId: '', profileCredentials: {} }); }
  async function initialize() {
    return withStorageLock(async () => {
      const store = await chrome.storage.local.get({ engineProfiles: null, activeProfileId: '', configV2: U.DEFAULTS, credentials: {}, profileCredentials: {} });
      if (store.engineProfiles && Object.keys(store.engineProfiles).length) return;
      const cfg = U.validateConfig(store.configV2);
      const id = crypto.randomUUID(), credentialId = crypto.randomUUID();
      const profile = { id, name: 'My current engine', config: U.publicConfig(cfg), credentialId };
      const profileCredentials = { ...store.profileCredentials, [credentialId]: { endpoint: cfg.baseUrl, apiKey: store.credentials[cfg.baseUrl] || cfg.apiKey || '' } };
      await chrome.storage.local.set({ engineProfiles: { [id]: profile }, activeProfileId: id, profileCredentials, configV2: activeConfig(profile) });
    });
  }
  async function list() { return summary(await read()); }
  async function get(id) {
    const store = await read(), profile = store.engineProfiles[id];
    if (!profile) throw Error('Saved engine not found.');
    return { profile: { id: profile.id, name: profile.name, config: { ...profile.config, apiKey: U.jobApiKey(activeConfig(profile), store) } } };
  }
  async function save({ id, name, config }) {
    name = String(name || '').trim();
    if (!name || name.length > 80) throw Error('Give this engine a name (1–80 characters).');
    // Accept only supported settings, never caller-provided internal credential references.
    const cfg = U.validateConfig(Object.fromEntries(Object.keys(U.DEFAULTS).map(k => [k, config[k] ?? U.DEFAULTS[k]])));
    if (!await chrome.permissions.contains({ origins: [U.permissionPattern(cfg.baseUrl)] })) throw Error('Server permission was not granted. Save again to grant access.');
    return withStorageLock(async () => {
      const store = await read();
      if (id && !Object.hasOwn(store.engineProfiles, id)) throw Error('This engine was removed. Create a new profile.');
      if (Object.values(store.engineProfiles).some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw Error('An engine with this name already exists.');
      id ||= crypto.randomUUID();
      const old = store.engineProfiles[id];
      const previous = store.profileCredentials[old?.credentialId];
      const credentialId = previous?.endpoint === cfg.baseUrl && previous.apiKey === cfg.apiKey ? old.credentialId : crypto.randomUUID();
      store.profileCredentials[credentialId] = { endpoint: cfg.baseUrl, apiKey: cfg.apiKey };
      const profile = { id, name, config: U.publicConfig(cfg), credentialId };
      store.engineProfiles[id] = profile;
      await chrome.storage.local.set({ ...store, activeProfileId: id, configV2: activeConfig(profile) });
      return { ...summary({ ...store, activeProfileId: id }), savedId: id };
    });
  }
  async function select(id) {
    return withStorageLock(async () => {
      const store = await read(), profile = store.engineProfiles[id];
      if (!profile) throw Error('Saved engine not found.');
      if (!await chrome.permissions.contains({ origins: [U.permissionPattern(profile.config.baseUrl)] })) throw Error('Access to this engine was revoked. Open Options and save it again.');
      await chrome.storage.local.set({ activeProfileId: id, configV2: activeConfig(profile) });
      return summary({ ...store, activeProfileId: id });
    });
  }
  async function remove(id) {
    return withStorageLock(async () => {
      const store = await read();
      if (id === store.activeProfileId) throw Error('Switch to another engine before deleting this one.');
      if (!Object.hasOwn(store.engineProfiles, id)) throw Error('Saved engine not found.');
      delete store.engineProfiles[id];
      // Historical credential records remain available to already-saved jobs.
      await chrome.storage.local.set({ engineProfiles: store.engineProfiles });
      return summary(store);
    });
  }
  globalThis.WNTProfiles = { initialize, list, get, save, select, remove };
})();
