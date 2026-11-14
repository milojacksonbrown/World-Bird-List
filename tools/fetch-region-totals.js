// Fetches how many bird species have ever been recorded in each country,
// state/province and (for the UK, France, Ireland and Indonesia) county, from
// eBird's API, and saves just those counts to docs/data/region-totals.json.
// The map's country view uses them to show "% of the species recorded there".
//
// Needs your own free eBird API key (https://ebird.org/api/keygen). It is read
// from the environment and never written anywhere. Run from the repo folder:
//   EBIRD_API_KEY=your-key node tools/fetch-region-totals.js
// Optional: only some countries, e.g.  ... node tools/fetch-region-totals.js AU,GB,TH
//
// About 4,300 requests for the whole world, one at a time (an hour or more: it
// paces itself and waits out eBird's "slow down" replies). Leave it running.
// Every answer is cached in private/ebird-api-cache.json (git-ignored), so an
// interrupted run carries on where it stopped and a re-run is quick.
// Counts are species only (eBird category "species"): no "sp.", hybrids or forms.
// Data: eBird, Cornell Lab of Ornithology (https://ebird.org), used with credit.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const KEY = process.env.EBIRD_API_KEY;
const API = 'https://api.ebird.org/v2/';
const COUNTY_COUNTRIES = ['GB', 'FR', 'IE', 'ID'];     // where the map draws counties
// Pacing: one request at a time. eBird answers "too many requests" (429) when
// pushed; then everything pauses and the pace slows, speeding up again after
// a run of successes.
const PACE = { start: 800, fastest: 600, slowest: 8000, pauseAfter429: 30000, giveUpAfter: 30 };
const cacheFile = path.join(root, 'private', 'ebird-api-cache.json');

if (!KEY) {
  console.error('No key. Get a free one at https://ebird.org/api/keygen, then run:\n  EBIRD_API_KEY=your-key node tools/fetch-region-totals.js');
  process.exit(1);
}

let cache = {};
try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { cache = {}; }
const saveCache = () => { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let gap = PACE.start, nextAt = 0, refusedInARow = 0, okInARow = 0;

/** One API call, cached and paced. The key goes in a header, never the URL. */
async function get(route) {
  if (cache[route] !== undefined) return cache[route];
  for (;;) {
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + gap;
    const res = await fetch(API + route, { headers: { 'X-eBirdApiToken': KEY } });
    if (res.status === 401 || res.status === 403) throw new Error('eBird refused the key (HTTP ' + res.status + '). Check it at https://ebird.org/api/keygen');
    if (res.status === 404 || res.status === 400) { cache[route] = null; return null; }
    if (res.ok) {
      refusedInARow = 0;
      if (++okInARow >= 50) { gap = Math.max(PACE.fastest, Math.round(gap * 0.9)); okInARow = 0; }   // going well: a little faster
      cache[route] = await res.json();
      return cache[route];
    }
    // Too many requests (429) or busy (5xx): pause everything, then go slower
    okInARow = 0;
    if (++refusedInARow >= PACE.giveUpAfter) {
      throw new Error('eBird keeps refusing (HTTP ' + res.status + '), which suggests a daily limit. Run the tool again later: it carries on where it stopped.');
    }
    gap = Math.min(PACE.slowest, Math.round(gap * 1.5));
    const asked = Number(res.headers.get('retry-after')) * 1000 || 0;
    const pause = Math.max(asked, res.status === 429 ? PACE.pauseAfter429 : 5000);
    nextAt = Date.now() + pause;
    console.log('  eBird says ' + (res.status === 429 ? 'slow down' : 'busy (' + res.status + ')') + ': pausing ' + Math.round(pause / 1000) +
      ' s, then one request every ' + (gap / 1000).toFixed(1) + ' s');
  }
}

/** Run `fn` over `items`, one at a time, with progress. */
async function eachLimited(items, fn, label) {
  let done = 0;
  for (const item of items) {
    await fn(item);
    if (++done % 100 === 0 || done === items.length) {
      console.log('  ' + label + ': ' + done + ' of ' + items.length + (done % 500 === 0 ? ' (' + new Date().toLocaleTimeString() + ')' : ''));
      saveCache();
    }
  }
}

async function main() {
  // eBird's taxonomy: which codes are full species
  console.log('Loading the eBird taxonomy…');
  const taxonomy = await get('ref/taxonomy/ebird?fmt=json');
  const isSpecies = new Set(taxonomy.filter(t => t.category === 'species').map(t => t.speciesCode));
  const speciesIn = list => (list || []).filter(code => isSpecies.has(code)).length;

  const only = process.argv[2] ? process.argv[2].toUpperCase().split(',') : null;
  const countries = (await get('ref/region/list/country/world')).filter(c => !only || only.includes(c.code));
  console.log(countries.length + ' countries');

  const regions = {}, counties = {};
  const sub1 = [];
  await eachLimited(countries, async c => {
    regions[c.code] = speciesIn(await get('product/spplist/' + c.code));
    const subs = (await get('ref/region/list/subnational1/' + c.code)) || [];
    subs.forEach(s => sub1.push({ code: s.code, name: s.name, cc: c.code }));
  }, 'countries');

  await eachLimited(sub1, async s => { regions[s.code] = speciesIn(await get('product/spplist/' + s.code)); }, 'states and provinces');

  const sub2 = [];
  await eachLimited(sub1.filter(s => COUNTY_COUNTRIES.includes(s.cc)), async s => {
    ((await get('ref/region/list/subnational2/' + s.code)) || []).forEach(c => sub2.push({ code: c.code, name: c.name, parent: s.code }));
  }, 'county lists');
  // Keyed like the eBird export's columns: "GB-ENG|North Yorkshire" (State/Province | County)
  await eachLimited(sub2, async c => { counties[c.parent + '|' + c.name] = speciesIn(await get('product/spplist/' + c.code)); }, 'counties');
  saveCache();

  const file = path.join(root, 'docs', 'data', 'region-totals.json');
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { }
  const out = {
    source: 'eBird (Cornell Lab of Ornithology), species ever recorded per region, via the eBird API',
    fetched: new Date().toISOString().slice(0, 10),
    regions: Object.assign({}, previous.regions, regions),     // a partial run adds to the last one
    counties: Object.assign({}, previous.counties, counties),
  };
  fs.writeFileSync(file, JSON.stringify(out));
  console.log('Saved ' + Object.keys(out.regions).length + ' regions and ' + Object.keys(out.counties).length +
    ' counties to docs/data/region-totals.json (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
}

main().catch(e => { saveCache(); console.error(e.message); process.exit(1); });
