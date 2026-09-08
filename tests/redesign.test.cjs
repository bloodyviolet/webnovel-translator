const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { webcrypto } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const { parseHTML } = require('linkedom');
function runtime(extra = {}) {
  const context = vm.createContext({ console, URL, TextEncoder, TextDecoder, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, ReadableStream, Response, indexedDB: new IDBFactory(), ...extra });
  for (const file of ['shared.js', 'db.js', 'modes.js', 'provider.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context;
}
const clone = value => JSON.parse(JSON.stringify(value));
test('story detection preserves ch titles and strips only actual routes/chapter suffixes', () => {
  const { WNT: u } = runtime();
  for (const [url, expected] of [
    ['https://lnmtl.com/chapter/chaotic-sword-god-chapter-4239', 'lnmtl.com/chaotic-sword-god'],
    ['https://lnmtl.com/chapter/chaotic-sword-god-chapter-4240', 'lnmtl.com/chaotic-sword-god'],
    ['https://example.com/novel/chasing-the-dao/chapter-2', 'example.com/chasing-the-dao'],
    ['https://example.com/chronicles-of-dawn/ch/10', 'example.com/chronicles-of-dawn'],
    ['https://example.com/chapterhouse/chapter/10', 'example.com/chapterhouse'],
    ['https://example.com/book/another-story/page/2', 'example.com/another-story'],
  ]) assert.equal(u.storyFromURL(url), expected);
});
test('configuration validates endpoint/budgets and supports no local key', () => {
  const { WNT: u } = runtime();
  assert.equal(u.validateConfig(u.DEFAULTS).apiKey, '');
  for (const config of [{ chunkChars: -1 }, { baseUrl: 'file:///test' }, { baseUrl: 'http://localhost:8080/v1' }, { maxTokens: 8192, contextTokens: 4096 }, { model: '' }]) assert.throws(() => u.validateConfig({ ...u.DEFAULTS, ...config }));
  assert.equal(u.permissionPattern('http://localhost:8080/v1/chat/completions'), 'http://localhost/*');
});
test('oversized text splitting is lossless and preserves Unicode', () => {
  const { WNT: u } = runtime(); const text = ('天地。😀 A sentence!\n').repeat(300);
  const parts = u.splitText(text, 101); assert.equal(parts.join(''), text);
  assert.ok(parts.every(p => Array.from(p).length <= 101));
  assert.ok(parts.every(p => !/[\uD800-\uDBFF]$/.test(p)));
});
test('language namespaces separate glossaries; retrieval keeps stored glossary intact', () => {
  const { WNT: u } = runtime();
  assert.notEqual(u.glossaryId('lnmtl.com/story', 'English'), u.glossaryId('lnmtl.com/story', 'Portuguese'));
  const record = { terms: { 长剑: 'Long sword', 剑: 'Sword', 不在: 'Absent' }, pinned: [] };
  const result = u.relevantGlossary(record, '长剑', 100);
  assert.deepEqual(Object.keys(result), ['长剑', '剑']); assert.equal(record.terms.不在, 'Absent');
});
test('llama.cpp modern/legacy controls, schema and native Ollama body are distinct', () => {
  const { WNT: u, WNTProvider: p } = runtime(); const messages = [{ role: 'user', content: 'x' }];
  let body = p.requestBody(u.DEFAULTS, messages, 2);
  assert.equal(body.reasoning_effort, 'none'); assert.equal(body.response_format.schema.properties.translations.minItems, 2); assert.equal(body.stream, true);
  body = p.requestBody({ ...u.DEFAULTS, thinking: 'legacy' }, messages, 2); assert.equal(body.chat_template_kwargs.enable_thinking, false); assert.equal(body.reasoning_effort, undefined);
  body = p.requestBody({ ...u.DEFAULTS, provider: 'ollama' }, messages, 2); assert.equal(body.think, false); assert.equal(body.options.num_ctx, 8192); assert.ok(body.format);
});
function streamingResponse(lines, split = 7) {
  const bytes = new TextEncoder().encode(lines); let offset = 0;
  return new Response(new ReadableStream({ pull(c) { if (offset >= bytes.length) c.close(); else { c.enqueue(bytes.slice(offset, offset += split)); } } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const good = JSON.stringify({ translations: ['Hello 世界'], glossary_updates: [{ source: '世界', translation: 'World' }] });
test('SSE parser handles fragmented UTF-8, CRLF, comments, usage, and no credentials', async () => {
  let request;
  const c = runtime({ fetch: async (_, req) => { request = req; return streamingResponse(': heartbeat\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: { content: good } }] }) + '\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n', 1); } });
  const result = await c.WNTProvider.generate(c.WNT.DEFAULTS, '', [], 1, new AbortController().signal);
  assert.equal(result.translations[0], 'Hello 世界'); assert.equal(result.metrics.usage.completion_tokens, 12); assert.equal(request.headers.Authorization, undefined);
});
test('native Ollama NDJSON stream is parsed independently of SSE', async () => {
  const c = runtime({ fetch: async () => streamingResponse(JSON.stringify({ message: { content: good } }) + '\n' + JSON.stringify({ done: true, done_reason: 'stop', eval_count: 20 }) + '\n') });
  const result = await c.WNTProvider.generate({ ...c.WNT.DEFAULTS, provider: 'ollama' }, '', [], 1, new AbortController().signal);
  assert.equal(result.translations[0], 'Hello 世界'); assert.equal(result.metrics.usage.completion_tokens, 20);
});
test('truncated, malformed and prematurely disconnected streams fail before commit', async () => {
  for (const finish of ['length', null]) {
    const c = runtime({ fetch: async () => streamingResponse('data: ' + JSON.stringify({ choices: [{ delta: { content: good }, finish_reason: finish }] }) + '\n\n') });
    await assert.rejects(c.WNTProvider.generate(c.WNT.DEFAULTS, '', [], 1, new AbortController().signal), /limit|successful/);
  }
  const c = runtime();
  assert.throws(() => c.WNTProvider.parseFinal('{"translations":[],"glossary_updates":[]}', 1));
  assert.equal(c.WNTProvider.parseFinal('<think>{bad}</think>```json\n' + good + '\n```', 1).translations[0], 'Hello 世界');
});
test('cancellation aborts the actual network request', async () => {
  let started;
  const begin = new Promise(r => started = r);
  const c = runtime({ fetch: async (_, req) => { started(); return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason))); } });
  const ctrl = new AbortController(); const running = c.WNTProvider.generate(c.WNT.DEFAULTS, '', [], 1, ctrl.signal);
  await begin; ctrl.abort(Error('User stop')); await assert.rejects(running, /User stop/);
});
test('silent model and total deadline abort without a response', async () => {
  const c = runtime({ fetch: async (_, req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason))) });
  await assert.rejects(c.WNTProvider.generate({ ...c.WNT.DEFAULTS, stallSec: 0.01 }, '', [], 1, new AbortController().signal), /stalled/);
  await assert.rejects(c.WNTProvider.generate({ ...c.WNT.DEFAULTS, timeoutSec: 0.01 }, '', [], 1, new AbortController().signal), /deadline/);
});
test('durable batch commit saves job, glossary, cache together and keeps established names', async () => {
  const { WNTDB: db } = runtime();
  await db.put('jobs', { id: 'j', status: 'running', glossaryId: 'g', story: 's', language: 'English', units: [{ text: 'a' }, { text: 'b' }], results: [null, null], metrics: [] });
  await db.put('glossaries', { id: 'g', terms: { A: 'Established' }, revision: 0, editRevision: 0 });
  await db.commitBatch('j', 0, ['One'], { A: 'Wrong', B: 'New' }, { id: 'cache', created: 1 }, { elapsedMs: 10 }, [], 0);
  assert.deepEqual(clone((await db.get('jobs', 'j')).results), ['One', null]);
  assert.equal((await db.get('glossaries', 'g')).terms.A, 'Established'); assert.ok(await db.get('cache', 'cache'));
  await db.commitBatch('j', 1, ['Two'], {}, null, {}, [], 0); assert.equal((await db.get('jobs', 'j')).status, 'done');
});
test('cancelled and glossary-stale results cannot be committed', async () => {
  const { WNTDB: db } = runtime();
  const job = { id: 'j', status: 'paused', glossaryId: 'g', units: [{}], results: [null] };
  await db.put('jobs', job); assert.equal(await db.commitBatch('j', 0, ['stale'], {}, null, {}), false);
  await db.put('jobs', { ...job, status: 'running' }); await db.put('glossaries', { id: 'g', terms: {}, editRevision: 2 });
  assert.equal(await db.commitBatch('j', 0, ['stale'], {}, null, {}, [], 1), false);
  assert.equal((await db.get('jobs', 'j')).results[0], null);
});
test('reader extraction handles nested sentences, BRs and entities without touching markup', () => {
  const { window, document } = parseHTML('<html><body><main><p>Start <span class="sentence">one &amp; two</span> end.</p><div>Alpha<br>Beta <b>bold</b></div><script>bad()</script><p hidden>hidden</p></main></body></html>');
  window.Element.prototype.getClientRects = function () { return [{}]; };
  const c = runtime({ document, Element: window.Element, Node: { TEXT_NODE: 3 }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extract.js'), 'utf8'), c);
  const root = document.querySelector('main'), html = root.innerHTML;
  const items = c.WNTExtract.paragraphs(root);
  assert.equal(items.map(i => i.text).join('|'), 'Start|one & two|end.|Alpha|Beta bold');
  assert.equal(root.innerHTML, html); assert.ok(items.every(i => i.nodes.every(n => n.isConnected)));
  const oldText = items.map(i => i.text).join('|'); root.querySelector('b').textContent = 'changed';
  assert.notEqual(c.WNTExtract.paragraphs(root).map(i => i.text).join('|'), oldText);
});

test('runner recovery pauses only interrupted jobs and preserves completed batches', async () => {
  const { WNTDB: db } = runtime();
  await db.put('jobs', { id: 'active', status: 'running', results: ['Saved translation', null], completed: 1 });
  await db.put('jobs', { id: 'waiting', status: 'queued', results: [null], completed: 0 });
  await db.put('jobs', { id: 'finished', status: 'done', results: ['Finished'], completed: 1 });
  await db.recoverInterruptedJobs();
  assert.equal((await db.get('jobs', 'active')).status, 'paused');
  assert.deepEqual(clone((await db.get('jobs', 'active')).results), ['Saved translation', null]);
  assert.equal((await db.get('jobs', 'waiting')).status, 'queued');
  assert.equal((await db.get('jobs', 'finished')).status, 'done');
});
