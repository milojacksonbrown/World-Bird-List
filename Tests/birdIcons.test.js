// Tests for the body-shape silhouettes (docs/js/bird-icons.js).
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'bird-icons.js'), 'utf8'), ctx, { filename: 'bird-icons.js' });
const run = expr => vm.runInContext(expr, ctx);
const shapeOf = (family, order) => { ctx.F = family; ctx.O = order; return run('birdShape_(F, O)'); };
const SHAPES = run('SHAPES');

test('every AviList family and order has a drawn shape (no family falls back by accident)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'avilist.json'), 'utf8'));
  const ORDER_SHAPE = run('ORDER_SHAPE_');
  const missingOrders = data.orders.filter(o => !ORDER_SHAPE[o]);
  assert.deepEqual(missingOrders, [], 'orders with no shape: ' + missingOrders.join(', '));
  data.families.forEach(([family, , o]) => {
    const shape = shapeOf(family, data.orders[o]);
    assert.ok(SHAPES[shape], family + ' maps to "' + shape + '", which has no drawing');
  });
});

test('every family override names a real family and a real shape', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'avilist.json'), 'utf8'));
  const families = new Set(data.families.map(f => f[0]));
  const FAMILY_SHAPE = run('FAMILY_SHAPE_');
  Object.entries(FAMILY_SHAPE).forEach(([family, shape]) => {
    assert.ok(families.has(family), family + ' is not an AviList family (typo, or renamed in a new edition?)');
    assert.ok(SHAPES[shape], family + ' maps to unknown shape "' + shape + '"');
  });
});

test('families that look unlike their order get their own shape', () => {
  assert.equal(shapeOf('Ardeidae', 'Pelecaniformes'), 'heron');
  assert.equal(shapeOf('Threskiornithidae', 'Pelecaniformes'), 'ibis');
  assert.equal(shapeOf('Laridae', 'Charadriiformes'), 'gull');
  assert.equal(shapeOf('Scolopacidae', 'Charadriiformes'), 'wader');
  assert.equal(shapeOf('Corvidae', 'Passeriformes'), 'crow');
  assert.equal(shapeOf('Fringillidae', 'Passeriformes'), 'finch');
  assert.equal(shapeOf('Turdidae', 'Passeriformes'), 'songbird');
  assert.equal(shapeOf('Trochilidae', 'Apodiformes'), 'hummingbird');
  assert.equal(shapeOf('Apodidae', 'Apodiformes'), 'swift');
  assert.equal(shapeOf('Unknownidae', 'Unknowniformes'), 'songbird');    // a future family still gets an icon
});

test('each shape draws a small decorative SVG with a label', () => {
  Object.keys(SHAPES).forEach(k => {
    ctx.K = k;
    const svg = run('birdIconSvg_(K, 26)');
    assert.match(svg, /^<svg class="bird-icon" viewBox="0 0 24 24" width="26" height="26"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.ok(!/NaN|undefined/.test(svg), k + ' has a broken number');
    assert.ok(SHAPES[k].label, k + ' has no label');
  });
  assert.equal(run('birdIconSvg_("nonsense")'), run('birdIconSvg_("songbird")'));
});

// ---------- habitat drawings (docs/js/habitat-icons.js) ----------

test('every habitat in the trait data has a drawing, and drawings are well formed', () => {
  const hctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'habitat-icons.js'), 'utf8'), hctx, { filename: 'habitat-icons.js' });
  const ICONS = vm.runInContext('HABITAT_ICONS_', hctx);
  const traits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'traits.json'), 'utf8'));
  const missing = traits.values.habitat.filter(h => !ICONS[h]);
  assert.deepEqual(missing, [], 'habitats with no drawing: ' + missing.join(', '));
  hctx.H = 'Forest';
  const svg = vm.runInContext('habitatIconSvg_(H, 20)', hctx);
  assert.match(svg, /^<svg class="habitat-icon"[^>]*width="20"[^>]*>.*<\/svg>$/);
  assert.equal(vm.runInContext('habitatIconSvg_("Moon", 20)', hctx), '');
});

test('every nest type in the trait data has a drawing, except "No nest" and "Other bird\'s nest"', () => {
  const nctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'nest-icons.js'), 'utf8'), nctx, { filename: 'nest-icons.js' });
  const ICONS = vm.runInContext('NEST_ICONS_', nctx);
  const traits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'traits.json'), 'utf8'));
  const NONE = ['No nest', "Other bird's nest"];
  const missing = traits.values.nest.filter(n => !ICONS[n] && !NONE.includes(n));
  assert.deepEqual(missing, [], 'nest types with no drawing: ' + missing.join(', '));
  NONE.forEach(n => assert.equal(vm.runInContext('nestIconSvg_(' + JSON.stringify(n) + ', 20)', nctx), ''));
  assert.match(vm.runInContext('nestIconSvg_("Cup", 20)', nctx), /^<svg class="nest-icon"[^>]*width="20"[^>]*>.*<\/svg>$/);
});
