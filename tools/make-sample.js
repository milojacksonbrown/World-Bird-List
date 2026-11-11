// Makes the website's "Try with sample data" file from an eBird export,
// keeping only the columns the dashboard needs. Checklist comments,
// observation details, counts, observer numbers and so on are dropped,
// because they can contain other people's names and private notes.
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

const KEEP = ['Submission ID', 'Common Name', 'Scientific Name', 'State/Province', 'Location ID', 'Location', 'Latitude', 'Longitude', 'Date', 'Time'];
const idx = KEEP.map(h => rows[0].indexOf(h));
const missing = KEEP.filter((h, i) => idx[i] < 0);
if (missing.length) { console.error('Missing columns: ' + missing.join(', ')); process.exit(1); }

const csv = v => /[",\n\r]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const out = [KEEP, ...rows.slice(1).map(r => idx.map(i => r[i] || ''))].map(r => r.map(csv).join(',')).join('\n') + '\n';

const outFile = path.join(root, 'docs', 'data', 'sample-ebird.csv');
fs.writeFileSync(outFile, out);
console.log('Wrote ' + (rows.length - 1) + ' records with columns: ' + KEEP.join(', ') + ' -> docs/data/sample-ebird.csv');
