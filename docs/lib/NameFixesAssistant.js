// GENERATED from NameFixesAssistant.gs by tools/build-site.js. Do not edit here: edit NameFixesAssistant.gs and re-run.
/**
 * ============================================================================
 *  NAME FIXES ASSISTANT  —  suggests AviList matches for unmatched eBird names
 * ============================================================================
 *
 *  See DESIGN.md. Two methods suggest a match for each unmatched name:
 *    1. String matching (this file, no AI): compares names after tidying up
 *       case, accents, punctuation and Grey/Gray-type spelling differences.
 *    2. An AI check (Gemini), which may only choose from a shortlist that
 *       this file builds.
 *  Confidence comes from whether the two methods agree, never from the AI's
 *  own view of how sure it is. Nothing is applied until the user ticks Accept.
 *
 *  Part 1 (string matching, shortlist, confidence) is "pure": plain values
 *  in, plain values out, no Google calls, so it can be tested outside Google.
 *  Part 2 (further down) adds the Gemini call, the new Name Fixes columns and
 *  the Accept tick box. Its decisions are pure functions too; only a few thin
 *  functions at the very end talk to Google.
 *  It uses normalise_(), TAB and others from LifeList.gs (Apps Script files
 *  share one scope).
 */

const ASSIST = {
  SHORTLIST_SIMILAR: 10,     // most similar-looking names overall
  SHORTLIST_GENUS: 5,        // extra species from the same genus
  STRING_MIN_SCORE: 0.8,     // below this, string matching has "no match"
  // Gemini model. Override without editing code by adding a Script Property
  // GEMINI_MODEL. Check Google AI Studio for which models are on the free tier.
  GEMINI_MODEL: 'gemini-3-flash-preview',
  // Backup model, tried when the main one is out of free quota, busy or
  // withdrawn. Gemma is Google's open model: it has its own, larger free
  // quota, but is slower and less accurate, which the answer checks allow for.
  // Override with a Script Property GEMINI_FALLBACK_MODEL ('none' turns it off).
  GEMINI_FALLBACK_MODEL: 'gemma-4-26b-a4b-it',
  AI_PAUSE_MS: 1500,         // wait between AI calls, to stay inside free-tier limits
  MAX_PER_RUN: 30,           // suggestions per run; the rest are done next run
  // Apps Script stops any run at 6 minutes. Don't start a new suggestion once
  // the whole run (including any eBird processing before it) is 4 minutes old,
  // leaving room for one slow AI reply (Google waits about a minute at most).
  STOP_AFTER_MS: 4 * 60 * 1000,
};

// When this run started. Apps Script loads all the code afresh at the start
// of every run, so this is the start of the whole run, not of the suggestions.
const RUN_STARTED_ = Date.now();

// Spelling differences that don't change which bird it is (British vs American etc.)
const SPELLING_VARIANTS = [
  ['grey', 'gray'],
  ['colour', 'color'],
  ['moustached', 'mustached'],
];
const SPELLING_RES_ = SPELLING_VARIANTS.map(([from, to]) => [new RegExp('\\b' + from + '\\b', 'g'), to]);

// Tidying a name is slow compared with comparing it, and the same AviList
// names are compared again and again, so each name is tidied once and the
// result remembered here (for as long as the script is running).
const TIDY_CACHE_ = new Map();

/** Tidies a name once: returns its comparison key and its set of words. */
function tidyName_(name) {
  const raw = String(name || '');
  let t = TIDY_CACHE_.get(raw);
  if (!t) {
    let s = normalise_(raw.replace(/\([^)]*\)/g, ' '));
    SPELLING_RES_.forEach(([re, to]) => { s = s.replace(re, to); });
    t = { key: s.replace(/[^a-z]/g, ''), words: new Set(s.split(/[^a-z]+/).filter(Boolean)) };
    TIDY_CACHE_.set(raw, t);
  }
  return t;
}

/**
 * Turns a name into a comparison key: lower case, no accents, no text in
 * brackets, one spelling of each variant, and letters only.
 * "Grey-headed Woodpecker (Grey-faced)" -> "grayheadedwoodpecker"
 */
function nameKey_(name) {
  return tidyName_(name).key;
}

/** Splits a name into tidied words, for comparing word by word. */
function nameWords_(name) {
  return [...tidyName_(name).words];
}

/** Number of single-letter edits needed to turn a into b (Levenshtein distance). */
function editDistance_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How alike two names are, from 0 (nothing alike) to 1 (the same once tidied).
 * Takes the better of two measures:
 *  - letters: how few edits separate them (catches typos)
 *  - words: how many words they share (catches "Ringed Plover" vs "Common Ringed Plover")
 */
function nameSimilarity_(a, b) {
  const ka = nameKey_(a), kb = nameKey_(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const wa = tidyName_(a).words, wb = tidyName_(b).words;
  let shared = 0;
  wa.forEach(w => { if (wb.has(w)) shared++; });
  // Word overlap alone can't make a perfect score: "Lesser Whitethroat" and
  // "Whitethroat" share a word but aren't the same bird.
  const words = Math.min((2 * shared) / (wa.size + wb.size), 0.95);
  // Shortcut: names whose lengths differ by n letters need at least n edits,
  // so the letter score can't be higher than this. If that still can't beat
  // the word score, skip the (slow) letter-by-letter comparison.
  const longest = Math.max(ka.length, kb.length);
  if (1 - Math.abs(ka.length - kb.length) / longest <= words) return words;
  const letters = 1 - editDistance_(ka, kb) / longest;
  return Math.max(letters, words);
}

/**
 * Scores one AviList species against an eBird record, using the scientific
 * name and every common name it goes by. Returns the best score and which
 * name produced it.
 * @param {{sci:string, common:string}} ebird
 * @param {{sci:string, common:string, alt:string}} sp  alt = other names, ";"-separated
 */
function scoreSpecies_(ebird, sp) {
  let best = { score: 0, via: '' };
  const binomial = String(ebird.sci || '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (binomial && sp.sci) {
    const s = nameSimilarity_(binomial, sp.sci);
    if (s > best.score) best = { score: s, via: 'scientific name' };
  }
  if (ebird.common) {
    const names = [sp.common].concat(String(sp.alt || '').split(';')).map(x => x.trim()).filter(Boolean);
    names.forEach(nm => {
      const s = nameSimilarity_(ebird.common, nm);
      if (s > best.score) best = { score: s, via: nm === sp.common ? 'common name' : 'other name "' + nm + '"' };
    });
  }
  return best;
}

/**
 * Scores every AviList species against one eBird name, best first.
 * This is the slow step, so suggestFor_ does it once and passes the result
 * to both stringMatch_ and buildShortlist_. (Species with equal scores keep
 * their Species-tab order, because JavaScript's sort keeps ties in order.)
 * @return {Array<{row:number, sci:string, common:string, score:number, via:string}>}
 */
function scoreAll_(ebird, species) {
  return species.map(sp => {
    const s = scoreSpecies_(ebird, sp);
    return { row: sp.row, sci: sp.sci, common: sp.common, score: s.score, via: s.via };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Method 1: string matching. Finds the single most similar AviList species.
 * @param {{sci:string, common:string}} ebird  the unmatched eBird name
 * @param {Array<{row:number, sci:string, common:string, alt:string}>} species
 * @param {Array} [scored]  result of scoreAll_, if already worked out
 * @return {{row:number, sci:string, score:number, via:string}|null}
 *         null if nothing scores at least ASSIST.STRING_MIN_SCORE
 */
function stringMatch_(ebird, species, scored) {
  const top = (scored || scoreAll_(ebird, species))[0];
  return top && top.score >= ASSIST.STRING_MIN_SCORE
    ? { row: top.row, sci: top.sci, score: top.score, via: top.via } : null;
}

/**
 * Builds the shortlist the AI must choose from: the most similar-looking
 * species overall, plus the most similar others from the same genus.
 * @param {Array} [scored]  result of scoreAll_, if already worked out
 * @return {Array<{row:number, sci:string, common:string, score:number}>} best first
 */
function buildShortlist_(ebird, species, scored) {
  const genus = String(ebird.sci || '').trim().split(/\s+/)[0].toLowerCase();
  scored = (scored || scoreAll_(ebird, species)).map(x => ({ row: x.row, sci: x.sci, common: x.common, score: x.score }));
  const list = scored.slice(0, ASSIST.SHORTLIST_SIMILAR);
  const inList = new Set(list.map(x => x.row));
  scored
    .filter(x => !inList.has(x.row) && String(x.sci).split(' ')[0].toLowerCase() === genus)
    .slice(0, ASSIST.SHORTLIST_GENUS)
    .forEach(x => list.push(x));
  return list;
}

/**
 * Combines the two methods into one suggestion, following DESIGN.md.
 * @param {{row:number, sci:string, score:number, via:string}|null} str  string match (or null)
 * @param {{row:number, sci:string, reason:string}|null} ai  AI pick from the shortlist (null = "none" or no answer)
 * @return {{sci:string, confidence:string, reason:string}}  confidence '' = no suggestion
 */
function decideSuggestion_(str, ai) {
  if (str && str.score === 1) {
    return { sci: str.sci, confidence: 'High',
      reason: 'Same ' + str.via + ' apart from spelling or punctuation' + (ai && ai.row !== str.row ? ' (AI suggested ' + ai.sci + ')' : '') };
  }
  if (str && ai && str.row === ai.row) {
    return { sci: str.sci, confidence: 'High', reason: 'String matching and AI agree. AI: ' + ai.reason };
  }
  if (str && ai) {
    return { sci: ai.sci, confidence: 'Low',
      reason: 'Methods disagree: AI picked this (' + ai.reason + '); string matching picked ' + str.sci + ' via ' + str.via };
  }
  if (ai) return { sci: ai.sci, confidence: 'Medium', reason: 'AI only: ' + ai.reason };
  if (str) return { sci: str.sci, confidence: 'Medium', reason: 'String matching only: similar ' + str.via + ' (' + Math.round(str.score * 100) + '% alike)' };
  return { sci: '', confidence: '', reason: 'No confident match; please fix by hand' };
}

// ===========================================================================
//  PART 2: AI check, Name Fixes columns, Accept tick box
// ===========================================================================

// Name Fixes tab columns (1-based). A–E already existed; F–I are new.
const FX = { SCI: 1, COMMON: 2, FIX: 3, RECORDS: 4, ADDED: 5, SUGGEST: 6, CONF: 7, REASON: 8, ACCEPT: 9 };
const FX_NEW_HEADERS = ['Suggested species', 'Confidence', 'Reason', 'Accept'];

/**
 * The message sent to the AI. It contains bird names only: the unmatched
 * eBird name and the numbered shortlist. No dates, places or counts.
 */
function buildAiPrompt_(ebird, shortlist) {
  const lines = shortlist.map((c, i) => (i + 1) + '. ' + c.sci + (c.common ? ' (' + c.common + ')' : ''));
  return [
    'You are matching a bird name from eBird to the AviList world bird checklist.',
    'eBird name: ' + String(ebird.sci || '').trim() + (ebird.common ? ' (' + String(ebird.common).trim() + ')' : ''),
    '',
    'AviList candidates:',
    ...lines,
    '',
    'Which candidate should this eBird bird be counted as in AviList?',
    'The eBird name is usually NOT in the list: that is why you are being asked. The two',
    'checklists disagree about what is a full species: genus moves, splits, lumps and renames',
    'are common. Think about which candidate species, as AviList defines it, includes the',
    'eBird bird\'s population.',
    'If AviList treats the eBird bird as a subspecies or form of one of the candidates',
    '(for example Hooded Crow as part of Carrion Crow), choose that candidate and say so in the',
    'reason. Similar-looking names are not enough: choose by what the bird is.',
    'Answer 0 only if the eBird bird belongs to none of the candidates.',
    'Reply with JSON only: {"choice": <candidate number, or 0 for none>, "reason": "<one short sentence>"}',
  ].join('\n');
}

// Gemini 3 models "think" before answering, which can take a long time.
// Picking a number from a short list needs little thought, so ask for a low
// level. The allowed levels differ between models (e.g. gemini-3.6-flash only
// accepts medium or high), so it's only set for models listed here.
const GEMINI_THINKING_ = { 'gemini-3-flash-preview': 'low' };

/**
 * The body of the Gemini request. Asks for JSON in a fixed shape.
 * No temperature setting: Google's Gemini 3 guidance is to leave it alone
 * (the newest models ignore it and will reject it in future).
 */
function geminiRequestBody_(prompt, model, schema) {
  const generationConfig = {
    responseMimeType: 'application/json',
    // The shape the reply must have. Name fixes by default; Ask your list passes its own.
    responseSchema: schema || {
      type: 'OBJECT',
      properties: { choice: { type: 'INTEGER' }, reason: { type: 'STRING' } },
      required: ['choice', 'reason'],
    },
  };
  const level = GEMINI_THINKING_[model];
  if (level) generationConfig.thinkingConfig = { thinkingLevel: level };
  return { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig };
}

/** Pulls the reply text out of Gemini's response. */
function readGeminiText_(json) {
  const parts = (((json || {}).candidates || [])[0] || {}).content;
  const text = ((parts && parts.parts) || []).map(p => p.text || '').join('');
  if (!text) throw new Error('empty answer from the AI');
  return text;
}

/**
 * Checks the AI's reply against the shortlist. Anything that isn't a
 * candidate number (or 0 for "none") is rejected.
 * @return {{status:'pick'|'none'|'invalid', pick?:{row:number, sci:string, reason:string}, reason:string}}
 */
function parseAiAnswer_(text, shortlist) {
  let obj;
  try {
    obj = JSON.parse(String(text || '').replace(/```(?:json)?/gi, '').trim());
  } catch (e) {
    return { status: 'invalid', reason: 'answer was not valid JSON' };
  }
  const reason = String((obj && obj.reason) || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'no reason given';
  const choice = Number(obj && obj.choice);
  if (choice === 0) return { status: 'none', reason };
  if (!Number.isInteger(choice) || choice < 1 || choice > shortlist.length) {
    return { status: 'invalid', reason: 'choice "' + (obj && obj.choice) + '" is not on the shortlist' };
  }
  const c = shortlist[choice - 1];
  return { status: 'pick', choice, pick: { row: c.row, sci: c.sci, reason }, reason };
}

/**
 * AviList's own answer, no AI needed: most names that eBird treats as a
 * species but AviList doesn't are listed in AviList as a SUBSPECIES. eBird's
 * Hooded Crow, "Corvus cornix", is AviList's "Corvus corone cornix", part of
 * Carrion Crow. This finds the one species in the same genus with a
 * subspecies of that name. Returns null if there's none, or more than one
 * (the same subspecies name can be used in two species of a genus).
 * Species records need an `ssp` field: subspecies names, ';'-separated.
 * @return {{row:number, sci:string, common:string, ssp:string}|null}  ssp: the full subspecies name
 */
function subspeciesMatch_(ebird, species) {
  const words = String((ebird && ebird.sci) || '').trim().toLowerCase().split(/\s+/);
  if (words.length < 2) return null;
  const genus = words[0], name = words[words.length - 1];
  const hits = species.filter(s => s.ssp && String(s.sci).toLowerCase().split(' ')[0] === genus &&
    String(s.ssp).toLowerCase().split(';').some(x => x.trim() === name));
  if (hits.length !== 1) return null;
  const s = hits[0];
  return { row: s.row, sci: s.sci, common: s.common, ssp: s.sci + ' ' + name };
}

/**
 * The local part of a suggestion: string matching and the shortlist (no AI).
 * Stops early with the final suggestion when the names are identical once tidied.
 * Split from suggestFor_ so the website can do this part in the browser and the
 * AI part on Lyrebird.
 * @return {{str:Object|null, shortlist:Array, final:Object|null}}
 */
function prepareSuggestion_(ebird, species) {
  const scored = scoreAll_(ebird, species);          // the slow step, done once
  const str = stringMatch_(ebird, species, scored);
  // The shortlist is always built (cheap once scored): the website shows it so
  // people can pick another candidate themselves.
  const shortlist = buildShortlist_(ebird, species, scored);
  // An identical name (once tidied) is High confidence already: no need to
  // spend time and free-tier quota asking the AI.
  if (str && str.score === 1) {
    const d = decideSuggestion_(str, null);
    d.reason += ' (AI check not needed)';
    return { str, shortlist, final: d };
  }
  // AviList lists the eBird bird as a subspecies: its own data gives the answer
  const ssp = subspeciesMatch_(ebird, species);
  if (ssp) {
    if (!shortlist.some(c => c.row === ssp.row)) shortlist.unshift({ row: ssp.row, sci: ssp.sci, common: ssp.common, score: 0 });
    return { str, shortlist, final: { sci: ssp.sci, confidence: 'High',
      reason: 'AviList lists it as a subspecies: ' + ssp.ssp + (ssp.common ? ', part of ' + ssp.common : '') + ' (AI check not needed)' } };
  }
  return { str, shortlist, final: null };
}

/**
 * The final part: combines the string match with the AI's checked answer.
 * @param {Object|null} str  from prepareSuggestion_
 * @param {{status:string, pick?:Object, reason:string}} ans  from parseAiAnswer_,
 *        or {status:'error', reason} when the AI couldn't be asked
 */
function suggestionFromAnswer_(str, ans) {
  let ai = null, note = '';
  if (ans.status === 'pick') ai = ans.pick;
  else if (ans.status === 'none') note = 'AI found no match on the shortlist: ' + ans.reason;
  else if (ans.status === 'invalid') note = 'AI answer rejected (' + ans.reason + ')';
  else note = 'AI check unavailable: ' + ans.reason;
  const d = decideSuggestion_(str, ai);
  if (note) d.reason += '. ' + note;
  return d;
}

/**
 * Makes one suggestion: string matching, shortlist, AI check, then confidence.
 * @param {{sci:string, common:string}} ebird
 * @param {Array} species  the Species tab, as for stringMatch_
 * @param {function(string):string} askAi  sends a prompt, returns the reply text.
 *        Passed in so tests can use a fake AI. May throw (no key, limit reached…).
 * @return {{sci:string, confidence:string, reason:string}}
 */
function suggestFor_(ebird, species, askAi) {
  const label = String(ebird.sci || ebird.common || '').trim();
  const t0 = Date.now();
  const prep = prepareSuggestion_(ebird, species);
  const scoreMs = Date.now() - t0;
  if (prep.final) {
    logTime_('Name Fixes: "' + label + '": scoring ' + scoreMs + ' ms, AI skipped (identical name or AviList subspecies)');
    return prep.final;
  }
  const t1 = Date.now();
  let ans;
  try {
    ans = parseAiAnswer_(askAi(buildAiPrompt_(ebird, prep.shortlist)), prep.shortlist);
  } catch (e) {
    ans = { status: 'error', reason: e.message };
  }
  logTime_('Name Fixes: "' + label + '": scoring ' + scoreMs + ' ms, AI ' + (Date.now() - t1) + ' ms');
  return suggestionFromAnswer_(prep.str, ans);
}

/** Writes a line to the Apps Script Executions log (does nothing in the tests). */
function logTime_(msg) {
  try { console.log(msg); } catch (e) { }
}

/**
 * Decides what column C (the fix) and the Accept box become after an edit,
 * so the box always shows whether the suggestion is what's applied.
 * @param {number} col  the column edited: FX.ACCEPT or FX.FIX
 * @param {boolean} ticked  Accept box value after the edit
 * @return {{fix:string, accept:boolean, message:string}}
 */
function acceptEdit_(col, ticked, suggestion, fix) {
  const sug = String(suggestion || '').trim(), cur = String(fix || '').trim();
  const same = !!sug && cur.toLowerCase() === sug.toLowerCase();
  if (col === FX.ACCEPT) {
    if (ticked && !sug) return { fix: cur, accept: false, message: 'There is no suggestion to accept on this row.' };
    if (ticked) return { fix: sug, accept: true, message: '' };
    return { fix: same ? '' : cur, accept: false, message: '' };   // untick: remove the suggestion, keep anything else
  }
  return { fix: cur, accept: same, message: '' };                  // typed in column C by hand
}

// ---------------------------------------------------------------------------
//  Google parts (need Apps Script)
// ---------------------------------------------------------------------------

/** Sends one prompt to Gemini (or the backup model) and returns the reply text. Throws on failure. */
function callGemini_(prompt, key, schema) {
  return askGemini_(prompt, key, schema).text;
}

/** The models to try, in order: the main one, then the backup (if any). */
function geminiModels_() {
  const props = PropertiesService.getScriptProperties();
  const main = props.getProperty('GEMINI_MODEL') || ASSIST.GEMINI_MODEL;
  const backup = props.getProperty('GEMINI_FALLBACK_MODEL') || ASSIST.GEMINI_FALLBACK_MODEL;
  return backup && backup !== 'none' && backup !== main ? [main, backup] : [main];
}

/**
 * Is a Gemini error worth trying the backup model for? Yes for problems
 * with this model: out of quota (429), busy or failing (5xx), or not
 * available to this key (404). No for problems that the backup would hit
 * too, such as a bad key (401, 403) or a malformed request (400).
 */
function shouldFallBack_(code) {
  return code === 429 || code === 404 || code >= 500;
}

/**
 * Asks Gemini, falling back to the backup model if the main one can't answer.
 * @return {{text: string, model: string, backup: boolean}}  backup: true if the backup model answered
 */
function askGemini_(prompt, key, schema) {
  const models = geminiModels_();
  let failure = null;
  for (let i = 0; i < models.length; i++) {
    const r = fetchGemini_(models[i], prompt, key, schema);
    if (r.ok) return { text: r.text, model: models[i], backup: i > 0 };
    if (failure) failure.message += '; backup model: ' + r.error.message;
    else failure = r.error;
    if (!shouldFallBack_(r.code)) break;
  }
  throw failure;
}

/** One request to one model. Never throws for an HTTP error: returns it instead. */
function fetchGemini_(model, prompt, key, schema) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },   // in a header, not the URL, so it never shows in errors or logs
    payload: JSON.stringify(geminiRequestBody_(prompt, model, schema)),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 200) return { ok: true, code, text: readGeminiText_(JSON.parse(res.getContentText())) };
  if (code === 429) return { ok: false, code, error: new Error('free-tier limit reached, try again later') };
  let detail = '';
  try { detail = JSON.parse(res.getContentText()).error.message; } catch (e) { }
  return { ok: false, code, error: new Error('Gemini error ' + code + (detail ? ': ' + String(detail).slice(0, 300) : '')) };
}

/** Adds the Suggested species / Confidence / Reason / Accept headers if missing. */
function ensureAssistColumns_(sh) {
  if (sh.getMaxColumns() < FX.ACCEPT) sh.insertColumnsAfter(sh.getMaxColumns(), FX.ACCEPT - sh.getMaxColumns());
  const hdr = sh.getRange(1, FX.SUGGEST, 1, FX_NEW_HEADERS.length);
  if (hdr.getValues()[0].join('|') === FX_NEW_HEADERS.join('|')) return;
  hdr.setValues([FX_NEW_HEADERS]);
  styleHeader_(hdr);
  [[FX.SUGGEST, 200], [FX.CONF, 90], [FX.REASON, 420], [FX.ACCEPT, 65]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  sh.getRange(1, FX.ACCEPT).setNote('Tick to copy the suggested species into column C. Untick to clear it again. Nothing is applied until you tick.');
}

/** The Species tab as plain records for matching. */
function readSpeciesForMatching_(sh) {
  const n = sh.getLastRow() - 1;
  const sci = sh.getRange(2, SP.SCI, n, 1).getValues();
  const common = sh.getRange(2, SP.COMMON, n, 1).getDisplayValues();
  const alt = sh.getRange(2, SP.ALT, n, 1).getValues();
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = String(sci[i][0]).trim();
    if (s) out.push({ row: i, sci: s, common: String(common[i][0]), alt: String(alt[i][0] || '') });
  }
  return out;
}

/**
 * Fills in suggestions for Name Fixes rows that have no fix and no suggestion
 * yet. Each row is written as soon as it's done, so a stop part-way loses nothing.
 * @return {string} a short summary
 */
function suggestNameFixes_() {
  const ss = ss_();
  const fsh = ss.getSheetByName(TAB.FIXES), ssp = ss.getSheetByName(TAB.SPECIES);
  if (!fsh || fsh.getLastRow() < 2) return 'The Name Fixes tab has no names to suggest for.';
  if (!ssp || ssp.getLastRow() < 2) return 'Build the species list first.';
  ensureAssistColumns_(fsh);
  const v = fsh.getRange(2, 1, fsh.getLastRow() - 1, FX.ACCEPT).getValues();
  const todo = [];
  v.forEach((r, i) => {
    if (String(r[FX.SCI - 1]).trim() && !String(r[FX.FIX - 1]).trim() && !String(r[FX.SUGGEST - 1]).trim()) todo.push(i);
  });
  if (!todo.length) return 'Every Name Fixes row already has a fix or a suggestion.';

  const species = readSpeciesForMatching_(ssp);
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const askAi = key ? p => callGemini_(p, key) : () => { throw new Error('no GEMINI_API_KEY in Script Properties'); };
  let done = 0;
  for (const i of todo) {
    // Measured from the start of the whole run, so time spent processing
    // eBird data beforehand counts too.
    if (done >= ASSIST.MAX_PER_RUN || Date.now() - RUN_STARTED_ > ASSIST.STOP_AFTER_MS) break;
    if (done && key) Utilities.sleep(ASSIST.AI_PAUSE_MS);
    const d = suggestFor_({ sci: v[i][FX.SCI - 1], common: v[i][FX.COMMON - 1] }, species, askAi);
    const row = i + 2;
    fsh.getRange(row, FX.SUGGEST, 1, 3).setValues([[d.sci, d.confidence, d.reason]]);
    const box = fsh.getRange(row, FX.ACCEPT);
    if (d.sci) box.insertCheckboxes().setValue(false);
    else box.clearDataValidations().clearContent();
    done++;
  }
  const left = todo.length - done;
  return 'Name Fixes assistant: ' + done + ' suggestion(s) added' +
    (left ? ', ' + left + ' still to do (run 🐦 Bird List ▸ Suggest Name Fixes again)' : '') +
    (key ? '.' : '. No GEMINI_API_KEY in Script Properties, so string matching only.');
}

/**
 * Checks the Gemini connection. Run it from the Apps Script editor: choose
 * checkGeminiConnection in the function drop-down, then Run. It sends one
 * tiny request (the Hooded Crow question with two candidates) and writes the
 * result, or Google's full error message, to the log at the bottom of the
 * editor. The key itself is never written out, only its length.
 */
function checkGeminiConnection() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  const model = props.getProperty('GEMINI_MODEL') || ASSIST.GEMINI_MODEL;
  if (!key) {
    console.log('No GEMINI_API_KEY found in Script Properties (Project Settings ▸ Script Properties).');
    return;
  }
  console.log('Key found (' + key.length + ' characters). Model: ' + model +
    (GEMINI_THINKING_[model] ? ', thinking level: ' + GEMINI_THINKING_[model] : ', thinking level: model default'));
  const shortlist = [
    { row: 0, sci: 'Corvus corone', common: 'Carrion Crow' },
    { row: 1, sci: 'Corvus corax', common: 'Common Raven' },
  ];
  const t = Date.now();
  try {
    const reply = callGemini_(buildAiPrompt_({ sci: 'Corvus cornix', common: 'Hooded Crow' }, shortlist), key);
    console.log('Gemini answered in ' + (Date.now() - t) + ' ms: ' + reply);
    console.log('Checked against the shortlist: ' + JSON.stringify(parseAiAnswer_(reply, shortlist)));
  } catch (e) {
    console.log('Gemini call failed after ' + (Date.now() - t) + ' ms: ' + e.message);
  }
}

function menuSuggestFixes() {
  SpreadsheetApp.getUi().alert(suggestNameFixes_());
}

/**
 * Runs automatically whenever someone edits the sheet (an Apps Script
 * "simple trigger"). Keeps column C and the Accept box in step.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== TAB.FIXES) return;
    const r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getLastRow();
    const c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
    const hits = c => c0 <= c && c <= c1;
    const col = hits(FX.ACCEPT) ? FX.ACCEPT : hits(FX.FIX) ? FX.FIX : 0;
    if (!col || r1 < r0) return;

    const n = r1 - r0 + 1;
    const v = sh.getRange(r0, FX.FIX, n, FX.ACCEPT - FX.FIX + 1).getValues();
    const iSug = FX.SUGGEST - FX.FIX, iAcc = FX.ACCEPT - FX.FIX;
    const fixes = [], boxes = [];
    let message = '';
    v.forEach(r => {
      const out = acceptEdit_(col, r[iAcc] === true, r[iSug], r[0]);
      fixes.push([out.fix]);
      // Leave the Accept cell alone unless it really changes (rows without a suggestion have no tick box)
      boxes.push([out.accept === (r[iAcc] === true) ? r[iAcc] : out.accept]);
      message = message || out.message;
    });
    sh.getRange(r0, FX.FIX, n, 1).setValues(fixes);
    sh.getRange(r0, FX.ACCEPT, n, 1).setValues(boxes);
    if (message) e.source.toast(message, '🐦 Bird List', 5);
  } catch (err) {
    console.log('Name Fixes onEdit: ' + err.message);
  }
}
