// Tests for the bird fact files and sticker icons (factFile_, stickerFor_ and
// birdAlbumUrl_ in docs/js/dashboard-data.js), and for the files they rely on.
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const f of ['LifeList.gs', 'NameFixesAssistant.gs', 'AskYourList.gs', 'docs/js/dashboard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const run = e => vm.runInContext(e, ctx);
const plain = x => JSON.parse(JSON.stringify(x));
const call = (fn, ...args) => { ctx.ARGS = args; return plain(run(fn + '(...ARGS)')); };

const STICKERS = { cdn: 'https://cdn.example/x@abc/', credit: 'Illustration: Bird Album / huashu-bird-sticker, CC BY 4.0',
  none: ['Raphus cucullatus'], pages: { 'Anas crecca': 'eurasian-teal', 'Corvus lost': null } };
const EAGLE = { sci: 'Aquila audax', common: 'Wedge-tailed Eagle', family: 'Accipitridae', familyEn: 'Kites, Hawks, and Eagles',
  order: 'Accipitriformes', iucn: 'LC', code: 'wetea1', regions: ['Australasia'], extinct: false };

test('stickers: a thumbnail kept with the site and the full picture on the pinned CDN', () => {
  assert.deepEqual(call('stickerFor_', EAGLE, STICKERS), {
    thumb: 'stickers/Aquila_audax.webp',
    full: 'https://cdn.example/x@abc/stickers/Accipitriformes/Accipitridae/Aquila_audax.webp',
  });
  assert.equal(call('stickerFor_', { sci: 'Raphus cucullatus', order: 'Columbiformes', family: 'Columbidae' }, STICKERS), null);
  assert.equal(call('stickerFor_', EAGLE, null), null);                 // stickers.json didn't load: silhouettes
});

test('Bird Album pages: named from the English name, with stored exceptions', () => {
  assert.equal(call('birdAlbumUrl_', { sci: 'X y', common: "Darwin's Nothura" }, STICKERS), 'https://birdalbum.com/birds/darwins-nothura/');
  assert.equal(call('birdAlbumUrl_', { sci: 'X z', common: 'Rüppell’s Vulture' }, STICKERS), 'https://birdalbum.com/birds/ruppells-vulture/');
  assert.equal(call('birdAlbumUrl_', { sci: 'Anas crecca', common: 'Green-winged Teal' }, STICKERS), 'https://birdalbum.com/birds/eurasian-teal/');
  assert.equal(call('birdAlbumUrl_', { sci: 'Corvus lost', common: 'Lost Crow' }, STICKERS), '');
});

test('a fact file: names, status, size and life facts with their sources, and my records', () => {
  const row = { seen: true, firstSeen: '2026-04-13', firstPlace: 'The Forts Walk', checklists: 3, countries: ['Australia'], places: ['Queensland'],
    mass: 3368.4, massSource: 'AVONET', wing: 617.7, tail: 380, beak: 60.2, habitat: 'Forest', diet: 'Vertebrate', lifestyle: 'Aerial',
    migration: 'Sedentary', elevationMin: 0, elevationMax: 2500, rangeSize: 9046000, clutchMax: 3, nest: ['Platform'],
    islandOnly: false, restrictedRange: false, flightless: false };
  const f = call('factFile_', EAGLE, row, { lifer: { checklist: 'S123' }, range: 'australia and New Guinea.', stickers: STICKERS });
  assert.equal(f.iucnName, 'Least Concern');
  assert.equal(f.threatened, false);
  assert.deepEqual(f.size.map(x => [x.label, x.value, x.source]), [
    ['Weight', '3.4 kg', 'AVONET'], ['Wing length', '617.7 mm', 'AVONET'], ['Tail', '380 mm', 'AVONET'], ['Beak', '60.2 mm', 'AVONET']]);
  assert.deepEqual(f.life.map(x => x.value), ['Forest', 'Vertebrate', 'Aerial', 'Sedentary', '0–2,500 m', '9 million km²', 'up to 3 eggs', 'Platform']);
  assert.deepEqual(f.records, { firstSeen: '2026-04-13', firstPlace: 'The Forts Walk', checklist: 'S123', checklists: 3, countries: ['Australia'], places: ['Queensland'] });
  assert.deepEqual(f.links.map(l => l.label), ['eBird', 'Bird Album']);
  assert.equal(f.range, 'Australia and New Guinea.');
  assert.deepEqual(f.tags, []);
});

test('nest: the type if recorded, else where the nest is, else "Not recorded"', () => {
  const nest = row => call('factFile_', EAGLE, row, {}).life.find(x => x.label === 'Nest');
  assert.deepEqual(nest({ nest: ['Platform'], nestSite: ['Tree'] }), { label: 'Nest', value: 'Platform', source: 'BIRDBASE', nest: ['Platform'] });
  assert.deepEqual(nest({ nest: [], nestSite: ['Tree'] }), { label: 'Nest', value: 'In trees', source: 'BIRDBASE', sites: ['Tree'] });
  assert.equal(nest({ nest: [], nestSite: ['Shrub', 'Tree'] }).value, 'In shrubs or in trees');
  assert.equal(nest({ nest: [], nestSite: ["Other animal's nest"] }).value, "In other animals' nests");
  assert.deepEqual(nest({ nest: [], nestSite: [] }), { label: 'Nest', value: 'Not recorded', source: '', missing: true });
});

test('every nest site in the trait data has a drawing', () => {
  const nctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'nest-icons.js'), 'utf8'), nctx, { filename: 'nest-icons.js' });
  const ICONS = vm.runInContext('NEST_SITE_ICONS_', nctx);
  const missing = data('traits.json').values.nestSite.filter(n => !ICONS[n]);
  assert.deepEqual(missing, []);
});

test('a fact file leaves out what isn\'t known, and flags what matters for conservation', () => {
  const sp = { sci: 'Strigops habroptilus', common: 'Kakapo', family: 'Strigopidae', order: 'Psittaciformes', iucn: 'CR', code: '', regions: ['Australasia'] };
  const f = call('factFile_', sp, { seen: false, mass: 1600, massSource: 'BIRDBASE', flightless: true, islandOnly: true, restrictedRange: true, nest: [] }, { stickers: STICKERS });
  assert.deepEqual(f.size.map(x => [x.label, x.value, x.source]), [['Weight', '1.6 kg', 'BIRDBASE']]);   // nothing else known
  assert.deepEqual(f.life.map(x => [x.label, x.value]), [['Nest', 'Not recorded']]);   // the Nest row is never left out
  assert.equal(f.records, null);
  assert.equal(f.threatened, true);
  assert.deepEqual(f.tags, ['Breeds only on islands', 'Restricted range (under 50,000 km²)', 'Flightless']);
  assert.deepEqual(f.links.map(l => l.label), ['Bird Album']);          // no eBird code
  // A made-up checklist ID (the sample data's) isn't linked
  assert.equal(call('factFile_', EAGLE, { seen: true, firstSeen: '2026-01-01' }, { lifer: { checklist: 'sample-1' } }).records.checklist, '');
});

// ---------- the files themselves ----------
const data = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', f), 'utf8'));

test('every living species with a sticker has its thumbnail, and the CDN is pinned to one commit', () => {
  const st = data('stickers.json'), avilist = data('avilist.json');
  assert.match(st.cdn, /^https:\/\/cdn\.jsdelivr\.net\/gh\/alchaincyf\/huashu-bird-sticker@[0-9a-f]{40}\/$/);
  assert.match(st.credit, /CC BY 4\.0/);
  const none = new Set(st.none);
  const missing = avilist.species.filter(r => !none.has(r[0]))
    .filter(r => !fs.existsSync(path.join(__dirname, '..', 'docs', 'stickers', r[0].replace(/ /g, '_') + '.webp')));
  assert.deepEqual(missing.map(r => r[0]), []);
  const living = avilist.species.filter(r => !r[7]).length;
  const livingWithout = avilist.species.filter(r => !r[7] && none.has(r[0])).length;
  assert.ok(livingWithout / living < 0.01, livingWithout + ' living species have no sticker');
});

test('AviList range text is there for nearly every species', () => {
  const r = data('ranges.json'), avilist = data('avilist.json');
  assert.ok(Object.keys(r.ranges).length > avilist.species.length * 0.95);
  assert.match(r.ranges['Aquila audax'], /Australia/);
});

// ---------- the range map (GBIF records by season) ----------

/** Builds a tiny Mapbox Vector Tile by hand: one layer, point features with properties. */
function mvt(features, extent = 4096) {
  const varint = n => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return out; };
  const zz = n => (n < 0 ? -2 * n - 1 : 2 * n);
  const field = (num, type, bytes) => [...varint(num * 8 + type), ...(type === 2 ? varint(bytes.length) : []), ...bytes];
  const str = s => [...Buffer.from(s)];
  const keys = ['total', 'geohash'], values = [];
  const valueIndex = v => { let i = values.findIndex(x => x === v); if (i < 0) { values.push(v); i = values.length - 1; } return i; };
  const feats = features.map(f => {
    const tags = [0, valueIndex(f.total), 1, valueIndex(f.geohash)];
    const geom = [1 + 8 * 1, zz(f.x), zz(f.y)];                // MoveTo, one point
    return field(2, 2, [...field(2, 2, tags.flatMap(varint)), ...field(3, 0, varint(1)), ...field(4, 2, geom.flatMap(varint))]);
  });
  const vals = values.map(v => field(4, 2, typeof v === 'number' ? field(5, 0, varint(v)) : field(1, 2, str(v))));
  const layer = [...field(15, 0, varint(2)), ...field(1, 2, str('occurrence')), ...feats.flat(),
    ...keys.flatMap(k => field(3, 2, str(k))), ...vals.flat(), ...field(5, 0, varint(extent))];
  return new Uint8Array(field(3, 2, layer));
}

test('readMvtPoints_: reads points and their properties from a vector tile', () => {
  ctx.BUF = mvt([{ x: 10, y: 20, total: 5, geohash: 'gcp' }, { x: 300, y: 7, total: 70000, geohash: 'u10' }], 1024);
  ctx.TextDecoder = TextDecoder;
  const t = plain(run('readMvtPoints_(BUF)'));
  assert.equal(t.extent, 1024);
  assert.deepEqual(t.points.map(p => [p.x, p.y, p.total, p.props.geohash]), [[10, 20, 5, 'gcp'], [300, 7, 70000, 'u10']]);
});

test('geohashBox_ and mercator_: grid cells and the map projection', () => {
  const b = call('geohashBox_', 'gcp');                   // London
  assert.ok(b.lat[0] < 51.5 && b.lat[1] > 51.5 && b.lon[0] < -0.1 && b.lon[1] > -0.1);
  assert.equal(call('geohashBox_', 'a!'), null);
  assert.deepEqual(call('mercator_', 0, 0), [0.5, 0.5]);
  const [x, y] = call('mercator_', 85, 180);
  assert.equal(x, 1);
  assert.ok(y >= 0 && y < 0.005);                          // the map stops at 85°N
});

test('seasonCells_: June–July, December–January or both, and strays left out for common birds', () => {
  const f = (geohash, total) => ({ props: { geohash }, total });
  const cells = call('seasonCells_', [f('gcp', 900000), f('u10', 2), f('gcq', 5)], [f('gcp', 400000), f('ezs', 300000)]);
  assert.deepEqual(cells.map(c => [c.hash, c.season]).sort(), [['ezs', 'december'], ['gcp', 'both']]);   // 2 and 5 records: strays
  const rare = call('seasonCells_', [f('u10', 1)], [f('u10', 2), f('gcp', 1)]);
  assert.deepEqual(rare.map(c => [c.hash, c.season]).sort(), [['gcp', 'december'], ['u10', 'both']]);   // a rare bird keeps them all
});

test('rangeMapSvg_: the cells by season, your sightings, and a frame around the range', () => {
  const box = (lat, lon) => ({ lat: [lat, lat + 1.4], lon: [lon, lon + 1.4] });
  const cells = [{ hash: 'a', box: box(51, -1), season: 'both', total: 9 }, { hash: 'b', box: box(64, -20), season: 'june', total: 9 }];
  const world = { features: [{ geometry: { type: 'Polygon', coordinates: [[[-10, 50], [2, 50], [2, 60], [-10, 60], [-10, 50]]] } }] };
  const svg = call('rangeMapSvg_', cells, world, [[52.6, 1.2]]);
  assert.match(svg, /^<svg class="range-map" viewBox="[-\d. ]+"/);
  assert.equal((svg.match(/<g class="june" filter="url\(#range-smooth\)"><rect/g) || []).length, 1);   // each season smoothed on its own
  assert.equal((svg.match(/<g class="both" filter="url\(#range-smooth\)"><rect/g) || []).length, 1);
  assert.match(svg, /<feGaussianBlur stdDeviation="[\d.]+"\/><feColorMatrix/);
  assert.equal((svg.match(/<circle/g) || []).length, 1);
  assert.match(svg, /class="land" d="M/);
  const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.ok(Math.abs(w / h - 1.5) < 0.01);                   // always 3:2
  assert.equal(call('rangeMapSvg_', [], world, []), '');     // nothing to show
});

test('sightings are kept per species, rounded to about 10 km, for the map', () => {
  ctx.ROWS = [['Submission ID', 'Common Name', 'Scientific Name', 'Latitude', 'Longitude', 'Date'],
    ['S1', 'Gray Heron', 'Ardea cinerea', '51.5074', '-0.1278', '2024-01-01'],
    ['S2', 'Gray Heron', 'Ardea cinerea', '51.5099', '-0.1301', '2024-01-02'],
    ['S3', 'Gray Heron', 'Ardea cinerea', 'x', '', '2024-01-03']];
  ctx.AVILIST = data('avilist.json');
  run('var CL = loadChecklist_(AVILIST); var IDX = { bySci: CL.bySci, byCommon: CL.byCommon, fixes: new Map() }');
  const heron = run('CL.bySci.get("ardea cinerea")');
  const st = run('speciesStats_(ROWS, IDX)').species[heron];
  assert.deepEqual(plain([...st.points.values()]), [[51.5, -0.1]]);    // two nearby records, one point; the bad one ignored
});

test('names in other languages: one file per language, in AviList order, with the picker list', () => {
  const avilist = data('avilist.json');
  const langs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'names', 'languages.json'), 'utf8'));
  assert.ok(langs.languages.length >= 40);
  assert.match(langs.source, /IOC World Bird List/);
  const bull = avilist.species.findIndex(s => s[0] === 'Pyrrhula pyrrhula');
  for (const [code, name] of [['fr', 'Bouvreuil pivoine'], ['de', 'Gimpel'], ['es', 'Camachuelo común']]) {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'names', code + '.json'), 'utf8'));
    assert.equal(f.count, avilist.species.length, code + ' is out of step with avilist.json: rebuild with tools/build-names.js');
    assert.equal(f.names[bull], name);
  }
});
