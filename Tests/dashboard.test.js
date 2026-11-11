// Tests for the web dashboard's calculations (docs/js/dashboard-data.js).
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['LifeList.gs', 'docs/js/dashboard-data.js']) {
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

test('unmatched names are listed, and a name fix makes them count', () => {
  const before = build();
  assert.deepEqual(Array.from(before.unmatched, u => u.sci), ['Corvus cornix']);
  const after = build(new Map([['corvus cornix', 'Corvus corone']]));
  assert.equal(after.unmatched.length, 0);
  assert.equal(after.totals.species, 4);
  assert.equal(after.totals.countries, 3);           // Ireland now counts
});
