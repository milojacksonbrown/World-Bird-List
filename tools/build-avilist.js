// Converts the AviList "Extended" .xlsx into the compact data file the web
// dashboard loads (docs/data/avilist.json).
//
// Run from the repo folder:
//   node tools/build-avilist.js private/avilist/<AviList file>.xlsx v2026
//
// It reuses parseAviList_() from LifeList.gs, so the website reads AviList
// exactly as the spreadsheet does (including the region summaries).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSheet, sheetNames } = require('./read-xlsx');

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.error('Usage: node tools/build-avilist.js <AviList .xlsx> <version, e.g. v2026>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'LifeList.gs'), 'utf8'), ctx, { filename: 'LifeList.gs' });
const run = expr => vm.runInContext(expr, ctx);

// The checklist is the first sheet (named e.g. "AviList v2026")
const sheet = Object.keys(sheetNames(file)).find(n => /^avilist/i.test(n)) || Object.keys(sheetNames(file))[0];
const species = run('parseAviList_')(readSheet(file, sheet));

// Regions, as bits in one number: bit 0 = first region in REGION_ORDER, …
const REGIONS = [...run('REGION_ORDER'), 'Worldwide'];
const regionBits = set => REGIONS.reduce((bits, r, i) => (set.has(r) ? bits | (1 << i) : bits), 0);

// Orders and families stored once; species refer to them by position
const orders = [], orderIdx = new Map();
const families = [], familyIdx = new Map();
const rows = species.map(s => {
  if (!orderIdx.has(s.order)) { orderIdx.set(s.order, orders.length); orders.push(s.order); }
  if (!familyIdx.has(s.family)) { familyIdx.set(s.family, families.length); families.push([s.family, s.familyEn, orderIdx.get(s.order)]); }
  return [s.sci, s.common, s.alt, familyIdx.get(s.family), s.iucn, s.code, regionBits(s.regionSet), s.extinct ? 1 : 0, s.ssp.join(';'), regionBits(s.visitSet)];
});

const year = version.replace(/\D/g, '');
const out = {
  version,
  source: 'https://www.avilist.org/checklist/' + version + '/',
  citation: 'AviList Core Team. ' + year + '. AviList: The Global Avian Checklist, ' + version + '. https://doi.org/10.2173/avilist.' + version,
  licence: 'AviList: The Global Avian Checklist © ' + year + ' by AviList Core Team is licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
  changes: 'Converted from the Extended .xlsx to this compact file: species rows only (with the names of their subspecies), selected columns, breeding and non-breeding regions summarised from the range text (vagrants not included).',
  regions: REGIONS,
  orders,
  families,                                                     // [scientific, English, order index]
  fields: ['sci', 'common', 'alt', 'family', 'iucn', 'code', 'regions', 'extinct', 'ssp', 'visits'],   // regions: breeds in; ssp: subspecies names, ';'-separated; visits: found in outside the breeding season
  species: rows,
};

const outFile = path.join(root, 'docs', 'data', 'avilist.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));
const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log('AviList ' + version + ': ' + rows.length + ' species, ' + families.length + ' families, ' +
  orders.length + ' orders -> docs/data/avilist.json (' + kb + ' KB)');
console.log('Species with no breeding region found: ' + species.filter(s => !s.regionSet.size).length);
