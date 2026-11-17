// Builds docs/data/traits.json: size, range, habitat, diet and breeding facts for
// every AviList species, from two published datasets, for "Ask your list".
//
//   AVONET (Tobias et al. 2022, Ecology Letters, CC BY 4.0): measurements of
//     90,000 museum birds, plus range size from BirdLife range maps.
//   BIRDBASE v2025.1 (Şekercioğlu et al. 2025, Scientific Data, CC BY 4.0):
//     78 traits from the literature, on the 2025 taxonomies including AviList.
//
// Run from the repo folder, with both files downloaded into private/traits/:
//   node tools/build-traits.js
// It also writes a coverage report: Tests/trait-coverage.md
//
// Which dataset gives which field (decided field by field, so one field never
// mixes two definitions):
//   - mass: AVONET, or BIRDBASE where AVONET has none (the same measurement:
//     average body mass in grams). Each value says which one it came from.
//   - wing, tail, beak, lifestyle, migration, range size: AVONET only.
//   - habitat, diet, elevation, island, restricted range, flightless, clutch,
//     nest: BIRDBASE only.
//
// Matching names: AviList 2026 differs from AVONET's 2021 names, so species are
// matched directly where the name is the same, and otherwise through BIRDBASE,
// which lists each species' BirdLife, eBird and AviList names side by side.
// Range size is kept only when exactly one AviList species matches an AVONET
// row: after a split, the old range covers several species, so it would be too big.

const fs = require('node:fs');
const path = require('node:path');
const { readSheet } = require('./read-xlsx');

const root = path.join(__dirname, '..');
const AVONET_FILE = path.join(root, 'private/traits/AVONET Supplementary dataset 1.xlsx');
const BIRDBASE_FILE = path.join(root, 'private/traits/BIRDBASE v2025.1.xlsx');

// ---------- small helpers ----------
const key = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const number = (v, dp = 1) => {
  const n = parseFloat(v);
  if (!isFinite(n) || String(v).trim() === '' || /^na$/i.test(String(v).trim())) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const NEST = { BU: 'Burrow', CP: 'Cup', CR: 'Crevice', CV: 'Tree cavity', DM: 'Dome', HC: 'Half cup', NO: 'No nest',
  O: 'Other bird\'s nest', PL: 'Platform', PN: 'Pendant', SA: 'Saucer', SC: 'Scrape', SP: 'Sphere', M: 'Mound' };
// Where the nest is (BIRDBASE "Nest_SBS"), used when the nest type isn't recorded
const NEST_SITE = { T: 'Tree', G: 'Ground', S: 'Shrub', R: 'Rock', Z: 'Grass', B: 'Building', C: 'Stump',
  N: 'Other animal\'s nest', A: 'Bamboo', P: 'Pole', W: 'Water', K: 'Cactus' };
const LIFESTYLE = { Insessorial: 'Perching', Terrestrial: 'Ground', Generalist: 'Generalist', Aerial: 'Aerial', Aquatic: 'Aquatic' };
const MIGRATION = { 1: 'Sedentary', 2: 'Partial migrant', 3: 'Migratory' };

/** A sheet as objects keyed by its header row (headerRow: 0-based). */
function table(file, sheet, headerRow = 0) {
  const rows = readSheet(file, sheet);
  const head = rows[headerRow].map(h => String(h).trim());
  return rows.slice(headerRow + 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

// ---------- the fields written for each species, in order ----------
const FIELDS = ['mass', 'massSource', 'wing', 'tail', 'beak', 'rangeSize', 'lifestyle', 'migration',
  'habitat', 'diet', 'elevationMin', 'elevationMax', 'islandOnly', 'restrictedRange', 'flightless', 'clutchMax', 'nest', 'nestSite'];

function build() {
  for (const f of [AVONET_FILE, BIRDBASE_FILE]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + path.relative(root, f) + ' (see the top of this file).'); process.exit(1); }
  }
  const avilist = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/avilist.json'), 'utf8'));
  const species = avilist.species.map(r => ({ sci: r[0], common: r[1], extinct: r[7] === 1 }));

  console.log('Reading AVONET…');
  const av1 = table(AVONET_FILE, 'AVONET1_BirdLife');            // BirdLife names; has range size
  const av2 = table(AVONET_FILE, 'AVONET2_eBird');               // eBird names
  console.log('Reading BIRDBASE…');
  const bb = table(BIRDBASE_FILE, 'Data', 1);                    // row 0 is a group heading
  const BB_NAMES = { latin: 'Latin (BirdLife > IOC > Clements>AviList)', birdlife: 'HBW/BirdLife International (v9.1)',
    ioc: 'IOC World Bird List (v15.1)', ebird: 'eBird/Clements (V2024b)', avilist: 'AviList v1 2025' };

  const index = (rows, col) => { const m = new Map(); rows.forEach(r => { const k = key(r[col]); if (k && !m.has(k)) m.set(k, r); }); return m; };
  const av1By = index(av1, 'Species1'), av2By = index(av2, 'Species2');
  const bbByAvilist = index(bb, BB_NAMES.avilist);
  const bbByAny = new Map();
  bb.forEach(r => Object.values(BB_NAMES).forEach(c => { const k = key(r[c]); if (k && !bbByAny.has(k)) bbByAny.set(k, r); }));

  // 1. Match each AviList species to a BIRDBASE row and an AVONET row
  const how = { bb: {}, av: {} };
  const tally = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const matches = species.map(s => {
    const k = key(s.sci);
    let b = bbByAvilist.get(k), bHow = 'AviList name';
    if (!b) { b = bbByAny.get(k); bHow = 'other name'; }
    if (!b) bHow = 'none';
    tally(how.bb, bHow);

    let a = null, aHow = 'none';
    const tries = [
      [av1By, k, 'BirdLife sheet, same name'],
      [av1By, b && key(b[BB_NAMES.birdlife]), 'BirdLife sheet, via BIRDBASE'],
      [av1By, b && key(b[BB_NAMES.latin]), 'BirdLife sheet, via BIRDBASE'],
      [av2By, k, 'eBird sheet, same name'],
      [av2By, b && key(b[BB_NAMES.ebird]), 'eBird sheet, via BIRDBASE'],
    ];
    for (const [map, name, label] of tries) {
      if (name && map.has(name)) { a = map.get(name); aHow = label; break; }
    }
    tally(how.av, aHow);
    return { s, b, a, aHow };
  });

  // How many AviList species share each AVONET row (more than one: a split since 2021)
  const shared = new Map();
  matches.forEach(m => { if (m.a) shared.set(m.a, (shared.get(m.a) || 0) + 1); });

  // 2. The values
  const out = {};
  // Stored compactly: words as numbers (positions in "values"), yes/no as 1/0,
  // and empty fields at the end trimmed off. unpackTraits_ in dashboard-data.js reverses it.
  const packed = {};
  const values = {};
  const pack = row => {
    const r = row.map((x, i) => {
      const f = FIELDS[i];
      if (x === null) return null;
      if (typeof x === 'boolean') return x ? 1 : 0;
      const code = w => { values[f] = values[f] || []; let n = values[f].indexOf(w); if (n < 0) { n = values[f].length; values[f].push(w); } return n; };
      if (Array.isArray(x)) return x.map(code);
      return typeof x === 'string' ? code(x) : x;
    });
    while (r.length && r[r.length - 1] === null) r.pop();
    return r;
  };
  const filled = Object.fromEntries(FIELDS.map(f => [f, 0]));
  let massAv = 0, massBb = 0, rangeDropped = 0;
  console.log('AVONET rows matched by more than one AviList species:', [...shared.values()].filter(n => n > 1).length);
  matches.forEach(({ s, b, a }) => {
    const v = {};
    if (a) {
      v.wing = number(a['Wing.Length']);
      v.tail = number(a['Tail.Length']);
      v.beak = number(a['Beak.Length_Culmen']);
      v.lifestyle = LIFESTYLE[a['Primary.Lifestyle']] || null;
      v.migration = MIGRATION[a.Migration] || null;
      if ('Range.Size' in a) {
        if (shared.get(a) === 1) v.rangeSize = number(a['Range.Size'], 0);
        else rangeDropped++;
      }
    }
    const avMass = a && number(a.Mass);
    const bbMass = b && number(b['Average Mass']);
    if (avMass) { v.mass = avMass; v.massSource = 'AVONET'; massAv++; }
    else if (bbMass) { v.mass = bbMass; v.massSource = 'BIRDBASE'; massBb++; }
    if (b) {
      const text = x => (String(x || '').trim() && !/^no information$/i.test(String(x).trim()) ? String(x).trim() : null);
      v.habitat = text(b['Primary Habitat']);
      v.diet = text(b['Primary Diet']);
      v.elevationMin = /^\d+(\.\d+)?$/.test(String(b.NormMin).trim()) ? number(b.NormMin, 0) : null;
      // A letter instead of a height: L = lowland (up to 500 m), F = foothills (up to 1,000 m)
      const max = String(b.NormMax).trim();
      v.elevationMax = /^\d+(\.\d+)?$/.test(max) ? number(max, 0) : { L: 500, F: 1000 }[max] || null;
      v.islandOnly = b.ISL === '1' ? true : b.ISL === '0' ? false : null;
      v.restrictedRange = b.RR === '1' ? true : b.RR === '0' ? false : null;
      v.flightless = b.Flightlessness === 'Yes' ? true : b.Flightlessness === 'No' || b.Flightlessness === 'Partial' ? false : null;
      v.clutchMax = number(b.Clutch_Max);
      const nests = String(b.Nest_Type || '').split(',').map(c => NEST[c.trim()]).filter(Boolean);
      v.nest = nests.length ? nests : null;
      const sites = String(b.Nest_SBS || '').split(/[,\s]+/).map(c => NEST_SITE[c.trim()]).filter(Boolean);
      v.nestSite = sites.length ? [...new Set(sites)] : null;
    }
    const row = FIELDS.map(f => (v[f] === undefined ? null : v[f]));
    row.forEach((x, i) => { if (x !== null) filled[FIELDS[i]]++; });
    if (row.some(x => x !== null)) { out[s.sci] = row; packed[s.sci] = pack(row); }
  });

  const result = {
    built: new Date().toISOString().slice(0, 10),
    sources: [
      'Tobias, J.A. et al. (2022) AVONET: morphological, ecological and geographical data for all birds. Ecology Letters 25: 581–597. https://doi.org/10.1111/ele.13898 (CC BY 4.0)',
      'Şekercioğlu, Ç.H. et al. (2025) BIRDBASE: A Global Database of Avian Biogeography, Conservation, Ecology and Life History Traits. Scientific Data. https://doi.org/10.1038/s41597-025-05615-3 (data: https://doi.org/10.6084/m9.figshare.27051040, CC BY 4.0)',
    ],
    fields: FIELDS,
    values,
    species: packed,
  };
  const file = path.join(root, 'docs/data/traits.json');
  fs.writeFileSync(file, JSON.stringify(result) + '\n');
  console.log('Wrote ' + path.relative(root, file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB, ' + Object.keys(out).length + ' species)');

  // 3. The coverage report
  const living = matches.filter(m => !m.s.extinct);
  const pct = (n, of) => (100 * n / of).toFixed(1) + '%';
  const livingFilled = f => living.filter(m => out[m.s.sci] && out[m.s.sci][FIELDS.indexOf(f)] !== null).length;
  const noAv = living.filter(m => !m.a).map(m => m.s);
  const noBb = living.filter(m => !m.b).map(m => m.s);
  const lines = [
    '# Trait coverage: AVONET and BIRDBASE matched to AviList',
    '',
    'Made by `node tools/build-traits.js` on ' + result.built + '. Counts are for the ' + living.length.toLocaleString('en-GB') +
      ' living AviList species (' + (species.length - living.length) + ' extinct species are left out of the percentages).',
    '',
    '## How species were matched',
    '',
    '| BIRDBASE | Species |', '|---|---|',
    ...Object.entries(how.bb).map(([k, n]) => '| ' + k + ' | ' + n.toLocaleString('en-GB') + ' |'),
    '',
    '| AVONET | Species |', '|---|---|',
    ...Object.entries(how.av).map(([k, n]) => '| ' + k + ' | ' + n.toLocaleString('en-GB') + ' |'),
    '',
    'Range sizes come from the BirdLife maps AVONET used (about 2018–2021). A species split since then has no AVONET row, so no range, and the species it was split from may still have the larger, older range. (Range size is also left blank whenever one AVONET row matches more than one AviList species: ' + rangeDropped + ' this time.)',
    '',
    'Values are as published. Some look surprising, e.g. BIRDBASE gives European Robin\'s normal elevation as 1,000 to 2,000 m; they are kept, not corrected by hand.',
    '',
    '## Fields filled',
    '',
    '| Field | Source | Living species with a value |', '|---|---|---|',
    ...FIELDS.filter(f => f !== 'massSource').map(f => {
      const src = f === 'mass' ? 'AVONET, else BIRDBASE' : ['wing', 'tail', 'beak', 'rangeSize', 'lifestyle', 'migration'].includes(f) ? 'AVONET' : 'BIRDBASE';
      return '| ' + f + ' | ' + src + ' | ' + livingFilled(f).toLocaleString('en-GB') + ' (' + pct(livingFilled(f), living.length) + ') |';
    }),
    '',
    'Mass: ' + massAv.toLocaleString('en-GB') + ' from AVONET, ' + massBb.toLocaleString('en-GB') + ' from BIRDBASE where AVONET had none.',
    '',
    '## Living species with no AVONET match (' + noAv.length + ')',
    '',
    noAv.map(s => s.common + ' (*' + s.sci + '*)').join(', ') || 'None.',
    '',
    '## Living species with no BIRDBASE match (' + noBb.length + ')',
    '',
    noBb.map(s => s.common + ' (*' + s.sci + '*)').join(', ') || 'None.',
    '',
  ];
  fs.writeFileSync(path.join(root, 'Tests/trait-coverage.md'), lines.join('\n'));
  console.log('Wrote Tests/trait-coverage.md');
  console.log('AVONET match:', how.av, '\nBIRDBASE match:', how.bb, '\nmass AVONET', massAv, 'BIRDBASE', massBb, 'range dropped', rangeDropped);
  console.log(FIELDS.map(f => f + ' ' + livingFilled(f)).join(', '));
}

build();
