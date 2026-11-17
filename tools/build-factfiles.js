// Builds the data behind the bird fact files and the sticker icons.
//
//   docs/data/ranges.json    AviList's written range for every species ("Breeds in…"),
//                            loaded only when a fact file is first opened.
//   docs/data/stickers.json  which species have a sticker, the pinned web address
//                            of the full-size stickers, the credit, and the few
//                            Bird Album page names that can't be worked out.
//   docs/stickers/*.webp     a 96-pixel thumbnail of every sticker, for the icons.
//
// Stickers: huashu-bird-sticker by Huashu (https://github.com/alchaincyf/huashu-bird-sticker),
// CC BY 4.0, AI-generated illustrations. Pinned to one commit, so they can't
// change under the site. To rebuild, download that commit's stickers into
// private/stickers/full/ (see README: "Stickers and fact files"), then run:
//   node tools/build-factfiles.js private/avilist/<AviList file>.xlsx
// Needs `cwebp` (Google's WebP tool) for the thumbnails.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { readSheet, sheetNames } = require('./read-xlsx');

const STICKERS = {
  commit: '3b42ef839501b93166e578075c4ea97adb4c4fa5',   // huashu-bird-sticker v2.3.6, 16 Nov 2026
  version: '2.3.6',
  repo: 'https://github.com/alchaincyf/huashu-bird-sticker',
  THUMB: 96,                                           // pixels: crisp at icon size on high-resolution screens
};

const root = path.join(__dirname, '..');
const file = process.argv[2];
if (!file) { console.error('Usage: node tools/build-factfiles.js <AviList .xlsx>'); process.exit(1); }

// ---------- 1. AviList range text ----------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'LifeList.gs'), 'utf8'), ctx, { filename: 'LifeList.gs' });
const sheet = Object.keys(sheetNames(file)).find(n => /^avilist/i.test(n)) || Object.keys(sheetNames(file))[0];
const species = vm.runInContext('parseAviList_', ctx)(readSheet(file, sheet));
const ranges = {};
species.forEach(s => {
  // The species' own range, or its subspecies' ranges where AviList gives those instead
  const text = s.range || s.sspRanges.map(x => x.name + ': ' + x.range).join(' · ');
  if (text) ranges[s.sci] = text.length > 1200 ? text.slice(0, 1200) + ' …' : text;
});
const avilist = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/avilist.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'docs/data/ranges.json'), JSON.stringify({
  source: avilist.citation, licence: 'CC BY 4.0', ranges,
}) + '\n');
console.log('Ranges: ' + Object.keys(ranges).length + ' species, ' + Math.round(fs.statSync(path.join(root, 'docs/data/ranges.json')).size / 1024) + ' KB');

// ---------- 2. Sticker index ----------
const index = JSON.parse(fs.readFileSync(path.join(root, 'private/stickers/stickers.json'), 'utf8'));
if (index.version !== STICKERS.version) throw new Error('private/stickers/stickers.json is version ' + index.version + ', expected ' + STICKERS.version);
const bySci = new Map(index.stickers.map(s => [s.scientificName, s]));
// The full sticker's path is stickers/<Order>/<Family>/<Genus_species>.webp, worked out from
// AviList on the website; checked here for every species, so a mismatch stops the build.
const stickerPath_ = (order, family, sci) => 'stickers/' + order + '/' + family + '/' + sci.replace(/ /g, '_') + '.webp';
// Bird Album pages are named from the English name; only the exceptions are stored.
const pageSlug_ = en => en.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const none = [], pages = {};
avilist.species.forEach(r => {
  const [sci, common] = r;
  const fam = avilist.families[r[3]];
  const s = bySci.get(sci);
  if (!s) { none.push(sci); return; }
  if (s.file !== stickerPath_(avilist.orders[fam[2]], fam[0], sci)) throw new Error('Unexpected sticker path for ' + sci + ': ' + s.file);
  const slug = s.page ? s.page.replace(/^https:\/\/birdalbum\.com\/birds\/|\/$/g, '') : null;
  if (slug !== pageSlug_(s.en || common)) pages[sci] = slug;      // null: no Bird Album page
});
fs.writeFileSync(path.join(root, 'docs/data/stickers.json'), JSON.stringify({
  source: 'huashu-bird-sticker v' + STICKERS.version + ' by Huashu, ' + STICKERS.repo,
  licence: 'CC BY 4.0',
  credit: 'Illustration: Bird Album / huashu-bird-sticker, CC BY 4.0',
  note: 'AI-generated illustrations, not checked by experts; they may contain errors.',
  cdn: 'https://cdn.jsdelivr.net/gh/alchaincyf/huashu-bird-sticker@' + STICKERS.commit + '/',
  none, pages,
}, null, 1) + '\n');
console.log('Stickers: ' + (avilist.species.length - none.length) + ' of ' + avilist.species.length + ' AviList species; ' +
  none.length + ' without; ' + Object.keys(pages).length + ' Bird Album page exceptions');

// ---------- 3. Thumbnails ----------
const outDir = path.join(root, 'docs/stickers');
fs.mkdirSync(outDir, { recursive: true });
let made = 0, kept = 0, bytes = 0;
const missing = [];
const inAvilist = new Set(avilist.species.map(r => r[0]));
index.stickers.forEach(s => {
  if (!inAvilist.has(s.scientificName)) return;
  const src = path.join(root, 'private/stickers/full', s.file);
  const out = path.join(outDir, s.scientificName.replace(/ /g, '_') + '.webp');
  if (!fs.existsSync(src)) { missing.push(s.file); return; }
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) { kept++; bytes += fs.statSync(out).size; return; }
  execFileSync('cwebp', ['-quiet', '-q', '72', '-alpha_q', '70', '-m', '6', '-resize', String(STICKERS.THUMB), '0', src, '-o', out]);
  made++; bytes += fs.statSync(out).size;
});
console.log('Thumbnails: ' + made + ' made, ' + kept + ' already up to date, ' + (bytes / 1048576).toFixed(1) + ' MB in all');
if (missing.length) { console.error(missing.length + ' downloaded stickers missing, e.g. ' + missing.slice(0, 3).join(', ')); process.exit(1); }
