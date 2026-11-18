// Builds docs/data/other-names.json: for the AviList species that GBIF doesn't know by their
// AviList scientific name, the name GBIF does use, or the species they were recently split from.
//
// Why: checklists disagree on names. AviList 2026 has moved some species to new genera (Musk
// Lorikeet: Trichoglossus concinnus, where GBIF and BirdLife say Glossopsitta concinna), and split
// others that GBIF still treats as one species (Little Heron is still filed under Striated Heron,
// Butorides striata). Without this, those fact files have no range map.
//
// For each living species, it asks GBIF's species match for the AviList name (exactly as the page
// does). For the ~3% GBIF doesn't know, it tries, in order:
//   1. BIRDBASE's names for the same species in other checklists (BirdLife, IOC, eBird/Clements),
//      using only names that belong to this one species (a name shared by several AviList species
//      is a split, not a renaming).
//   2. GBIF's own list of the family: a species with the same second name (allowing for Latin
//      gender endings: pusillus / pusilla), if there's exactly one and no AviList species already
//      has that name. A moved genus keeps its second name (Fringillaria capensis = Emberiza capensis).
//   3. GBIF's subspecies in the family: if GBIF has the bird as a subspecies (Butorides striata
//      atricapilla), it's a recent split, and the species named is the one it was split from.
// Every renaming found is checked with GBIF's strict match before it is kept.
//
// The page uses "renamed" to ask GBIF under the other name, and "splitFrom" to explain an
// empty map. tools/build-traits.js uses "renamed" to find AVONET's measurements.
//
// Needs internet (GBIF's public API, no key) and private/traits/BIRDBASE v2025.1.xlsx. Every GBIF
// answer is cached in private/gbif-names-cache.json, so a second run is quick:
//   node tools/build-other-names.js

const fs = require('node:fs');
const path = require('node:path');
const { readSheet } = require('./read-xlsx');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'docs/data/other-names.json');
const CACHE = path.join(root, 'private/gbif-names-cache.json');
const BIRDBASE_FILE = path.join(root, 'private/traits/BIRDBASE v2025.1.xlsx');
const API = 'https://api.gbif.org/v1/';
const BACKBONE = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';     // GBIF's backbone taxonomy

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A GBIF API answer, cached. */
async function gbif(url) {
  if (url in cache) return cache[url];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(API + url);
      if (!res.ok) throw new Error('GBIF ' + res.status);
      return (cache[url] = await res.json());
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

/** GBIF's key for a species name, by the same strict match the page uses (null if none). */
async function speciesKey(name) {
  const m = await gbif('species/match?rank=SPECIES&strict=true&name=' + encodeURIComponent(name));
  if (m && m.usageKey && m.rank === 'SPECIES' && m.matchType === 'EXACT') return m.acceptedUsageKey || m.usageKey;
  // Asked as a bird: some names are also plants or insects (Chloris chloris, the greenfinch, is also a grass)
  const b = await birdMatch(name);
  return b && b.matchType === 'EXACT' ? (b.acceptedUsageKey || b.usageKey) : null;
}
const birdMatch = async name => {
  const m = await gbif('species/match?rank=SPECIES&strict=true&kingdom=Animalia&class=Aves&name=' + encodeURIComponent(name));
  return m && m.usageKey && m.rank === 'SPECIES' ? m : null;
};

/** Letters to change to turn one name into another. */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** Every accepted name of one rank in a GBIF family (the backbone), as scientific names without authors. */
async function familyNames(familyKey, rank) {
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await gbif('species/search?datasetKey=' + BACKBONE + '&highertaxonKey=' + familyKey + '&rank=' + rank +
      '&status=ACCEPTED&limit=1000&offset=' + offset);
    page.results.forEach(r => names.push(r.canonicalName));
    if (page.endOfRecords || !page.results.length) break;
  }
  return names.filter(Boolean);
}

/** The second name without its Latin ending, so pusillus, pusilla and pusillum compare equal. */
const stem = epithet => String(epithet).toLowerCase().replace(/(us|um|a|is|e|er|ra|rum)$/, '');

/** Runs fn over items, a few at a time. */
async function pool(items, n, fn) {
  const queue = items.slice();
  let done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) {
      await fn(queue.shift());
      if (++done % 1000 === 0) { saveCache(); console.log('  ' + done + ' of ' + items.length); }
    }
  }));
}

async function main() {
  const avilist = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/avilist.json'), 'utf8'));
  const living = avilist.species.filter(s => !s[7]);
  const aviNames = new Set(avilist.species.map(s => s[0]));

  console.log('Checking ' + living.length + ' AviList names with GBIF…');
  const unknown = [];
  await pool(living, 6, async s => { if (!(await speciesKey(s[0]))) unknown.push(s); });
  saveCache();
  console.log(unknown.length + ' not known to GBIF by their AviList name.');

  // BIRDBASE: each species' names in other checklists, and how many species use each name
  if (!fs.existsSync(BIRDBASE_FILE)) throw new Error('needs ' + path.relative(root, BIRDBASE_FILE));
  const rows = readSheet(BIRDBASE_FILE, 'Data'), head = rows[1];
  const avCol = head.indexOf('AviList v1 2025');
  const cols = ['HBW/BirdLife International (v9.1)', 'IOC World Bird List (v15.1)', 'eBird/Clements (V2024b)',
    'Latin (BirdLife > IOC > Clements>AviList)'].map(c => head.indexOf(c));
  const otherNames = new Map(), uses = new Map();
  rows.slice(2).forEach(r => {
    const names = [...new Set(cols.map(c => String(r[c] || '').trim()).filter(n => /^[A-Z][a-z]+ [a-z-]+$/.test(n)))];
    otherNames.set(String(r[avCol]).trim(), names);
    names.forEach(n => uses.set(n, (uses.get(n) || 0) + 1));
  });

  const renamed = {}, splitFrom = {}, how = { spelling: 0, birdbase: 0, family: 0, split: 0, splitBirdbase: 0, none: 0 };
  const familyKeys = new Map();
  for (const s of unknown.sort((a, b) => a[3] - b[3])) {
    const sci = s[0], [genus, epithet] = sci.split(' ');
    // 0. A spelling difference (habroptilus / habroptila, rueppelli / rueppellii): GBIF's near match,
    //    if it's in the same genus, a couple of letters away, and not another AviList species
    const near = await birdMatch(sci);
    if (near && near.matchType === 'FUZZY' && near.canonicalName && near.canonicalName.split(' ')[0] === genus &&
        editDistance(near.canonicalName, sci) <= 2 && !aviNames.has(near.canonicalName)) {
      renamed[sci] = near.canonicalName; how.spelling++; continue;
    }
    // 1. BIRDBASE's other names that belong to this species alone
    const mine = (otherNames.get(sci) || []).filter(n => n !== sci && uses.get(n) === 1 && !aviNames.has(n));
    let found = null;
    for (const n of mine) if (await speciesKey(n)) { found = n; break; }
    if (found) { renamed[sci] = found; how.birdbase++; continue; }

    // 2 and 3: GBIF's own lists for the family
    const family = avilist.families[s[3]][0];
    if (!familyKeys.has(family)) familyKeys.set(family, await speciesKeyOfFamily(family));
    const fk = familyKeys.get(family);
    if (fk) {
      const sameStem = n => stem(n.split(' ').pop()) === stem(epithet);
      const species = (await familyNames(fk, 'SPECIES')).filter(n => n !== sci && sameStem(n) && !aviNames.has(n));
      // Same second name in the same family isn't proof (Myophonus flavirostris, a whistling thrush, isn't
      // Humblotia flavirostris, Humblot's Flycatcher), so GBIF's English name must be the same kind of bird
      if (species.length === 1) {
        const key = await speciesKey(species[0]);
        if (key && await sameKindOfBird(key, s[1])) { renamed[sci] = species[0]; how.family++; continue; }
      }
      // A subspecies "Genus species epithet" with this bird's second name; not a nominate subspecies
      // ("Rhyacornis fuliginosa fuliginosa" is just that species itself)
      const subs = (await familyNames(fk, 'SUBSPECIES')).filter(n => {
        const w = n.split(' ');
        return w.length === 3 && w[1] !== w[2] && sameStem(n);
      });
      const parents = [...new Set(subs.map(n => n.split(' ').slice(0, 2).join(' ')))].filter(p => p !== sci);
      const parent = parents.length === 1 ? parents[0] : parents.filter(p => p.startsWith(genus + ' ')).length === 1 ? parents.find(p => p.startsWith(genus + ' ')) : null;
      if (parent && await speciesKey(parent)) { splitFrom[sci] = parent; how.split++; continue; }
    }
    // 4. BIRDBASE: a name this species shares with others is the one it was split from
    const shared = (otherNames.get(sci) || []).filter(n => n !== sci && uses.get(n) > 1);
    if (shared.length && await speciesKey(shared[0])) { splitFrom[sci] = shared[0]; how.splitBirdbase++; continue; }
    how.none++;
  }
  saveCache();

  fs.writeFileSync(OUT, JSON.stringify({
    source: 'Names GBIF uses for AviList ' + avilist.version + ' species it does not know by their AviList name: from BIRDBASE v2025.1 ' +
      '(Şekercioğlu et al., CC BY 4.0) and the GBIF Backbone Taxonomy. "renamed": the same species under another name; ' +
      '"splitFrom": a recent split, still filed under the species named.',
    built: new Date().toISOString().slice(0, 10), renamed, splitFrom,
  }, null, 1) + '\n');
  const common = Object.fromEntries(avilist.species.map(s => [s[0], s[1]]));
  console.log('Renamed: ' + Object.keys(renamed).length + ' (' + how.spelling + ' spelling, ' + how.birdbase + ' via BIRDBASE, ' + how.family + ' from GBIF\'s family list); ' +
    'split: ' + Object.keys(splitFrom).length + ' (' + how.split + ' via GBIF subspecies, ' + how.splitBirdbase + ' via BIRDBASE); not found: ' + how.none);
  console.log('e.g. ' + Object.entries(renamed).slice(0, 4).map(([a, b]) => common[a] + ': ' + b).join('; ') + '; ' +
    Object.entries(splitFrom).slice(0, 4).map(([a, b]) => common[a] + ' split from ' + (common[b] || b)).join('; '));
  console.log('Wrote ' + path.relative(root, OUT));
}

/**
 * Whether one of GBIF's English names for a species is the same kind of bird as the AviList
 * name: its last word ("Cape Bunting" and "Cape Bunting"; "Grey Emutail" and "Grey Emu-tail").
 */
async function sameKindOfBird(key, common) {
  const words = n => { const w = n.toLowerCase().split(/[\s]+/).pop(); return [w, ...w.split('-'), w.replace(/-/g, '')]; };
  const kind = words(common)[0].replace(/-/g, '');
  const v = await gbif('species/' + key + '/vernacularNames?limit=200');
  return (v.results || []).filter(r => r.language === 'eng').some(r => {
    const all = r.vernacularName.toLowerCase().split(/\s+/).flatMap(w => [w, ...w.split('-'), w.replace(/-/g, '')]);
    return all.includes(kind) || all.includes(kind.replace(/s$/, ''));
  });
}

/** GBIF's key for a bird family. */
async function speciesKeyOfFamily(family) {
  const m = await gbif('species/match?rank=FAMILY&strict=true&class=Aves&name=' + encodeURIComponent(family));
  return m && m.rank === 'FAMILY' && m.matchType === 'EXACT' ? m.usageKey : null;
}

main().catch(e => { saveCache(); console.error('Stopped: ' + e.message + ' (run again to carry on)'); process.exit(1); });
