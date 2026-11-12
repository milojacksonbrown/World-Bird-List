// The "Ask your list" accuracy check: sends example questions to the live
// Lyrebird, checks each was understood as expected, and writes the results to
// Tests/question-accuracy.md (for the README case study).
//
// Each question uses one of Lyrebird's daily AI calls (there are 16 here).
// Only the questions are sent, never any eBird data.
//
// Run from the repo folder:   node tools/check-questions.js
// Optionally name the Lyrebird version that must be live, e.g.
//   node tools/check-questions.js "2026-11-11 (session 4b)"

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
for (const file of ['AskYourList.gs', 'docs/js/config.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const LYREBIRD_URL = vm.runInContext('LYREBIRD_URL', ctx);
const checkQuery = vm.runInContext('checkQuery_', ctx);
const describe = vm.runInContext('describeQuery_', ctx);

// Small helpers for the expectations
const has = (q, field, op, value) => q.filters.some(f => f.field === field && (!op || f.op === op) &&
  (value === undefined || String(f.value).toLowerCase() === String(value).toLowerCase()));
const seen = q => has(q, 'seen', 'eq', 'true');

// [question, what counts as understood correctly (in words), a check on the query, or 'cannot']
const QUESTIONS = [
  ['Which families have I seen less than 10% of?', 'families, % seen under 10',
    q => q.table === 'families' && has(q, 'pctSeen', 'lt', 10)],
  ['How many lifers did I get in 2024?', 'lifers first seen in 2024 (species or years table)',
    q => (q.table === 'species' && seen(q) && (has(q, 'firstYear', 'eq', 2024) || has(q, 'firstSeen', 'gte', '2024-01-01'))) ||
      (q.table === 'years' && has(q, 'year', 'eq', 2024))],
  ['Which threatened species have I seen?', 'seen and threatened',
    q => q.table === 'species' && seen(q) && has(q, 'threatened', 'eq', 'true')],
  ['What were my first 10 lifers in Asia?', 'seen, Asia, oldest first, 10',
    q => q.table === 'species' && seen(q) && q.region === 'Asia' && q.sortField === 'firstSeen' && q.sortDir === 'asc' && q.limit === 10],
  ['Which year did I get the most lifers?', 'years by lifers, highest first',
    q => q.table === 'years' && q.sortField === 'lifers' && q.sortDir === 'desc'],
  ['Which month do I see the most species in?', 'months by species, highest first',
    q => q.table === 'months' && q.sortField === 'species' && q.sortDir === 'desc'],
  ['Which owls have I seen?', 'seen, family contains "owl"',
    q => q.table === 'species' && seen(q) && q.filters.some(f => f.field === 'family' && /owl/i.test(f.value))],
  ['Which country have I seen the most species in?', 'countries by species, highest first',
    q => q.table === 'countries' && q.sortField === 'species' && q.sortDir === 'desc'],
  ['What have I seen in Thailand?', 'species recorded in Thailand',
    q => q.table === 'species' && has(q, 'countries', 'has', 'Thailand')],
  ['Which orders haven\'t I seen anything from?', 'orders with none seen',
    q => q.table === 'orders' && (has(q, 'seen', 'eq', 0) || has(q, 'pctSeen', 'eq', 0) || has(q, 'seen', 'lt', 1))],
  ['Which families have I seen every species of?', 'families with all seen',
    q => q.table === 'families' && (has(q, 'pctSeen', 'eq', 100) || has(q, 'pctSeen', 'gte', 100) || has(q, 'notSeen', 'eq', 0))],
  ['What endangered birds in Australasia haven\'t I seen yet?', 'not seen, Australasia, Endangered (or threatened)',
    q => q.table === 'species' && q.region === 'Australasia' && has(q, 'seen', 'eq', 'false') &&
      (has(q, 'iucn', 'eq', 'EN') || has(q, 'threatened', 'eq', 'true'))],
  ['Show my lifers from March 2026', 'seen, first seen in March 2026',
    // (a first-seen filter implies "seen": only seen species have a first sighting)
    q => q.table === 'species' &&
      ((has(q, 'firstMonth', 'eq', 3) && has(q, 'firstYear', 'eq', 2026)) || (has(q, 'firstSeen', 'gte', '2026-03-01') && q.filters.some(f => f.field === 'firstSeen' && /^(lt|lte)$/.test(f.op))))],
  ['Which hummingbirds have I seen?', 'seen, family contains "hummingbird"',
    q => q.table === 'species' && seen(q) && q.filters.some(f => /^family/.test(f.field) && /hummingbird|trochilidae/i.test(f.value))],
  ['What did I see at Hyde Park last weekend?', 'cannot (places below country, trips)', 'cannot'],
  ['Which species have I seen in only one country?', 'cannot (needs two steps)', 'cannot'],
];

// The free Gemini key allows only a few calls a minute, so questions are spaced out,
// and one that hits that limit is tried again after a longer wait.
const PAUSE_MS = 8000, RETRY_MS = 45000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Temporary problems worth waiting for: the free-tier limit (429) or high demand (503)
// and dropped connections ("fetch failed")
const BUSY = /limit reached|error 5\d\d|high demand|try again later|fetch failed|HTTP 5\d\d/i;

async function askLyrebird(question, retried) {
  const reply = await askOnce(question).catch(e => ({ ok: false, message: e.message }));
  if (!retried && !reply.ok && BUSY.test(reply.message || '')) {
    console.log('    (Gemini is busy or at its per-minute limit: waiting ' + RETRY_MS / 1000 + ' s and trying again)');
    await sleep(RETRY_MS);
    return askLyrebird(question, true);
  }
  return reply;
}

async function askOnce(question) {
  const res = await fetch(LYREBIRD_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'query', question }) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function main() {
  if (!LYREBIRD_URL) throw new Error('No LYREBIRD_URL in docs/js/config.js');
  const status = await (await fetch(LYREBIRD_URL)).json();
  if (!(status.actions || []).includes('query') || (process.argv[2] && status.version !== process.argv[2])) {
    throw new Error('The live Lyrebird (version ' + status.version + ') doesn\'t know "query" yet: redeploy it first.');
  }
  const lines = [];
  let right = 0;
  for (const [question, expected, check] of QUESTIONS) {
    if (lines.length) await sleep(PAUSE_MS);
    const started = Date.now();
    let reply, understood, ok;
    try {
      reply = await askLyrebird(question);
    } catch (e) {
      reply = { ok: false, message: e.message };
    }
    if (!reply.ok && !BUSY.test(reply.message || '')) {
      // Not a busy moment but a set-up problem (e.g. an unknown model): every question would fail the same way
      throw new Error('Stopped: ' + reply.message + '\nNothing was saved; fix Lyrebird\'s set-up and run again.');
    }
    if (!reply.ok) { understood = 'Error: ' + reply.message; ok = false; }
    else if (reply.status !== 'query') { understood = reply.status + ': ' + reply.reason; ok = check === 'cannot' && reply.status === 'cannot'; }
    else {
      const c = checkQuery(reply.query);
      understood = c.problem ? 'Rejected: ' + c.problem : describe(c.query);
      ok = !c.problem && check !== 'cannot' && check(c.query);
    }
    if (ok) right++;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const model = reply.model ? reply.model + (reply.backup ? ' (backup)' : '') : '';
    console.log((ok ? '✔ ' : '✘ ') + question + '\n    ' + understood + '  (' + secs + ' s' + (model ? ', ' + model : '') + ')');
    lines.push('| ' + [question, expected, understood, model || '–', ok ? 'Yes' : '**No**'].map(s => String(s).replace(/\|/g, '\\|')).join(' | ') + ' |');
  }
  const summary = right + ' of ' + QUESTIONS.length + ' understood as expected';
  console.log('\n' + summary);
  const md = [
    '# Ask your list: accuracy check',
    '',
    'Run on ' + new Date().toISOString().slice(0, 10) + ' against Lyrebird version ' + status.version + ' (' + summary + ').',
    'Made by `node tools/check-questions.js`. "Understood as" is the plain-English line the website shows.',
    '',
    '| Question | Counts as right | Understood as | Answered by | Right? |',
    '|---|---|---|---|---|',
  ].concat(lines).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'Tests', 'question-accuracy.md'), md);
  console.log('Saved Tests/question-accuracy.md');
}

main().catch(e => { console.error(e.message); process.exit(1); });
