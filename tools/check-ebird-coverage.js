// How well do eBird's names match AviList? Runs EVERY name in eBird's
// taxonomy through the same matching the website uses, without any AI, and
// counts how each one is settled:
//   - direct: the scientific (or common) name is an AviList species
//   - identical once tidied (spelling, punctuation): High suggestion
//   - AviList subspecies rule (subspeciesMatch_): High suggestion
//   - left over: string matching's guess only, or nothing (the AI's job)
// Also counts direct matches where AviList's eBird species code differs from
// eBird's: the same name, but the two checklists may draw the species
// differently.
//
// Get the taxonomy (public, no key needed):
//   curl -o ebird-taxonomy.csv "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv"
// Then run from the repo folder:
//   node tools/check-ebird-coverage.js <ebird-taxonomy.csv>
// Writes Tests/ebird-coverage.md.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const file = process.argv[2];
if (!file) { console.error('Usage: node tools/check-ebird-coverage.js <ebird-taxonomy.csv>'); process.exit(1); }

const ctx = vm.createContext({});
for (const f of ['LifeList.gs', 'NameFixesAssistant.gs', 'docs/js/dashboard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const run = expr => vm.runInContext(expr, ctx);
ctx.AVI = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'avilist.json'), 'utf8'));
run('var CL = loadChecklist_(AVI); var SPECIES = speciesForMatching_(CL); var INDEX = { bySci: CL.bySci, byCommon: CL.byCommon, fixes: new Map() };');

ctx.TEXT = fs.readFileSync(file, 'utf8');
const rows = run('parseCsvText_(TEXT)');
const H = rows[0];
const c = name => H.indexOf(name);
const C = { sci: c('SCIENTIFIC_NAME'), common: c('COMMON_NAME'), code: c('SPECIES_CODE'), cat: c('CATEGORY'), extinct: c('EXTINCT') };

const species = rows.slice(1).filter(r => r[C.cat] === 'species');
const started = Date.now();
const tally = { direct: 0, directByCommon: 0, codeDiffers: 0, identical: 0, subspecies: 0, stringGuess: 0, nothing: 0, skipped: 0 };
const leftovers = [], subspeciesHits = [], codeDiffers = [];

species.forEach((r, n) => {
  const sci = r[C.sci], common = r[C.common], code = r[C.code];
  ctx.S = sci; ctx.N = common;
  const res = run('resolveEbirdName_(S, N, INDEX)');
  if (res.skip) { tally.skipped++; return; }
  if (res.target !== undefined && res.target !== null) {
    tally.direct++;
    const av = run('CL.species[' + res.target + ']');
    if (av.sci.toLowerCase() !== sci.toLowerCase()) tally.directByCommon++;
    if (av.code && av.code !== code) { tally.codeDiffers++; codeDiffers.push([common, sci, av.common, av.sci]); }
    return;
  }
  const prep = run('prepareSuggestion_({ sci: S, common: N }, SPECIES)');
  if (prep.final && /subspecies/.test(prep.final.reason)) {
    tally.subspecies++; subspeciesHits.push([common, sci, prep.final.sci, prep.final.reason]);
  } else if (prep.final) {
    tally.identical++;
  } else if (prep.str) {
    tally.stringGuess++; leftovers.push([common, sci, 'string guess: ' + prep.str.sci + ' (' + Math.round(prep.str.score * 100) + '%)']);
  } else {
    tally.nothing++; leftovers.push([common, sci, 'no guess']);
  }
  if ((n + 1) % 2000 === 0) console.log('  ' + (n + 1) + ' of ' + species.length + ' done…');
});

// Below species level: subspecies groups ("issf"), forms and intergrades,
// which birders often record (e.g. "Hooded Crow (Hooded)"). They count
// towards their species, so the question is whether that species is found.
const lower = rows.slice(1).filter(r => ['issf', 'form', 'intergrade'].includes(r[C.cat]));
const low = { matched: 0, viaSubspeciesRule: 0, notMatched: 0, skipped: 0 };
const lowMisses = [];
lower.forEach(r => {
  ctx.S = r[C.sci]; ctx.N = r[C.common];
  const res = run('resolveEbirdName_(S, N, INDEX)');
  if (res.skip) { low.skipped++; return; }
  if (res.target !== undefined && res.target !== null) { low.matched++; return; }
  if (run('subspeciesMatch_({ sci: S, common: N }, SPECIES)')) { low.viaSubspeciesRule++; return; }
  low.notMatched++; lowMisses.push([r[C.common], r[C.sci], r[C.cat]]);
});
const skippedNames = species.filter(r => { ctx.S = r[C.sci]; ctx.N = r[C.common]; return run('resolveEbirdName_(S, N, INDEX)').skip; })
  .map(r => r[C.common] + ' (' + r[C.sci] + ')');

const total = species.length;
const pct = x => (100 * x / total).toFixed(1) + '%';
const settled = tally.direct + tally.identical + tally.subspecies;
const lines = [
  '# eBird names against AviList: coverage check', '',
  'Run on ' + new Date().toISOString().slice(0, 10) + ' with `node tools/check-ebird-coverage.js`: every **species** in eBird\'s taxonomy',
  '(' + total.toLocaleString('en-GB') + ' names) through the website\'s matching, with no AI. AviList ' + ctx.AVI.version + '.', '',
  '| How the name is settled | Names | Share |', '|---|---|---|',
  '| Matches an AviList species directly | ' + tally.direct + ' | ' + pct(tally.direct) + ' |',
  '| Identical once tidied (High suggestion) | ' + tally.identical + ' | ' + pct(tally.identical) + ' |',
  '| AviList lists it as a subspecies (High suggestion) | ' + tally.subspecies + ' | ' + pct(tally.subspecies) + ' |',
  '| **Settled without AI** | **' + settled + '** | **' + pct(settled) + '** |',
  '| Left for the AI: string matching has a guess | ' + tally.stringGuess + ' | ' + pct(tally.stringGuess) + ' |',
  '| Left for the AI: no guess at all | ' + tally.nothing + ' | ' + pct(tally.nothing) + ' |', '',
  'Of the direct matches, ' + tally.directByCommon + ' matched by common name rather than scientific name, and ' + tally.codeDiffers +
    ' have a different eBird species code in AviList (same name, but the two checklists may draw the species differently).', '',
  (skippedNames.length ? 'Skipped as not countable by the matching (' + skippedNames.length + '): ' + skippedNames.join('; ') + '.\n' : ''),
  '**Below species level** (subspecies groups, forms, intergrades: ' + lower.length.toLocaleString('en-GB') + ' names): ' +
    low.matched + ' counted towards an AviList species directly, ' + low.viaSubspeciesRule + ' via the subspecies rule, ' +
    low.notMatched + ' not matched' + (low.skipped ? ', ' + low.skipped + ' skipped' : '') + '.', '',
  '## Settled by the subspecies rule (' + subspeciesHits.length + ')', '',
  '| eBird name | AviList species |', '|---|---|',
  ...subspeciesHits.map(([cm, sc, to]) => '| ' + cm + ' (*' + sc + '*) | *' + to + '* |'), '',
  '## Left for the AI or a person (' + leftovers.length + ')', '',
  '| eBird name | String matching |', '|---|---|',
  ...leftovers.map(([cm, sc, note]) => '| ' + cm + ' (*' + sc + '*) | ' + note + ' |'), '',
  '## Below species level, not matched (' + lowMisses.length + ')', '',
  '| eBird name | Category |', '|---|---|',
  ...lowMisses.map(([cm, sc, cat]) => '| ' + cm + ' (*' + sc + '*) | ' + cat + ' |'), '',
  '## Same name, different eBird code (' + codeDiffers.length + ')', '',
  '| eBird name | AviList species |', '|---|---|',
  ...codeDiffers.map(([cm, sc, acm, asc]) => '| ' + cm + ' (*' + sc + '*) | ' + acm + ' (*' + asc + '*) |'), '',
];
fs.writeFileSync(path.join(root, 'Tests', 'ebird-coverage.md'), lines.join('\n'));
console.log(JSON.stringify(tally));
console.log('Below species level: ' + JSON.stringify(low) + '; skipped species: ' + skippedNames.join('; '));
console.log('Settled without AI: ' + settled + ' of ' + total + ' (' + pct(settled) + ') in ' + Math.round((Date.now() - started) / 1000) + ' s');
console.log('Saved Tests/ebird-coverage.md');
