// Makes docs/data/countries.json: each country's two-letter code, its name,
// other names people use for it, and the AviList region it counts towards.
// The "Ask your list" question tool uses it, so questions can name countries
// ("what have I seen in Kenya?") and regions ("countries in Africa").
//
// The source is Natural Earth's countries file (public domain), at the same
// pinned release as the map, but the more detailed 1:50m version so small
// countries such as Singapore are included:
//   https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_admin_0_countries.geojson
// Download it, then run from the repo folder:
//   node tools/build-countries.js <path to the .geojson>

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

// Everyday names Natural Earth doesn't list
const EXTRA_NAMES = {
  GB: ['UK', 'Britain', 'Great Britain'], US: ['USA', 'US', 'United States'], AE: ['UAE'],
  CZ: ['Czech Republic'], CI: ['Ivory Coast'], MM: ['Burma'], NL: ['Holland'], TR: ['Turkey'],
};

// Reuse the website's own rules for which region a country belongs to
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'docs', 'js', 'dashboard-data.js'), 'utf8'), ctx);
const countryCode_ = vm.runInContext('countryCode_', ctx);
const regionForCountry_ = vm.runInContext('regionForCountry_', ctx);

function build(geojsonPath) {
  const g = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const out = {};
  g.features.forEach(f => {
    const p = f.properties;
    const code = countryCode_(p);
    if (!code || out[code]) return;
    const names = [p.NAME, p.NAME_LONG, p.NAME_EN, p.BRK_NAME, p.FORMAL_EN, p.NAME_ALT].concat(EXTRA_NAMES[code] || [])
      .filter(n => n && typeof n === 'string');
    const unique = [...new Set(names)];
    out[code] = [unique[0], regionForCountry_(p)].concat(unique.slice(1));
  });
  const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
  const file = path.join(root, 'docs', 'data', 'countries.json');
  fs.writeFileSync(file, JSON.stringify({
    source: 'Natural Earth 1:50m admin 0 countries, v5.1.2 (public domain)',
    fields: ['name', 'region', '...other names'],
    countries: sorted,
  }) + '\n');
  console.log('Wrote ' + Object.keys(sorted).length + ' countries to ' + path.relative(root, file));
}

if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: node tools/build-countries.js <countries .geojson>'); process.exit(1); }
  build(process.argv[2]);
}
