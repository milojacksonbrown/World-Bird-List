// parseAviList_ must read both AviList heading styles (v2025 and v2026).
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'LifeList.gs'), 'utf8'), ctx, { filename: 'LifeList.gs' });
const parseAviList = vm.runInContext('parseAviList_', ctx);

// A tiny made-up slice: one order, one family, one species with one subspecies
const body = style => {
  const v26 = style === 'v2026';
  return [
    [1, 'order', 'Passeriformes', '', 'Passeriformes', 'Perching Birds', '', '', 'Global', '', ''],
    [2, 'family', 'Passeriformes', 'Corvidae', 'Corvidae', v26 ? 'Crows, Jays, and Magpies' : '', '', '', '', '', ''],
    [3, 'species', 'Passeriformes', 'Corvidae', 'Corvus corone', 'Carrion Crow', 'Carrion Crow', 'Carrion Crow',
      'Western Europe to Japan', '', 'LC'],
    [4, 'subspecies', 'Passeriformes', 'Corvidae', 'Corvus corone cornix', 'Hooded Crow', '', '', 'N Europe', '', ''],
  ].map(r => v26 ? r : [...r, 'Crows, Jays, and Magpies']);
};

test('parseAviList_ reads the v2025 heading style', () => {
  const H = ['Sequence', 'Taxon_rank', 'Order', 'Family', 'Scientific_name', 'English_name_AviList',
    'English_name_Clements_v2024', 'English_name_BirdLife_v9', 'Range', 'Extinct_or_possibly_extinct', 'IUCN_Red_List_Category',
    'Family_English_name'];
  const sp = parseAviList([['AviList v2025'], H, ...body('v2025')]);   // v2025 files have a title row first
  assert.equal(sp.length, 1);
  assert.equal(sp[0].sci, 'Corvus corone');
  assert.equal(sp[0].familyEn, 'Crows, Jays, and Magpies');
});

test('parseAviList_ reads the v2026 heading style, taking family names from family rows', () => {
  const H = ['#', 'RANK', 'ORDER', 'FAMILY', 'SCIENTIFIC NAME', 'ENGLISH NAME: AVILIST',
    'ENGLISH NAME: CLEMENTS v2026', 'ENGLISH NAME: BIRDLIFE v10', 'RANGE', 'EXTINCTION STATUS', 'IUCN RED LIST CATEGORY'];
  const sp = parseAviList([H, ...body('v2026')]);
  assert.equal(sp.length, 1);
  const s = sp[0];
  assert.equal(s.sci, 'Corvus corone');
  assert.equal(s.common, 'Carrion Crow');
  assert.equal(s.family, 'Corvidae');
  assert.equal(s.familyEn, 'Crows, Jays, and Magpies');
  assert.equal(s.order, 'Passeriformes');
  assert.equal(s.iucn, 'LC');
  assert.equal(s.seq, 3);
  assert.ok(s.regionSet.has('Europe'));
});

test('parseAviList_ explains clearly when there is no rank column', () => {
  assert.throws(() => parseAviList([['Name', 'Range'], ['x', 'y']]), /rank column/);
});
