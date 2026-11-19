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

/**
 * A fresh Lyrebird with fake Google services. geminiReply: [httpCode, body].
 * geminiReplies: several, one per call in order (e.g. Flash fails, then Gemma answers).
 */
function setup({ geminiReply = [200, { choice: 1, reason: 'Hooded Crow is part of Carrion Crow here' }], geminiReplies, props = {}, ebirdReply = [200, []] } = {}) {
  const store = new Map(Object.entries({ GEMINI_API_KEY: KEY, ...props }));
  const calls = [];
  const cacheStore = new Map();
  const fakes = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (store.has(k) ? store.get(k) : null),
      setProperty: (k, v) => store.set(k, String(v)),
      deleteProperty: k => store.delete(k),
      getKeys: () => [...store.keys()],
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cacheStore.has(k) ? cacheStore.get(k) : null), put: (k, v) => cacheStore.set(k, v) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => ({ text }) }) },
    UrlFetchApp: { fetch: (url, opts) => {
      calls.push({ url, opts });
      if (/api\.ebird\.org/.test(url)) return { getResponseCode: () => ebirdReply[0], getContentText: () => JSON.stringify(ebirdReply[1]) };
      const [code, body] = geminiReplies ? geminiReplies[Math.min(calls.length - 1, geminiReplies.length - 1)] : geminiReply;
      const groq = /api\.groq\.com/.test(url);       // Groq replies in OpenAI's chat format
      const text = typeof body === 'string' ? body : JSON.stringify(code !== 200 ? body
        : groq ? { choices: [{ message: { content: JSON.stringify(body) } }] }
          : { candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
      return { getResponseCode: () => code, getContentText: () => text };
    } },
  };
  const ctx = vm.createContext(fakes);
  for (const file of ['NameFixesAssistant.gs', 'AskYourList.gs', 'Lyrebird/Lyrebird.gs']) {
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
  assert.deepEqual(JSON.parse(text), { ok: true, service: 'Lyrebird (Life List AI middleman)', version: '2026-11-19 (answers remembered)', actions: ['nameFix', 'query', 'recent'], usedToday: 0, dailyCap: 200 });
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

// ---------- the "query" action (Ask your list) ----------

const question = q => JSON.stringify({ action: 'query', question: q });

test('query: sends only the question, with the query reply shape, and returns a checked query', () => {
  const { post, calls } = setup({ geminiReply: [200, { status: 'query', reason: 'Families by % seen', table: 'families',
    filters: [{ field: 'pctSeen', op: 'lt', value: '10' }], sortField: 'pctSeen', sortDir: 'asc' }] });
  const r = post(question('Which families have I seen less than 10% of?'));
  assert.equal(r.ok, true);
  assert.equal(r.status, 'query');
  assert.deepEqual(r.query, { table: 'families', region: '', filters: [{ field: 'pctSeen', op: 'lt', value: 10 }], sortField: 'pctSeen', sortDir: 'asc', limit: 25, columns: [] });
  const sent = JSON.parse(calls[0].opts.payload);
  assert.match(sent.contents[0].parts[0].text, /Question: "Which families have I seen less than 10% of\?"/);
  assert.ok(sent.generationConfig.responseSchema.properties.table, 'asks for the query shape, not the name-fix shape');
});

test('query: the same question again that day comes from memory: no AI call, nothing counted', () => {
  const { post, calls, store, today } = setup({ geminiReply: [200, { status: 'query', reason: 'Heaviest first', table: 'species',
    filters: [], sortField: 'mass', sortDir: 'desc' }] });
  const first = post(question("What's the heaviest bird I've seen?"));
  assert.equal(first.status, 'query');
  assert.equal(first.cached, undefined);
  const again = post(question("  what's the HEAVIEST bird   I've seen?"));      // capitals and spacing don't matter
  assert.equal(again.cached, true);
  assert.deepEqual(again.query, first.query);
  assert.equal(calls.length, 1);                       // the AI was asked once
  assert.equal(store.get(today), '1');                 // and counted once
  post(question("What's the lightest bird I've seen?"));   // a different question is asked afresh
  assert.equal(calls.length, 2);
});

test('query: refusals are not remembered, and a new day asks again', () => {
  const { post, calls, run } = setup({ geminiReply: [200, { status: 'cannot', reason: 'Not in the tables.' }] });
  post(question('What did I see last weekend?'));
  post(question('What did I see last weekend?'));
  assert.equal(calls.length, 2);                       // "cannot" is asked again, in case it was a slip
  assert.notEqual(run('queryCacheKey_("Owls", new Date("2026-11-19T12:00:00Z"))'), run('queryCacheKey_("Owls", new Date("2026-11-20T12:00:00Z"))'));
  assert.notEqual(run('queryCacheKey_("Owls", new Date("2026-11-19T12:00:00Z"))'), run('queryCacheKey_("Owlz", new Date("2026-11-19T12:00:00Z"))'));
});

test('query: a query outside the allowed tables is not passed on', () => {
  const { post } = setup({ geminiReply: [200, { status: 'query', reason: '', table: 'species', filters: [{ field: 'email', op: 'eq', value: 'x' }] }] });
  const r = post(question('Show me everything'));
  assert.equal(r.status, 'invalid');
  assert.equal(r.query, undefined);
});

test('query: "cannot" is passed on with the reason', () => {
  const { post } = setup({ geminiReply: [200, { status: 'cannot', reason: 'Counties are not in the tables.' }] });
  assert.deepEqual(post(question('What did I see in Norfolk?')), { ok: true, status: 'cannot', reason: 'Counties are not in the tables.', model: 'gemini-3-flash-preview', backup: false });
});

test('query: missing or over-long questions are refused before Gemini is asked', () => {
  const { post, calls } = setup();
  assert.equal(post(question('   ')).error, 'bad-request');
  assert.equal(post(question('x'.repeat(301))).error, 'bad-request');
  assert.equal(post(JSON.stringify({ action: 'query', question: { text: 'hi' } })).error, 'bad-request');
  assert.equal(calls.length, 0);
});

// ---------- the backup model (Gemma) ----------

const FLASH = 'gemini-3-flash-preview', GEMMA = 'gemma-4-26b-a4b-it';
const modelOf = call => decodeURIComponent(call.url.match(/models\/([^:]+):/)[1]);
const OUT_OF_QUOTA = [429, { error: { message: 'Quota exceeded' } }];

test('name fixes: the main model answers when it can, and says so', () => {
  const { post, calls } = setup();
  const r = post(request());
  assert.deepEqual([r.model, r.backup], [FLASH, false]);
  assert.deepEqual(calls.map(modelOf), [FLASH]);
});

test('name fixes: when Flash is out of quota, Gemma answers, through the same checks', () => {
  const { post, calls, store, today } = setup({ geminiReplies: [OUT_OF_QUOTA, [200, { choice: 1, reason: 'Hooded Crow is treated as part of Carrion Crow' }]] });
  const r = post(request());
  assert.deepEqual(calls.map(modelOf), [FLASH, GEMMA]);
  assert.equal(r.status, 'pick');
  assert.equal(r.choice, 1);
  assert.deepEqual([r.model, r.backup], [GEMMA, true]);
  assert.equal(store.get(today), '1');            // counts once towards the daily cap
});

test('name fixes: Gemma\'s answer is still checked against the shortlist', () => {
  const { post } = setup({ geminiReplies: [OUT_OF_QUOTA, [200, { choice: 7, reason: 'made up' }]] });
  assert.equal(post(request()).status, 'invalid');
});

test('questions: when Flash is busy, Gemma answers, and its query is checked', () => {
  const { post, calls } = setup({ geminiReplies: [[503, { error: { message: 'high demand' } }],
    [200, { status: 'query', reason: 'Years', table: 'years', region: '', filters: [], sortField: 'lifers', sortDir: 'desc', limit: 1 }]] });
  const r = post(JSON.stringify({ action: 'query', question: 'Which year did I get the most lifers?' }));
  assert.deepEqual(calls.map(modelOf), [FLASH, GEMMA]);
  assert.equal(r.status, 'query');
  assert.equal(r.query.sortField, 'lifers');
  assert.equal(r.backup, true);
  // Gemma gets the same reply shape (responseSchema) as Flash
  assert.ok(JSON.parse(calls[1].opts.payload).generationConfig.responseSchema.properties.table);
});

test('questions: a bad query from Gemma is rejected, as from Flash', () => {
  const { post } = setup({ geminiReplies: [OUT_OF_QUOTA, [200, { status: 'query', reason: '', table: 'species', region: '',
    filters: [{ field: ' состояния_seen', op: 'eq', value: 'true' }], sortField: '', sortDir: 'desc', limit: 0 }]] });
  const r = post(JSON.stringify({ action: 'query', question: 'Which threatened species have I seen?' }));
  assert.equal(r.status, 'invalid');
  assert.equal(r.query, undefined);
});

test('no fallback for problems Gemma would have too (a bad key or request)', () => {
  const { post, calls } = setup({ geminiReply: [403, { error: { message: 'API key not valid' } }] });
  const r = post(request());
  assert.equal(r.error, 'ai-unavailable');
  assert.deepEqual(calls.map(modelOf), [FLASH]);
});

test('when both models fail, the reply explains both, without the key', () => {
  const { post } = setup({ geminiReplies: [OUT_OF_QUOTA, [500, { error: { message: 'Internal error encountered.' } }]] });
  const r = post(request());
  assert.equal(r.error, 'ai-unavailable');
  assert.match(r.message, /gemini-3-flash-preview: free-tier limit reached.*then gemma-4-26b-a4b-it: Gemini error 500/);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('the backup can be changed or turned off with Script Properties', () => {
  const other = setup({ geminiReplies: [OUT_OF_QUOTA, [200, { choice: 1, reason: 'x' }]], props: { GEMINI_FALLBACK_MODEL: 'gemma-4-31b-it' } });
  other.post(request());
  assert.deepEqual(other.calls.map(modelOf), [FLASH, 'gemma-4-31b-it']);
  const off = setup({ geminiReplies: [OUT_OF_QUOTA], props: { GEMINI_FALLBACK_MODEL: 'none' } });
  assert.equal(off.post(request()).error, 'ai-unavailable');
  assert.deepEqual(off.calls.map(modelOf), [FLASH]);
});

// ---------- Groq (another company's models, chosen with AI_MODELS) ----------

const GROQ = 'groq:openai/gpt-oss-120b';
const viaGroq = call => /api\.groq\.com/.test(call.url);

test('AI_MODELS can put a Groq model first: it gets the Groq key, strict JSON, and answers', () => {
  const { post, calls } = setup({ props: { AI_MODELS: GROQ + ', gemini-3-flash-preview', GROQ_API_KEY: 'TEST-GROQ-KEY' } });
  const r = post(request());
  assert.equal(r.status, 'pick');
  assert.deepEqual([r.model, r.backup], [GROQ, false]);
  assert.equal(calls.length, 1);
  assert.ok(viaGroq(calls[0]));
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer TEST-GROQ-KEY');
  assert.ok(!JSON.stringify(calls[0]).includes(KEY), 'the Google key is never sent to Groq');
  const body = JSON.parse(calls[0].opts.payload);
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, {
    type: 'object', properties: { choice: { type: 'integer' }, reason: { type: 'string' } },
    required: ['choice', 'reason'], additionalProperties: false });
});

test('questions on Groq: the query reply shape is converted to strict JSON Schema, and checked', () => {
  const { post, calls } = setup({ props: { AI_MODELS: GROQ, GROQ_API_KEY: 'g' },
    geminiReply: [200, { status: 'query', reason: 'Owls seen', table: 'species', region: '', filters: [{ field: 'family', op: 'contains', value: 'owl' }], sortField: '', sortDir: 'desc', limit: 0 }] });
  const r = post(JSON.stringify({ action: 'query', question: 'Which owls have I seen?' }));
  assert.equal(r.status, 'query');
  assert.equal(r.model, GROQ);
  const schema = JSON.parse(calls[0].opts.payload).response_format.json_schema.schema;
  assert.equal(schema.properties.filters.items.additionalProperties, false);
  assert.deepEqual(schema.properties.filters.items.required, ['field', 'op', 'value']);
  assert.equal(schema.propertyOrdering, undefined);
});

test('if Groq fails for any reason, the next company\'s model answers (even a bad Groq key)', () => {
  const { post, calls } = setup({ props: { AI_MODELS: GROQ + ', gemini-3-flash-preview', GROQ_API_KEY: 'bad' },
    geminiReplies: [[401, { error: { message: 'Invalid API Key' } }], [200, { choice: 1, reason: 'Carrion Crow' }]] });
  const r = post(request());
  assert.deepEqual([r.model, r.backup], ['gemini-3-flash-preview', true]);
  assert.deepEqual(calls.map(viaGroq), [true, false]);
});

test('a Groq model with no GROQ_API_KEY is skipped, and Lyrebird runs on a Groq key alone', () => {
  const noGroqKey = setup({ props: { AI_MODELS: GROQ + ', gemini-3-flash-preview' } });
  assert.equal(noGroqKey.post(request()).model, 'gemini-3-flash-preview');
  assert.equal(noGroqKey.calls.length, 1);                        // nothing sent to Groq without a key
  const groqOnly = setup({ props: { GEMINI_API_KEY: '', AI_MODELS: GROQ, GROQ_API_KEY: 'g' } });
  assert.equal(groqOnly.post(request()).status, 'pick');
});

// ---------- recent: the birds reported in a place lately, for Explore ----------
const EBIRD_KEY = 'TEST-EBIRD-KEY';
const OBS = [
  { speciesCode: 'eurrob1', obsDt: '2026-11-17 08:10', locName: 'Minsmere RSPB', locationPrivate: false },
  { speciesCode: 'eurrob1', obsDt: '2026-11-16 09:00', locName: 'Somewhere else', locationPrivate: false },   // the same bird again
  { speciesCode: 'bewswa1', obsDt: '2026-11-15 15:30', locName: '12 Acacia Avenue (my garden)', locationPrivate: true },
];

test('recent: the species reported in a region lately, one each, private places left out', () => {
  const { post, calls } = setup({ props: { EBIRD_API_KEY: EBIRD_KEY }, ebirdReply: [200, OBS] });
  const r = post(JSON.stringify({ action: 'recent', region: 'GB-ENG-SUF' }));
  assert.deepEqual(r, { ok: true, region: 'GB-ENG-SUF', days: 30, species: [
    { code: 'eurrob1', date: '2026-11-17', loc: 'Minsmere RSPB' }, { code: 'bewswa1', date: '2026-11-15', loc: '' }] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.ebird\.org\/v2\/data\/obs\/GB-ENG-SUF\/recent\?back=30&cat=species$/);
  assert.equal(calls[0].opts.headers['X-eBirdApiToken'], EBIRD_KEY);          // the key goes in a header
  assert.ok(!JSON.stringify(r).includes('Acacia'));
});

test('recent: a place asked about again within the hour comes from memory, not eBird', () => {
  const { post, calls, store } = setup({ props: { EBIRD_API_KEY: EBIRD_KEY }, ebirdReply: [200, OBS] });
  post(JSON.stringify({ action: 'recent', region: 'GB' }));
  post(JSON.stringify({ action: 'recent', region: 'GB' }));
  assert.equal(calls.length, 1);
  assert.equal(store.get('RECENT_' + new Date().toISOString().slice(0, 10)), '1');  // counted once, separately from the AI
});

test('recent: bad region codes, no eBird key, and eBird errors', () => {
  const { post } = setup({ props: { EBIRD_API_KEY: EBIRD_KEY } });
  for (const region of ['', 'gb', 'GB-ENG-SUF-X', 'GB; DROP', 42]) {
    assert.equal(post(JSON.stringify({ action: 'recent', region })).error, 'bad-request', String(region));
  }
  assert.equal(setup().post(JSON.stringify({ action: 'recent', region: 'GB' })).error, 'not-configured');
  assert.equal(setup({ props: { EBIRD_API_KEY: EBIRD_KEY }, ebirdReply: [403, {}] }).post(JSON.stringify({ action: 'recent', region: 'GB' })).error, 'ebird-unavailable');
});

test('a new day\'s tidy-up removes only old counters, never the keys', () => {
  // The first version deleted every setting starting EBIRD_, including EBIRD_API_KEY
  const { post, store } = setup({ props: { EBIRD_API_KEY: EBIRD_KEY, GROQ_API_KEY: 'groq-key',
    'RECENT_2026-01-01': '9', 'USED_2026-01-01': '9', RECENT_NOTES: 'keep me' }, ebirdReply: [200, OBS] });
  assert.equal(post(JSON.stringify({ action: 'recent', region: 'GB' })).ok, true);
  assert.equal(post(JSON.stringify({ action: 'recent', region: 'FR' })).ok, true);   // the key is still there for the next request
  assert.equal(store.get('EBIRD_API_KEY'), EBIRD_KEY);
  assert.equal(store.get('GROQ_API_KEY'), 'groq-key');
  assert.equal(store.has('RECENT_2026-01-01'), false);          // yesterday's counter, tidied away
  assert.equal(store.get('RECENT_NOTES'), 'keep me');            // not a counter: left alone
  assert.equal(store.get('USED_2026-01-01'), '9');               // the AI's counters are the AI's business
});
