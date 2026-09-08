/* Shared pure utilities. No credentials or storage are exposed to page scripts. */
(() => {
  const DEFAULTS = {
    provider: 'llamacpp', baseUrl: 'http://localhost:8080/v1/chat/completions', model: 'qwen3-8b', apiKey: '',
    targetLang: 'English', chunkChars: 1000, maxTokens: 2048, contextTokens: 8192,
    temperature: 0.7, topP: 0.8, topK: 20, minP: 0, thinking: 'off', structured: 'schema',
    timeoutSec: 180, stallSec: 60, glossaryChars: 3000, tokenize: true,
  };
  const ROUTE = /^(?:novels?|books?|series|stories|chapters?|ch|pages?|read|reader|fiction)(?:[-_]?\d+(?:[.-]\d+)?)?$/i;
  function normalizeSlug(slug) {
    return slug.replace(/\.(?:html?|php)$/i, '').replace(/[-_]chapter[-_]\d+(?:[.-]\d+)?(?:[-_].*)?$/i, '');
  }
  function storyFromURL(value) {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
    const bookRoute = parts.findIndex(p => /^(novels?|books?|series|stories|fiction)$/i.test(p));
    let slug = bookRoute >= 0 ? parts[bookRoute + 1] : undefined;
    if (!slug || ROUTE.test(slug)) slug = parts.find(p => !ROUTE.test(p) && !/^\d+(?:[.-]\d+)?$/.test(p));
    slug = slug ? normalizeSlug(slug) : '';
    return url.hostname.toLowerCase() + (slug ? '/' + slug : '');
  }
  function canonicalStoryKey(value) {
    if (typeof value !== 'string' || !value.trim()) throw Error('Story ID is required.');
    const key = value.trim();
    if (/^https?:\/\//i.test(key)) return storyFromURL(key);
    if (/^[\w.-]+\.[a-z]{2,}\//i.test(key)) return storyFromURL('https://' + key);
    return key;
  }
  function languageKey(value) { return value.trim().normalize('NFKC').toLowerCase(); }
  function glossaryId(story, language) { return JSON.stringify([canonicalStoryKey(story), languageKey(language)]); }
  function validateConfig(input) {
    const cfg = { ...DEFAULTS, ...input };
    if (!['llamacpp', 'openai', 'lmstudio', 'ollama', 'gemini', 'deepseek'].includes(cfg.provider)) throw Error('Unknown provider.');
    const url = new URL(String(cfg.baseUrl).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Use an HTTP(S) endpoint without credentials, query, or fragment.');
    if (!(cfg.provider === 'ollama' ? /\/api\/chat\/?$/ : /\/chat\/completions\/?$/).test(url.pathname)) throw Error('Enter the complete chat endpoint path for this provider.');
    cfg.baseUrl = url.href.replace(/\/$/, '');
    for (const name of ['model', 'targetLang']) {
      if (typeof cfg[name] !== 'string' || !cfg[name].trim() || cfg[name].length > 200) throw Error(name + ' must be a non-empty name (at most 200 characters).');
      cfg[name] = cfg[name].trim();
    }
    const limits = { chunkChars: [100, 12000], maxTokens: [128, 16384], contextTokens: [2048, 131072], timeoutSec: [15, 1800], stallSec: [10, 600], glossaryChars: [0, 20000], temperature: [0, 2], topP: [0.01, 1], topK: [0, 100], minP: [0, 1] };
    for (const [key, [min, max]] of Object.entries(limits)) {
      cfg[key] = Number(cfg[key]);
      if (!Number.isFinite(cfg[key]) || cfg[key] < min || cfg[key] > max) throw Error(`${key} must be between ${min} and ${max}.`);
      if (!['temperature', 'topP', 'minP'].includes(key) && !Number.isInteger(cfg[key])) throw Error(key + ' must be an integer.');
    }
    if (cfg.maxTokens + 512 >= cfg.contextTokens) throw Error('Context must leave room for the prompt in addition to the output allowance.');
    if (!['off', 'server', 'legacy'].includes(cfg.thinking) || !['schema', 'json', 'prompt'].includes(cfg.structured)) throw Error('Invalid generation mode.');
    cfg.apiKey = String(cfg.apiKey || '').trim();
    cfg.tokenize = !!cfg.tokenize;
    return cfg;
  }
  function validGlossary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Glossary must be a JSON object.');
    const result = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (!k.trim() || typeof v !== 'string' || !v.trim() || k.length > 500 || v.length > 1000) throw Error('Glossary terms and translations must be non-empty strings (500/1000 character limits).');
      result[k] = v;
    }
    return result;
  }
  function splitText(text, limit) {
    const units = [];
    // Slice on code points so surrogate pairs are never broken. Preserve whitespace.
    const chars = Array.from(text);
    while (chars.length) {
      let end = Math.min(limit, chars.length);
      if (end < chars.length) {
        for (let i = end - 1; i >= Math.floor(end / 2); i--) {
          if (/[。！？.!?\n\s]/u.test(chars[i])) { end = i + 1; break; }
        }
      }
      units.push(chars.splice(0, end).join(''));
    }
    return units;
  }
  function relevantGlossary(record, text, budget) {
    const terms = record?.terms || {};
    const pinned = new Set(record?.pinned || []);
    const keys = Object.keys(terms).filter(k => pinned.has(k) || text.includes(k))
      .sort((a, b) => Number(pinned.has(b)) - Number(pinned.has(a)) || b.length - a.length || a.localeCompare(b));
    const selected = Object.create(null); let used = 2;
    for (const key of keys) {
      const cost = JSON.stringify([key, terms[key]]).length + 1;
      if (used + cost <= budget) { selected[key] = terms[key]; used += cost; }
    }
    return selected;
  }
  async function hash(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  function permissionPattern(value) { const url = new URL(value); return url.protocol + '//' + url.hostname + '/*'; }
  function jobApiKey(cfg, store) {
    if (cfg.engineCredentialId) {
      const record = store.profileCredentials?.[cfg.engineCredentialId];
      if (!record || record.endpoint !== cfg.baseUrl) throw Error('The saved engine credential is unavailable for this job.');
      return record.apiKey;
    }
    return store.credentials?.[cfg.baseUrl] || '';
  }
  function publicConfig(cfg) { const { apiKey, ...rest } = cfg; return rest; }
  globalThis.WNT = { DEFAULTS, storyFromURL, canonicalStoryKey, languageKey, glossaryId, validateConfig, validGlossary, splitText, relevantGlossary, hash, publicConfig, permissionPattern, jobApiKey };
})();
