// ===========================================================================
//  Lyrebird on Cloudflare Workers: the same middleman as Lyrebird/Lyrebird.gs,
//  on faster plumbing.
//
//  Everything that decides anything is the shared code bundled above this
//  part, unchanged: the request checks (checkRequest_), the prompts, the
//  answer checks (readQueryAnswer_, parseAiAnswer_), the replies (queryReply_,
//  nameFixReply_, recentReply_), the caps (LYREBIRD), and which AI model to
//  try and when to fall back (aiRequest_, aiReply_, aiTryNext_). This part
//  only sends and stores:
//
//    Apps Script                  this Worker
//    Script Properties (keys)     secrets: env.GROQ_API_KEY, env.GEMINI_API_KEY, env.EBIRD_API_KEY
//    Script Properties (counts)   D1 (Cloudflare's small SQL database): env.DB, table "counts"
//    CacheService                 D1: table "memo" (Cloudflare's own cache does nothing on workers.dev)
//    UrlFetchApp                  fetch
//
//  Built into dist/lyrebird.js by tools/build-worker.js; deployed with wrangler (see README.md here).
// ===========================================================================

const WORKER = {
  // Shown when the address is opened, so you can tell which code is live
  VERSION: '2026-11-19 (Cloudflare Worker)',
  // Web pages allowed to use it (a browser always says which page is asking). A request from no
  // page at all, such as a test from the command line, is allowed: the daily caps protect the quota.
  ORIGINS: ['https://milojacksonbrown.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'],
  // The models to try, in order (as Script Property AI_MODELS in Apps Script); wrangler.toml can change it
  DEFAULT_MODELS: 'groq:openai/gpt-oss-120b, gemini-3-flash-preview',
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (origin && !WORKER.ORIGINS.includes(origin)) return new Response('Not allowed from this site.', { status: 403 });
    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reply = obj => new Response(JSON.stringify(obj), { headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
    try {
      await tables_(env);
      if (request.method === 'GET') {
        return reply({ ok: true, service: 'Lyrebird (Life List AI middleman)', version: WORKER.VERSION, host: 'Cloudflare Worker',
          actions: LYREBIRD.ACTIONS, usedToday: await usedToday_W(env, 'USED_'), dailyCap: LYREBIRD.DAILY_CAP });
      }
      if (request.method !== 'POST') return new Response('Use GET or POST.', { status: 405, headers: cors });
      let body;
      try { body = JSON.parse(await request.text()); } catch (e) {
        return reply({ ok: false, error: 'bad-request', message: 'The request was not valid JSON.' });
      }
      return reply(await answer_(body, env));
    } catch (err) {
      return reply({ ok: false, error: 'ai-unavailable', message: String((err && err.message) || err).slice(0, 200) });
    }
  },
};

/** What doPost does in Lyrebird.gs, step for step, with this Worker's sending and storing. */
async function answer_(body, env) {
  const req = checkRequest_(body);
  if (req.problem) return { ok: false, error: 'bad-request', message: req.problem };
  if (req.action === 'recent') return recentW_(req.region, env);

  // A question asked already today: the same checked search, from memory, nothing counted
  const memoKey = req.action === 'query' ? queryCacheKey_(req.question, new Date()) : '';
  if (memoKey) {
    const hit = await memoGet_(env, memoKey);
    if (hit) return Object.assign(JSON.parse(hit), { cached: true });
  }
  if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) return { ok: false, error: 'not-configured', message: 'The AI is not set up yet.' };
  if (!(await takeW_(env, 'USED_', LYREBIRD.DAILY_CAP))) {
    return { ok: false, error: 'limit', message: 'The AI limit for today has been reached. Please try again tomorrow.' };
  }
  try {
    if (req.action === 'query') {
      const out = queryReply_(await askAiW_(buildQueryPrompt_(req.question, new Date()), queryResponseSchema_(), env));
      if (out.status === 'query') await memoPut_(env, memoKey, JSON.stringify(out), LYREBIRD.QUERY_CACHE_S);
      return out;
    }
    return nameFixReply_(await askAiW_(buildAiPrompt_(req.ebird, req.shortlist), undefined, env), req);
  } catch (err) {
    return { ok: false, error: 'ai-unavailable', message: String((err && err.message) || err).slice(0, 200) };
  }
}

/** Asks the AI, trying each model in turn, by the same rules as askAi_ in NameFixesAssistant.gs. */
async function askAiW_(prompt, schema, env) {
  const models = String(env.AI_MODELS || WORKER.DEFAULT_MODELS).split(',').map(m => m.trim()).filter(Boolean);
  const keys = { google: env.GEMINI_API_KEY || '', groq: env.GROQ_API_KEY || '' };
  let failure = null;
  for (let i = 0; i < models.length; i++) {
    const req = aiRequest_(models[i], prompt, schema, keys);
    let r = req.problem;
    if (!r && aiProvider_(models[i]) === 'google' && !keys.google) r = { ok: false, code: 401, error: new Error('no GEMINI_API_KEY set up') };
    if (!r) {
      const res = await fetch(req.url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, req.headers), body: JSON.stringify(req.body) });
      r = aiReply_(models[i], res.status, await res.text());
    }
    if (r.ok) return { text: r.text, model: models[i], backup: i > 0 };
    failure = aiFailure_(failure, models, i, r);
    if (!aiTryNext_(models, i, r)) break;
  }
  throw failure;
}

/** Explore: as recentSightings_ in Lyrebird.gs. */
async function recentW_(region, env) {
  const hit = await memoGet_(env, 'recent:' + region);
  if (hit) return JSON.parse(hit);
  if (!env.EBIRD_API_KEY) return { ok: false, error: 'not-configured', message: 'Explore is not set up yet (no eBird key).' };
  if (!(await takeW_(env, 'RECENT_', LYREBIRD.RECENT_CAP))) {
    return { ok: false, error: 'limit', message: 'Explore has reached its limit for today. Please try again tomorrow.' };
  }
  const res = await fetch(recentUrl_(region), { headers: { 'X-eBirdApiToken': env.EBIRD_API_KEY } });
  if (res.status !== 200) return { ok: false, error: 'ebird-unavailable', message: 'eBird answered ' + res.status + '.' };
  const out = recentReply_(region, await res.json());
  await memoPut_(env, 'recent:' + region, JSON.stringify(out), LYREBIRD.RECENT_CACHE_S);
  return out;
}

// ---------- Storage (D1) ----------
// counts: one row per counter per day ("USED_" for the AI, "RECENT_" for Explore).
// memo: remembered answers, each with the time it's forgotten.
let tablesReady = false;
async function tables_(env) {
  if (tablesReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS counts (name TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (name, day))').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS memo (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)').run();
  tablesReady = true;
}

/**
 * Takes one from today's allowance, or false if it's used up. One SQL statement does the check and
 * the count together, so two requests arriving at once can't both take the last one.
 */
async function takeW_(env, name, cap) {
  const day = dayKey_(new Date());
  const row = await env.DB.prepare('INSERT INTO counts (name, day, n) VALUES (?1, ?2, 1) ' +
    'ON CONFLICT (name, day) DO UPDATE SET n = n + 1 WHERE n < ?3 RETURNING n').bind(name, day, cap).first();
  if (row && row.n === 1) {                                     // a new day: tidy away old counts and forgotten answers
    await env.DB.prepare('DELETE FROM counts WHERE day < ?1').bind(day).run();
    await env.DB.prepare('DELETE FROM memo WHERE expires < ?1').bind(Date.now()).run();
  }
  return !!row;
}

async function usedToday_W(env, name) {
  const row = await env.DB.prepare('SELECT n FROM counts WHERE name = ?1 AND day = ?2').bind(name, dayKey_(new Date())).first();
  return row ? row.n : 0;
}

async function memoGet_(env, key) {
  const row = await env.DB.prepare('SELECT value FROM memo WHERE key = ?1 AND expires > ?2').bind(key, Date.now()).first();
  return row ? row.value : null;
}

async function memoPut_(env, key, value, seconds) {
  await env.DB.prepare('INSERT OR REPLACE INTO memo (key, value, expires) VALUES (?1, ?2, ?3)').bind(key, value, Date.now() + seconds * 1000).run();
}
