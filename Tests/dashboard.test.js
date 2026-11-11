// Tests for the web dashboard's calculations (docs/js/dashboard-data.js).
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['LifeList.gs', 'NameFixesAssistant.gs', 'docs/js/dashboard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const run = expr => vm.runInContext(expr, ctx);
// (Arrays made inside the sandbox are compared after copying with Array.from,
//  because strict deepEqual also checks they come from the same JavaScript realm.)

// A made-up checklist in the same compact shape as docs/data/avilist.json
const REGIONS = ['Europe', 'Asia', 'Africa', 'N America', 'Middle America', 'S America', 'Australasia', 'Pacific Is.', 'Antarctic', 'Oceans', 'Worldwide'];
const bit = (...names) => names.reduce((b, n) => b | (1 << REGIONS.indexOf(n)), 0);
const DATA = {
  version: 'test', regions: REGIONS, orders: ['Pelecaniformes', 'Passeriformes', 'Accipitriformes', 'Columbiformes'],
  families: [['Ardeidae', 'Herons', 0], ['Corvidae', 'Crows', 1], ['Pandionidae', 'Osprey', 2], ['Columbidae', 'Pigeons', 3]],
  fields: ['sci', 'common', 'alt', 'family', 'iucn', 'code', 'regions', 'extinct'],
  species: [
    ['Ardea cinerea', 'Grey Heron', 'Gray Heron', 0, 'LC', 'graher1', bit('Europe', 'Asia', 'Africa'), 0],
    ['Ardea alba', 'Great Egret', '', 0, 'LC', 'greegr', bit('Europe', 'Africa', 'S America'), 0],
    ['Corvus corone', 'Carrion Crow', '', 1, 'LC', '', bit('Europe', 'Asia'), 0],
    ['Corvus corax', 'Common Raven', '', 1, 'LC', 'comrav', bit('Europe', 'N America'), 0],
    ['Pandion haliaetus', 'Osprey', '', 2, 'LC', 'osprey', bit('Worldwide'), 0],
    ['Streptopelia turtur', 'European Turtle Dove', '', 3, 'VU', 'eutdov', bit('Europe'), 0],
    ['Raphus cucullatus', 'Dodo', '', 3, 'EX', 'dodo1', bit('Africa'), 1],
  ],
};

const H = ['Submission ID', 'Common Name', 'Scientific Name', 'Count', 'State/Province', 'Location ID', 'Location', 'Latitude', 'Longitude', 'Date', 'Time'];
const row = (sub, common, sci, state, loc, date) => [sub, common, sci, '1', state, 'L' + loc, loc, '51.5', '-0.1', date, '08:00 AM'];
const ROWS = [H,
  row('S1', 'Gray Heron', 'Ardea cinerea', 'GB-ENG', 'Hyde Park', '2023-05-01'),
  row('S2', 'Gray Heron', 'Ardea cinerea', 'GB-ENG', 'Hyde Park', '2022-03-10'),      // earlier: this is the lifer
  row('S3', 'Osprey', 'Pandion haliaetus', 'ES-AN', 'Doñana', '2024-07-02'),
  row('S4', 'European Turtle Dove', 'Streptopelia turtur', 'ES-AN', 'Doñana', '2024-07-02'),
  row('S5', 'Hooded Crow', 'Corvus cornix', 'IE-D', 'Dublin', '2024-01-01'),          // not an AviList species
  row('S6', 'gull sp.', 'Larus sp.', 'GB-ENG', 'Hyde Park', '2024-01-01'),            // not countable
];

const build = fixes => {
  ctx.DATA = DATA; ctx.ROWS = ROWS; ctx.FIXES = fixes || new Map();
  return run('buildDashboard_(ROWS, loadChecklist_(DATA), FIXES)');
};

test('headline numbers count species, families, orders, countries and threatened species', () => {
  const d = build();
  assert.equal(d.totals.species, 3);                 // heron, osprey, turtle dove
  assert.equal(d.totals.worldSpecies, 6);            // the Dodo is extinct, so not counted
  assert.equal(d.totals.worldPct, 3 / 6);
  assert.equal(d.totals.families, 3);
  assert.equal(d.totals.orders, 3);
  assert.equal(d.totals.countries, 2);               // GB and ES (IE only had an unmatched name)
  assert.equal(d.totals.threatened, 1);              // turtle dove (VU)
  assert.equal(d.totals.records, 6);
});

test('the lifer date is the earliest sighting, and lifers are listed newest first', () => {
  const d = build();
  const heron = d.lifers.find(l => l.sci === 'Ardea cinerea');
  assert.equal(heron.date.getFullYear(), 2022);
  assert.equal(heron.checklist, 'S2');
  assert.deepEqual(Array.from(d.lifers, l => l.date.getFullYear()), [2024, 2024, 2022]);
  assert.deepEqual({ ...d.perYear }, { 2022: 1, 2024: 2 });
});

test('region progress: Worldwide species count in land regions only, extinct species never', () => {
  const d = build();
  const r = name => d.regions.find(x => x.name === name);
  assert.deepEqual([r('Europe').seen, r('Europe').total], [3, 6]);   // all but the Dodo breed in Europe (osprey via Worldwide)
  assert.deepEqual([r('Africa').seen, r('Africa').total], [2, 3]);   // heron, osprey / heron, egret, osprey
  assert.deepEqual([r('Oceans').seen, r('Oceans').total], [0, 0]);   // Worldwide doesn't count at sea
});

test('lifers per month of the year count every year together (January = position 0)', () => {
  const d = build();
  const m = Array.from(d.perMonth);
  assert.equal(m.length, 12);
  assert.equal(m[2], 1);                              // March 2022: heron
  assert.equal(m[6], 2);                              // July 2024: osprey, turtle dove
  assert.equal(m.reduce((a, b) => a + b, 0), 3);
});

test('species recorded and checklists per year and month count every record, not just lifers', () => {
  const d = build();
  // 2022: heron (S2). 2023: heron again (S1), not a lifer but still a species recorded that year.
  // 2024: osprey + turtle dove (S3, S4); Hooded Crow (S5) and gull sp. (S6) are checklists but not species.
  assert.deepEqual({ ...d.speciesPerYear }, { 2022: 1, 2023: 1, 2024: 2 });
  assert.deepEqual({ ...d.checklistsPerYear }, { 2022: 1, 2023: 1, 2024: 4 });
  const sm = Array.from(d.speciesPerMonth), cm = Array.from(d.checklistsPerMonth);
  assert.equal(sm[0], 0);                             // January: only unmatched / "sp." records
  assert.equal(cm[0], 2);                             // …but two checklists
  assert.equal(sm[4], 1);                             // May 2023: heron
  assert.equal(sm[6], 2);                             // July: osprey, turtle dove
});

test('regionForCountry_ follows the range summariser for borderline countries', () => {
  const r = (code, continent, subregion) => run('regionForCountry_')({ ISO_A2_EH: code, ISO_A2: code, CONTINENT: continent, SUBREGION: subregion });
  assert.equal(r('GB', 'Europe', 'Northern Europe'), 'Europe');
  assert.equal(r('US', 'North America', 'Northern America'), 'N America');
  assert.equal(r('MX', 'North America', 'Central America'), 'Middle America');
  assert.equal(r('CU', 'North America', 'Caribbean'), 'Middle America');
  assert.equal(r('AU', 'Oceania', 'Australia and New Zealand'), 'Australasia');
  assert.equal(r('PG', 'Oceania', 'Melanesia'), 'Australasia');
  assert.equal(r('FJ', 'Oceania', 'Melanesia'), 'Pacific Is.');
  assert.equal(r('TF', 'Seven seas (open ocean)', 'Seven seas (open ocean)'), 'Antarctic');
  assert.equal(r('BR', 'South America', 'South America'), 'S America');
  // Natural Earth gives a few countries "-99"; ISO_A2_EH is the fixed code
  assert.equal(run('countryCode_')({ ISO_A2: '-99', ISO_A2_EH: 'FR' }), 'FR');
  assert.equal(run('countryCode_')({ ISO_A2: '-99', ISO_A2_EH: '-99' }), '');
});

test('unmatched names are listed, and a name fix makes them count', () => {
  const before = build();
  assert.deepEqual(Array.from(before.unmatched, u => u.sci), ['Corvus cornix']);
  const after = build(new Map([['corvus cornix', 'Corvus corone']]));
  assert.equal(after.unmatched.length, 0);
  assert.equal(after.totals.species, 4);
  assert.equal(after.totals.countries, 3);           // Ireland now counts
});

// ---------- Name Fixes on the website ----------
test('answerFromLyrebird_ re-checks a pick against the browser\'s own shortlist', () => {
  const shortlist = [{ row: 2, sci: 'Corvus corone' }, { row: 3, sci: 'Corvus corax' }];
  ctx.SL = shortlist;
  const a = reply => run('answerFromLyrebird_')(reply, run('SL'));
  const pick = a({ ok: true, status: 'pick', choice: 1, reason: 'part of Carrion Crow' });
  assert.equal(pick.status, 'pick');
  assert.equal(pick.pick.sci, 'Corvus corone');
  assert.equal(pick.pick.row, 2);
  assert.equal(a({ ok: true, status: 'pick', choice: 7, reason: 'x' }).status, 'invalid');   // off the shortlist
  assert.equal(a({ ok: true, status: 'pick', choice: 0, reason: 'x' }).status, 'invalid');   // a broken "pick", not "no match"
  assert.equal(a({ ok: true, status: 'none', reason: 'not here' }).status, 'none');
  assert.equal(a({ ok: true, status: 'invalid', reason: 'x' }).status, 'invalid');
  const err = a({ ok: false, error: 'limit', message: 'The AI limit for today has been reached.' });
  assert.equal(err.status, 'error');
  assert.match(err.reason, /limit/);
});

test('the full website flow: Hooded Crow gets Carrion Crow, at Low confidence when string matching disagrees', () => {
  ctx.DATA = DATA;
  const r = run(`(() => {
    const checklist = loadChecklist_(DATA);
    const prep = prepareSuggestion_({ sci: 'Corvus cornix', common: 'Hooded Crow' }, speciesForMatching_(checklist));
    const n = prep.shortlist.findIndex(c => c.sci === 'Corvus corone') + 1;
    const ans = answerFromLyrebird_({ ok: true, status: 'pick', choice: n, reason: 'Hooded Crow is part of Carrion Crow in AviList' }, prep.shortlist);
    return { final: prep.final, str: prep.str && prep.str.sci, d: suggestionFromAnswer_(prep.str, ans) };
  })()`);
  assert.equal(r.final, null);                        // not identical, so the AI is asked
  assert.equal(r.d.sci, 'Corvus corone');
  if (r.str && r.str !== 'Corvus corone') assert.equal(r.d.confidence, 'Low');   // e.g. string matching picked the Raven
});

test('findSpecies_ finds what was typed in the search box, and never guesses', () => {
  ctx.DATA = DATA;
  const find = text => { ctx.T = text; const s = run('findSpecies_(loadChecklist_(DATA), T)'); return s ? s.sci : null; };
  assert.equal(find('Carrion Crow (Corvus corone)'), 'Corvus corone');   // the suggestion format
  assert.equal(find('corvus corone'), 'Corvus corone');                  // scientific name, any case
  assert.equal(find('Gray Heron'), 'Ardea cinerea');                     // another name for it
  assert.equal(find('  grey heron '), 'Ardea cinerea');                  // common name, tidied
  assert.equal(find('Carrion'), null);                                  // partial: no guessing
  assert.equal(find(''), null);
  ctx.S = { sci: 'Corvus corone', common: 'Carrion Crow' };
  assert.equal(run('searchLabel_(S)'), 'Carrion Crow (Corvus corone)');
});

test('prepareSuggestion_ always returns a shortlist, even for an identical name', () => {
  ctx.DATA = DATA;
  const r = run(`(() => { const p = prepareSuggestion_({ sci: 'Ardea cinerea', common: 'Grey Heron' }, speciesForMatching_(loadChecklist_(DATA)));
    return { conf: p.final && p.final.confidence, n: p.shortlist.length, first: p.shortlist[0].sci }; })()`);
  assert.equal(r.conf, 'High');
  assert.ok(r.n > 1);
  assert.equal(r.first, 'Ardea cinerea');
});

test('filterLifers_ searches common name, scientific name and family, ignoring case and accents', () => {
  ctx.L = [
    { common: "Rüppell's Vulture", sci: 'Gyps rueppelli', family: 'Hawks, Eagles, and Kites' },
    { common: 'Common Ringed Plover', sci: 'Charadrius hiaticula', family: 'Plovers and Lapwings' },
    { common: 'Grey Heron', sci: 'Ardea cinerea', family: 'Herons' },
  ];
  const f = q => { ctx.Q = q; return Array.from(run('filterLifers_(L, Q)'), l => l.common); };
  assert.deepEqual(f('plover'), ['Common Ringed Plover']);
  assert.deepEqual(f('CHARADRIUS'), ['Common Ringed Plover']);
  assert.deepEqual(f('ruppells'), ["Rüppell's Vulture"]);          // accent and apostrophe ignored
  assert.deepEqual(f('herons'), ['Grey Heron']);                    // by family
  assert.equal(f('').length, 3);                                    // empty search: everything
  assert.equal(f('albatross').length, 0);
});
