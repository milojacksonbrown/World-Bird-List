// Makes the website's "Try with sample data" file from an eBird export,
// keeping only the columns the dashboard needs. Checklist comments,
// observation details, counts, observer numbers and so on are dropped,
// because they can contain other people's names and private notes.
// Dropped-pin locations are blurred to about 1 km and checklist IDs replaced
// (see "Privacy" below), because the file is public.
//
//   node tools/make-sample.js private/ebird/MyEBirdData.csv

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/make-sample.js <MyEBirdData.csv>'); process.exit(1); }

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'LifeList.gs'), 'utf8'), ctx);
const rows = vm.runInContext('parseCsvText_', ctx)(fs.readFileSync(file, 'utf8'));

const KEEP = ['Submission ID', 'Common Name', 'Scientific Name', 'State/Province', 'County', 'Location ID', 'Location', 'Latitude', 'Longitude', 'Date', 'Time'];
const idx = KEEP.map(h => rows[0].indexOf(h));
const missing = KEEP.filter((h, i) => idx[i] < 0);
if (missing.length) { console.error('Missing columns: ' + missing.join(', ')); process.exit(1); }

// ---- Privacy: the file is public, so blur anything that pinpoints a home or stay ----
// 1. Dropped pins. eBird names a pin after the nearest address, e.g.
//    "19 Victoria Street, Coburg, Victoria, AU (-37.743, 144.965)". Keep the
//    suburb and region, drop house numbers and road names, and round the
//    coordinates to 2 decimal places (about 1 km). Named hotspots are kept.
const PIN = /\s*\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)\s*$/;
const ROADISH = /\d|\b(road|rd|street|st|avenue|ave|lane|highway|freeway|drive|way|close|court|terrace|jalan|thanon|soi)\b/i;
function blurPin(name) {
  if (!PIN.test(name)) return null;
  const parts = name.replace(PIN, '').split(',').map(x => x.trim()).filter(Boolean);
  const kept = parts.filter(x => !ROADISH.test(x));
  return (kept.length ? kept : parts.slice(-1)).join(', ') + ' (approx.)';
}
// 2. Checklist IDs. eBird checklists are public and show their exact location,
//    so real IDs would lead straight to it. Each checklist gets a made-up ID
//    instead, which still tells checklists apart (the page only links real "S…" IDs).
const subIds = new Map();
const fakeSub = s => { if (!subIds.has(s)) subIds.set(s, 'sample-' + (subIds.size + 1)); return subIds.get(s); };

const locIds = new Map();
const fakeLoc = l => { if (!locIds.has(l)) locIds.set(l, 'sample-pin-' + (locIds.size + 1)); return locIds.get(l); };

const I = name => KEEP.indexOf(name);
let blurred = 0;
const body = rows.slice(1).map(r => {
  const out = idx.map(i => r[i] || '');
  out[I('Submission ID')] = fakeSub(out[I('Submission ID')]);
  const pin = blurPin(out[I('Location')]);
  if (pin) {
    blurred++;
    out[I('Location')] = pin;
    out[I('Location ID')] = fakeLoc(out[I('Location ID')]);
    out[I('Latitude')] = Number(out[I('Latitude')]).toFixed(2);
    out[I('Longitude')] = Number(out[I('Longitude')]).toFixed(2);
  }
  return out;
});

const csv = v => /[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const out = [KEEP, ...body].map(r => r.map(csv).join(',')).join('\n') + '\n';

const outFile = path.join(root, 'docs', 'data', 'sample-ebird.csv');
fs.writeFileSync(outFile, out);
console.log('Wrote ' + (rows.length - 1) + ' records with columns: ' + KEEP.join(', ') + ' -> docs/data/sample-ebird.csv');
console.log('Blurred ' + blurred + ' records at dropped pins; ' + subIds.size + ' checklists given made-up IDs.');
