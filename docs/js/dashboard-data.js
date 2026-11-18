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
      iucn: r[F.iucn], code: r[F.code], extinct: !!r[F.extinct], ssp: F.ssp === undefined ? '' : r[F.ssp] || '',
      regions: data.regions.filter((_, b) => r[F.regions] & (1 << b)),                          // breeds in
      visits: F.visits === undefined ? [] : data.regions.filter((_, b) => r[F.visits] & (1 << b)),  // winters in or passes through
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

/**
 * How often each species was recorded, and the firsts in each country, for
 * "Ask your list". One pass over the eBird rows, matching names exactly as
 * the lifer list does (resolveEbirdName_), and ordering by date and time as
 * summariseEbird_ does, so the "first" here agrees with the lifer list.
 * @return {{species: Object<number,{checklists:number, firstCountry:string, states:string[], counties:string[]}>,
 *           countries: Object<string,{firstVisit:Date, firstSpecies:number, lifers:number, firstLifer:?number, firstLiferDate:?Date}>,
 *           states: Object<string,Place>,     states: eBird's State/Province codes, e.g. AU-VIC
 *           counties: Object<string,Place>}}  counties: "GB-ENG|North Yorkshire" (state code | County column)
 *   Place = {species, lifers, firstVisit, firstSpecies, firstLifer, firstLiferDate}, as for countries.
 *   Keyed by species number and two-letter country code. (Counts of individual
 *   birds aren't used: most records are eBird's "X", seen but not counted.)
 */
function speciesStats_(rows, index) {
  const out = { species: {}, countries: {}, states: {}, counties: {} };
  if (!rows || rows.length < 2) return out;
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const col = {
    sci: H.indexOf('scientific name'), common: H.indexOf('common name'), date: H.indexOf('date'),
    time: H.indexOf('time'), state: H.indexOf('state/province'), sub: H.indexOf('submission id'), county: H.indexOf('county'),
    lat: H.indexOf('latitude'), lng: H.indexOf('longitude'),
  };
  if (col.sci < 0) return out;
  const subs = {}, firstOf = {};       // species -> Set of checklists; species -> earliest {key, date, cc, state}
  const stateSp = {};                  // state code (e.g. AU-VIC) -> Set of species
  const countySp = {};                 // "GB-ENG|North Yorkshire" -> Set of species
  const states = out.states;
  const firstIn = {};                  // state code or county key -> earliest {key, date, species}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sci = String(r[col.sci] || '').trim();
    if (!sci) continue;
    const res = resolveEbirdName_(sci, col.common >= 0 ? String(r[col.common] || '').trim() : '', index);
    if (res.skip || res.target === undefined || res.target === null) continue;
    const t = res.target;
    const st = out.species[t] || (out.species[t] = { checklists: 0, firstCountry: '', states: new Set(), counties: new Set(), points: new Map() });
    // Where it was seen, rounded to 0.1° (about 10 km), for the fact file's map
    const lat = col.lat >= 0 ? parseFloat(r[col.lat]) : NaN, lng = col.lng >= 0 ? parseFloat(r[col.lng]) : NaN;
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const p = [Math.round(lat * 10) / 10, Math.round(lng * 10) / 10];
      st.points.set(p.join(','), p);
    }
    const sub = col.sub >= 0 ? String(r[col.sub] || '').trim() : '';
    (subs[t] = subs[t] || new Set()).add(sub || 'row' + i);
    const state = String(col.state >= 0 ? r[col.state] : '').trim().toUpperCase();
    const county = col.county >= 0 ? String(r[col.county] || '').trim() : '';
    const isState = /^[A-Z]{2}-[A-Z0-9]+$/.test(state);
    if (isState) {
      (stateSp[state] = stateSp[state] || new Set()).add(t);
      st.states.add(state);
      if (county) { (countySp[state + '|' + county] = countySp[state + '|' + county] || new Set()).add(t); st.counties.add(state + '|' + county); }
    }
    const date = col.date >= 0 ? parseEbirdDate_(r[col.date]) : null;
    if (!date) continue;
    const key = date.getTime() + parseEbirdTime_(col.time >= 0 ? r[col.time] : '') * 60000;
    if (isState) {                                   // the first record in each state and county
      if (!firstIn[state] || key < firstIn[state].key) firstIn[state] = { key, date, species: t };
      const ck = state + '|' + county;
      if (county && (!firstIn[ck] || key < firstIn[ck].key)) firstIn[ck] = { key, date, species: t };
    }
    const cc = state.split('-')[0];
    if (!firstOf[t] || key < firstOf[t].key) firstOf[t] = { key, date, cc, state, county };
    if (/^[A-Z]{2}$/.test(cc)) {
      const c = out.countries[cc] || (out.countries[cc] = { key: Infinity, firstVisit: null, firstSpecies: null, lifers: 0, firstLifer: null, firstLiferDate: null, liferKey: Infinity });
      if (key < c.key) { c.key = key; c.firstVisit = date; c.firstSpecies = t; }
    }
  }
  // Each state and county: species, lifers gained there, first record and first lifer
  const place = (k, n) => ({ species: n, lifers: 0, firstVisit: firstIn[k] ? firstIn[k].date : null,
    firstSpecies: firstIn[k] ? Number(firstIn[k].species) : null, firstLifer: null, firstLiferDate: null, liferKey: Infinity });
  Object.keys(stateSp).forEach(code => { states[code] = place(code, stateSp[code].size); });
  Object.keys(countySp).forEach(k => { out.counties[k] = place(k, countySp[k].size); });
  const liferIn = (p, f, t) => {
    if (!p) return;
    p.lifers++;
    if (f.key < p.liferKey) { p.liferKey = f.key; p.firstLifer = Number(t); p.firstLiferDate = f.date; }
  };
  Object.keys(out.species).forEach(t => {
    const sp = out.species[t];
    sp.checklists = subs[t].size;
    sp.states = [...sp.states];                      // codes, e.g. "AU-VIC"
    sp.counties = [...sp.counties];                  // "AU-VIC|Melbourne"
    const f = firstOf[t];
    if (!f) return;
    sp.firstCountry = /^[A-Z]{2}$/.test(f.cc) ? f.cc : '';
    liferIn(out.states[f.state], f, t);                    // and in this state or province
    if (f.county) liferIn(out.counties[f.state + '|' + f.county], f, t);
    const c = out.countries[f.cc];                   // the lifer was gained in this country
    if (!c) return;
    c.lifers++;
    if (f.key < c.liferKey) { c.liferKey = f.key; c.firstLifer = Number(t); c.firstLiferDate = f.date; }
  });
  Object.values(out.countries).forEach(c => { delete c.key; delete c.liferKey; });
  Object.values(out.states).concat(Object.values(out.counties)).forEach(p => { delete p.liferKey; });
  return out;
}

/**
 * What to draw when the map zooms into one country, at the finest level the
 * visitor's data and the outlines both support:
 *   - counties, where eBird's State/Province codes are groups (the UK's
 *     nations, France's regions, Ireland's provinces, Indonesia's island
 *     groups) and the file has the parts: eBird's County column is matched to
 *     the parts by name, within each group (so "London" is London, England)
 *   - otherwise states or provinces, by code (AU-VIC, TH-50)
 * Each row carries the region's species total from eBird, when known.
 * @param {Object} file      a docs/data/regions/<CC>.json, or null if it didn't load
 * @param {Object} stats     from speciesStats_: {states, counties}
 * @param {string} cc        the country's two-letter code
 * @param {Object} [totals]  docs/data/region-totals.json: {regions: {code: n}, counties: {"GB-ENG|North Yorkshire": n}}
 * @return {{level: 'counties'|'regions', shapes: Array<{code, name, polys, group, species, lifers, total}>,
 *           unmapped: Array<{code, name, species, lifers, total}>}}  unmapped: birded places with no outline
 */
function countryRegions_(file, stats, cc, totals) {
  const regions = (file && file.regions) || {};
  const states = (stats && stats.states) || {}, counties = (stats && stats.counties) || {};
  const T = totals || {}, regionTotal = code => (T.regions && T.regions[code]) || null;
  const countyTotal = key => (T.counties && T.counties[key]) || null;
  const mine = Object.keys(states).filter(code => code.slice(0, 3) === cc + '-');
  const useGroups = mine.some(code => regions[code] && regions[code].group);
  const tidy = n => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  const myCounties = Object.keys(counties).filter(k => k.slice(0, 3) === cc + '-');
  const parts = Object.keys(regions).filter(code => regions[code].in);

  if (useGroups && parts.length && myCounties.length) {
    const byName = new Map(parts.map(code => [regions[code].in + '|' + tidy(regions[code].name), code]));
    const used = new Set();
    const shapes = parts.map(code => {
      const r = regions[code], key = Object.keys(counties).find(k => k.split('|')[0] === r.in && tidy(k.split('|')[1]) === tidy(r.name));
      if (key) used.add(key);
      const c = key ? counties[key] : null;
      return { code, name: r.name, polys: r.polys, group: !!r.whole, species: c ? c.species : 0, lifers: c ? c.lifers : 0,
               total: key ? countyTotal(key) : null };
    });
    const unmapped = myCounties.filter(k => !used.has(k) && !byName.has(k.split('|')[0] + '|' + tidy(k.split('|')[1])))
      .map(k => ({ code: k, name: k.split('|')[1], species: counties[k].species, lifers: counties[k].lifers, total: countyTotal(k) }));
    // Birding recorded only at the State/Province level (no County) is listed too
    mine.forEach(code => {
      const inCounties = myCounties.filter(k => k.split('|')[0] === code).length;
      if (!inCounties) unmapped.push({ code, name: regions[code] ? regions[code].name : code, species: states[code].species, lifers: states[code].lifers, total: regionTotal(code) });
    });
    return { level: 'counties', shapes, unmapped };
  }

  const shapes = Object.keys(regions).filter(code => !!regions[code].group === useGroups).map(code => ({
      code, name: regions[code].name, polys: regions[code].polys, group: !!regions[code].group,
      species: states[code] ? states[code].species : 0, lifers: states[code] ? states[code].lifers : 0, total: regionTotal(code),
    }));
  const drawn = new Set(shapes.map(s => s.code));
  const unmapped = mine.filter(code => !drawn.has(code))
    .map(code => ({ code, name: code, species: states[code].species, lifers: states[code].lifers, total: regionTotal(code) }));
  return { level: 'regions', shapes, unmapped };
}

// ---------------------------------------------------------------------------
//  Name Fixes on the website (uses NameFixesAssistant.js, loaded before this)
// ---------------------------------------------------------------------------

/** AviList species in the shape the string-matching functions expect. */
function speciesForMatching_(checklist) {
  return checklist.species.map(s => ({ row: s.i, sci: s.sci, common: s.common, alt: s.alt, ssp: s.ssp }));
}

/**
 * Turns Lyrebird's reply into the answer suggestionFromAnswer_ expects.
 * A "pick" is checked again here against the browser's own shortlist, so a
 * faulty or tampered Lyrebird still can't suggest something not on it.
 * @param {Object} reply  Lyrebird's JSON reply
 * @param {Array} shortlist  from prepareSuggestion_
 */
function answerFromLyrebird_(reply, shortlist) {
  if (!reply || !reply.ok) return { status: 'error', reason: (reply && reply.message) || 'no answer from the AI' };
  if (reply.status === 'none') return { status: 'none', reason: String(reply.reason || 'no reason given').slice(0, 200) };
  if (reply.status !== 'pick') return { status: 'invalid', reason: 'the AI\'s answer was not on the shortlist' };
  // A "pick" must name a candidate (1 or more); anything else is a broken reply, not "no match"
  if (!(Number(reply.choice) >= 1)) return { status: 'invalid', reason: 'Lyrebird\'s reply did not say which candidate' };
  return parseAiAnswer_(JSON.stringify({ choice: reply.choice, reason: reply.reason }), shortlist);
}

/** How a species appears in the search box's suggestions, e.g. "Carrion Crow (Corvus corone)". */
function searchLabel_(s) {
  return (s.common ? s.common + ' (' + s.sci + ')' : s.sci);
}

/**
 * Finds the AviList species someone typed in the search box: the
 * "Common Name (Scientific name)" form from the suggestions, a scientific
 * name, or a common or other name. Returns null rather than guessing.
 * @return {Object|null}  a species from loadChecklist_
 */
function findSpecies_(checklist, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const inBrackets = t.match(/\(([^()]+)\)\s*$/);
  const tries = inBrackets ? [inBrackets[1], t.replace(/\s*\([^()]*\)\s*$/, '')] : [t];
  for (const x of tries) {
    let i = checklist.bySci.get(x.trim().toLowerCase());
    if (i === undefined) i = checklist.byCommon.get(normCommon_(x));
    if (i !== undefined) return checklist.species[i];
  }
  return null;
}

/**
 * Lifers matching a search: common name, scientific name or family, ignoring
 * capitals, accents and punctuation (so "ruppell" finds "Rüppell's Vulture").
 * An empty search returns every lifer. Keeps the newest-first order.
 */
function filterLifers_(lifers, text) {
  // apostrophes removed (Rüppell's -> ruppells), other punctuation becomes a space
  const tidy = s => normalise_(s).replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = tidy(text);
  if (!q) return lifers;
  return lifers.filter(l => [l.common, l.sci, l.family].some(f => tidy(f).includes(q)));
}

/**
 * Does this species count towards this region? Yes if it breeds there or
 * regularly visits (winters or passes through on migration), as AviList's
 * range text describes. Vagrants aren't counted: the range text rarely lists them.
 */
function inRegion_(s, region) {
  const has = r => s.regions.includes(r) || (s.visits || []).includes(r);
  return has(region) || (has('Worldwide') && LAND_REGIONS_.includes(region));
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
    return { i, sci: s.sci, common: s.common, family: s.familyEn || s.family, familyLatin: s.family, order: s.order,
             date: x.date || null, place: x.loc || '', checklist: x.sub || '' };
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
  const stats = speciesStats_(rows, index);          // for "Ask your list"

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
    // For "Ask your list": checklist counts per species, and firsts per country
    stats,
    // For "Ask your list": the countries each species was recorded in (species number -> codes)
    speciesCountries: [...places.countries.values()].reduce((m, c) => {
      c.species.forEach(i => { (m[i] = m[i] || []).push(c.code); });
      return m;
    }, {}),
  };
}

// ---------------------------------------------------------------------------
//  Ask your list (uses AskYourList.js, loaded before this)
// ---------------------------------------------------------------------------

/**
 * Unpacks countries.json (made by tools/build-countries.js).
 * @return {{byCode: Object<string,{name:string, region:string}>, names: Object<string,string>}}
 *   names: every name a country is known by (tidied) -> its usual name, e.g. "uk" -> "United Kingdom"
 */
function loadCountries_(data) {
  const byCode = {}, names = {};
  Object.keys((data && data.countries) || {}).forEach(code => {
    const [name, region, ...others] = data.countries[code];
    byCode[code] = { name, region };
    [name].concat(others).forEach(n => { names[askTidy_(n)] = name; });
  });
  return { byCode, names };
}

/** A date as YYYY-MM-DD, in the visitor's own time zone (as the lifers list shows it). */
function isoDay_(d) {
  return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : null;
}

/**
 * The visitor's list as the tables questions are run on (see ASK_TABLES_).
 * Families and orders are worked out from the species rows by runQuery_.
 * @param {Object} d  from buildDashboard_
 * @param {Object} checklist  from loadChecklist_
 * @param {Object} [countries]  from loadCountries_; without it, countries show as codes
 * @param {Object} [totals]  docs/data/region-totals.json: state names and eBird's species totals;
 *   without it, states show as codes (AU-VIC) and "% seen" is empty
 */
function askData_(d, checklist, countries, totals, traits) {
  const TR = traits || new Map();
  const C = countries || { byCode: {}, names: {} };
  const countryName = code => (C.byCode[code] && C.byCode[code].name) || code;
  const T = totals || {};
  const stateName = code => (T.names && T.names[code]) || code;
  const placeName = k => k.includes('|') ? k.split('|')[1] : stateName(k);    // a county key, or a state code
  const pctOf = (n, of) => of ? Math.min(100, Math.round(1000 * n / of) / 10) : null;
  const firsts = new Map(d.lifers.map(l => [l.i, l]));
  const st = (d.stats && d.stats.species) || {}, cst = (d.stats && d.stats.countries) || {};
  const nameOf = i => (i === null || i === undefined) ? null : checklist.species[i].common || checklist.species[i].sci;
  const species = checklist.species.map(s => {
    const l = firsts.get(s.i);
    return {
      common: s.common, scientific: s.sci, family: s.familyEn || s.family, familyLatin: s.family, order: s.order,
      iucn: String(s.iucn || '').split(' ')[0], threatened: THREATENED_.test(s.iucn), extinct: s.extinct,
      seen: !!l,
      firstSeen: l ? isoDay_(l.date) : null,
      firstYear: l && l.date ? l.date.getFullYear() : null,
      firstMonth: l && l.date ? l.date.getMonth() + 1 : null,
      firstPlace: l ? l.place : null,
      firstCountry: st[s.i] && st[s.i].firstCountry ? countryName(st[s.i].firstCountry) : null,
      checklists: st[s.i] ? st[s.i].checklists : 0,
      countries: (d.speciesCountries[s.i] || []).map(countryName),
      places: st[s.i] ? [...new Set((st[s.i].states || []).concat(st[s.i].counties || []).map(placeName))] : [],
      // "Worldwide" species count towards every land region, as on the region bars
      regions: checklist.regions.filter(r => r !== 'Worldwide' && inRegion_(s, r)),
      ...traitFields_(TR.get(s.sci)),
    };
  });
  const years = [...new Set(Object.keys(d.perYear).concat(Object.keys(d.speciesPerYear), Object.keys(d.checklistsPerYear)))]
    .map(Number).sort((a, b) => a - b)
    .map(y => ({ year: y, lifers: d.perYear[y] || 0, species: d.speciesPerYear[y] || 0, checklists: d.checklistsPerYear[y] || 0 }));
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const months = MONTH_NAMES.map((name, m) => ({
    month: m + 1, name, lifers: d.perMonth[m], species: d.speciesPerMonth[m], checklists: d.checklistsPerMonth[m],
  }));
  return {
    species,
    countries: d.countries.map(c => {
      const f = cst[c.code] || {};
      return {
        country: countryName(c.code), region: (C.byCode[c.code] && C.byCode[c.code].region) || '', species: c.species,
        firstVisit: isoDay_(f.firstVisit), firstSpecies: nameOf(f.firstSpecies),
        lifers: f.lifers || 0, firstLifer: nameOf(f.firstLifer), firstLiferDate: isoDay_(f.firstLiferDate),
      };
    }),
    // States, provinces and counties: from eBird's State/Province and County columns
    places: Object.entries((d.stats && d.stats.states) || {}).map(([code, p]) => ({ key: code, p, level: 'state' }))
      .concat(Object.entries((d.stats && d.stats.counties) || {}).map(([k, p]) => ({ key: k, p, level: 'county' })))
      .map(({ key, p, level }) => {
        const state = key.split('|')[0], country = countryName(state.split('-')[0]);
        const recorded = (level === 'state' ? T.regions && T.regions[key] : T.counties && T.counties[key]) || null;
        return {
          place: placeName(key), level, country,
          within: level === 'state' ? country : stateName(state) + ', ' + country,
          species: p.species, lifers: p.lifers, recorded, pctSeen: pctOf(p.species, recorded),
          firstVisit: isoDay_(p.firstVisit), firstSpecies: nameOf(p.firstSpecies),
          firstLifer: nameOf(p.firstLifer), firstLiferDate: isoDay_(p.firstLiferDate),
        };
      }),
    years,
    months,
    countryNames: C.names,
  };
}

/**
 * Turns Lyrebird's reply to a question into something to show. The query is
 * checked again here, so a faulty or tampered Lyrebird still can't run
 * anything outside the allowed tables and fields.
 * @return {{status:'query', query:Object, reason:string}|{status:'cannot'|'invalid'|'error', reason:string}}
 */
function queryFromLyrebird_(reply) {
  if (!reply || !reply.ok) return { status: 'error', reason: (reply && reply.message) || 'no answer from the AI' };
  const reason = String(reply.reason || '').slice(0, 200);
  if (reply.status === 'cannot') return { status: 'cannot', reason: reason || 'That question can\'t be answered from your list.' };
  if (reply.status !== 'query') return { status: 'invalid', reason: reason || 'the AI\'s answer could not be used' };
  const checked = checkQuery_(reply.query);
  if (checked.problem) return { status: 'invalid', reason: checked.problem };
  return { status: 'query', query: checked.query, reason };
}

// ---------- Traits: size, range, habitat, diet… (docs/data/traits.json, from tools/build-traits.js) ----------
const TRAIT_FIELDS_ = ['mass', 'massSource', 'wing', 'tail', 'beak', 'rangeSize', 'lifestyle', 'migration',
  'habitat', 'diet', 'elevationMin', 'elevationMax', 'islandOnly', 'restrictedRange', 'flightless', 'clutchMax', 'nest', 'nestSite'];
const TRAIT_YESNO_ = ['islandOnly', 'restrictedRange', 'flightless'];

/**
 * Unpacks traits.json: words were stored as numbers (positions in "values"),
 * yes/no as 1/0, and empty fields at the end trimmed off.
 * @return {Map<string, Object>}  AviList scientific name -> { mass, habitat, … }
 */
function unpackTraits_(data) {
  const out = new Map();
  if (!data || !data.species || !Array.isArray(data.fields)) return out;
  const values = data.values || {};
  Object.keys(data.species).forEach(sci => {
    const row = data.species[sci], t = {};
    data.fields.forEach((f, i) => {
      const v = row[i];
      if (v === null || v === undefined) return;
      if (TRAIT_YESNO_.includes(f)) t[f] = v === 1;
      else if (values[f]) t[f] = Array.isArray(v) ? v.map(x => values[f][x]) : values[f][v];
      else t[f] = v;
    });
    out.set(sci, t);
  });
  return out;
}

/** One species' trait fields for "Ask your list", with null (unknown) where there's no value. */
function traitFields_(t) {
  const o = {};
  TRAIT_FIELDS_.forEach(f => { o[f] = t && t[f] !== undefined ? t[f] : (f === 'nest' || f === 'nestSite' ? [] : null); });
  return o;
}

// ---------- Fact files: everything known about one species, from every source ----------

const IUCN_NAMES_ = { LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable', EN: 'Endangered', CR: 'Critically Endangered',
  EW: 'Extinct in the Wild', EX: 'Extinct', DD: 'Data Deficient', NE: 'Not Evaluated' };

/** "Alcedo atthis" -> "Alcedo_atthis": the stickers' file name. */
function stickerName_(sci) { return String(sci).replace(/ /g, '_'); }

/**
 * Where a species' sticker is: a small thumbnail kept with the site, and the
 * full-size one on the pinned CDN. null if the species has no sticker.
 * @param {Object} sp  a checklist species ({sci, family, order})
 * @param {Object} stickers  docs/data/stickers.json
 */
function stickerFor_(sp, stickers) {
  if (!stickers || !sp || (stickers.none || []).includes(sp.sci)) return null;
  const name = stickerName_(sp.sci);
  return { thumb: 'stickers/' + name + '.webp', full: stickers.cdn + 'stickers/' + sp.order + '/' + sp.family + '/' + name + '.webp' };
}

/** The species' page on Bird Album (the stickers' own guide), or '' if it has none. */
function birdAlbumUrl_(sp, stickers) {
  const pages = (stickers && stickers.pages) || {};
  const slug = sp.sci in pages ? pages[sp.sci]
    : String(sp.common).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? 'https://birdalbum.com/birds/' + slug + '/' : '';
}

/**
 * The fact file for one species, as plain values for the page to lay out.
 * Each fact says which dataset it came from, so the reader can judge it.
 * @param {Object} sp  the checklist species
 * @param {Object} row  its row in askData_'s species table (records and traits)
 * @param {Object} extra  { lifer, range, stickers }: its lifer record (if seen), AviList range text, stickers.json
 */
function factFile_(sp, row, extra) {
  const e = extra || {}, r = row || {};
  const n = (v, dp) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: dp === undefined ? 1 : dp });
  const has = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
  const fact = (label, value, source) => (has(value) ? { label, value: String(value), source } : null);
  const weight = has(r.mass) ? (r.mass >= 1000 ? n(r.mass / 1000, 1) + ' kg' : n(r.mass) + ' g') : null;
  const elevation = has(r.elevationMin) && has(r.elevationMax)
    ? (r.elevationMin === r.elevationMax ? n(r.elevationMax, 0) + ' m' : n(r.elevationMin, 0) + '–' + n(r.elevationMax, 0) + ' m')
    : has(r.elevationMax) ? 'up to ' + n(r.elevationMax, 0) + ' m' : null;
  const range = has(r.rangeSize) ? (r.rangeSize >= 1e6 ? n(r.rangeSize / 1e6, 1) + ' million km²' : n(r.rangeSize, 0) + ' km²') : null;
  const iucn = String(sp.iucn || '').split(' ')[0];
  const tags = [
    r.islandOnly && 'Breeds only on islands',
    r.restrictedRange && 'Restricted range (under 50,000 km²)',
    r.flightless && 'Flightless',
    sp.extinct && 'Extinct',
  ].filter(Boolean);
  const lifer = e.lifer || null;
  const clean = list => list.filter(Boolean);
  return {
    i: sp.i, common: sp.common, sci: sp.sci,
    family: sp.familyEn || sp.family, familyLatin: sp.family, order: sp.order,
    iucn, iucnName: IUCN_NAMES_[iucn] || '', threatened: THREATENED_.test(sp.iucn || ''),
    sticker: stickerFor_(sp, e.stickers),
    tags,
    habitat: r.habitat || null,
    range: e.range ? e.range.charAt(0).toUpperCase() + e.range.slice(1) : '',   // AviList's text starts in lower case
    regions: (sp.regions || []).filter(x => x !== 'Worldwide'),
    worldwide: (sp.regions || []).includes('Worldwide'),
    size: clean([
      fact('Weight', weight, r.massSource || ''),
      fact('Wing length', has(r.wing) ? n(r.wing) + ' mm' : null, 'AVONET'),
      fact('Tail', has(r.tail) ? n(r.tail) + ' mm' : null, 'AVONET'),
      fact('Beak', has(r.beak) ? n(r.beak) + ' mm' : null, 'AVONET'),
    ]),
    life: clean([
      fact('Main habitat', r.habitat, 'BIRDBASE'),
      fact('Main diet', r.diet, 'BIRDBASE'),
      fact('Lifestyle', r.lifestyle, 'AVONET'),
      fact('Migration', r.migration, 'AVONET'),
      fact('Usual altitude', elevation, 'BIRDBASE'),
      fact('Range size', range, 'AVONET'),
      fact('Clutch', has(r.clutchMax) ? 'up to ' + n(r.clutchMax) + ' egg' + (r.clutchMax === 1 ? '' : 's') : null, 'BIRDBASE'),
      // Nest: the type; or, where BIRDBASE doesn't record the type, where the nest is; or "Not recorded"
      has(r.nest) ? { label: 'Nest', value: r.nest.join(' or '), source: 'BIRDBASE', nest: r.nest }
        : has(r.nestSite) ? { label: 'Nest', value: r.nestSite.map((st, i) => nestSiteWords_(st, i > 0)).join(' or '), source: 'BIRDBASE', sites: r.nestSite }
          : { label: 'Nest', value: 'Not recorded', source: '', missing: true },
    ]),
    seen: !!r.seen,
    records: r.seen ? {
      firstSeen: r.firstSeen, firstPlace: r.firstPlace || '',
      checklist: lifer && /^S\d+$/.test(lifer.checklist) ? lifer.checklist : '',
      checklists: r.checklists || 0,
      countries: r.countries || [], places: r.places || [],
    } : null,
    links: clean([
      sp.code && { label: 'eBird', url: 'https://ebird.org/species/' + encodeURIComponent(sp.code) },
      e.stickers && birdAlbumUrl_(sp, e.stickers) && { label: 'Bird Album', url: birdAlbumUrl_(sp, e.stickers) },
    ]),
  };
}

// ---------- Range maps: where a species has been recorded, by season (GBIF) ----------

/**
 * Reads the points from one Mapbox Vector Tile (the format GBIF's map service sends):
 * a small protocol-buffer decoder, enough for point layers. Pure: bytes in, points out.
 * @param {Uint8Array} buf
 * @return {{extent:number, points: Array<{x:number, y:number, total:number}>}}  x, y from 0 to extent
 */
function readMvtPoints_(buf) {
  let pos = 0;
  const varint = end => {
    let v = 0, shift = 0, b;
    do { if (pos >= end) throw new Error('truncated tile'); b = buf[pos++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return v;
  };
  const skip = (type, end) => {
    if (type === 0) varint(end);
    else if (type === 1) pos += 8;
    else if (type === 2) { const len = varint(end); pos += len; }   // not pos += varint(): that adds to the old pos
    else if (type === 5) pos += 4;
    else throw new Error('unknown field type ' + type);
  };
  const packed = end => { const len = varint(end), stop = pos + len, out = []; while (pos < stop) out.push(varint(stop)); return out; };
  const zigzag = n => (n % 2 ? -(n + 1) / 2 : n / 2);
  const points = [];
  let extent = 4096;
  while (pos < buf.length) {
    const key = varint(buf.length);
    if (key >> 3 !== 3 || (key & 7) !== 2) { skip(key & 7, buf.length); continue; }   // only layers matter
    const layerLen = varint(buf.length), layerEnd = pos + layerLen;   // read the length first: it moves pos
    const keys = [], values = [], feats = [];
    while (pos < layerEnd) {
      const k = varint(layerEnd), field = k >> 3, type = k & 7;
      if (field === 2 && type === 2) {                      // a feature
        const fLen = varint(layerEnd), fEnd = pos + fLen;
        const f = { tags: [], geom: [] };
        while (pos < fEnd) {
          const fk = varint(fEnd);
          if (fk >> 3 === 2 && (fk & 7) === 2) f.tags = packed(fEnd);
          else if (fk >> 3 === 4 && (fk & 7) === 2) f.geom = packed(fEnd);
          else skip(fk & 7, fEnd);
        }
        feats.push(f);
      } else if (field === 3 && type === 2) {               // a key
        const len = varint(layerEnd);
        keys.push(new TextDecoder().decode(buf.subarray(pos, pos + len))); pos += len;
      } else if (field === 4 && type === 2) {               // a value: numbers only matter here
        const vLen = varint(layerEnd), vEnd = pos + vLen;
        let v = null, lastString = null;
        while (pos < vEnd) {
          const vk = varint(vEnd), vf = vk >> 3, vt = vk & 7;
          if (vt === 0 && (vf === 4 || vf === 5)) v = varint(vEnd);
          else if (vt === 0 && vf === 6) v = zigzag(varint(vEnd));
          else if (vt === 1 && vf === 3) { v = new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0, true); pos += 8; }
          else if (vt === 5 && vf === 2) { v = new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true); pos += 4; }
          else if (vt === 2 && vf === 1) { const len = varint(vEnd); lastString = new TextDecoder().decode(buf.subarray(pos, pos + len)); pos += len; }
          else skip(vt, vEnd);
        }
        values.push(v === null ? lastString : v);
      } else if (field === 5 && type === 0) extent = varint(layerEnd);
      else skip(type, layerEnd);
    }
    feats.forEach(f => {
      const props = {};
      for (let i = 0; i < f.tags.length; i += 2) props[keys[f.tags[i]]] = values[f.tags[i + 1]];
      const total = Number(props.total) || 1;
      // Points: MoveTo (command 1) with a count, then x, y pairs relative to the cursor
      let x = 0, y = 0, i = 0;
      while (i < f.geom.length) {
        const cmd = f.geom[i] & 7, count = f.geom[i] >> 3; i++;
        for (let c = 0; c < count; c++) {
          if (cmd === 7) continue;                          // ClosePath has no coordinates
          x += zigzag(f.geom[i++]); y += zigzag(f.geom[i++]);
          if (cmd === 1) points.push({ x, y, total, props });
        }
      }
    });
    pos = layerEnd;
  }
  return { extent, points };
}

/** A geohash (e.g. "f7x") as the box of latitude and longitude it covers. */
function geohashBox_(hash) {
  const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  const lat = [-90, 90], lon = [-180, 180];
  let even = true;
  for (const ch of String(hash).toLowerCase()) {
    const n = B32.indexOf(ch);
    if (n < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lon : lat, mid = (r[0] + r[1]) / 2;
      if ((n >> bit) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat, lon };
}

/**
 * Sorts GBIF's grid cells by season, like a field guide's range map: recorded in
 * June–July only, December–January only, or both. (Not "breeding" and "winter":
 * June is summer in the north and winter in the south.) For birds with many
 * records, cells with only one or two are left out, so a few vagrants don't
 * look like part of the range.
 * @param {Array} june  features from readMvtPoints_ for June–July (props.geohash, total)
 * @param {Array} december  the same for December–January
 * @return {Array<{hash, box, season: 'june'|'december'|'both', total}>}
 */
function seasonCells_(june, december) {
  const add = (map, list, season) => (list || []).forEach(p => {
    const h = p.props && p.props.geohash;
    if (!h) return;
    const c = map.get(h) || { hash: h, june: 0, december: 0 };
    c[season] += p.total || 1;
    map.set(h, c);
  });
  const cells = new Map();
  add(cells, june, 'june');
  add(cells, december, 'december');
  const all = [...cells.values()];
  const records = all.reduce((n, c) => n + c.june + c.december, 0);
  const min = records > 5000 ? Math.max(3, Math.round(records * 1e-5)) : 1;   // one record in 100,000, for common birds
  return all.map(c => {
    const j = c.june >= min, d = c.december >= min;
    if (!j && !d) return null;
    const box = geohashBox_(c.hash);
    return box && { hash: c.hash, box, season: j && d ? 'both' : j ? 'june' : 'december', total: c.june + c.december };
  }).filter(Boolean);
}

/** Latitude and longitude to Web Mercator, as a fraction of the world's width (0 to 1, north at 0). */
function mercator_(lat, lon) {
  const clamped = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2];
}

/**
 * The range map as an SVG string: the land, the season cells and your own sightings,
 * framed around where the bird has been recorded.
 * @param {Array} cells  from seasonCells_
 * @param {Object} countries  Natural Earth GeoJSON (the main map's outlines)
 * @param {Array<[number, number]>} sightings  [lat, lng] where you recorded it
 */
function rangeMapSvg_(cells, countries, sightings) {
  const W = 1000;                                       // the world is 1000 units wide
  const P = (lat, lon) => mercator_(lat, lon).map(v => v * W);
  // Frame the map on the middle 95% of the grid cells, east to west and north to south, so a few
  // far-flung strays don't shrink the range to a dot; and on all your own sightings. (Cells, not
  // records: counting records would centre the map on wherever most birdwatchers live.)
  const pts = [];
  const centres = cells.map(c => ({ p: P((c.box.lat[0] + c.box.lat[1]) / 2, (c.box.lon[0] + c.box.lon[1]) / 2), w: 1, c }));
  const records = centres.reduce((n, x) => n + x.w, 0);
  const middle = axis => {
    const sorted = centres.slice().sort((a, b) => a.p[axis] - b.p[axis]);
    let run = 0;
    const lo = sorted.find(x => (run += x.w) >= records * 0.025);
    run = 0;
    const hi = sorted.slice().reverse().find(x => (run += x.w) >= records * 0.025);
    return lo && hi ? [lo.p[axis], hi.p[axis]] : null;
  };
  const mx = middle(0), my = middle(1);
  if (mx && my) {
    centres.filter(x => x.p[0] >= mx[0] && x.p[0] <= mx[1] && x.p[1] >= my[0] && x.p[1] <= my[1])
      .forEach(x => pts.push(P(x.c.box.lat[0], x.c.box.lon[0]), P(x.c.box.lat[1], x.c.box.lon[1])));
  }
  (sightings || []).forEach(([la, lo]) => pts.push(P(la, lo)));
  if (!pts.length) return '';
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
  let y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  // Pad the frame, keep it at least a continent wide, and make it 3:2
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12 + 8;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const minW = 120;
  if (x1 - x0 < minW) { const m = (x0 + x1) / 2; x0 = m - minW / 2; x1 = m + minW / 2; }
  const ratio = 1.5;
  if ((x1 - x0) / (y1 - y0) < ratio) { const m = (x0 + x1) / 2, w = (y1 - y0) * ratio; x0 = m - w / 2; x1 = m + w / 2; }
  else { const m = (y0 + y1) / 2, h = (x1 - x0) / ratio; y0 = m - h / 2; y1 = m + h / 2; }
  if (x1 - x0 > W) { x0 = 0; x1 = W; }
  const r1 = n => Math.round(n * 10) / 10;
  // Land: only the countries that reach into the frame
  const ring = r => {
    const xy = r.map(([lo, la]) => P(la, lo));
    if (xy.every(p => p[0] < x0) || xy.every(p => p[0] > x1) || xy.every(p => p[1] < y0) || xy.every(p => p[1] > y1)) return '';
    return 'M' + xy.map(p => r1(p[0]) + ' ' + r1(p[1])).join('L') + 'Z';
  };
  const land = ((countries && countries.features) || []).map(f => {
    const g = f.geometry || {};
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.map(poly => poly.map(ring).join('')).join('');
  }).filter(Boolean).join('');
  // Each cell is drawn at least 1/90 of the map wide, so a widely scattered bird still shows on a world map
  const minCell = (x1 - x0) / 90;
  const sizes = [];
  const cellRects = season => cells.filter(c => c.season === season).map(c => {
    const [ax, ay] = P(c.box.lat[1], c.box.lon[0]), [bx, by] = P(c.box.lat[0], c.box.lon[1]);
    const w = Math.max(bx - ax + 0.3, minCell), h = Math.max(by - ay + 0.3, minCell);
    sizes.push(Math.min(w, h));
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    return '<rect x="' + r1(cx - w / 2) + '" y="' + r1(cy - h / 2) + '" width="' + r1(w) + '" height="' + r1(h) + '"/>';
  }).join('');
  const dotR = r1((x1 - x0) / 140);
  const groups = ['june', 'december', 'both'].map(season => '<g class="' + season + '" filter="url(#range-smooth)">' + cellRects(season) + '</g>').join('');
  // Smoothing ("gooey" filter): blur the squares, then turn the blurred edge back into a sharp one.
  // Neighbouring squares melt into one rounded shape, like a field guide's range map; lone squares
  // become round dots. The blur is about half a typical square, so shapes keep their size.
  sizes.sort((a, b) => a - b);
  const cell = sizes.length ? sizes[Math.floor(sizes.length / 2)] : minCell;
  const blur = r1(Math.max(0.3, cell * 0.45));
  return '<svg class="range-map" viewBox="' + [x0, y0, x1 - x0, y1 - y0].map(r1).join(' ') + '" role="img" aria-label="Range map">' +
    '<rect class="sea" x="' + r1(x0) + '" y="' + r1(y0) + '" width="' + r1(x1 - x0) + '" height="' + r1(y1 - y0) + '"/>' +
    '<path class="land" d="' + land + '"/>' +
    '<defs><filter id="range-smooth" filterUnits="userSpaceOnUse" x="' + r1(x0) + '" y="' + r1(y0) + '" width="' + r1(x1 - x0) + '" height="' + r1(y1 - y0) + '">' +
      '<feGaussianBlur stdDeviation="' + blur + '"/>' +
      '<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 14 -6"/></filter></defs>' +
    '<g class="cells">' + groups + '</g>' +
    '<path class="borders" d="' + land + '"/>' +
    '<g class="mine">' + (sightings || []).map(([la, lo]) => { const [x, y] = P(la, lo); return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + dotR + '"/>'; }).join('') + '</g>' +
    '</svg>';
}

// ---------- The bird quiz: name your lifers from their stickers ----------

/** Shuffles a copy of a list, using the given random number function (0 to 1). */
function shuffled_(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The birds a quiz can ask about: your lifers that have a sticker, as checklist species. */
function quizPool_(lifers, checklist, stickers) {
  return (lifers || []).map(l => checklist.species[l.i]).filter(sp => sp && stickerFor_(sp, stickers));
}

/**
 * The four names for a multiple-choice question: the answer and three others from your
 * own lifers. "hard" picks birds that look alike first: the same family, then the same
 * order, then the same body shape; "easy" picks any. Names are never repeated.
 * @param {Object} answer  a checklist species
 * @param {Array} pool  from quizPool_
 * @param {'easy'|'hard'} level
 * @param {Function} rnd  random number function
 * @param {Function} [shapeOf]  species -> body shape (bird-icons.js), for "hard"
 */
function quizOptions_(answer, pool, level, rnd, shapeOf) {
  const others = shuffled_(pool.filter(sp => sp.common !== answer.common), rnd);
  const tiers = level === 'hard'
    ? [sp => sp.family === answer.family, sp => sp.order === answer.order,
       sp => !!shapeOf && shapeOf(sp) === shapeOf(answer), () => true]
    : [() => true];
  const picked = [];
  tiers.forEach(fits => others.forEach(sp => {
    if (picked.length < 3 && fits(sp) && !picked.some(p => p.common === sp.common)) picked.push(sp);
  }));
  return shuffled_([answer].concat(picked), rnd);
}

/** A name made comparable: no capitals, accents, hyphens or apostrophes, and "grey" as "gray". */
function quizName_(s) {
  return normCommon_(s).replace(/\bgrey/g, 'gray');
}

/** How many single-letter changes turn one word into another (Levenshtein distance). */
function editDistance_(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
}

/**
 * Checks a typed answer. Correct if it matches the AviList name, one of its other names
 * (e.g. American spellings) or the scientific name; a small spelling slip is forgiven
 * (one letter in eight); and the name without its first word ("Bullfinch" for "Eurasian
 * Bullfinch") counts, unless that's another species' name.
 * @param {string} typed
 * @param {Object} sp  the checklist species asked about
 * @param {Object} checklist  for the names of every species (byCommon)
 * @return {{correct: boolean, note: string}}  note: what was forgiven, if anything
 */
function quizCheck_(typed, sp, checklist, otherNames) {
  const t = quizName_(typed);
  if (!t) return { correct: false, note: '' };
  // otherNames: the bird's name in the language chosen on the page (e.g. "Bouvreuil pivoine"), which counts too
  const names = [sp.common].concat(String(sp.alt || '').split(';'), otherNames || []).map(s => String(s).trim()).filter(Boolean);
  const sci = String(sp.sci).toLowerCase();
  if (names.some(n => quizName_(n) === t) || String(typed).trim().toLowerCase().replace(/\s+/g, ' ') === sci) return { correct: true, note: '' };
  for (const n of names) {
    const want = quizName_(n);
    if (editDistance_(t, want) <= Math.max(1, Math.floor(want.length / 8))) return { correct: true, note: 'spelled ' + n };
  }
  // The name without its first word, if no other bird is called that
  const short = quizName_(sp.common).split(' ').slice(1).join(' ');
  const other = checklist && checklist.byCommon && checklist.byCommon.get(normCommon_(short));
  if (short.length >= 4 && (other === undefined || other === sp.i) && (t === short || editDistance_(t, short) <= Math.floor(short.length / 8))) {
    return { correct: true, note: 'in full, ' + sp.common };
  }
  return { correct: false, note: '' };
}

// ---------- Size comparison: an estimate of the bird's length ----------
// None of the datasets give a bird's length (beak tip to tail tip, as field guides quote it), so
// it's estimated: beak + tail + a body length from weight (body length grows with the cube root
// of weight). Long-necked shapes get more. Calibrated on 28 birds of known length: median error
// 6%, worst 22% (Mute Swan, too short). Shown as an estimate, never as a measurement.
const LENGTH_K_ = 30.75;                                       // mm of body per cube-root gram
const NECK_ = { heron: 1.75, crane: 1.6, flamingo: 2.1, cormorant: 1.5, diver: 1.3, duck: 1.3 };

/**
 * @param {Object} t  the species' traits (mass in g, beak and tail in mm)
 * @param {string} shape  its body shape (birdShape_ in bird-icons.js)
 * @return {number|null}  estimated length in mm, or null without a weight
 */
function estimateLength_(t, shape) {
  if (!t || !(t.mass > 0)) return null;
  return Math.round((t.beak || 0) + (t.tail || 0) + LENGTH_K_ * (NECK_[shape] || 1) * Math.cbrt(t.mass));
}

/** A nest site as words for the fact file: "Tree" -> "In trees" (or "in trees" after the first). */
function nestSiteWords_(site, later) {
  const w = { Tree: 'In trees', Ground: 'On the ground', Shrub: 'In shrubs', Rock: 'On rock', Grass: 'In grass',
    Building: 'On buildings', Stump: 'In stumps', 'Other animal\'s nest': 'In other animals\' nests', Bamboo: 'In bamboo',
    Pole: 'On poles', Water: 'On water', Cactus: 'In cacti' }[site] || site;
  return later ? w.charAt(0).toLowerCase() + w.slice(1) : w;
}

// ---------- Bird sounds (xeno-canto, via tools/fetch-sounds.js) ----------

/**
 * One recording, ready to show: a label ("Song · 0:19 · Australia") and its credit, which the
 * licence requires: the XC number, the recordist and the Creative Commons licence.
 * @param {Object} r  {id, type, length, rec, cnt, lic, file} from docs/data/sounds.json
 */
function soundInfo_(r) {
  const type = /song/i.test(r.type) ? 'Song' : /call/i.test(r.type) ? 'Call' : 'Sound';
  const m = String(r.lic || '').match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  const licence = m ? 'CC ' + m[1].toUpperCase() + ' ' + m[2] : 'see xeno-canto';
  return {
    id: String(r.id), type, file: String(r.file),
    label: [type, r.length, r.cnt].filter(Boolean).join(' · '),
    credit: 'XC' + r.id + ' by ' + (r.rec || 'unknown') + ', ' + licence,
    page: 'https://xeno-canto.org/' + encodeURIComponent(r.id), licenceUrl: String(r.lic || ''),
  };
}

/**
 * A "Quiz me on…" request, answered as an Ask your list query, made into the quiz's list of birds:
 * it must be about species, it's limited to ones you've seen (added if the AI left it out), and it
 * takes every match (the 200-row cap is for answer tables; this list stays in the browser).
 * Returns {problem} if it can't be used.
 * @param {Object} q  a checked query (checkQuery_ / queryFromLyrebird_)
 */
function quizScopeQuery_(q) {
  if (!q || q.table !== 'species') return { problem: 'That isn\'t a group of birds. Try something like "birds I saw in Thailand" or "owls".' };
  const filters = q.filters.filter(f => f.field !== 'seen').concat([{ field: 'seen', op: 'eq', value: true }]);
  return { problem: '', query: Object.assign({}, q, { filters, limit: Infinity, columns: [] }) };
}

// ---------- Explore: birds reported near you lately that aren't on your list ----------

/**
 * eBird's recent sightings for a place (via Lyrebird), as the species you haven't seen,
 * grouped by family in checklist order. eBird's species codes are matched through AviList's
 * own eBird codes; a code AviList doesn't have (rare: a taxonomy difference) is counted, not shown.
 * @param {Object} reply  {ok, species: [{code, date, loc}]} from Lyrebird's "recent" action
 * @param {Object} checklist  loadChecklist_ result
 * @param {Set<number>} seen  checklist indexes of your lifers
 * @return {{total:number, newCount:number, unmatched:number, families:Array<{family, familyLatin, birds:Array}>}}
 */
function exploreList_(reply, checklist, seen) {
  const byCode = new Map();
  checklist.species.forEach(sp => { if (sp.code) byCode.set(sp.code, sp); });
  const families = new Map();
  let total = 0, unmatched = 0, newCount = 0;
  ((reply && reply.species) || []).forEach(o => {
    const sp = byCode.get(o && o.code);
    if (!sp) { unmatched++; return; }
    total++;
    if (seen.has(sp.i)) return;
    newCount++;
    const f = families.get(sp.family) || { family: sp.familyEn || sp.family, familyLatin: sp.family, first: sp.i, birds: [] };
    f.birds.push({ i: sp.i, sci: sp.sci, common: sp.common, date: String(o.date || ''), loc: String(o.loc || '') });
    families.set(sp.family, f);
  });
  const list = [...families.values()].sort((a, b) => a.first - b.first);   // checklist (taxonomic) order
  list.forEach(f => { f.birds.sort((a, b) => a.i - b.i); delete f.first; });
  return { total, newCount, unmatched, families: list };
}
