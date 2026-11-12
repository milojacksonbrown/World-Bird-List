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
 * @return {{species: Object<number,{checklists:number, firstCountry:string}>,
 *           countries: Object<string,{firstVisit:Date, firstSpecies:number, lifers:number, firstLifer:?number, firstLiferDate:?Date}>}}
 *   Keyed by species number and two-letter country code. (Counts of individual
 *   birds aren't used: most records are eBird's "X", seen but not counted.)
 */
function speciesStats_(rows, index) {
  const out = { species: {}, countries: {} };
  if (!rows || rows.length < 2) return out;
  const H = rows[0].map(h => String(h).trim().toLowerCase());
  const col = {
    sci: H.indexOf('scientific name'), common: H.indexOf('common name'), date: H.indexOf('date'),
    time: H.indexOf('time'), state: H.indexOf('state/province'), sub: H.indexOf('submission id'),
  };
  if (col.sci < 0) return out;
  const subs = {}, firstOf = {};       // species -> Set of checklists; species -> earliest {key, date, cc}
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sci = String(r[col.sci] || '').trim();
    if (!sci) continue;
    const res = resolveEbirdName_(sci, col.common >= 0 ? String(r[col.common] || '').trim() : '', index);
    if (res.skip || res.target === undefined || res.target === null) continue;
    const t = res.target;
    const st = out.species[t] || (out.species[t] = { checklists: 0, firstCountry: '' });
    const sub = col.sub >= 0 ? String(r[col.sub] || '').trim() : '';
    (subs[t] = subs[t] || new Set()).add(sub || 'row' + i);
    const date = col.date >= 0 ? parseEbirdDate_(r[col.date]) : null;
    if (!date) continue;
    const key = date.getTime() + parseEbirdTime_(col.time >= 0 ? r[col.time] : '') * 60000;
    const cc = String(col.state >= 0 ? r[col.state] : '').trim().toUpperCase().split('-')[0];
    if (!firstOf[t] || key < firstOf[t].key) firstOf[t] = { key, date, cc };
    if (/^[A-Z]{2}$/.test(cc)) {
      const c = out.countries[cc] || (out.countries[cc] = { key: Infinity, firstVisit: null, firstSpecies: null, lifers: 0, firstLifer: null, firstLiferDate: null, liferKey: Infinity });
      if (key < c.key) { c.key = key; c.firstVisit = date; c.firstSpecies = t; }
    }
  }
  Object.keys(out.species).forEach(t => {
    out.species[t].checklists = subs[t].size;
    const f = firstOf[t];
    if (!f) return;
    out.species[t].firstCountry = /^[A-Z]{2}$/.test(f.cc) ? f.cc : '';
    const c = out.countries[f.cc];                   // the lifer was gained in this country
    if (!c) return;
    c.lifers++;
    if (f.key < c.liferKey) { c.liferKey = f.key; c.firstLifer = Number(t); c.firstLiferDate = f.date; }
  });
  Object.values(out.countries).forEach(c => { delete c.key; delete c.liferKey; });
  return out;
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
    return { i, sci: s.sci, common: s.common, family: s.familyEn || s.family, date: x.date || null, place: x.loc || '', checklist: x.sub || '' };
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
 */
function askData_(d, checklist, countries) {
  const C = countries || { byCode: {}, names: {} };
  const countryName = code => (C.byCode[code] && C.byCode[code].name) || code;
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
      // "Worldwide" species count towards every land region, as on the region bars
      regions: checklist.regions.filter(r => r !== 'Worldwide' && inRegion_(s, r)),
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
