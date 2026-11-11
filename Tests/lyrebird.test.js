// Tests for Lyrebird, the AI middleman (Lyrebird/Lyrebird.gs), run outside Google.
// Google's services are replaced by small fakes, including a fake Gemini,
// so these tests never use the internet or a real key.
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEY = 'TEST-KEY-not-a-real-key';
const SHORTLIST = [{ sci: 'Corvus corone', common: 'Carrion Crow' }, { sci: 'Corvus corax', common: 'Common Raven' }];
const request = extra => JSON.stringify({ action: 'nameFix', ebird: { sci: 'Corvus cornix', common: 'Hooded Crow' }, shortlist: SHORTLIST, ...extra });

/** A fresh Lyrebird with fake Google services. geminiReply: [httpCode, body]. */
function setup({ geminiReply = [200, { choice: 1, reason: 'Hooded Crow is part of Carrion Crow here' }], props = {} } = {}) {
  const store = new Map(Object.entries({ GEMINI_API_KEY: KEY, ...props }));
  const calls = [];
  const fakes = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (store.has(k) ? store.get(k) : null),
      setProperty: (k, v) => store.set(k, String(v)),
      deleteProperty: k => store.delete(k),
      getKeys: () => [...store.keys()],
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => ({ text }) }) },
    UrlFetchApp: { fetch: (url, opts) => {
      calls.push({ url, opts });
      const [code, body] = geminiReply;
      const text = typeof body === 'string' ? body : JSON.stringify(
        code === 200 ? { candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] } : body);
      return { getResponseCode: () => code, getContentText: () => text };
    } },
  };
  const ctx = vm.createContext(fakes);
  for (const file of ['NameFixesAssistant.gs', 'Lyrebird/Lyrebird.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
  }
  const run = expr => vm.runInContext(expr, ctx);
  const post = contents => JSON.parse(run('doPost')({ postData: { contents } }).text);
  const today = 'USED_' + new Date().toISOString().slice(0, 10);
  return { post, run, store, calls, today };
}

test('opening the web address shows it is running, without revealing the key', () => {
  const { run } = setup();
  const text = run('doGet')().text;
  assert.deepEqual(JSON.parse(text), { ok: true, service: 'Lyrebird (Life List AI middleman)', version: '2026-11-11 (session 3)', usedToday: 0, dailyCap: 200 });
  assert.ok(!text.includes(KEY));
});

test('nameFix: asks Gemini and returns the checked choice', () => {
  const { post, calls, store, today } = setup();
  const r = post(request());
  assert.equal(r.ok, true);
  assert.equal(r.status, 'pick');
  assert.equal(r.choice, 1);
  assert.match(r.reason, /Carrion Crow/);
  assert.equal(calls.length, 1);
  assert.equal(store.get(today), '1');                 // counted towards today's allowance
});

test('the key goes in a header, never the web address, and only bird names are sent', () => {
  const { post, calls } = setup();
  post(request({ location: 'My garden, 51.5,-0.1', date: '2026-11-11' }));     // extra fields are dropped
  const { url, opts } = calls[0];
  assert.ok(!url.includes(KEY));
  assert.equal(opts.headers['x-goog-api-key'], KEY);
  assert.match(opts.payload, /Corvus cornix/);
  assert.ok(!/garden|51\.5|2026-11-11/.test(opts.payload));
});

test('an answer that is not on the shortlist is rejected', () => {
  const { post } = setup({ geminiReply: [200, { choice: 9, reason: 'made up' }] });
  const r = post(request());
  assert.equal(r.ok, true);
  assert.equal(r.status, 'invalid');
  assert.equal(r.choice, 0);
});

test('bad requests are refused before Gemini is asked', () => {
  const { post, calls } = setup();
  const long = 'x'.repeat(121);
  const cases = [
    'not json',
    JSON.stringify({ action: 'deleteEverything' }),
    JSON.stringify([1, 2]),
    request({ ebird: { sci: long, common: '' } }),
    request({ ebird: { sci: '', common: 'Hooded Crow' } }),
    request({ shortlist: [] }),
    request({ shortlist: Array(21).fill(SHORTLIST[0]) }),
    request({ shortlist: [{ sci: 42 }] }),
  ];
  cases.forEach(c => {
    const r = post(c);
    assert.equal(r.ok, false, c.slice(0, 40));
    assert.equal(r.error, 'bad-request', c.slice(0, 40));
  });
  assert.equal(calls.length, 0);
});

test('the daily cap stops calls before Gemini is asked', () => {
  const t = 'USED_' + new Date().toISOString().slice(0, 10);
  const { post, calls } = setup({ props: { [t]: '200' } });
  const r = post(request());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'limit');
  assert.equal(calls.length, 0);
});

test('a new day starts from zero and tidies away old counts', () => {
  const { post, store, today } = setup({ props: { 'USED_2020-01-01': '200' } });
  assert.equal(post(request()).ok, true);
  assert.equal(store.get(today), '1');
  assert.ok(!store.has('USED_2020-01-01'));
});

test('no key set up: a clear error, and nothing is counted', () => {
  const { post, store, today } = setup({ props: { GEMINI_API_KEY: '' } });
  const r = post(request());
  assert.equal(r.error, 'not-configured');
  assert.ok(!store.has(today));
});

test('a Gemini failure is reported without revealing the key', () => {
  const { post } = setup({ geminiReply: [500, { error: { message: 'Internal error' } }] });
  const r = post(request());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ai-unavailable');
  assert.match(r.message, /500/);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('the candidate number is right even with an older NameFixesAssistant.gs (no "choice" in its answers)', () => {
  const { post, run } = setup({ geminiReply: [200, { choice: 2, reason: 'ravens' }] });
  // Simulate the older shared file: its parseAiAnswer_ didn't include the number
  const original = run('parseAiAnswer_');
  run('globalThis').parseAiAnswer_ = (text, list) => { const a = original(text, list); delete a.choice; return a; };
  const r = post(request());
  assert.equal(r.status, 'pick');
  assert.equal(r.choice, 2);
});
