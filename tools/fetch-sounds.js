// Fetches bird sound recordings' details from xeno-canto (https://xeno-canto.org) for every
// living AviList species, and writes docs/data/sounds.json for the fact files and sound quiz.
//
// Only the details are saved (the audio's web address, recordist, licence, type, country,
// length): the audio itself streams from xeno-canto when someone presses play.
//
// It needs your own xeno-canto API key (free, from your account page). Run:
//   node tools/fetch-sounds.js
// (or, to rewrite sounds.json from the saved answers without fetching: node tools/fetch-sounds.js --rebuild)
// Second pass: node tools/fetch-sounds.js --other-names  tries the species that found nothing under
// the scientific names other checklists use (IOC, eBird, BirdLife, from BIRDBASE): AviList has moved
// some species to new genera, and xeno-canto may still file them under the old name.
// and paste the key when asked: it isn't shown as you paste, and it is only kept in memory while
// this runs (never saved, never committed, never in the website, never in your shell history).
// (Or set XC_API_KEY in the environment first, and it won't ask.)
//
// Polite and resumable: one request at a time, about one a second, slowing down if xeno-canto
// says it's busy. Every answer is cached in private/xc-cache.json, so it can be stopped
// (Ctrl+C) and run again to carry on. It does the sample data's lifers first, then the rest.
// All ~11,000 species take about 3 hours. docs/data/sounds.json is rewritten as it goes.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let KEY = process.env.XC_API_KEY;

/** Asks for the key in the terminal without showing what's typed or pasted. */
function askForKey() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('run this in a terminal so it can ask for your key')); return; }
    process.stdout.write('Paste your xeno-canto API key and press Enter (it won\'t be shown): ');
    let key = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = chunk => {
      // Terminals may wrap pasted text in markers (ESC[200~ … ESC[201~): leave those out
      chunk = String(chunk).replace(/\u001b\[20[01]~/g, '');
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          if (!key.trim()) continue;                       // a line break before the key (e.g. copied with it): not Enter yet
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(key.trim()); return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }          // Ctrl+C
        if (ch === '\u007f' || ch === '\b') key = key.slice(0, -1);                    // Backspace
        else if (ch >= ' ') key += ch;                                                 // ignore other control characters
      }
    };
    stdin.on('data', onData);
  });
}
const CACHE = path.join(root, 'private/xc-cache.json');
const OUT = path.join(root, 'docs/data/sounds.json');
const API = 'https://xeno-canto.org/api/3/recordings';
const PAUSE_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

/** One xeno-canto search, as its list of recordings (waits and retries if asked to slow down). */
async function search(query) {
  let wait = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + '?query=' + encodeURIComponent(query) + '&key=' + encodeURIComponent(KEY));
    if (res.status === 429 || res.status >= 500) { console.log('  xeno-canto busy (' + res.status + '), waiting ' + wait / 1000 + ' s'); await sleep(wait); wait *= 2; continue; }
    const body = await res.json();
    if (body.error) throw new Error(body.message || body.error);
    return body.recordings || [];
  }
  throw new Error('xeno-canto kept saying it was busy; run again later to carry on');
}

const seconds = len => { const [m, s] = String(len || '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
const usable = r => r.file && !/restricted/i.test(r.file) && seconds(r.length) >= 3;
// Best first: quality A, then B…; a length that's easy to listen to (10 to 60 s); then the longest
const score = r => ('ABCDE'.indexOf(r.q) < 0 ? 5 : 'ABCDE'.indexOf(r.q)) * 1000 +
  (seconds(r.length) >= 10 && seconds(r.length) <= 60 ? 0 : 100) - Math.min(seconds(r.length), 60);

/** Up to two recordings: the best song and the best call (or the two best of whatever there is). */
function pick(recs) {
  const ok = recs.filter(usable).sort((a, b) => score(a) - score(b));
  const song = ok.find(r => /song/i.test(r.type));
  const call = ok.find(r => /call/i.test(r.type) && !/song/i.test(r.type) && r !== song);
  const chosen = [song, call].filter(Boolean);
  ok.forEach(r => { if (chosen.length < 2 && !chosen.includes(r)) chosen.push(r); });
  return chosen.map(r => ({
    id: r.id, type: /song/i.test(r.type) ? 'song' : /call/i.test(r.type) ? 'call' : String(r.type || 'sound').split(',')[0].trim().toLowerCase(),
    length: r.length, rec: r.rec, cnt: r.cnt, lic: String(r.lic || '').replace(/^\/\//, 'https://'),
    file: String(r.file).replace(/^\/\//, 'https://'),
  }));
}

// A recording is only used with a Creative Commons licence, so it can be credited properly
const licensed = r => /creativecommons\.org\/licenses\//.test(r.lic || '');

function writeOut() {
  const species = {};
  Object.keys(cache).sort().forEach(sci => { const recs = cache[sci].filter(licensed); if (recs.length) species[sci] = recs; });
  fs.writeFileSync(OUT, JSON.stringify({
    source: 'xeno-canto (https://xeno-canto.org): each recording by its recordist, under the Creative Commons licence given',
    fetched: new Date().toISOString().slice(0, 10), species,
  }) + '\n');
}

async function main() {
  // node tools/fetch-sounds.js --rebuild : rewrite docs/data/sounds.json from the saved answers (no key, no fetching)
  if (process.argv.includes('--rebuild')) { writeOut(); console.log('Rewrote ' + path.relative(root, OUT) + ' from ' + path.relative(root, CACHE)); return; }
  if (!KEY) KEY = await askForKey();
  if (!KEY) { console.error('No key given.'); process.exit(1); }
  const avilist = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/avilist.json'), 'utf8'));
  const living = avilist.species.filter(s => !s[7]).map(s => s[0]);
  if (process.argv.includes('--other-names')) return otherNames(living);
  // The sample data's lifers first, so the site can be tried before the whole run finishes
  const sample = new Set(fs.readFileSync(path.join(root, 'docs/data/sample-ebird.csv'), 'utf8').split('\n').slice(1)
    .map(l => (l.split(',')[2] || '').split(' ').slice(0, 2).join(' ')));
  const order = living.filter(s => sample.has(s)).concat(living.filter(s => !sample.has(s)));
  const todo = order.filter(s => !(s in cache));
  console.log(living.length + ' species; ' + (living.length - todo.length) + ' already done; ' + todo.length + ' to fetch (about ' + Math.ceil(todo.length * 1.1 / 60) + ' minutes).');
  let n = 0;
  for (const sci of todo) {
    let recs = await search('sp:"' + sci + '" q:A');
    if (recs.length < 2) { await sleep(PAUSE_MS); recs = recs.concat(await search('sp:"' + sci + '"')); }
    cache[sci] = pick(recs);
    if (++n % 25 === 0) { saveCache(); writeOut(); console.log('  ' + n + ' of ' + todo.length + ' (' + Object.values(cache).filter(v => v.length).length + ' species with sounds so far)'); }
    await sleep(PAUSE_MS);
  }
  saveCache(); writeOut();
  const withSounds = living.filter(s => (cache[s] || []).length).length;
  console.log('Done: ' + withSounds + ' of ' + living.length + ' living species have a recording. Wrote ' + path.relative(root, OUT));
}

/** The second pass: species with no recording, searched under their names in other checklists. */
async function otherNames(living) {
  const { readSheet } = require('./read-xlsx');
  const bbFile = path.join(root, 'private/traits/BIRDBASE v2025.1.xlsx');
  if (!fs.existsSync(bbFile)) throw new Error('needs ' + path.relative(root, bbFile) + ' for the other names');
  const rows = readSheet(bbFile, 'Data'), head = rows[1];
  const col = n => head.indexOf(n);
  const av = col('AviList v1 2025'), others = ['IOC World Bird List (v15.1)', 'eBird/Clements (V2024b)', 'HBW/BirdLife International (v9.1)', 'Latin (BirdLife > IOC > Clements>AviList)'].map(col);
  const altNames = new Map();
  rows.slice(2).forEach(r => {
    const names = [...new Set(others.map(c => String(r[c] || '').trim()).filter(n => n && n !== r[av] && /^[A-Z][a-z]+ [a-z-]+$/.test(n)))];
    if (names.length) altNames.set(r[av], names);
  });
  const triedFile = path.join(root, 'private/xc-other-names-tried.json');
  const tried = fs.existsSync(triedFile) ? JSON.parse(fs.readFileSync(triedFile, 'utf8')) : {};
  const todo = living.filter(s => !(cache[s] || []).some(licensed) && altNames.has(s) && !tried[s]);
  console.log(todo.length + ' species with no recording have another name to try (about ' + Math.ceil(todo.length * 2.2 / 60) + ' minutes).');
  let found = 0, n = 0;
  for (const sci of todo) {
    for (const alt of altNames.get(sci)) {
      let recs = await search('sp:"' + alt + '" q:A');
      if (recs.length < 2) { await sleep(PAUSE_MS); recs = recs.concat(await search('sp:"' + alt + '"')); }
      await sleep(PAUSE_MS);
      const picked = pick(recs).filter(licensed).map(r => Object.assign(r, { as: alt }));   // as: the name it was found under
      if (picked.length) { cache[sci] = picked; found++; break; }
    }
    tried[sci] = true;
    if (++n % 10 === 0) { saveCache(); fs.writeFileSync(triedFile, JSON.stringify(tried)); writeOut(); console.log('  ' + n + ' of ' + todo.length + ' (' + found + ' found)'); }
  }
  saveCache(); fs.writeFileSync(triedFile, JSON.stringify(tried)); writeOut();
  console.log('Done: found recordings for ' + found + ' more species. ' + living.filter(s => (cache[s] || []).some(licensed)).length + ' of ' + living.length + ' now have one.');
}

main().catch(e => { saveCache(); writeOut(); console.error('Stopped: ' + e.message + ' (run again to carry on)'); process.exit(1); });
