/**
 * ============================================================================
 *  DASHBOARD DATA  —  turns an eBird export into the dashboard's numbers
 * ============================================================================
 *  Pure functions: plain values in, plain values out, no page or Google code,
 *  so they can be tested with `node --test`. They reuse the eBird functions
 *  from LifeList.gs (loaded before this file), so the website and the
 *  spreadsheet match names in exactly the same way.
 */

// Regions that "Worldwide" species count towards (not seas or Antarctica)
const LAND_REGIONS_ = ['Europe', 'Asia', 'Africa', 'N America', 'Middle America', 'S America', 'Australasia', 'Pacific Is.'];
const THREATENED_ = /^(VU|EN|CR)\b/;    // includes "CR (PE)" and "CR (PEW)"

/**
 * Unpacks the compact avilist.json into species records and a matching index.
 * @param {Object} data  the parsed avilist.json
 */
function loadChecklist_(data) {
  const F = data.fields.reduce((o, f, i) => (o[f] = i, o), {});
  const species = data.species.map((r, i) => {
    const fam = data.families[r[F.family]];
    return {
      i, sci: r[F.sci], common: r[F.common], alt: r[F.alt],
      family: fam[0], familyEn: fam[1], order: data.orders[fam[2]],
      iucn: r[F.iucn], code: r[F.code], extinct: !!r[F.extinct],
      regions: data.regions.filter((_, b) => r[F.regions] & (1 << b)),
    };
  });
  // Same index as applyEbird_ in LifeList.gs: scientific name, then common and other names
  const bySci = new Map(), byCommon = new Map();
  species.forEach(s => {
    bySci.set(s.sci.toLowerCase(), s.i);
    [s.common].concat(String(s.alt || '').split(';')).forEach(nm => {
      const k = normCommon_(nm);
      if (k && !byCommon.has(k)) byCommon.set(k, s.i);
    });
  });
  return { version: data.version, citation: data.citation, licence: data.licence, regions: data.regions, species, bySci, byCommon };
}

// ---------------------------------------------------------------------------
//  Countries on the map -> AviList regions
// ---------------------------------------------------------------------------
// Follows the range summariser in LifeList.gs (REGION_TABLE), so a country's
// colour agrees with the species counts: New Guinea and Wallacea are
// Australasia; the Solomons, Vanuatu, New Caledonia and Fiji are Pacific Is.
const COUNTRY_REGION_OVERRIDES_ = {
  PG: 'Australasia', TL: 'Australasia',
  SB: 'Pacific Is.', VU: 'Pacific Is.', NC: 'Pacific Is.', FJ: 'Pacific Is.',
  TF: 'Antarctic',
};

/** Two-letter country code from Natural Earth properties (a few have "-99" in ISO_A2). */
function countryCode_(p) {
  const c = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
  return c && c !== '-99' ? c : '';
}

/**
 * Which AviList region a country on the map belongs to.
 * One region per country: countries spanning two (Russia, Egypt, Indonesia)
 * go by Natural Earth's continent.
 * @param {{ISO_A2:string, ISO_A2_EH:string, CONTINENT:string, SUBREGION:string}} p  Natural Earth properties
 */
function regionForCountry_(p) {
  const override = COUNTRY_REGION_OVERRIDES_[countryCode_(p)];
  if (override) return override;
  switch (p.CONTINENT) {
    case 'Europe': return 'Europe';
    case 'Asia': return 'Asia';
    case 'Africa': return 'Africa';
    case 'South America': return 'S America';
    case 'Antarctica': return 'Antarctic';
    case 'North America': return /Central America|Caribbean/.test(p.SUBREGION) ? 'Middle America' : 'N America';
    case 'Oceania': return /Micronesia|Polynesia/.test(p.SUBREGION) ? 'Pacific Is.' : 'Australasia';
    default: return '';
  }
}

/**
 * Every species recorded (lifer or not) and every checklist, by year and by
 * month of the year (all years together). Checklists show how much birding
 * was done, so busy months can be told apart from birdy months.
 * Checklists count any dated record, even "sp." or unmatched names.
 */
function activityByDate_(rows, index) {
  const out = { speciesPerYear: {}, speciesPerMonth: Array(12).fill(0), checklistsPerYear: {}, checklistsPerMonth: Array(12).fill(0) };
  if (!rows || rows.length < 2) return out;
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const col = { sci: H.indexOf('scientific name'), common: H.indexOf('common name'), date: H.indexOf('date'), sub: H.indexOf('submission id') };
  if (col.sci < 0 || col.date < 0) return out;
  const yearSp = {}, yearCl = {};
  const monthSp = Array.from({ length: 12 }, () => new Set()), monthCl = Array.from({ length: 12 }, () => new Set());
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseEbirdDate_(r[col.date]);
    if (!date) continue;
    const y = date.getFullYear(), m = date.getMonth();
    const sub = col.sub >= 0 ? String(r[col.sub] || '').trim() : '';
    if (sub) { (yearCl[y] = yearCl[y] || new Set()).add(sub); monthCl[m].add(sub); }
    const sci = String(r[col.sci] || '').trim();
    if (!sci) continue;
    const res = resolveEbirdName_(sci, col.common >= 0 ? String(r[col.common] || '').trim() : '', index);
    if (res.skip || res.target === undefined || res.target === null) continue;
    (yearSp[y] = yearSp[y] || new Set()).add(res.target);
    monthSp[m].add(res.target);
  }
  Object.keys(yearSp).forEach(y => { out.speciesPerYear[y] = yearSp[y].size; });
  Object.keys(yearCl).forEach(y => { out.checklistsPerYear[y] = yearCl[y].size; });
  out.speciesPerMonth = monthSp.map(s => s.size);
  out.checklistsPerMonth = monthCl.map(s => s.size);
  return out;
}

/** Does this species count towards this region? */
function inRegion_(s, region) {
  return s.regions.includes(region) || (s.regions.includes('Worldwide') && LAND_REGIONS_.includes(region));
}

/**
 * Works out everything the dashboard shows.
 * @param {Array[]} rows  the eBird CSV as rows (header first), e.g. from parseCsvText_
 * @param {Object} checklist  from loadChecklist_
 * @param {Map<string,string>} [fixes]  eBird scientific name (lower case) -> AviList scientific name or 'IGNORE'
 */
function buildDashboard_(rows, checklist, fixes) {
  const index = { bySci: checklist.bySci, byCommon: checklist.byCommon, fixes: fixes || new Map() };
  const ebird = summariseEbird_(rows, index);                       // first sightings + unmatched names
  const familyOf = checklist.species.map(s => s.family);
  const places = summariseLocations_(rows, index, familyOf);        // countries and places

  const seen = [...ebird.bySpecies.keys()].map(i => checklist.species[i]);
  const living = checklist.species.filter(s => !s.extinct);
  const count = (list, key) => new Set(list.map(s => s[key])).size;

  // Lifers: every species seen, with its first sighting, newest first
  const lifers = [...ebird.bySpecies.entries()].map(([i, x]) => {
    const s = checklist.species[i];
    return { sci: s.sci, common: s.common, family: s.familyEn || s.family, date: x.date || null, place: x.loc || '', checklist: x.sub || '' };
  }).sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));

  // Lifers per year, and per month of the year (all Januaries together…) for seasonality
  const perYear = {};
  const perMonth = Array(12).fill(0);
  lifers.forEach(l => {
    if (!l.date) return;
    const y = l.date.getFullYear();
    perYear[y] = (perYear[y] || 0) + 1;
    perMonth[l.date.getMonth()]++;
  });

  const activity = activityByDate_(rows, index);

  const regions = checklist.regions.filter(r => r !== 'Worldwide').map(r => {
    const total = living.filter(s => inRegion_(s, r)).length;
    const n = seen.filter(s => !s.extinct && inRegion_(s, r)).length;
    return { name: r, seen: n, total, pct: total ? n / total : 0 };
  });

  return {
    totals: {
      species: seen.length,
      worldSpecies: living.length,
      worldPct: living.length ? seen.filter(s => !s.extinct).length / living.length : 0,
      families: count(seen, 'family'), worldFamilies: count(living, 'family'),
      orders: count(seen, 'order'), worldOrders: count(living, 'order'),
      countries: places.countries.size,
      threatened: seen.filter(s => THREATENED_.test(s.iucn)).length,
      records: Math.max(rows.length - 1, 0),
      skipped: ebird.skipped,
    },
    lifers,
    perYear,
    perMonth,
    speciesPerYear: activity.speciesPerYear,
    speciesPerMonth: activity.speciesPerMonth,
    checklistsPerYear: activity.checklistsPerYear,
    checklistsPerMonth: activity.checklistsPerMonth,
    regions,
    unmatched: [...ebird.unmatched.values()].sort((a, b) => b.n - a.n),
    countries: [...places.countries.values()].map(c => ({ code: c.code, species: c.species.size }))
      .sort((a, b) => b.species - a.species),
  };
}
