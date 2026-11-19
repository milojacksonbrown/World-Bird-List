/**
 * ============================================================================
 *  LYREBIRD  —  the Life List AI middleman: lets the public website use Gemini safely
 * ============================================================================
 *
 *  Named after the lyrebird, famous for passing on sounds it has heard: it
 *  passes the website's questions to Gemini and the answers back.
 *
 *  The website is public, so it can't contain the Gemini API key: anyone could
 *  copy it from the page. Instead, the website sends bird names here, and this
 *  small Apps Script web app adds the key, asks Gemini, checks the answer and
 *  replies. See DASHBOARD-DESIGN.md ("AI design").
 *
 *  It's a separate Apps Script project from the spreadsheet, so its public web
 *  address can never touch the spreadsheet. It needs three files:
 *    - Lyrebird.gs (this file)
 *    - NameFixesAssistant.gs (shared: the name-fix prompt, the Gemini call, the checks)
 *    - AskYourList.gs (shared: the question prompt and the query checker)
 *  and the GEMINI_API_KEY in Project Settings ▸ Script Properties (plus GROQ_API_KEY
 *  if a Groq model is used, and EBIRD_API_KEY for Explore).
 *
 *  It does three jobs ("actions"):
 *    - nameFix: pick the AviList species an unmatched eBird name belongs to
 *    - query:   turn a question about your list into a checked query. Only the
 *               question is sent; the website runs the query on your data.
 *    - recent:  for Explore, the species eBird has had reported in a country, state or
 *               county in the last 30 days (no AI; remembered for an hour per place).
 *
 *  Deploy ▸ New deployment ▸ Web app, Execute as: Me, Who has access: Anyone.
 *
 *  Safety:
 *    - Only known actions, with size limits on everything (checkRequest_).
 *    - A daily cap on Gemini calls, shared by everyone (DAILY_CAP), and another on
 *      eBird requests for Explore (RECENT_CAP).
 *    - Gemini's answer is checked here (against the shortlist, or against the
 *      list of allowed tables and fields), and again by the website.
 *    - Nothing is stored except today's counts, for an hour each place's eBird answer, and
 *      for up to 6 hours (that day only) the checked search a question was turned into.
 *      Only the question's wording and the search are kept: never anyone's data.
 *
 *  Models: Gemini 3 Flash first; if it's out of free quota or busy, the
 *  backup Gemma 4 model answers instead. Script Property AI_MODELS can set
 *  another order, including Groq models (askAi_ in NameFixesAssistant.gs).
 *  A request counts once towards the daily cap, whichever model answers.
 */

const LYREBIRD = {
  // Shown when the web address is opened, so you can tell which code is live.
  // Change it whenever you publish a new version.
  VERSION: '2026-11-19 (answers remembered)',
  DAILY_CAP: 200,          // Gemini calls per day, for everyone together
  MAX_TEXT: 120,           // longest name accepted, in characters
  MAX_SHORTLIST: 20,       // most candidates accepted
  ACTIONS: ['nameFix', 'query', 'recent'],
  RECENT_CAP: 500,         // eBird requests per day for Explore, for everyone together
  RECENT_DAYS: 30,         // "recent" = reported in the last 30 days
  RECENT_CACHE_S: 3600,    // each place's answer is remembered for an hour
  QUERY_CACHE_S: 21600,    // a question's checked answer is remembered for 6 hours (that day only)
};

/** Opening the web address in a browser shows that Lyrebird is running. */
function doGet() {
  return json_({ ok: true, service: 'Lyrebird (Life List AI middleman)', version: LYREBIRD.VERSION, actions: LYREBIRD.ACTIONS, usedToday: usedToday_(), dailyCap: LYREBIRD.DAILY_CAP });
}

/**
 * The website sends a JSON request here, e.g.
 *   { "action": "nameFix", "ebird": {"sci": "Corvus cornix", "common": "Hooded Crow"},
 *     "shortlist": [{"sci": "Corvus corone", "common": "Carrion Crow"}, …] }
 * Reply: { "ok": true, "status": "pick" | "none" | "invalid", "choice": 1, "reason": "…",
 *          "model": "gemini-3-flash-preview", "backup": false }
 *
 * or a question:
 *   { "action": "query", "question": "Which families have I seen less than 10% of?" }
 * Reply: { "ok": true, "status": "query", "query": {…}, "reason": "…" }
 *    or: { "ok": true, "status": "cannot" | "invalid", "reason": "…" }
 *
 * or the birds reported recently in a place (for Explore; no AI involved):
 *   { "action": "recent", "region": "GB-ENG-SUF" }
 * Reply: { "ok": true, "region": "GB-ENG-SUF", "days": 30, "species": [{ "code": "eurrob1", "date": "2026-11-17", "loc": "Minsmere RSPB" }, …] }
 *   ("loc" is empty where eBird marks the place private, e.g. someone's garden)
 *
 * Any may fail with: { "ok": false, "error": "bad-request" | "limit" | "not-configured" | "ai-unavailable" | "ebird-unavailable", "message": "…" }
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad-request', message: 'The request was not valid JSON.' });
  }
  const req = checkRequest_(body);
  if (req.problem) return json_({ ok: false, error: 'bad-request', message: req.problem });
  if (req.action === 'recent') return json_(recentSightings_(req.region));

  // A question asked already today (the example questions, say): the same checked search,
  // straight from memory, without asking the AI again or using up the daily allowance
  const remembered = req.action === 'query' ? rememberedQuery_(req.question, new Date()) : null;
  if (remembered) return json_(remembered);

  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY') || '';
  if (!key && !props.getProperty('GROQ_API_KEY')) return json_({ ok: false, error: 'not-configured', message: 'The AI is not set up yet.' });
  if (!takeFromDailyAllowance_()) {
    return json_({ ok: false, error: 'limit', message: 'The AI limit for today has been reached. Please try again tomorrow.' });
  }

  try {
    // Both jobs say which model answered: the main one, or the backup (Gemma)
    // if the main one was out of quota or busy. See askAi_.
    if (req.action === 'query') {
      const ai = askAi_(buildQueryPrompt_(req.question, new Date()), key, queryResponseSchema_());
      const ans = readQueryAnswer_(ai.text);
      if (ans.status !== 'query') return json_({ ok: true, status: ans.status, reason: ans.reason, model: ai.model, backup: ai.backup });
      const reply = { ok: true, status: 'query', query: ans.query, reason: ans.reason, model: ai.model, backup: ai.backup };
      rememberQuery_(req.question, new Date(), reply);
      return json_(reply);
    }
    // nameFix
    const ai = askAi_(buildAiPrompt_(req.ebird, req.shortlist), key);
    const ans = parseAiAnswer_(ai.text, req.shortlist);
    // The candidate's number (1 = first). Worked out here too, so an older copy of
    // NameFixesAssistant.gs (whose answers don't include it) still gives the right number.
    const choice = ans.status !== 'pick' ? 0
      : (ans.choice || req.shortlist.findIndex(c => c.sci === ans.pick.sci) + 1);
    return json_({ ok: true, status: ans.status, choice, reason: ans.reason, model: ai.model, backup: ai.backup });
  } catch (err) {
    return json_({ ok: false, error: 'ai-unavailable', message: String(err.message || err).slice(0, 200) });
  }
}

/**
 * Checks a request and keeps only what's needed. Pure: plain values in and out.
 * @return {{problem:string}|{problem:'', action:'nameFix', ebird:Object, shortlist:Array}|{problem:'', action:'query', question:string}}
 */
function checkRequest_(b) {
  const text = (v, required) => (typeof v === 'string' || (!required && v == null)) &&
    String(v == null ? '' : v).length <= LYREBIRD.MAX_TEXT && (!required || String(v).trim() !== '');
  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  if (!b || typeof b !== 'object' || Array.isArray(b)) return { problem: 'Missing request.' };
  if (!LYREBIRD.ACTIONS.includes(b.action)) return { problem: 'Unknown action.' };

  if (b.action === 'recent') {
    // An eBird region code: a country (GB), a state (GB-ENG) or a county (GB-ENG-SUF)
    if (typeof b.region !== 'string' || !/^[A-Z]{2}(-[A-Z0-9]{1,4}){0,2}$/.test(b.region)) return { problem: 'The region must be an eBird region code, e.g. GB or GB-ENG-SUF.' };
    return { problem: '', action: 'recent', region: b.region };
  }

  if (b.action === 'query') {
    if (typeof b.question !== 'string' || !b.question.trim()) return { problem: 'The question is missing.' };
    if (b.question.length > ASK.MAX_QUESTION) return { problem: 'The question is too long (at most ' + ASK.MAX_QUESTION + ' characters).' };
    return { problem: '', action: 'query', question: clean(b.question) };      // only the question goes on
  }

  // nameFix
  const e = b.ebird;
  if (!e || typeof e !== 'object' || !text(e.sci, true) || !text(e.common, false)) {
    return { problem: 'The eBird name is missing or too long.' };
  }
  if (!Array.isArray(b.shortlist) || !b.shortlist.length || b.shortlist.length > LYREBIRD.MAX_SHORTLIST) {
    return { problem: 'The shortlist must have 1 to ' + LYREBIRD.MAX_SHORTLIST + ' candidates.' };
  }
  if (!b.shortlist.every(c => c && typeof c === 'object' && text(c.sci, true) && text(c.common, false))) {
    return { problem: 'A shortlist name is missing or too long.' };
  }
  return {
    problem: '',
    action: b.action,
    ebird: { sci: clean(e.sci), common: clean(e.common) },                      // only the names go on
    shortlist: b.shortlist.map(c => ({ sci: clean(c.sci), common: clean(c.common) })),
  };
}

/**
 * The species reported in a region in the last RECENT_DAYS days, from eBird, for Explore.
 * Uses the eBird key in Script Properties (EBIRD_API_KEY); remembers each region's answer
 * for an hour, so repeated clicks don't call eBird again; and has its own daily cap.
 * Only what the website needs is passed on: species code, last date, and the place name
 * unless eBird marks it private.
 */
function recentSightings_(region) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('recent:' + region);
  if (cached) return JSON.parse(cached);
  const key = PropertiesService.getScriptProperties().getProperty('EBIRD_API_KEY') || '';
  if (!key) return { ok: false, error: 'not-configured', message: 'Explore is not set up yet (no eBird key).' };
  if (!takeFromDailyAllowance_('RECENT_', LYREBIRD.RECENT_CAP)) {
    return { ok: false, error: 'limit', message: 'Explore has reached its limit for today. Please try again tomorrow.' };
  }
  const url = 'https://api.ebird.org/v2/data/obs/' + encodeURIComponent(region) + '/recent?back=' + LYREBIRD.RECENT_DAYS + '&cat=species';
  const res = UrlFetchApp.fetch(url, { headers: { 'X-eBirdApiToken': key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'ebird-unavailable', message: 'eBird answered ' + res.getResponseCode() + '.' };
  const seen = new Set(), species = [];
  JSON.parse(res.getContentText()).forEach(o => {
    if (!o || !o.speciesCode || seen.has(o.speciesCode)) return;
    seen.add(o.speciesCode);
    species.push({ code: String(o.speciesCode), date: String(o.obsDt || '').slice(0, 10), loc: o.locationPrivate ? '' : String(o.locName || '').slice(0, 120) });
  });
  const out = { ok: true, region, days: LYREBIRD.RECENT_DAYS, species };
  try { cache.put('recent:' + region, JSON.stringify(out), LYREBIRD.RECENT_CACHE_S); } catch (e) { /* too big to remember: fine */ }
  return out;
}

/** Today's date as the key for the daily count, e.g. "2026-11-11" (UTC). */
/**
 * Where a question's answer is remembered: the question as typed, ignoring capitals and spacing,
 * on that day (the AI is told today's date, for questions like "this year"). Two different hashes
 * of the wording together, so two questions sharing one is never a worry.
 */
function queryCacheKey_(question, date) {
  const text = String(question).toLowerCase().replace(/\s+/g, ' ').trim();
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return 'ask:' + dayKey_(date) + ':' + a.toString(36) + b.toString(36) + ':' + text.length;
}

/** A checked answer to this question from earlier today, marked as remembered; null if none. */
function rememberedQuery_(question, date) {
  const hit = CacheService.getScriptCache().get(queryCacheKey_(question, date));
  if (!hit) return null;
  try { return Object.assign(JSON.parse(hit), { cached: true }); } catch (e) { return null; }
}

/** Remembers a checked answer (only a good one: a refusal or failure is asked again next time). */
function rememberQuery_(question, date, reply) {
  try { CacheService.getScriptCache().put(queryCacheKey_(question, date), JSON.stringify(reply), LYREBIRD.QUERY_CACHE_S); } catch (e) { /* too big to remember: fine */ }
}

function dayKey_(date) {
  return date.toISOString().slice(0, 10);
}

/** How many Gemini calls have been made today. */
function usedToday_() {
  return Number(PropertiesService.getScriptProperties().getProperty('USED_' + dayKey_(new Date())) || 0);
}

/**
 * Takes one Gemini call from today's allowance. Returns false if none are left.
 * The lock stops two requests arriving together from both taking the last one.
 */
function takeFromDailyAllowance_(prefix, cap) {
  prefix = prefix || 'USED_';                          // USED_ for the AI; RECENT_ for Explore
  cap = cap || LYREBIRD.DAILY_CAP;
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = prefix + dayKey_(new Date());
    const used = Number(props.getProperty(key) || 0);
    if (used >= cap) return false;
    if (used === 0) {                                    // a new day: tidy away old counts
      // Only counters: the prefix followed by a date. (A looser match once deleted EBIRD_API_KEY.)
      const counter = new RegExp('^' + prefix + '\\d{4}-\\d{2}-\\d{2}$');
      props.getKeys().filter(k => counter.test(k) && k !== key).forEach(k => props.deleteProperty(k));
    }
    props.setProperty(key, String(used + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
