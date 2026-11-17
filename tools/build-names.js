// Builds bird names in other languages for the website: docs/data/names/<language>.json,
// plus docs/data/names/languages.json (the list for the language picker).
//
// Source: the IOC World Bird List v15.2 multilingual edition (Gill, Donsker & Rasmussen, eds;
// CC BY 3.0), as collected in huashu-bird-sticker (data/names.csv, pinned to the same commit as
// the stickers). Names are only given there for species whose boundaries are the same in IOC and
// AviList, so a few hundred recently split or merged species have English only.
//
// Each file is a list of names in the same order as docs/data/avilist.json's species ('' where
// there's no name), so it needs no scientific names and stays small. A test checks the order.
//
// Download names.csv and languages.json from the pinned commit into private/stickers/, then:
//   node tools/build-names.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const csvFile = path.join(root, 'private/stickers/names.csv');
if (!fs.existsSync(csvFile)) { console.error('Missing private/stickers/names.csv (see the top of this file).'); process.exit(1); }

// The language picker shows each language in English and in itself
const NATIVE = {
  ca: 'Català', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', hr: 'Hrvatski', cs: 'Čeština', da: 'Dansk', nl: 'Nederlands',
  eo: 'Esperanto', fi: 'Suomi', fr: 'Français', de: 'Deutsch', it: 'Italiano', ja: '日本語', lt: 'Lietuvių', no: 'Norsk',
  pl: 'Polski', 'pt-x-lusophone': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', ru: 'Русский', sr: 'Српски',
  sk: 'Slovenčina', es: 'Español', sv: 'Svenska', tr: 'Türkçe', uk: 'Українська', af: 'Afrikaans', ar: 'العربية',
  be: 'Беларуская', bg: 'Български', et: 'Eesti', 'fr-x-gaudin': 'Français (Gaudin)', el: 'Ελληνικά', he: 'עברית',
  hu: 'Magyar', is: 'Íslenska', 'id-ID': 'Bahasa Indonesia', ko: '한국어', lv: 'Latviešu', mk: 'Македонски',
  ml: 'മലയാളം', se: 'Davvisámegiella', fa: 'فارسی', ro: 'Română', sl: 'Slovenščina', th: 'ไทย',
};

/** A CSV file as rows of fields (quoted fields may contain commas). */
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.length > 1) rows.push(row); row = []; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, ''));
const head = rows[0], sciCol = head.indexOf('scientific_name');
const bySci = new Map(rows.slice(1).map(r => [r[sciCol], r]));
const iocNames = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(root, 'private/stickers/languages.json'), 'utf8')).map(l => [l.code, l.iocColumn]));
const avilist = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/avilist.json'), 'utf8'));

const outDir = path.join(root, 'docs/data/names');
fs.mkdirSync(outDir, { recursive: true });
const languages = [];
head.forEach((code, col) => {
  if (['id', 'scientific_name', 'en'].includes(code)) return;
  const names = avilist.species.map(s => ((bySci.get(s[0]) || [])[col] || '').trim());
  const have = names.filter(Boolean).length;
  if (!have) return;
  fs.writeFileSync(path.join(outDir, code + '.json'), JSON.stringify({ avilist: avilist.version, count: names.length, names }) + '\n');
  languages.push({ code, english: iocNames[code] || code, native: NATIVE[code] || '', names: have });
});
languages.sort((a, b) => a.english.localeCompare(b.english));
fs.writeFileSync(path.join(outDir, 'languages.json'), JSON.stringify({
  source: 'IOC World Bird List v15.2 (multilingual), Gill, F., D. Donsker & P. Rasmussen (Eds), CC BY 3.0, via huashu-bird-sticker',
  languages,
}, null, 1) + '\n');
const bytes = fs.readdirSync(outDir).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(languages.length + ' languages, ' + (bytes / 1048576).toFixed(1) + ' MB in all; e.g. ' +
  languages.filter(l => ['fr', 'es', 'de', 'ja'].includes(l.code)).map(l => l.english + ' ' + l.names).join(', '));
