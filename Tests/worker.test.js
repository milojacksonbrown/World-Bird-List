// Tests for Lyrebird on Cloudflare Workers (worker/main.js, bundled into worker/dist/lyrebird.js).
// The Worker's storage (D1) is played by Node's own SQLite, so the real SQL is tested, and the
// network by a fake fetch: no Cloudflare account, internet or real key needed.
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { bundle, OUT } = require('../tools/build-worker');

const KEYS = { GROQ_API_KEY: 'TEST-GROQ-not-real', GEMINI_API_KEY: 'TEST-GEMINI-not-real', EBIRD_API_KEY: 'TEST-EBIRD-not-real' };
const SITE = 'https://milojacksonbrown.github.io';

/** D1's interface (prepare → bind → first / run), on an in-memory SQLite database. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) || null,
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: sql => stmt(sql), db };
}

/**
 * A fresh Worker, its storage, and a fake network. replies: what the AI and eBird answer, in order:
 * [httpCode, body] for each AI call; ebird: [httpCode, list].
 */
async function setup({ ai = [[200, { status: 'query', reason: 'Owls', table: 'species', filters: [], sortField: '', sortDir: '' }]], ebird = [200, []], env = {} } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (/api\.ebird\.org/.test(url)) return new Response(JSON.stringify(ebird[1]), { status: ebird[0] });
    const [code, body] = ai[Math.min(calls.filter(c => !/ebird/.test(c.url)).length - 1, ai.length - 1)];
    const groq = /groq/.test(url);
    const text = code !== 200 ? JSON.stringify(body) : groq ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] })
      : JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
    return new Response(text, { status: code });
  };
  // A fresh copy of the module each time (its "tables ready" note starts empty)
  const mod = await import(pathToFileURL(OUT).href + '?t=' + Math.random());
  const DB = fakeD1();
  const fullEnv = Object.assign({ DB }, KEYS, env);
  const send = async (method, body, origin = SITE) => {
    const headers = origin ? { Origin: origin } : {};
    const res = await mod.default.fetch(new Request('https://lyrebird.example.workers.dev/', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), fullEnv);
    return { res, json: res.headers.get('Content-Type') === 'application/json' ? await res.json() : null };
  };
  const post = async body => (await send('POST', body)).json;
  return { post, send, calls, DB };
}

test('the bundle is up to date with the shared code and worker/main.js (else run: node tools/build-worker.js)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), bundle());
});

test('opening the address shows it is running, without revealing any key', async () => {
  const { send } = await setup();
  const { res, json } = await send('GET');
  assert.equal(json.ok, true);
  assert.equal(json.host, 'Cloudflare Worker');
  assert.deepEqual(json.actions, ['nameFix', 'query', 'recent']);
  assert.equal(json.usedToday, 0);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.ok(!JSON.stringify(json).includes('TEST-'));
});

test('only the site (or no page at all) may use it; the browser\'s pre-check is answered', async () => {
  const { send } = await setup();
  assert.equal((await send('POST', { action: 'query', question: 'Owls?' }, 'https://evil.example')).res.status, 403);
  assert.equal((await send('POST', { action: 'query', question: 'Owls?' }, '')).json.ok, true);
  const pre = await send('OPTIONS', undefined);
  assert.equal(pre.res.status, 204);
  assert.match(pre.res.headers.get('Access-Control-Allow-Methods'), /POST/);
});

test('a question: Groq first, the key in a header, only the question sent, and the same checked reply as Apps Script', async () => {
  const { post, calls } = await setup();
  const r = await post({ action: 'query', question: 'Which owls have I seen?', location: 'my garden' });
  assert.equal(r.status, 'query');
  assert.equal(r.model, 'groq:openai/gpt-oss-120b');
  assert.equal(r.backup, false);
  assert.equal(r.query.table, 'species');
  assert.match(calls[0].url, /api\.groq\.com/);
  assert.ok(!calls[0].url.includes('TEST-'));
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer TEST-GROQ-not-real');
  assert.match(calls[0].opts.body, /Which owls have I seen/);
  assert.ok(!/garden/.test(calls[0].opts.body));
});

test('the same question again that day comes from memory: no AI call, nothing counted', async () => {
  const { post, calls, send } = await setup();
  await post({ action: 'query', question: 'Which owls have I seen?' });
  const again = await post({ action: 'query', question: '  which OWLS have I seen? ' });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
  assert.equal((await send('GET')).json.usedToday, 1);
});

test('a query outside the allowed tables is refused, as in Apps Script, and not remembered', async () => {
  const { post, calls } = await setup({ ai: [[200, { status: 'query', reason: '', table: 'species', filters: [{ field: 'email', op: 'eq', value: 'x' }] }]] });
  assert.equal((await post({ action: 'query', question: 'Everything' })).status, 'invalid');
  await post({ action: 'query', question: 'Everything' });
  assert.equal(calls.length, 2);
});

test('when Groq fails, Gemini answers through the same checks, and says it was the backup', async () => {
  const { post, calls } = await setup({ ai: [[503, { error: { message: 'busy' } }], [200, { status: 'query', reason: 'Owls', table: 'species', filters: [] }]] });
  const r = await post({ action: 'query', question: 'Owls?' });
  assert.equal(r.status, 'query');
  assert.equal(r.model, 'gemini-3-flash-preview');
  assert.equal(r.backup, true);
  assert.equal(calls[1].opts.headers['x-goog-api-key'], 'TEST-GEMINI-not-real');
});

test('when both fail, the reply explains both, in Apps Script\'s words, without a key', async () => {
  const { post } = await setup({ ai: [[429, {}], [500, { error: { message: 'Internal error' } }]] });
  const r = await post({ action: 'query', question: 'Owls?' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ai-unavailable');
  assert.match(r.message, /groq:openai\/gpt-oss-120b: Groq free-tier limit reached.*then gemini-3-flash-preview: Gemini error 500: Internal error/);
  assert.ok(!r.message.includes('TEST-'));
});

test('name fixes: the AI must pick from the shortlist', async () => {
  const shortlist = [{ sci: 'Corvus corone', common: 'Carrion Crow' }, { sci: 'Corvus corax', common: 'Common Raven' }];
  const ok = await (await setup({ ai: [[200, { choice: 1, reason: 'Hooded Crow is part of Carrion Crow here' }]] }))
    .post({ action: 'nameFix', ebird: { sci: 'Corvus cornix', common: 'Hooded Crow' }, shortlist });
  assert.equal(ok.status, 'pick');
  assert.equal(ok.choice, 1);
  const bad = await (await setup({ ai: [[200, { choice: 7, reason: 'made up' }]] }))
    .post({ action: 'nameFix', ebird: { sci: 'Corvus cornix', common: 'Hooded Crow' }, shortlist });
  assert.equal(bad.status, 'invalid');
});

test('bad requests are refused before any AI call', async () => {
  const { post, calls, send } = await setup();
  assert.equal((await post({ action: 'deleteEverything' })).error, 'bad-request');
  assert.equal((await post({ action: 'query', question: 'x'.repeat(301) })).error, 'bad-request');
  const notJson = await send('POST', undefined);
  assert.equal(notJson.json.error, 'bad-request');
  assert.equal(calls.length, 0);
});

test('the daily cap stops calls before the AI is asked, and one SQL step counts', async () => {
  const { post, calls, DB } = await setup();
  const day = new Date().toISOString().slice(0, 10);
  DB.db.exec('CREATE TABLE IF NOT EXISTS counts (name TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (name, day))');
  DB.db.prepare('INSERT INTO counts VALUES (?, ?, ?)').run('USED_', day, 200);
  const r = await post({ action: 'query', question: 'Owls?' });
  assert.equal(r.error, 'limit');
  assert.equal(calls.length, 0);
});

test('a new day tidies away old counts and forgotten answers, never anything else', async () => {
  const { post, DB } = await setup();
  await post({ action: 'query', question: 'Warm-up' });          // makes the tables
  DB.db.prepare('INSERT INTO counts VALUES (?, ?, ?)').run('USED_', '2020-01-01', 5);
  DB.db.prepare('INSERT INTO memo VALUES (?, ?, ?)').run('old', '{}', 1);
  DB.db.prepare('DELETE FROM counts WHERE day >= ?').run('2021-01-01');   // as if today's first call
  await post({ action: 'query', question: 'First of the day' });
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM counts WHERE day = ?').get('2020-01-01').n, 0);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM memo WHERE key = ?').get('old').n, 0);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM memo').get().n, 2);   // today's answers kept
});

test('Explore: one entry per species, private places left out, the key in a header, remembered for an hour', async () => {
  const sightings = [
    { speciesCode: 'eurrob1', obsDt: '2026-11-17 08:00', locName: 'Minsmere RSPB' },
    { speciesCode: 'eurrob1', obsDt: '2026-11-16 08:00', locName: 'Elsewhere' },
    { speciesCode: 'blutit', obsDt: '2026-11-15', locName: '12 Acacia Avenue', locationPrivate: true },
  ];
  const { post, calls } = await setup({ ebird: [200, sightings] });
  const r = await post({ action: 'recent', region: 'GB-ENG-SUF' });
  assert.deepEqual(r.species, [{ code: 'eurrob1', date: '2026-11-17', loc: 'Minsmere RSPB' }, { code: 'blutit', date: '2026-11-15', loc: '' }]);
  assert.equal(calls[0].opts.headers['X-eBirdApiToken'], 'TEST-EBIRD-not-real');
  assert.ok(!calls[0].url.includes('TEST-'));
  await post({ action: 'recent', region: 'GB-ENG-SUF' });
  assert.equal(calls.length, 1);                                  // the second came from memory
  assert.equal((await post({ action: 'recent', region: 'not a region' })).error, 'bad-request');
});

test('Explore: no eBird key, and eBird errors, are explained', async () => {
  assert.equal((await (await setup({ env: { EBIRD_API_KEY: '' } })).post({ action: 'recent', region: 'GB' })).error, 'not-configured');
  assert.equal((await (await setup({ ebird: [503, []] })).post({ action: 'recent', region: 'GB' })).error, 'ebird-unavailable');
});
