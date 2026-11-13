// Tests for "Ask your list" (AskYourList.gs): the query checker, the runner,
// the plain-English description, and the website's tables (askData_).
// No AI is used here: the queries are written by hand, as Gemini would.
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['LifeList.gs', 'NameFixesAssistant.gs', 'AskYourList.gs', 'docs/js/dashboard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const run = expr => vm.runInContext(expr, ctx);
// Results made inside the sandbox are copied through JSON before comparing,
// because strict deepEqual also checks they come from the same JavaScript realm.
const plain = x => JSON.parse(JSON.stringify(x));
const check = raw => { ctx.RAW = raw; return plain(run('checkQuery_(RAW)')); };

// The same made-up checklist and eBird file as dashboard.test.js
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
  row('S2', 'Gray Heron', 'Ardea cinerea', 'GB-ENG', 'Hyde Park', '2022-03-10'),
  row('S3', 'Osprey', 'Pandion haliaetus', 'ES-AN', 'Doñana', '2024-07-02'),
  row('S4', 'European Turtle Dove', 'Streptopelia turtur', 'ES-AN', 'Doñana', '2024-07-02'),
  row('S7', 'Gray Heron', 'Ardea cinerea', 'ES-AN', 'Doñana', '2024-07-03'),
];
const COUNTRIES = { countries: { GB: ['United Kingdom', 'Europe', 'UK', 'Britain'], ES: ['Spain', 'Europe', 'Kingdom of Spain'] } };

ctx.DATA = DATA; ctx.ROWS = ROWS; ctx.COUNTRIES = COUNTRIES;
run('var CL = loadChecklist_(DATA); var ASKDATA = askData_(buildDashboard_(ROWS, CL), CL, loadCountries_(COUNTRIES));');

/** Checks a query, runs it on the made-up list, and returns plain results. */
const ask = raw => {
  const c = check(raw);
  assert.equal(c.problem, '', 'query should pass the checker: ' + c.problem);
  ctx.Q = c.query;
  return plain(run('runQuery_(Q, ASKDATA)'));
};
const col = (res, field) => res.rows.map(r => r[res.columns.findIndex(c => c.field === field)]);

// ---------- the checker ----------

test('a valid query passes, with values converted to the right types and defaults filled in', () => {
  const c = check({ table: 'families', filters: [{ field: 'pctSeen', op: 'lt', value: '10%' }] });
  assert.equal(c.problem, '');
  assert.deepEqual(c.query, { table: 'families', region: '', filters: [{ field: 'pctSeen', op: 'lt', value: 10 }], sortField: 'seen', sortDir: 'desc', limit: 25, columns: [] });
});

test('Gemini\'s "nothing" values (empty region and sort, no filters, limit 0) mean the defaults', () => {
  const c = check({ status: 'query', reason: '', table: 'years', region: '', filters: [], sortField: '', sortDir: 'desc', limit: 0 });
  assert.deepEqual(c.query, { table: 'years', region: '', filters: [], sortField: 'year', sortDir: 'asc', limit: 25, columns: [] });
});

test('the checker accepts its own output, so the browser can check Lyrebird\'s reply again', () => {
  const once = check({ table: 'species', region: 'africa', filters: [{ field: 'seen', op: 'eq', value: 'true' }, { field: 'firstSeen', op: 'gte', value: '2020-01-01' }], sortField: 'firstSeen', limit: 5 });
  assert.equal(once.problem, '');
  assert.equal(once.query.region, 'Africa');                 // tidied to the official spelling
  assert.equal(once.query.sortDir, 'desc');                  // dates default to newest first
  assert.deepEqual(check(once.query), once);
});

test('unknown tables, fields, comparisons, regions and badly typed values are rejected', () => {
  const bad = [
    [{ table: 'sightings' }, /Unknown table/],
    [{ table: 'constructor' }, /Unknown table/],
    [{ table: 'species', filters: [{ field: 'password', op: 'eq', value: 'x' }] }, /no field "password"/],
    [{ table: 'species', filters: [{ field: 'common', op: 'lt', value: 'x' }] }, /Can't use "lt"/],
    [{ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'maybe' }] }, /doesn't suit seen/],
    [{ table: 'families', filters: [{ field: 'pctSeen', op: 'lt', value: 'ten' }] }, /doesn't suit pctSeen/],
    [{ table: 'species', filters: [{ field: 'firstSeen', op: 'gt', value: '2019-02-30' }] }, /doesn't suit firstSeen/],
    [{ table: 'species', filters: [{ field: 'common', op: 'eq', value: 'x'.repeat(101) }] }, /doesn't suit common/],
    [{ table: 'species', filters: [{ field: 'common', op: 'eq', value: { a: 1 } }] }, /doesn't suit common/],
    [{ table: 'species', region: 'Narnia' }, /Unknown region/],
    [{ table: 'years', region: 'Europe' }, /can't be limited to a region/],
    [{ table: 'species', sortField: 'countries' }, /Can't sort by a list/],
    [{ table: 'species', sortField: 'common', sortDir: 'sideways' }, /asc or desc/],
    [{ table: 'species', limit: 5000 }, /limit/],
    [{ table: 'species', limit: 2.5 }, /limit/],
    [{ table: 'species', filters: 'seen' }, /must be a list/],
    [{ table: 'species', filters: Array(7).fill({ field: 'seen', op: 'eq', value: 'true' }) }, /Too many filters/],
    [null, /empty/],
  ];
  bad.forEach(([raw, why]) => assert.match(check(raw).problem, why, JSON.stringify(raw)));
});

test('a region on the countries table becomes a filter on its region field', () => {
  const c = check({ table: 'countries', region: 'Europe' });
  assert.equal(c.query.region, '');
  assert.deepEqual(c.query.filters, [{ field: 'region', op: 'eq', value: 'Europe' }]);
});

test('Gemini\'s reply: a query is checked, "cannot" is passed on, and broken replies are rejected', () => {
  const read = text => { ctx.T = text; return plain(run('readQueryAnswer_(T)')); };
  const ok = read('{"status":"query","reason":"Families by % seen","table":"families","sortField":"pctSeen","sortDir":"asc"}');
  assert.equal(ok.status, 'query');
  assert.equal(ok.query.sortField, 'pctSeen');
  assert.deepEqual(read('{"status":"cannot","reason":"Counties are not in the tables."}'), { status: 'cannot', reason: 'Counties are not in the tables.' });
  assert.equal(read('not json').status, 'invalid');
  assert.equal(read('{"status":"query","table":"species","filters":[{"field":"x","op":"eq","value":"1"}]}').status, 'invalid');
});

test('the browser checks Lyrebird\'s reply again', () => {
  const from = reply => { ctx.R = reply; return plain(run('queryFromLyrebird_(R)')); };
  assert.equal(from({ ok: true, status: 'query', query: { table: 'years' }, reason: 'Years' }).status, 'query');
  assert.equal(from({ ok: true, status: 'query', query: { table: 'emails' } }).status, 'invalid');     // a tampered reply
  assert.equal(from({ ok: true, status: 'cannot', reason: 'No.' }).status, 'cannot');
  assert.deepEqual(from({ ok: false, message: 'The AI limit for today has been reached.' }), { status: 'error', reason: 'The AI limit for today has been reached.' });
});

// ---------- the prompt ----------

test('the prompt holds the question and the allowed tables, and no data from the list', () => {
  ctx.QN = 'Which owls have I seen?';
  const p = run('buildQueryPrompt_(QN, new Date("2026-11-11T12:00:00Z"))');
  assert.match(p, /Question: "Which owls have I seen\?"/);
  assert.match(p, /Today is 2026-11-11/);
  assert.match(p, /Table "families"/);
  assert.match(p, /pctSeen \(number\)/);
  assert.ok(!/Hyde Park|Ardea|Doñana/.test(p));      // nothing from the eBird file
  const schema = plain(run('queryResponseSchema_()'));
  assert.deepEqual(schema.properties.table.enum, ['species', 'families', 'orders', 'countries', 'years', 'months']);
  // Every key required: Gemini drops optional keys (found in the accuracy check)
  assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
});

// ---------- the description ----------

test('the query is described in plain English, so a misreading can be spotted', () => {
  const describe = raw => { ctx.Q = check(raw).query; return run('describeQuery_(Q)'); };
  assert.equal(describe({ table: 'families', region: 'Africa', filters: [{ field: 'pctSeen', op: 'lt', value: '10' }], sortField: 'pctSeen', sortDir: 'asc' }),
    'Families (Africa species only) where % seen is under 10%, % seen lowest first, up to 25.');
  assert.equal(describe({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }, { field: 'countries', op: 'has', value: 'Kenya' }], limit: 5 }),
    'Species that I\'ve seen and whose countries include Kenya, first seen newest first, up to 5.');
  assert.equal(describe({ table: 'species', filters: [{ field: 'firstSeen', op: 'lt', value: '2020-01-01' }, { field: 'family', op: 'contains', value: 'owl' }] }),
    'Species first seen before 2020-01-01 and family contains “owl”, first seen newest first, up to 25.');
  assert.equal(describe({ table: 'families', filters: [{ field: 'pctSeen', op: 'lt', value: '10' }, { field: 'seen', op: 'gt', value: '0' }] }),
    'Families where % seen is under 10% and seen is over 0, seen highest first, up to 25.');
});

// ---------- the runner, on the made-up list ----------

test('species I\'ve seen, newest first, with my first sighting', () => {
  const r = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }] });
  assert.equal(r.total, 3);
  assert.deepEqual(col(r, 'common'), ['Osprey', 'European Turtle Dove', 'Grey Heron']);   // same day: AviList order
  assert.deepEqual(col(r, 'firstSeen'), ['2024-07-02', '2024-07-02', '2022-03-10']);
  assert.deepEqual(r.columns.map(c => c.field), ['common', 'scientific', 'family', 'firstSeen', 'firstPlace']);   // no "Seen: Yes" column
});

test('species not seen leave out extinct ones; "Worldwide" species count in every land region', () => {
  const notSeen = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'false' }], sortField: 'common' });
  assert.deepEqual(col(notSeen, 'common'), ['Carrion Crow', 'Common Raven', 'Great Egret']);   // no Dodo
  const africa = ask({ table: 'species', region: 'Africa', sortField: 'common' });
  assert.deepEqual(col(africa, 'common'), ['Great Egret', 'Grey Heron', 'Osprey']);
});

test('families: counts, % seen and a region limit', () => {
  const all = ask({ table: 'families', sortField: 'familyLatin' });
  assert.deepEqual(all.rows.map(r => r.slice(0, 5)), [
    ['Herons', 'Ardeidae', 1, 2, 50],
    ['Pigeons', 'Columbidae', 1, 1, 100],      // the extinct Dodo isn't counted
    ['Crows', 'Corvidae', 0, 2, 0],
    ['Osprey', 'Pandionidae', 1, 1, 100],
  ]);
  const under = ask({ table: 'families', filters: [{ field: 'pctSeen', op: 'lt', value: '60' }], sortField: 'pctSeen', sortDir: 'asc' });
  assert.deepEqual(col(under, 'family'), ['Crows', 'Herons']);
  const asia = ask({ table: 'families', region: 'Asia', sortField: 'familyLatin' });
  assert.deepEqual(asia.rows.map(r => [r[0], r[2], r[3]]), [['Herons', 1, 1], ['Crows', 0, 1], ['Osprey', 1, 1]]);
});

test('orders count their families too', () => {
  const r = ask({ table: 'orders', filters: [{ field: 'order', op: 'eq', value: 'passeriformes' }] });
  assert.equal(r.total, 1);
  assert.deepEqual(r.rows[0], ['Passeriformes', 0, 2, 0, 0, 'Passeriformes'].slice(0, 5));
});

test('countries can be named by another name ("UK"), and species filtered by country', () => {
  const uk = ask({ table: 'species', filters: [{ field: 'countries', op: 'has', value: 'UK' }] });
  assert.deepEqual(col(uk, 'common'), ['Grey Heron']);
  const notSpain = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }, { field: 'countries', op: 'lacks', value: 'spain' }] });
  assert.deepEqual(col(notSpain, 'common'), []);
  const c = ask({ table: 'countries', filters: [{ field: 'country', op: 'eq', value: 'Britain' }] });
  assert.deepEqual(c.rows, [['United Kingdom', 'Europe', 1, 1]]);
});

test('threatened species, text "contains", and the limit', () => {
  assert.deepEqual(col(ask({ table: 'species', filters: [{ field: 'threatened', op: 'eq', value: 'true' }] }), 'common'), ['European Turtle Dove']);
  assert.deepEqual(col(ask({ table: 'species', filters: [{ field: 'family', op: 'contains', value: 'HERON' }], sortField: 'common' }), 'common'), ['Great Egret', 'Grey Heron']);
  const one = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }], sortField: 'firstSeen', sortDir: 'asc', limit: 1 });
  assert.equal(one.total, 3);                // how many matched…
  assert.equal(one.rows.length, 1);          // …and how many are shown
  assert.equal(one.rows[0][0], 'Grey Heron');
});

test('years and months: the best year for lifers, and a season', () => {
  const best = ask({ table: 'years', sortField: 'lifers', sortDir: 'desc', limit: 1 });
  assert.deepEqual(best.rows, [[2024, 2, 3, 3]]);           // 2024: 2 lifers, 3 species, 3 checklists
  const july = ask({ table: 'months', filters: [{ field: 'name', op: 'eq', value: 'july' }] });
  assert.deepEqual(july.rows, [['July', 2, 3, 3]]);
  const firstYear = ask({ table: 'species', filters: [{ field: 'firstYear', op: 'eq', value: '2022' }] });
  assert.deepEqual(col(firstYear, 'common'), ['Grey Heron']);
});

// ---------- how often, and firsts in each country ----------

test('"which bird have I seen the most": species by number of checklists', () => {
  const r = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }], sortField: 'checklists', sortDir: 'desc', limit: 2 });
  assert.deepEqual(r.rows.map(x => [x[0], x[r.columns.findIndex(c => c.field === 'checklists')]]), [['Grey Heron', 3], ['Osprey', 1]]);
  const never = ask({ table: 'species', filters: [{ field: 'common', op: 'eq', value: 'Great Egret' }], columns: ['checklists'] });
  assert.equal(col(never, 'checklists')[0], 0);
});

test('"first lifer in each country": firsts per country, and lifers add up to the whole list', () => {
  const r = ask({ table: 'countries', sortField: 'firstVisit', sortDir: 'asc', columns: ['firstLifer', 'firstLiferDate', 'firstSpecies'] });
  assert.deepEqual(r.columns.map(c => c.field), ['country', 'region', 'species', 'lifers', 'firstLifer', 'firstLiferDate', 'firstSpecies', 'firstVisit']);
  assert.deepEqual(r.rows, [
    ['United Kingdom', 'Europe', 1, 1, 'Grey Heron', '2022-03-10', 'Grey Heron', '2022-03-10'],
    ['Spain', 'Europe', 3, 2, 'Osprey', '2024-07-02', 'Osprey', '2024-07-02'],
  ]);
  assert.equal(col(r, 'lifers').reduce((a, b) => a + b, 0), 3);     // every lifer is counted in exactly one country
});

test('the first bird recorded in a country can differ from the first lifer there', () => {
  // A Grey Heron seen first in Spain on a later trip: already a lifer from the UK
  ctx.ROWS2 = ROWS.concat([row('S8', 'Gray Heron', 'Ardea cinerea', 'FR-IDF', 'Paris', '2025-01-01'),
    row('S9', 'Osprey', 'Pandion haliaetus', 'FR-IDF', 'Paris', '2025-01-02'),
    row('S9', 'Great Egret', 'Ardea alba', 'FR-IDF', 'Paris', '2025-01-02')]);
  run('var ASK2 = askData_(buildDashboard_(ROWS2, CL), CL, loadCountries_(COUNTRIES));');
  const fr = plain(run('ASK2.countries')).find(c => c.country === 'FR');   // no name in the test list: shown as its code
  assert.deepEqual([fr.firstSpecies, fr.firstLifer, fr.lifers], ['Grey Heron', 'Great Egret', 1]);
  assert.equal(plain(run('ASK2.species')).find(s => s.common === 'Great Egret').firstCountry, 'FR');
});

test('columns: only fields of the table, at most six, shown in the description', () => {
  assert.match(check({ table: 'countries', columns: ['firstLifer', 'password'] }).problem, /no field "password" to show/);
  assert.match(check({ table: 'countries', columns: 'firstLifer' }).problem, /must be a list/);
  assert.match(check({ table: 'species', columns: ['common', 'scientific', 'family', 'order', 'iucn', 'checklists', 'seen'] }).problem, /Too many columns/);
  assert.deepEqual(check({ table: 'countries', columns: ['firstLifer', 'firstLifer'] }).query.columns, ['firstLifer']);
  ctx.Q = check({ table: 'countries', columns: ['firstLifer', 'firstLiferDate'] }).query;
  assert.equal(run('describeQuery_(Q)'), 'Countries, species highest first, up to 25, showing first lifer and first lifer date.');
});

test('each result row carries its family and order, for the bird silhouettes', () => {
  const r = ask({ table: 'species', filters: [{ field: 'seen', op: 'eq', value: 'true' }], sortField: 'common', limit: 2 });
  assert.equal(r.kinds.length, r.rows.length);
  assert.deepEqual(r.rows.map(x => x[0]), ['European Turtle Dove', 'Grey Heron']);
  assert.deepEqual(r.kinds, [{ familyLatin: 'Columbidae', order: 'Columbiformes' }, { familyLatin: 'Ardeidae', order: 'Pelecaniformes' }]);
  const orders = ask({ table: 'orders', filters: [{ field: 'order', op: 'eq', value: 'Passeriformes' }] });
  assert.deepEqual(orders.kinds, [{ familyLatin: '', order: 'Passeriformes' }]);
  const years = ask({ table: 'years' });
  assert.ok(years.kinds.every(k => k.familyLatin === '' && k.order === ''));   // not birds: no silhouette
});
