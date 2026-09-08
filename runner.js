const DB = WNTDB, U = WNT, Provider = WNTProvider;
let activeId = null, controller = null, polling = false, lastRender = '';
const $ = id => document.getElementById(id);
async function render() {
  const jobs = (await DB.all('jobs')).sort((a, b) => b.created - a.created);
  const signature = JSON.stringify(jobs.map(j => [j.id, j.status, j.completed, j.error, j.progress]));
  if (signature === lastRender) return; lastRender = signature;
  $('jobs').replaceChildren();
  for (const job of jobs) {
    const section = document.createElement('article');
    const title = document.createElement('h2'); title.textContent = job.story + ' → ' + job.language + ' · ' + (job.engineName || job.config.model); section.append(title);
    const status = document.createElement('p'); status.textContent = `${job.status} · ${job.completed}/${job.units.length} units` + (job.progress ? ` · ${job.progress.elapsedSec}s · ${job.progress.outputChars} output characters` : '') + (job.error ? ' · ' + job.error : ''); section.append(status);
    const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.disabled = !['running', 'queued'].includes(job.status);
    stop.onclick = async () => { await DB.update('jobs', job.id, j => ({ ...j, status: 'paused', error: 'Stopped by user.' })); if (activeId === job.id) controller?.abort(Error('Stopped.')); render(); }; section.append(stop);
    const resume = document.createElement('button'); resume.textContent = 'Resume missing batches'; resume.disabled = !['paused', 'error', 'cancelled'].includes(job.status);
    resume.onclick = async () => { await DB.update('jobs', job.id, j => ({ ...j, status: 'queued', error: '', updated: Date.now() })); render(); }; section.append(resume);
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Read saved translation and metrics'; details.append(summary);
    const text = document.createElement('div'); text.className = 'reading';
    job.units.forEach((unit, i) => { const p = document.createElement('p'); p.textContent = job.results[i] || '[Pending] ' + unit.text; text.append(p); });
    const metrics = document.createElement('pre'); metrics.textContent = JSON.stringify(job.metrics || [], null, 2); details.append(text, metrics); section.append(details); $('jobs').append(section);
  }
}
async function run(job) {
  activeId = job.id; controller = new AbortController();
  await DB.update('jobs', job.id, j => ({ ...j, status: 'running', error: '', updated: Date.now() }));
  let progressWrite = Promise.resolve(), lastProgress = 0;
  const monitor = setInterval(async () => {
    try { const current = await DB.get('jobs', job.id); if (current?.status !== 'running') controller?.abort(Error(current?.error || 'Stopped.')); }
    catch (error) { controller?.abort(error); }
  }, 500);
  try {
    while (!controller.signal.aborted) {
      job = await DB.get('jobs', job.id);
      if (job.status !== 'running') break;
      const start = job.results.findIndex(value => value === null); if (start < 0) break;
      const record = await DB.get('glossaries', job.glossaryId);
      if ((record?.editRevision || 0) !== job.glossaryEditRevision) throw Error('Glossary changed. Start translation again from the page to apply the edited terminology.');
      const cfg = job.config;
      const savedCredentials = await chrome.storage.local.get({ credentials: {}, profileCredentials: {} });
      const apiKey = U.jobApiKey(cfg, savedCredentials);
      if (!await chrome.permissions.contains({ origins: [WNT.permissionPattern(cfg.baseUrl)] })) throw Error('Server permission missing. Open settings and save the configuration.');
      let end = start, chars = 0;
      while (end < job.units.length && job.results[end] === null && end - start < 20) {
        const next = job.units[end].text.length;
        if (chars + next > cfg.chunkChars && end > start) break;
        chars += next; end++;
      }
      let texts, glossary, messages, tokenInfo;
      while (true) {
        texts = job.units.slice(start, end).map(u => u.text);
        glossary = U.relevantGlossary(record, texts.join('\n'), cfg.glossaryChars);
        messages = Provider.messages(job, texts, glossary);
        tokenInfo = await Provider.promptTokens(cfg, apiKey, messages, controller.signal);
        if (tokenInfo.count + cfg.maxTokens <= cfg.contextTokens) break;
        if (end - start > 1) { end--; continue; }
        // Try removing optional glossary context before splitting a large source unit.
        messages = Provider.messages(job, texts, {});
        tokenInfo = await Provider.promptTokens(cfg, apiKey, messages, controller.signal);
        if (tokenInfo.count + cfg.maxTokens <= cfg.contextTokens) { glossary = {}; break; }
        if (Array.from(texts[0]).length <= 100) throw Error('Prompt exceeds the context budget. Shorten instructions or increase configured/server context.');
        const parts = U.splitText(texts[0], Math.ceil(Array.from(texts[0]).length / 2)).filter(t => t.trim());
        job = await DB.update('jobs', job.id, current => {
          if (current.status !== 'running') return current;
          current.units.splice(start, 1, ...parts.map(text => ({ text, paragraph: current.units[start].paragraph })));
          current.results.splice(start, 1, ...parts.map(() => null)); return current;
        });
        if (job.status !== 'running') break;
        end = start + 1;
      }
      if (controller.signal.aborted || job.status !== 'running') break;
      const cacheId = await U.hash([texts, job.story, job.language, cfg, job.instruction, glossary]);
      const cached = await DB.get('cache', cacheId);
      if (cached) {
        const committed = await DB.commitBatch(job.id, start, cached.translations, {}, null, { cached: true, elapsedMs: 0 }, [], job.glossaryEditRevision);
        if (!committed) break; continue;
      }
      const result = await navigator.locks.request('wnt-generation', { signal: controller.signal }, () => Provider.generate(cfg, apiKey, messages, texts.length, controller.signal, progress => {
        if (Date.now() - lastProgress < 500) return; lastProgress = Date.now();
        progressWrite = progressWrite.then(() => DB.update('jobs', job.id, current => current.status === 'running' ? { ...current, progress, updated: Date.now() } : current)).catch(() => {});
      }));
      await progressWrite;
      const additions = Object.create(null), candidates = [];
      const source = texts.join('\n');
      for (const [term, translation] of Object.entries(result.updates)) {
        if (!source.includes(term)) candidates.push({ term, alternative: translation, reason: 'Source term is absent from this batch.' });
        else if (Object.hasOwn(record?.terms || {}, term) && record.terms[term] !== translation) candidates.push({ term, kept: record.terms[term], alternative: translation, reason: 'Established term preserved.' });
        else additions[term] = translation;
      }
      const metrics = { ...result.metrics, promptBudget: tokenInfo, unitCount: texts.length, sourceChars: source.length };
      const cache = { id: cacheId, translations: result.translations, created: Date.now() };
      if (!await DB.commitBatch(job.id, start, result.translations, additions, cache, metrics, candidates, job.glossaryEditRevision)) break;
      // Cache with the newly learned relevant terms too, for later identical batches.
      const latest = await DB.get('glossaries', job.glossaryId);
      const nextGlossary = U.relevantGlossary(latest, source, cfg.glossaryChars);
      await DB.put('cache', { ...cache, id: await U.hash([texts, job.story, job.language, cfg, job.instruction, nextGlossary]) });
    }
  } catch (error) {
    await DB.update('jobs', job.id, current => current?.status === 'running' ? { ...current, status: controller.signal.aborted ? 'paused' : 'error', error: error.message || String(error), progress: null, updated: Date.now() } : current);
  } finally { clearInterval(monitor); await progressWrite; activeId = null; controller = null; await DB.pruneCache(); }
}
async function schedule() {
  if (polling) return; polling = true;
  try {
    await render();
    if (!activeId) {
      const job = (await DB.all('jobs')).filter(j => j.status === 'queued').sort((a, b) => a.created - b.created)[0];
      if (job) run(job).catch(error => { $('status').textContent = error.message; });
    }
  } catch (error) { $('status').textContent = error.message; }
  finally { polling = false; }
}
$('refresh').onclick = render;
window.addEventListener('pagehide', () => controller?.abort(Error('Job tab closed.')));
(async () => {
  await chrome.runtime.sendMessage({ type: 'CONFIG_GET' });
  await navigator.locks.request('wnt-translation-runner', async () => {
    await DB.recoverInterruptedJobs();
    $('status').textContent = 'Ready. One request at a time; completed batches are saved automatically.';
    setInterval(schedule, 750); schedule();
    await new Promise(() => {});
  });
})().catch(error => { $('status').textContent = error.message; });
