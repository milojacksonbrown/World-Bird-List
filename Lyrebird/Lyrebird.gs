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
 *  if a Groq model is used).
 *
 *  It does two jobs ("actions"):
 *    - nameFix: pick the AviList species an unmatched eBird name belongs to
 *    - query:   turn a question about your list into a checked query. Only the
 *               question is sent; the website runs the query on your data.
 *
 *  Deploy ▸ New deployment ▸ Web app, Execute as: Me, Who has access: Anyone.
 *
 *  Safety:
 *    - Only known actions, with size limits on everything (checkRequest_).
 *    - A daily cap on Gemini calls, shared by everyone (DAILY_CAP).
 *    - Gemini's answer is checked here (against the shortlist, or against the
 *      list of allowed tables and fields), and again by the website.
 *    - Nothing is stored except today's count.
 *
 *  Models: Gemini 3 Flash first; if it's out of free quota or busy, the
 *  backup Gemma 4 model answers instead. Script Property AI_MODELS can set
 *  another order, including Groq models (askAi_ in NameFixesAssistant.gs).
 *  A request counts once towards the daily cap, whichever model answers.
 */

const LYREBIRD = {
  // Shown when the web address is opened, so you can tell which code is live.
  // Change it whenever you publish a new version.
  VERSION: '2026-11-12 (session 4f)',
  DAILY_CAP: 200,          // Gemini calls per day, for everyone together
  MAX_TEXT: 120,           // longest name accepted, in characters
  MAX_SHORTLIST: 20,       // most candidates accepted
  ACTIONS: ['nameFix', 'query'],
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
 * Either may fail with: { "ok": false, "error": "bad-request" | "limit" | "not-configured" | "ai-unavailable", "message": "…" }
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
      return json_(ans.status === 'query'
        ? { ok: true, status: 'query', query: ans.query, reason: ans.reason, model: ai.model, backup: ai.backup }
        : { ok: true, status: ans.status, reason: ans.reason, model: ai.model, backup: ai.backup });
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

/** Today's date as the key for the daily count, e.g. "2026-11-11" (UTC). */
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
function takeFromDailyAllowance_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'USED_' + dayKey_(new Date());
    const used = Number(props.getProperty(key) || 0);
    if (used >= LYREBIRD.DAILY_CAP) return false;
    if (used === 0) {                                    // a new day: tidy away old counts
      props.getKeys().filter(k => k.indexOf('USED_') === 0 && k !== key).forEach(k => props.deleteProperty(k));
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
