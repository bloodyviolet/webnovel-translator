// Genre-mode guidance now lives only in modes.js (globalThis.WNT_MODES).
// This file used to keep its own duplicate copy of that object, which
// could drift out of sync with the version provider.js actually uses to
// build prompts. Removed in favor of referencing the shared export.

// Only unambiguous LNMTL chapter/novel keys are normalized. Host-only keys
// cannot be assigned to a novel safely (the old /^ch/ filter also matched Chaotic).
const MIGRATION_KEY = "migration:lnmtl-glossaries:v1";
let migrationPromise;
let storageQueue = Promise.resolve();
const storyQueues = new Map();

function canonicalStoryKey(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Story ID is required.");
  const key = value.trim();
  const match = key.match(/^((?:[a-z0-9-]+\.)*lnmtl\.com)\/(?:chapter\/|novel\/)?([^/]+)\/?$/i);
  if (!match) return key;
  const slug = match[2].replace(/-chapter-\d+(?:[.-]\d+)?(?:-.*)?$/i, "");
  return match[1].toLowerCase() + "/" + slug;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validGlossary(value) {
  if (!isRecord(value)) throw new Error("Glossary must be an object of source terms and translations.");
  const result = Object.create(null);
  for (const [term, translation] of Object.entries(value)) {
    if (!term.trim() || typeof translation !== "string" || !translation.trim()) {
      throw new Error("Every glossary term and translation must be a non-empty string.");
    }
    result[term] = translation;
  }
  return result;
}

function withStorageLock(work) {
  const task = storageQueue.then(work);
  storageQueue = task.catch(() => {});
  return task;
}

function withStoryLock(storyKey, work) {
  const previous = storyQueues.get(storyKey) || Promise.resolve();
  const task = previous.then(work);
  const tail = task.catch(() => {});
  storyQueues.set(storyKey, tail);
  tail.then(() => { if (storyQueues.get(storyKey) === tail) storyQueues.delete(storyKey); });
  return task;
}

async function migrateLegacyGlossaries() {
  return withStorageLock(async () => {
    const marker = await chrome.storage.local.get(MIGRATION_KEY);
    if (marker[MIGRATION_KEY]) return marker[MIGRATION_KEY];
    const store = await chrome.storage.local.get(null);
    const report = { version: 1, completedAt: new Date().toISOString(), stories: [], ambiguousKeys: [], skipped: [] };
    const groups = new Map();
    for (const storageKey of Object.keys(store).sort()) {
      if (!/^(glossary|settings):/i.test(storageKey)) continue;
      const prefix = storageKey.slice(0, storageKey.indexOf(":") + 1);
      const oldKey = storageKey.slice(prefix.length);
      if (!/^(?:[a-z0-9-]+\.)*lnmtl\.com(?:\/|$)/i.test(oldKey)) continue;
      if (/^(?:[a-z0-9-]+\.)*lnmtl\.com\/?(?:novel|chapter)?\/?$/i.test(oldKey)) {
        report.ambiguousKeys.push(storageKey);
        continue;
      }
      const stable = canonicalStoryKey(oldKey);
      if (stable === oldKey) continue;
      if (!groups.has(stable)) groups.set(stable, []);
      groups.get(stable).push({ storageKey, prefix });
    }
    const writes = Object.create(null);
    for (const [storyKey, sources] of groups) {
      // Numeric URL chapter order, not lexicographic order (2 before 10).
      sources.sort((a, b) => a.storageKey.localeCompare(b.storageKey, "en", { numeric: true }) ||
        (a.storageKey < b.storageKey ? -1 : a.storageKey > b.storageKey ? 1 : 0));
      const glossaryKey = "glossary:" + storyKey;
      let merged;
      try { merged = validGlossary(store[glossaryKey] ?? {}); }
      catch (error) { report.skipped.push({ key: glossaryKey, reason: error.message }); continue; }
      const detail = { storyKey, sourceKeys: [], addedTerms: 0, conflicts: [], settingsSource: null };
      const origins = Object.assign(Object.create(null), Object.fromEntries(Object.keys(merged).map(term => [term, glossaryKey])));
      for (const { storageKey, prefix } of sources) {
        if (prefix !== "glossary:") continue;
        let glossary;
        try { glossary = validGlossary(store[storageKey]); }
        catch (error) { report.skipped.push({ key: storageKey, reason: error.message }); continue; }
        detail.sourceKeys.push(storageKey);
        for (const [term, translation] of Object.entries(glossary)) {
          if (!Object.hasOwn(merged, term)) {
            merged[term] = translation;
            origins[term] = storageKey;
            detail.addedTerms++;
          } else if (merged[term] !== translation) {
            detail.conflicts.push({ term, kept: merged[term], keptFrom: origins[term], alternative: translation, from: storageKey });
          }
        }
      }
      if (detail.sourceKeys.length) writes[glossaryKey] = merged;
      const settingsKey = "settings:" + storyKey;
      if (!Object.hasOwn(store, settingsKey)) {
        // Last numbered chapter is the best available hint for most recent preferences;
        // no timestamps existed in the old storage format.
        for (const { storageKey, prefix } of [...sources].reverse()) {
          if (prefix !== "settings:") continue;
          const value = store[storageKey];
          if (!isRecord(value)) { report.skipped.push({ key: storageKey, reason: "Invalid settings object" }); continue; }
          writes[settingsKey] = {
            mode: Object.hasOwn(WNT_MODES, value.mode) ? value.mode : "general",
            customInstructions: typeof value.customInstructions === "string" ? value.customInstructions : "",
            auto: value.auto === true,
          };
          detail.settingsSource = storageKey;
          break;
        }
      }
      report.stories.push(detail);
    }
    // Never remove the old keys. Write the completion report only with the results.
    writes[MIGRATION_KEY] = report;
    await chrome.storage.local.set(writes);
    return report;
  });
}

function ensureMigration() {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyGlossaries().catch(error => { migrationPromise = null; throw error; });
  }
  return migrationPromise;
}
