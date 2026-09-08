/* IndexedDB is shared only by trusted extension pages and the worker. */
(() => {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('wnt-v2', 1);
      req.onupgradeneeded = () => {
        for (const name of ['jobs', 'glossaries', 'cache', 'meta']) req.result.createObjectStore(name, { keyPath: 'id' });
      };
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opening = null; }; resolve(req.result); };
      req.onerror = () => { opening = null; reject(req.error); };
    });
    return opening;
  }
  async function transaction(names, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode); let output;
      tx.oncomplete = () => resolve(output);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('Database transaction failed.'));
      try { fn(tx, value => { output = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  const get = (name, id) => transaction([name], 'readonly', (tx, result) => { tx.objectStore(name).get(id).onsuccess = e => result(e.target.result); });
  const all = name => transaction([name], 'readonly', (tx, result) => { tx.objectStore(name).getAll().onsuccess = e => result(e.target.result); });
  const put = (name, value) => transaction([name], 'readwrite', tx => { tx.objectStore(name).put(value); });
  const update = (name, id, fn) => transaction([name], 'readwrite', (tx, result) => {
    const store = tx.objectStore(name);
    store.get(id).onsuccess = e => {
      try { const next = fn(e.target.result); if (next) store.put(next); result(next); }
      catch (error) { tx.abort(); }
    };
  });
  const clear = name => transaction([name], 'readwrite', tx => tx.objectStore(name).clear());
  async function pruneCache(limit = 300) {
    const entries = (await all('cache')).sort((a, b) => b.created - a.created);
    if (entries.length <= limit) return;
    await transaction(['cache'], 'readwrite', tx => entries.slice(limit).forEach(e => tx.objectStore('cache').delete(e.id)));
  }
  async function commitBatch(jobId, start, translations, additions, cache, metrics, candidates = [], expectedRevision) {
    return transaction(['jobs', 'glossaries', 'cache'], 'readwrite', (tx, output) => {
      const jobs = tx.objectStore('jobs'), glossaries = tx.objectStore('glossaries');
      jobs.get(jobId).onsuccess = event => {
        const job = event.target.result;
        if (!job || job.status !== 'running') { output(false); return; }
        glossaries.get(job.glossaryId).onsuccess = event => {
          const record = event.target.result || { id: job.glossaryId, story: job.story, language: job.language, terms: {}, pinned: [], revision: 0, editRevision: 0, candidates: [] };
          if (expectedRevision !== undefined && (record.editRevision || 0) !== expectedRevision) {
            job.status = 'paused'; job.error = 'Glossary was edited during generation. Start a new translation to apply the edits.'; jobs.put(job); output(false); return;
          }
          const terms = Object.assign(Object.create(null), record.terms);
          for (const [key, value] of Object.entries(additions)) if (!Object.hasOwn(terms, key)) terms[key] = value;
          const changed = JSON.stringify(terms) !== JSON.stringify(record.terms);
          record.terms = terms; if (changed) record.revision++;
          record.candidates = [...(record.candidates || []), ...candidates].slice(-200);
          record.updated = Date.now(); glossaries.put(record);
          translations.forEach((text, i) => { job.results[start + i] = text; });
          job.completed = job.results.filter(v => typeof v === 'string').length;
          job.metrics = [...(job.metrics || []), metrics];
          job.updated = Date.now(); job.progress = null;
          if (job.completed === job.units.length) job.status = 'done';
          jobs.put(job);
          if (cache) tx.objectStore('cache').put(cache);
          output(true);
        };
      };
    });
  }
  async function recoverInterruptedJobs() {
    for (const job of await all('jobs')) {
      if (job.status === 'running') await update('jobs', job.id, current => current.status === 'running'
        ? { ...current, status: 'paused', error: 'Runner was interrupted. Resume missing batches.' } : current);
    }
  }
  globalThis.WNTDB = { open, transaction, get, all, put, update, clear, pruneCache, commitBatch, recoverInterruptedJobs };
})();
