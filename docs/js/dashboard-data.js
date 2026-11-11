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

  const perYear = {};
  lifers.forEach(l => { if (l.date) { const y = l.date.getFullYear(); perYear[y] = (perYear[y] || 0) + 1; } });

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
    regions,
    unmatched: [...ebird.unmatched.values()].sort((a, b) => b.n - a.n),
    countries: [...places.countries.values()].map(c => ({ code: c.code, species: c.species.size }))
      .sort((a, b) => b.species - a.species),
  };
}
