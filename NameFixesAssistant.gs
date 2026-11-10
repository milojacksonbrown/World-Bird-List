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
 *  Everything in this part is "pure": it takes plain values in and returns
 *  plain values, with no Google calls, so it can be tested outside Google.
 *  It uses normalise_() from Code.gs (Apps Script files share one scope).
 */

const ASSIST = {
  SHORTLIST_SIMILAR: 10,     // most similar-looking names overall
  SHORTLIST_GENUS: 5,        // extra species from the same genus
  STRING_MIN_SCORE: 0.8,     // below this, string matching has "no match"
};

// Spelling differences that don't change which bird it is (British vs American etc.)
const SPELLING_VARIANTS = [
  ['grey', 'gray'],
  ['colour', 'color'],
  ['moustached', 'mustached'],
];

/**
 * Turns a name into a comparison key: lower case, no accents, no text in
 * brackets, one spelling of each variant, and letters only.
 * "Grey-headed Woodpecker (Grey-faced)" -> "grayheadedwoodpecker"
 */
function nameKey_(name) {
  let s = normalise_(String(name || '').replace(/\([^)]*\)/g, ' '));
  SPELLING_VARIANTS.forEach(([from, to]) => {
    s = s.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
  });
  return s.replace(/[^a-z]/g, '');
}

/** Splits a name into tidied words, for comparing word by word. */
function nameWords_(name) {
  let s = normalise_(String(name || '').replace(/\([^)]*\)/g, ' '));
  SPELLING_VARIANTS.forEach(([from, to]) => {
    s = s.replace(new RegExp('\\b' + from + '\\b', 'g'), to);
  });
  return s.split(/[^a-z]+/).filter(Boolean);
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
  const letters = 1 - editDistance_(ka, kb) / Math.max(ka.length, kb.length);
  const wa = new Set(nameWords_(a)), wb = new Set(nameWords_(b));
  const shared = [...wa].filter(w => wb.has(w)).length;
  const words = (2 * shared) / (wa.size + wb.size);
  // Word overlap alone can't make a perfect score: "Lesser Whitethroat" and
  // "Whitethroat" share a word but aren't the same bird.
  return Math.max(letters, Math.min(words, 0.95));
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
 * Method 1: string matching. Finds the single most similar AviList species.
 * @param {{sci:string, common:string}} ebird  the unmatched eBird name
 * @param {Array<{row:number, sci:string, common:string, alt:string}>} species
 * @return {{row:number, sci:string, score:number, via:string}|null}
 *         null if nothing scores at least ASSIST.STRING_MIN_SCORE
 */
function stringMatch_(ebird, species) {
  let best = null;
  species.forEach(sp => {
    const s = scoreSpecies_(ebird, sp);
    if (!best || s.score > best.score) best = { row: sp.row, sci: sp.sci, score: s.score, via: s.via };
  });
  return best && best.score >= ASSIST.STRING_MIN_SCORE ? best : null;
}

/**
 * Builds the shortlist the AI must choose from: the most similar-looking
 * species overall, plus the most similar others from the same genus.
 * @return {Array<{row:number, sci:string, common:string, score:number}>} best first
 */
function buildShortlist_(ebird, species) {
  const genus = String(ebird.sci || '').trim().split(/\s+/)[0].toLowerCase();
  const scored = species.map(sp => ({ row: sp.row, sci: sp.sci, common: sp.common, score: scoreSpecies_(ebird, sp).score }))
    .sort((a, b) => b.score - a.score);
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
