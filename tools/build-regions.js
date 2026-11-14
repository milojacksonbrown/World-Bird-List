// Makes docs/data/regions/<CC>.json: the outlines of each country's states,
// provinces or regions, keyed by the codes eBird uses in its "State/Province"
// column (e.g. AU-VIC, TH-50, GB-ENG, FR-ARA), so the world map can zoom into
// a country and shade the regions you've birded.
//
// Source: Natural Earth 1:10m admin-1 states and provinces, v5.1.2 (public
// domain). Too big for jsDelivr, so download it from GitHub:
//   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson
// Then run from the repo folder:
//   node tools/build-regions.js <path to the .geojson>
//
// eBird mostly uses ISO 3166-2 codes, which Natural Earth records, but for a
// few countries at a different level, so the outlines are grouped to match:
//   - United Kingdom: its four nations (GB-ENG, GB-SCT, GB-WLS, GB-NIR)
//   - countries with official groupings in Natural Earth (France's regions,
//     FR-ARA ...): both the parts and the groups are written
//   - Ireland's four provinces and Indonesia's seven island groups: from the
//     small tables below, which Natural Earth doesn't record
// A group is drawn as its parts (same shade, no lines between), so no
// polygon merging is needed.
//
// Outlines are simplified (Douglas-Peucker), more for bigger countries, and
// rounded: plenty for a map the size of the dashboard's.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Detail scales with the country's size, since a big country is seen zoomed out:
// about 0.5 km for small countries, up to about 5 km for Russia or Canada. Checked
// against real sightings: coarser outlines cut off the beaches and headlands
// where people go birding.
const DETAIL = { perDegree: 1 / 2000, min: 0.004, max: 0.05 };   // tolerance = country width x perDegree
const toleranceFor = extentDeg => Math.min(DETAIL.max, Math.max(DETAIL.min, extentDeg * DETAIL.perDegree));

const GB_NATIONS = { England: ['GB-ENG', 'England'], Scotland: ['GB-SCT', 'Scotland'], Wales: ['GB-WLS', 'Wales'], 'Northern Ireland': ['GB-NIR', 'Northern Ireland'] };

// Ireland: county (ISO 3166-2) -> province
const IE_PROVINCES = {
  'IE-C': ['Connacht', 'G', 'LM', 'MO', 'RN', 'SO'],
  'IE-L': ['Leinster', 'CW', 'D', 'DL-NONE', 'KE', 'KK', 'LS', 'LD', 'LH', 'MH', 'OY', 'WH', 'WX', 'WW'],
  'IE-M': ['Munster', 'CE', 'CO', 'KY', 'LK', 'TA', 'WD'],
  'IE-U': ['Ulster (Ireland)', 'CN', 'DL', 'MN'],
};
// Indonesia: province (ISO 3166-2) -> geographical unit
const ID_UNITS = {
  'ID-JW': ['Java', 'BT', 'JB', 'JK', 'JI', 'JT', 'YO'],
  'ID-KA': ['Kalimantan', 'KB', 'KI', 'KS', 'KT', 'KU'],
  'ID-ML': ['Maluku', 'MA', 'MU'],
  'ID-NU': ['Nusa Tenggara', 'BA', 'NB', 'NT'],
  'ID-PP': ['Western New Guinea', 'PA', 'PB', 'PD', 'PE', 'PS', 'PT'],
  'ID-SL': ['Sulawesi', 'GO', 'SA', 'SG', 'SN', 'SR', 'ST'],
  'ID-SM': ['Sumatra', 'AC', 'BB', 'BE', 'JA', 'KR', 'LA', 'RI', 'SB', 'SS', 'SU'],
};
const groupOf = table => {
  const out = {};
  Object.entries(table).forEach(([code, [, ...parts]]) => parts.forEach(p => { out[code.slice(0, 3) + p] = code; }));
  return out;
};
const IE_GROUP = groupOf(IE_PROVINCES), ID_GROUP = groupOf(ID_UNITS);

// ---------- geometry ----------
let round = n => Math.round(n * 1000) / 1000;      // set per country in build()
function dp(pts, tol) {                            // Douglas-Peucker line simplification
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return dp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(dp(pts.slice(idx), tol));
}
/** A closed ring's ends are the same point, so split it at the point farthest from the start and simplify each half. */
function dpRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 0, k = 0;
  ring.forEach(([x, y], i) => { const d = Math.hypot(x - x0, y - y0); if (d > far) { far = d; k = i; } });
  if (k === 0) return ring;
  return dp(ring.slice(0, k + 1), tol).slice(0, -1).concat(dp(ring.slice(k), tol));
}
const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
function simplifyPolygon(rings, tol) {
  const out = [];
  rings.forEach((ring, i) => {
    if (area(ring) < tol * tol) return;              // an island or hole too small to see
    const s = dpRing(ring, tol).map(([x, y]) => [round(x), round(y)]);
    if (s.length >= 4) out.push(s);
  });
  return out.length ? out : null;
}
function simplify(geom, tol) {
  return polygonsOf(geom).map(rings => simplifyPolygon(rings, tol)).filter(Boolean);    // a MultiPolygon's coordinates
}
const polygonsOf = geom => geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

/** Width of a country in degrees of longitude, from its features (ignoring the antimeridian wrap). */
function extentOf(features) {
  let lo = 180, hi = -180;
  features.forEach(f => polygonsOf(f.geometry).forEach(poly => poly[0].forEach(([x]) => { lo = Math.min(lo, x); hi = Math.max(hi, x); })));
  return Math.max(0, hi - lo);
}

// ---------- build ----------
function build(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byCountry = {};
  // group: true for a grouping of smaller regions (France's regions, Ireland's provinces,
  // Indonesia's island groups), so the map can draw one level at a time
  // inGroup: for a part (county, département...), the group it belongs to, so the map
  // can match eBird's County column within that group
  const add = (cc, code, name, polys, group, inGroup) => {
    if (!polys.length) return;
    const c = byCountry[cc] = byCountry[cc] || {};
    const r = c[code] = c[code] || { name, polys: [], group: !!group, in: inGroup || '', pieces: 0 };
    r.polys.push(...polys);
    r.pieces++;
  };
  const groups = {};
  g.features.forEach(f => { const cc = f.properties.iso_a2; if (/^[A-Z]{2}$/.test(cc || '')) (groups[cc] = groups[cc] || []).push(f); });
  const tolOf = {};
  Object.entries(groups).forEach(([cc, fs]) => { tolOf[cc] = toleranceFor(extentOf(fs)); });
  g.features.forEach(f => {
    const p = Object.assign({}, f.properties), cc = p.iso_a2;
    if (!cc || !tolOf[cc]) return;
    ['iso_3166_2', 'region_cod', 'region', 'name', 'geonunit'].forEach(k => { if (typeof p[k] === 'string') p[k] = p[k].trim(); });   // the source has stray tabs
    round = tolOf[cc] >= 0.03 ? n => Math.round(n * 100) / 100 : n => Math.round(n * 1000) / 1000;
    const polys = simplify(f.geometry, tolOf[cc]);
    const code = p.iso_3166_2 && /^[A-Z]{2}-/.test(p.iso_3166_2) ? p.iso_3166_2 : null;
    if (cc === 'GB') {                                   // eBird: the four nations, then counties
      const n = GB_NATIONS[p.geonunit];
      if (!n) return;
      add(cc, n[0], n[1], polys, true);                  // a group of counties
      if (p.region === 'Greater London') add(cc, 'GB-LND', 'London', polys, false, n[0]);   // eBird's "London": all 33 boroughs
      else if (code) add(cc, code, p.name, polys, false, n[0]);
      return;
    }
    const groupCode = (p.region_cod && /^[A-Z]{2}-/.test(p.region_cod) && p.region_cod !== code) ? p.region_cod
      : cc === 'IE' ? IE_GROUP[code] : cc === 'ID' ? ID_GROUP[code] : '';
    if (code) add(cc, code, p.name, polys, false, groupCode);
    if (groupCode) {
      const groupName = cc === 'IE' ? IE_PROVINCES[groupCode][0] : cc === 'ID' ? ID_UNITS[groupCode][0] : (p.region || groupCode);
      add(cc, groupCode, groupName, polys, true);
    }
  });
  const dir = path.join(root, 'docs', 'data', 'regions');
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  Object.entries(byCountry).sort().forEach(([cc, regions]) => {
    const out = { source: 'Natural Earth 1:10m admin-1 states and provinces, v5.1.2 (public domain), simplified', country: cc, regions: {} };
    Object.keys(regions).sort().forEach(code => {
      const r = regions[code];
      out.regions[code] = r.group ? { name: r.name, group: true, polys: r.polys }
        : r.in ? Object.assign({ name: r.name, in: r.in }, r.pieces > 1 ? { whole: true } : {}, { polys: r.polys })   // whole: built from pieces (London's boroughs)
        : { name: r.name, polys: r.polys };
    });
    const text = JSON.stringify(out);
    fs.writeFileSync(path.join(dir, cc + '.json'), text);
    total += text.length;
  });
  console.log('Wrote ' + Object.keys(byCountry).length + ' countries to docs/data/regions/ (' + Math.round(total / 1024) + ' KB in all)');
  return byCountry;
}

module.exports = { build };
if (require.main === module) {
  if (!process.argv[2]) { console.error('Usage: node tools/build-regions.js <admin-1 .geojson>'); process.exit(1); }
  build(process.argv[2]);
}
