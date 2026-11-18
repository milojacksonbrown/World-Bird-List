// Builds docs/data/explore-regions.json: every country, state/province and county with its
// eBird region code, for the Explore section's place picker (so the codes always match eBird's).
//
// Made from what tools/fetch-region-totals.js already saved: the region names in
// docs/data/region-totals.json, and eBird's county lists in private/ebird-api-cache.json.
// No key or internet needed:
//   node tools/build-explore-regions.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const totals = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/region-totals.json'), 'utf8'));
const cacheFile = path.join(root, 'private/ebird-api-cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

const byName = (a, b) => a[1].localeCompare(b[1]);
const countries = [], states = {}, counties = {};
Object.entries(totals.names).forEach(([code, name]) => {
  if (/^[A-Z]{2}$/.test(code)) countries.push([code, name]);
  else if (/^[A-Z]{2}-[A-Z0-9]+$/.test(code)) (states[code.slice(0, 2)] = states[code.slice(0, 2)] || []).push([code, name]);
});
Object.keys(cache).forEach(k => {
  const m = k.match(/^ref\/region\/list\/subnational2\/([A-Z]{2}-[A-Z0-9]+)$/);
  if (m && Array.isArray(cache[k]) && cache[k].length) counties[m[1]] = cache[k].map(r => [r.code, r.name]).sort(byName);
});
countries.sort(byName);
Object.values(states).forEach(list => list.sort(byName));

const out = { source: 'eBird region codes and names (Cornell Lab of Ornithology)', countries, states, counties };
fs.writeFileSync(path.join(root, 'docs/data/explore-regions.json'), JSON.stringify(out) + '\n');
console.log(countries.length + ' countries, ' + Object.values(states).flat().length + ' states/provinces, ' +
  Object.values(counties).flat().length + ' counties (in ' + Object.keys(counties).length + ' states); ' +
  Math.round(fs.statSync(path.join(root, 'docs/data/explore-regions.json')).size / 1024) + ' KB');
