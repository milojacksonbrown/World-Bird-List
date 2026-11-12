// A live check of Name Fixes through Lyrebird: takes every eBird name in the
// sample data that doesn't match AviList, makes the shortlist on this
// computer (as the website does), asks Lyrebird, and shows each suggestion,
// its confidence and which AI model answered. Results go to
// Tests/name-fix-check.md, for a person to mark right or wrong.
//
// Uses one of Lyrebird's daily AI calls per name that string matching can't settle.
// Only bird names are sent.
//
// Run from the repo folder:   node tools/check-name-fixes.js [eBird csv]
// (default: docs/data/sample-ebird.csv)

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
for (const file of ['LifeList.gs', 'NameFixesAssistant.gs', 'docs/js/dashboard-data.js', 'docs/js/config.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const run = expr => vm.runInContext(expr, ctx);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const csv = process.argv[2] || path.join(root, 'docs', 'data', 'sample-ebird.csv');
  ctx.AVI = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'avilist.json'), 'utf8'));
  ctx.CSV = fs.readFileSync(csv, 'utf8');
  run('var CL = loadChecklist_(AVI); var SPECIES = speciesForMatching_(CL); var D = buildDashboard_(parseCsvText_(CSV), CL);');
  const unmatched = run('D.unmatched');
  const url = run('LYREBIRD_URL');
  console.log(unmatched.length + ' unmatched names in ' + path.relative(root, csv));

  const lines = [];
  for (const u of unmatched) {
    ctx.E = { sci: u.sci, common: u.common };
    const prep = run('prepareSuggestion_(E, SPECIES)');
    let d = prep.final, model = 'string matching only';
    if (!d) {
      if (lines.length) await sleep(8000);         // stay inside free-tier per-minute limits
      let reply;
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'nameFix', ebird: ctx.E, shortlist: prep.shortlist.map(c => ({ sci: c.sci, common: c.common })) }) });
        reply = await res.json();
      } catch (e) {
        reply = { ok: false, message: e.message };
      }
      ctx.REPLY = reply; ctx.PREP = prep;
      d = run('suggestionFromAnswer_(PREP.str, answerFromLyrebird_(REPLY, PREP.shortlist))');
      model = reply.model ? reply.model + (reply.backup ? ' (backup)' : '') : 'no answer';
    }
    const suggested = d.sci ? (run('CL.species[CL.bySci.get(' + JSON.stringify(d.sci.toLowerCase()) + ')]') || {}).common + ' (' + d.sci + ')' : '—';
    console.log(u.common + ' (' + u.sci + ') -> ' + suggested + '  [' + (d.confidence || 'none') + ', ' + model + ']\n    ' + d.reason);
    lines.push('| ' + [u.common + ' (' + u.sci + ')', suggested, d.confidence || '—', d.reason, model, ''].map(s => String(s).replace(/\|/g, '\\|')).join(' | ') + ' |');
  }
  const md = ['# Name Fixes: live check', '',
    'Run on ' + new Date().toISOString().slice(0, 10) + ' with `node tools/check-name-fixes.js`, on the unmatched names in ' + path.relative(root, csv) + '.',
    'The last column is for a person to fill in.', '',
    '| eBird name | Suggested AviList species | Confidence | Reason | Answered by | Right? |',
    '|---|---|---|---|---|---|'].concat(lines).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'Tests', 'name-fix-check.md'), md);
  console.log('Saved Tests/name-fix-check.md');
}

main().catch(e => { console.error(e.message); process.exit(1); });
