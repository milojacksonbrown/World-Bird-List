// GENERATED from AskYourList.gs by tools/build-site.js. Do not edit here: edit AskYourList.gs and re-run.
/**
 * ============================================================================
 *  ASK YOUR LIST  —  plain-English questions about your life list
 * ============================================================================
 *
 *  The AI doesn't answer the question. It translates it into a small,
 *  structured query; this code checks the query against a fixed list of what
 *  may be asked, and the browser runs it on the visitor's own data.
 *  See DASHBOARD-DESIGN.md ("2. Ask a question").
 *
 *    "Which families have I seen less than 10% of?"
 *        ↓  Gemini (via Lyrebird), which sees the question only
 *    { table: 'families', filters: [{ field: 'pctSeen', op: 'lt', value: '10' }],
 *      sortField: 'pctSeen', sortDir: 'asc' }
 *        ↓  checkQuery_ (in Lyrebird, and again in the browser)
 *        ↓  runQuery_ (in the browser, on the visitor's data)
 *    a table of families, plus "Families where % seen is under 10, lowest first"
 *
 *  Everything here is pure (plain values in, plain values out), so it is
 *  tested with `node --test`. Shared by:
 *    - Lyrebird (the prompt, the schema and the first check)
 *    - the website (the second check, the runner and the description)
 *
 *  ASK_TABLES_ is the single source of truth: the prompt sent to Gemini, the
 *  checker and the description are all generated from it, so they can't
 *  disagree about what can be asked.
 */

const ASK = {
  MAX_QUESTION: 300,       // longest question accepted, in characters
  MAX_FILTERS: 6,
  MAX_COLUMNS: 6,          // extra columns a question can ask to see
  MAX_VALUE: 100,          // longest filter value, in characters
  DEFAULT_LIMIT: 25,       // rows shown when the question doesn't say
  MAX_LIMIT: 200,
  // The regions a question can be limited to (AviList regions: where a species breeds, winters or passes through)
  REGIONS: ['Europe', 'Asia', 'Africa', 'N America', 'Middle America', 'S America', 'Australasia', 'Pacific Is.', 'Antarctic', 'Oceans'],
};

// The kinds of value a field can hold, and the comparisons allowed on each
const ASK_OPS_ = {
  text: ['eq', 'ne', 'contains'],
  number: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'],
  yesno: ['eq'],
  date: ['eq', 'lt', 'lte', 'gt', 'gte'],
  list: ['has', 'lacks'],
};
const ASK_ALL_OPS_ = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'has', 'lacks'];

/**
 * What can be asked: each table, its fields ([type, label, description]),
 * the columns shown by default, and its usual order.
 */
const ASK_TABLES_ = {
  species: {
    about: 'every bird species in the world (AviList), one row each, seen or not',
    noun: ['species', 'species'],
    fields: {
      common: ['text', 'Species', 'English name, e.g. Barn Owl'],
      scientific: ['text', 'Scientific name', 'e.g. Tyto alba'],
      family: ['text', 'Family', 'family English name, e.g. "Owls", "Herons, Egrets"'],
      familyLatin: ['text', 'Family (scientific)', 'family scientific name, e.g. Strigidae'],
      order: ['text', 'Order', 'order scientific name, e.g. Strigiformes, Passeriformes'],
      iucn: ['text', 'IUCN', 'IUCN Red List category: LC, NT, VU, EN, CR or DD'],
      threatened: ['yesno', 'Threatened', 'true if IUCN Vulnerable, Endangered or Critically Endangered'],
      seen: ['yesno', 'Seen', 'true if on my life list'],
      firstSeen: ['date', 'First seen', 'date of my first sighting, YYYY-MM-DD'],
      firstYear: ['number', 'Year first seen', 'year of my first sighting'],
      firstMonth: ['number', 'Month first seen', 'month of my first sighting, 1 = January'],
      firstPlace: ['text', 'Where first seen', 'eBird location of my first sighting'],
      firstCountry: ['text', 'Country first seen', 'country of my first sighting (where it became a lifer)'],
      checklists: ['number', 'Checklists', 'how many of my eBird checklists it is on: how often I have seen it (0 if never)'],
      countries: ['list', 'Countries', 'countries where I have recorded it, e.g. "Kenya"'],
      regions: ['list', 'Regions', 'AviList regions where it breeds, winters or passes through'],
    },
    show: ['common', 'scientific', 'family', 'firstSeen', 'firstPlace'],
    sort: ['firstSeen', 'desc'],
  },
  families: {
    about: 'bird families, one row each, with how many of their species I have seen',
    noun: ['family', 'families'],
    fields: {
      family: ['text', 'Family', 'English name, e.g. "Owls"'],
      familyLatin: ['text', 'Family (scientific)', 'e.g. Strigidae'],
      order: ['text', 'Order', 'e.g. Strigiformes'],
      species: ['number', 'Species', 'number of living species in the family'],
      seen: ['number', 'Seen', 'number of its species I have seen'],
      notSeen: ['number', 'Not seen', 'number of its species I have not seen'],
      pctSeen: ['number', '% seen', 'percentage of its species I have seen, 0 to 100'],
    },
    show: ['family', 'familyLatin', 'seen', 'species', 'pctSeen'],
    sort: ['seen', 'desc'],
  },
  orders: {
    about: 'bird orders, one row each, with how many of their species and families I have seen',
    noun: ['order', 'orders'],
    fields: {
      order: ['text', 'Order', 'e.g. Passeriformes'],
      families: ['number', 'Families', 'number of families in the order'],
      familiesSeen: ['number', 'Families seen', 'number of its families I have seen at least one species of'],
      species: ['number', 'Species', 'number of living species in the order'],
      seen: ['number', 'Seen', 'number of its species I have seen'],
      notSeen: ['number', 'Not seen', 'number of its species I have not seen'],
      pctSeen: ['number', '% seen', 'percentage of its species I have seen, 0 to 100'],
    },
    show: ['order', 'seen', 'species', 'pctSeen', 'familiesSeen'],
    sort: ['seen', 'desc'],
  },
  countries: {
    about: 'countries where I have recorded at least one species',
    noun: ['country', 'countries'],
    fields: {
      country: ['text', 'Country', 'e.g. "Kenya"'],
      region: ['text', 'Region', 'the AviList region the country is counted in'],
      species: ['number', 'Species', 'number of species I have recorded there'],
      lifers: ['number', 'Lifers', 'species whose first-ever sighting (lifer) was in this country'],
      firstVisit: ['date', 'First visit', 'date of my first record in this country'],
      firstSpecies: ['text', 'First bird recorded', 'the first species I recorded in this country (may already have been on my list)'],
      firstLifer: ['text', 'First lifer', 'the first species I saw in this country that was new to my list'],
      firstLiferDate: ['date', 'First lifer date', 'date of that first lifer'],
    },
    show: ['country', 'region', 'species', 'lifers'],
    sort: ['species', 'desc'],
  },
  years: {
    about: 'calendar years in which I went birding',
    noun: ['year', 'years'],
    fields: {
      year: ['number', 'Year', 'e.g. 2019'],
      lifers: ['number', 'Lifers', 'new species that year'],
      species: ['number', 'Species', 'species recorded that year, new or not'],
      checklists: ['number', 'Checklists', 'eBird checklists that year'],
    },
    show: ['year', 'lifers', 'species', 'checklists'],
    sort: ['year', 'asc'],
  },
  months: {
    about: 'the twelve months of the year, all years added together (for seasons)',
    noun: ['month', 'months'],
    fields: {
      month: ['number', 'Month number', '1 = January … 12 = December'],
      name: ['text', 'Month', 'e.g. "May"'],
      lifers: ['number', 'Lifers', 'new species in that month, all years together'],
      species: ['number', 'Species', 'species recorded in that month, all years together'],
      checklists: ['number', 'Checklists', 'eBird checklists in that month, all years together'],
    },
    show: ['name', 'lifers', 'species', 'checklists'],
    sort: ['month', 'asc'],
  },
};
// A region can limit these tables (countries use their own "region" field instead)
const ASK_REGION_TABLES_ = ['species', 'families', 'orders'];

// ---------------------------------------------------------------------------
//  1. The prompt and the reply format (used by Lyrebird)
// ---------------------------------------------------------------------------

/** Describes the tables for the prompt, generated from ASK_TABLES_. */
function describeTablesForPrompt_() {
  return Object.keys(ASK_TABLES_).map(t => {
    const T = ASK_TABLES_[t];
    return 'Table "' + t + '": ' + T.about + '.\n' + Object.keys(T.fields).map(f =>
      '  - ' + f + ' (' + T.fields[f][0] + '): ' + T.fields[f][2]).join('\n');
  }).join('\n');
}

/**
 * The prompt sent to Gemini. Contains the question and the description of
 * what can be searched, nothing else: no sightings, names, dates or places.
 * @param {string} question
 * @param {Date} today  so "this year" and "last year" can be worked out
 */
function buildQueryPrompt_(question, today) {
  const ops = Object.keys(ASK_OPS_).map(k => '  - ' + k + ': ' + ASK_OPS_[k].join(', ')).join('\n');
  return [
    'You translate a birdwatcher\'s question about their own life list into a query.',
    'You never answer the question yourself; the query is run on their data afterwards.',
    'Today is ' + today.toISOString().slice(0, 10) + '.',
    '',
    describeTablesForPrompt_(),
    '',
    'Comparisons allowed for each kind of field:',
    ops,
    '(eq equals, ne not equal, lt less than, lte at most, gt more than, gte at least,',
    ' contains: text contains these letters, has/lacks: list includes / does not include.)',
    '',
    'Reply with JSON, always including every key below:',
    '  status: "query", or "cannot" if the question can\'t be answered with these tables.',
    '  reason: one short sentence: how you read the question, or why it can\'t be answered.',
    '  table: one of ' + Object.keys(ASK_TABLES_).join(', ') + '.',
    '  region: limits species, families or orders to one AviList region: ' + ASK.REGIONS.join(', ') + '.',
    '          "" unless the question names a region or continent.',
    '  filters: a list of {field, op, value}, all of which must be true; [] if none. value is always text:',
    '           numbers as digits ("10"), yes/no as "true" or "false", dates as YYYY-MM-DD.',
    '           Put EVERY condition in the question into filters, region, sort or limit; never drop one.',
    '  sortField: the field to order the results by, or "" for the usual order.',
    '  sortDir: "asc" or "desc".',
    '  limit: how many rows to show (1 to ' + ASK.MAX_LIMIT + '), or 0 for the usual number.',
    '  columns: extra fields of the same table to show in the answer, [] if none. Use it when the',
    '           question asks for something the filters and sort don\'t already show.',
    '',
    'Rules:',
    '- "I have seen", "my lifers", "on my list" means seen = true on the species table.',
    '- Family names: use the English name with "contains" so "owls" finds "Owls" and "Barn Owls";',
    '  use familyLatin when the question gives a scientific family name.',
    '- Percentages are 0 to 100: "less than 10%" is pctSeen lt "10".',
    '- A country is matched by its English name, e.g. "Kenya", "United Kingdom".',
    '- "Most", "best", "top" means sort descending; "least", "fewest", "worst" ascending.',
    '- "Which year ..." questions use the years table; "which month" or "season" use months.',
    '- "Seen the most", "most often", "most common on my checklists": species sorted by checklists, descending.',
    '- "In each country" questions use the countries table, one row per country, with the asked-for fields in columns.',
    '  A "lifer" is a species new to my list: "first lifer in each country" is firstLifer (with firstLiferDate);',
    '  "first bird I saw in each country" is firstSpecies (with firstVisit).',
    '- Questions about a place inside a country (a county, a park), about counts of individual birds,',
    '  about other people, or about anything not in these tables: status "cannot".',
    '',
    'Examples:',
    'Q: Which families have I seen less than 10% of in Africa?',
    'A: {"status":"query","reason":"Families, counting African species only, where under 10% are seen.","table":"families","region":"Africa","filters":[{"field":"pctSeen","op":"lt","value":"10"}],"sortField":"pctSeen","sortDir":"asc","limit":0,"columns":[]}',
    'Q: What were my first five lifers?',
    'A: {"status":"query","reason":"Species I have seen, oldest first sighting first, five of them.","table":"species","region":"","filters":[{"field":"seen","op":"eq","value":"true"}],"sortField":"firstSeen","sortDir":"asc","limit":5,"columns":[]}',
    'Q: Which threatened birds have I seen in Kenya?',
    'A: {"status":"query","reason":"Threatened species recorded in Kenya.","table":"species","region":"","filters":[{"field":"threatened","op":"eq","value":"true"},{"field":"countries","op":"has","value":"Kenya"}],"sortField":"","sortDir":"desc","limit":0,"columns":[]}',
    'Q: How many birds did I see on my trip last weekend?',
    'A: {"status":"cannot","reason":"Trips and individual days aren\'t in the tables; try asking about a year or a month.","table":"species","region":"","filters":[],"sortField":"","sortDir":"desc","limit":0,"columns":[]}',
    '',
    'Question: ' + JSON.stringify(String(question)),
  ].join('\n');
}

/**
 * The JSON shape Gemini must reply in (its "responseSchema").
 * Every key is required: in testing, Gemini left out optional keys (filters,
 * sort, limit) even when the question needed them. "Nothing" is written as
 * "" (region, sortField), [] (filters) or 0 (limit) instead.
 */
function queryResponseSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      status: { type: 'STRING', enum: ['query', 'cannot'] },
      reason: { type: 'STRING' },
      table: { type: 'STRING', enum: Object.keys(ASK_TABLES_) },
      region: { type: 'STRING' },
      filters: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { field: { type: 'STRING' }, op: { type: 'STRING', enum: ASK_ALL_OPS_ }, value: { type: 'STRING' } },
          required: ['field', 'op', 'value'],
        },
      },
      sortField: { type: 'STRING' },
      sortDir: { type: 'STRING', enum: ['asc', 'desc'] },
      limit: { type: 'INTEGER' },
      columns: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['status', 'reason', 'table', 'region', 'filters', 'sortField', 'sortDir', 'limit', 'columns'],
    propertyOrdering: ['status', 'reason', 'table', 'region', 'filters', 'sortField', 'sortDir', 'limit', 'columns'],
  };
}

// ---------------------------------------------------------------------------
//  2. The checker (Lyrebird, and again in the browser)
// ---------------------------------------------------------------------------

/** Lower case, no accents or apostrophes, single spaces: "Côte d'Ivoire" -> "cote divoire". */
function askTidy_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9.%-]+/g, ' ').trim();
}

/** Converts one filter value to its field's type. Returns undefined if it can't. */
function askValue_(type, v) {
  if (type === 'number') {
    const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[%,\s]/g, ''));
    return String(v).trim() !== '' && isFinite(n) ? n : undefined;
  }
  if (type === 'yesno') {
    if (typeof v === 'boolean') return v;
    const t = askTidy_(v);
    return t === 'true' || t === 'yes' ? true : t === 'false' || t === 'no' ? false : undefined;
  }
  if (type === 'date') {
    const m = String(v == null ? '' : v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return undefined;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? m[0] : undefined;     // rejects 2019-02-30
  }
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();   // text and list
  return s && s.length <= ASK.MAX_VALUE && typeof v !== 'object' ? s : undefined;
}

/**
 * Checks a query from the AI. Every table, field, comparison and value must
 * be on the allowed lists and the right type; anything else is rejected.
 * Accepts its own output too, so the browser can check Lyrebird's reply again.
 * @return {{problem:string}|{problem:'', query:Object}}
 */
function checkQuery_(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'The query was empty.' };
  const T = ASK_TABLES_[raw.table];
  if (!Object.prototype.hasOwnProperty.call(ASK_TABLES_, raw.table)) return { problem: 'Unknown table "' + raw.table + '".' };
  const field = f => Object.prototype.hasOwnProperty.call(T.fields, f) ? T.fields[f] : null;

  // Region: only for species, families and orders; countries use their own field
  let region = '';
  const filtersIn = Array.isArray(raw.filters) ? raw.filters.slice() : raw.filters == null ? [] : null;
  if (!filtersIn) return { problem: 'Filters must be a list.' };
  if (raw.region != null && String(raw.region).trim() !== '') {
    region = ASK.REGIONS.find(r => askTidy_(r) === askTidy_(raw.region)) || '';
    if (!region) return { problem: 'Unknown region "' + raw.region + '".' };
    if (raw.table === 'countries') { filtersIn.push({ field: 'region', op: 'eq', value: region }); region = ''; }
    else if (!ASK_REGION_TABLES_.includes(raw.table)) return { problem: 'The ' + raw.table + ' table can\'t be limited to a region.' };
  }

  if (filtersIn.length > ASK.MAX_FILTERS) return { problem: 'Too many filters (at most ' + ASK.MAX_FILTERS + ').' };
  const filters = [];
  for (const f of filtersIn) {
    if (!f || typeof f !== 'object') return { problem: 'A filter was empty.' };
    const def = field(f.field);
    if (!def) return { problem: 'The ' + raw.table + ' table has no field "' + f.field + '".' };
    if (!ASK_OPS_[def[0]].includes(f.op)) return { problem: 'Can\'t use "' + f.op + '" on ' + f.field + '.' };
    const value = askValue_(def[0], f.value);
    if (value === undefined) return { problem: 'The value "' + f.value + '" doesn\'t suit ' + f.field + ' (' + def[0] + ').' };
    filters.push({ field: f.field, op: f.op, value });
  }

  let sortField = raw.sortField == null || raw.sortField === '' ? '' : String(raw.sortField);
  let sortDir = raw.sortDir == null || raw.sortDir === '' ? '' : String(raw.sortDir);
  if (sortField) {
    const def = field(sortField);
    if (!def) return { problem: 'Can\'t sort by "' + sortField + '": the ' + raw.table + ' table has no such field.' };
    if (def[0] === 'list') return { problem: 'Can\'t sort by a list (' + sortField + ').' };
    if (sortDir && sortDir !== 'asc' && sortDir !== 'desc') return { problem: 'Sort direction must be asc or desc.' };
    sortDir = sortDir || (def[0] === 'number' || def[0] === 'date' ? 'desc' : 'asc');
  } else {
    [sortField, sortDir] = T.sort;
  }

  let limit = ASK.DEFAULT_LIMIT;
  if (raw.limit != null && raw.limit !== '' && raw.limit !== 0) {
    limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > ASK.MAX_LIMIT) return { problem: 'The limit must be a whole number from 1 to ' + ASK.MAX_LIMIT + '.' };
  }
  // Extra columns to show: fields of this table, each once (older replies have none)
  const columns = [];
  if (raw.columns != null) {
    if (!Array.isArray(raw.columns)) return { problem: 'Columns must be a list.' };
    if (raw.columns.length > ASK.MAX_COLUMNS) return { problem: 'Too many columns (at most ' + ASK.MAX_COLUMNS + ').' };
    for (const c of raw.columns) {
      if (!field(c)) return { problem: 'The ' + raw.table + ' table has no field "' + c + '" to show.' };
      if (!columns.includes(c)) columns.push(c);
    }
  }
  return { problem: '', query: { table: raw.table, region, filters, sortField, sortDir, limit, columns } };
}

/**
 * Reads Gemini's reply text and checks it.
 * @return {{status:'query', query:Object, reason:string}|{status:'cannot'|'invalid', reason:string}}
 */
function readQueryAnswer_(text) {
  let obj;
  try {
    obj = JSON.parse(String(text || '').replace(/```(?:json)?/gi, '').trim());
  } catch (e) {
    return { status: 'invalid', reason: 'the AI\'s answer was not valid JSON' };
  }
  const reason = String((obj && obj.reason) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (obj && obj.status === 'cannot') return { status: 'cannot', reason: reason || 'That question can\'t be answered from your list.' };
  const checked = checkQuery_(obj);
  if (checked.problem) return { status: 'invalid', reason: checked.problem };
  return { status: 'query', query: checked.query, reason };
}

// ---------------------------------------------------------------------------
//  3. Saying how the query was understood, in plain English
// ---------------------------------------------------------------------------

const ASK_OP_WORDS_ = {
  eq: 'is', ne: 'is not', lt: 'is under', lte: 'is at most', gt: 'is over', gte: 'is at least',
  contains: 'contains', has: 'include', lacks: 'don\'t include',
};
const ASK_DATE_WORDS_ = { eq: 'on', lt: 'before', lte: 'on or before', gt: 'after', gte: 'on or after' };

/** One filter in words, e.g. "% seen is under 10" or "that I've seen". */
function describeFilter_(table, f) {
  const [type, label] = ASK_TABLES_[table].fields[f.field];
  if (f.field === 'seen' && type === 'yesno') return f.value ? 'that I\'ve seen' : 'that I haven\'t seen';
  if (f.field === 'threatened') return f.value ? 'that are threatened' : 'that aren\'t threatened';
  if (type === 'date') return label.toLowerCase() + ' ' + ASK_DATE_WORDS_[f.op] + ' ' + f.value;
  if (type === 'list') return 'whose ' + label.toLowerCase() + ' ' + ASK_OP_WORDS_[f.op] + ' ' + f.value;
  const value = type === 'text' ? '“' + f.value + '”' : f.field === 'pctSeen' ? f.value + '%' : f.value;
  return 'where ' + label.toLowerCase() + ' ' + ASK_OP_WORDS_[f.op] + ' ' + value;
}

/**
 * The query in words, so people can spot a misreading, e.g.
 * "Families (Africa only) where % seen is under 10%, lowest % seen first, up to 25."
 */
function describeQuery_(q) {
  const T = ASK_TABLES_[q.table];
  let s = T.noun[1].charAt(0).toUpperCase() + T.noun[1].slice(1);
  if (q.region) s += q.table === 'species' ? ' found in ' + q.region : ' (' + q.region + ' species only)';
  // "where % seen is under 10% and seen is over 0": "where" only once
  if (q.filters.length) s += ' ' + q.filters.map((f, i) => describeFilter_(q.table, f).replace(i ? /^where / : /^$/, '')).join(' and ');
  const [type, label] = T.fields[q.sortField];
  const words = type === 'date' ? (q.sortDir === 'desc' ? 'newest first' : 'oldest first')
    : type === 'number' ? (q.sortDir === 'desc' ? 'highest first' : 'lowest first')
      : (q.sortDir === 'desc' ? 'Z to A' : 'A to Z');
  s += ', ' + label.toLowerCase() + ' ' + words + ', up to ' + q.limit;
  const shown = (q.columns || []).filter(c => !T.show.includes(c));
  if (shown.length) s += ', showing ' + shown.map(c => T.fields[c][1].toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1');
  s += '.';
  return s.replace(/\s+,/g, ',');
}

// ---------------------------------------------------------------------------
//  4. Running a query (in the browser, on the visitor's own data)
// ---------------------------------------------------------------------------

/**
 * Families and orders, worked out from the species rows (after any region
 * limit), so their counts always agree with the species table.
 * Living species only, as on the rest of the dashboard.
 */
function groupSpecies_(species, key) {
  const groups = new Map();
  species.forEach(s => {
    if (s.extinct) return;
    let g = groups.get(s[key]);
    if (!g) {
      g = key === 'familyLatin'
        ? { family: s.family, familyLatin: s.familyLatin, order: s.order, species: 0, seen: 0 }
        : { order: s.order, families: new Set(), seenFamilies: new Set(), species: 0, seen: 0 };
      groups.set(s[key], g);
    }
    g.species++;
    if (s.seen) g.seen++;
    if (g.families) { g.families.add(s.familyLatin); if (s.seen) g.seenFamilies.add(s.familyLatin); }
  });
  return [...groups.values()].map(g => {
    const row = Object.assign({}, g, { notSeen: g.species - g.seen, pctSeen: g.species ? Math.round(1000 * g.seen / g.species) / 10 : 0 });
    if (g.families) { row.families = g.families.size; row.familiesSeen = g.seenFamilies.size; delete row.seenFamilies; }
    return row;
  });
}

/** Does one row pass one filter? Text is compared ignoring capitals and accents. */
function askMatch_(type, have, op, want, aliases) {
  if (type === 'list') {
    const w = askTidy_(aliases && aliases[askTidy_(want)] || want);
    const found = (have || []).some(x => askTidy_(x) === w);
    return op === 'has' ? found : !found;
  }
  if (have === null || have === undefined || have === '') return op === 'ne';   // unknown: only "is not" passes
  if (type === 'text') {
    const h = askTidy_(have), w = askTidy_(aliases && aliases[askTidy_(want)] || want);
    return op === 'contains' ? h.includes(w) : op === 'eq' ? h === w : h !== w;
  }
  if (type === 'yesno') return have === want;
  const a = type === 'date' ? String(have) : Number(have), b = type === 'date' ? String(want) : Number(want);
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'gt': return a > b;
    case 'gte': return a >= b;
  }
  return false;
}

/**
 * Runs a checked query on the visitor's data.
 * @param {Object} q  from checkQuery_
 * @param {Object} data  { species: [...], countries: [...], years: [...], months: [...],
 *                         countryNames: { tidied other name -> country name } }
 *   Species rows have the species-table fields plus `extinct`; `regions` must
 *   already include the regions a "Worldwide" species counts towards.
 * @return {{columns: Array<{field, label, type}>, rows: Array[], total: number}}
 */
function runQuery_(q, data) {
  const T = ASK_TABLES_[q.table];
  let rows;
  if (ASK_REGION_TABLES_.includes(q.table)) {
    // Extinct species are left out unless they're on the list
    let species = (data.species || []).filter(s => !s.extinct || s.seen);
    if (q.region) species = species.filter(s => (s.regions || []).includes(q.region));
    rows = q.table === 'species' ? species
      : groupSpecies_(species, q.table === 'families' ? 'familyLatin' : 'order');
  } else {
    rows = data[q.table] || [];
  }

  const aliases = data.countryNames || {};
  rows = rows.filter(r => q.filters.every(f => {
    const type = T.fields[f.field][0];
    const isCountry = f.field === 'countries' || f.field === 'country';
    return askMatch_(type, r[f.field], f.op, f.value, isCountry ? aliases : null);
  }));

  // Sort; rows with no value (e.g. species never seen have no first date) go last
  const type = T.fields[q.sortField][0];
  const dir = q.sortDir === 'desc' ? -1 : 1;
  rows = rows.slice().sort((a, b) => {
    const x = a[q.sortField], y = b[q.sortField];
    const xm = x === null || x === undefined || x === '', ym = y === null || y === undefined || y === '';
    if (xm || ym) return xm && ym ? 0 : xm ? 1 : -1;
    if (type === 'text') return dir * String(x).localeCompare(String(y));
    return dir * (x < y ? -1 : x > y ? 1 : 0);
  });

  // Columns: the table's usual ones, plus any field the question filtered or sorted by
  // (not the table's usual order, e.g. month number, which needs no column of its own)
  const fields = T.show.slice();
  (q.columns || []).forEach(f => { if (!fields.includes(f)) fields.push(f); });     // asked for by the question
  // (a yes/no filter needs no column either: every row would say the same)
  const extra = q.filters.filter(f => T.fields[f.field][0] !== 'yesno').map(f => f.field)
    .concat(q.sortField === T.sort[0] ? [] : [q.sortField]);
  extra.forEach(f => { if (!fields.includes(f)) fields.push(f); });
  return {
    columns: fields.map(f => ({ field: f, label: T.fields[f][1], type: T.fields[f][0] })),
    rows: rows.slice(0, q.limit).map(r => fields.map(f => r[f] === undefined ? null : r[f])),
    total: rows.length,
  };
}
