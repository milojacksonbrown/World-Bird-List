// The page: loads the checklist, reads the eBird file, shows the results.
// All the calculations are in dashboard-data.js (tested); this file only displays them.
// Wrapped in a function so its names can't clash with the shared LifeList.js code.

(() => {
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('en-GB');
  const pct = x => (x * 100).toFixed(1) + '%';
  const date = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date unknown';
  const status = msg => { $('#status').textContent = msg || ''; };

  // Country outlines: Natural Earth (public domain), pinned to a fixed release
  const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Colours come from styles.css, so the charts and map match the page
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  let checklist = null, matching = null, countries = null, stickers = null;
  let charts = [], map = null, countryLayer = null, countryShapes = null;
  let stateLayer = null, zoomed = null;                 // zoomed: {cc, name} of the country whose regions are shown
  const regionFiles = new Map();                        // cc -> its docs/data/regions file (null if it didn't load)
  let regionTotals;                                     // species recorded per region, from eBird (tools/fetch-region-totals.js); null if absent
  let current = null;                  // { text, label, d }: the file shown, so fixes can recalculate it

  // Name fixes the visitor has accepted: eBird scientific name (lower case) -> AviList name or 'IGNORE'.
  // Kept in their own browser; wrapped in try because browser storage can be blocked.
  const FIXES_KEY = 'lifelist.fixes';
  function loadFixes() {
    try { return new Map(JSON.parse(localStorage.getItem(FIXES_KEY) || '[]')); } catch (e) { return new Map(); }
  }
  function saveFixes(fixes) {
    try { localStorage.setItem(FIXES_KEY, JSON.stringify([...fixes])); } catch (e) { status('Your browser blocked saving fixes, so they will last until you reload.'); }
    sessionFixes = fixes;
  }
  let sessionFixes = null;             // fallback if storage is blocked
  const getFixes = () => { const f = loadFixes(); return f.size || !sessionFixes ? f : sessionFixes; };

  async function init() {
    status('Loading the AviList checklist…');
    try {
      const res = await fetch('data/avilist.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      checklist = loadChecklist_(await res.json());
      // Which species have a sticker (huashu-bird-sticker); without it, the silhouettes are used
      fetch('data/stickers.json').then(r => r.ok ? r.json() : null).then(st => { stickers = st; if (current) { renderLifers(); renderAsk(); } }).catch(() => {});
      // Country names for "Ask your list"; if they don't load, countries show as codes
      fetch('data/countries.json').then(r => r.ok ? r.json() : null).then(c => { countries = c && loadCountries_(c); }).catch(() => {});
      $('#citation').innerHTML = 'Checklist: ' + esc(checklist.citation).replace(/(https:\/\/doi\.org\/\S+)/, '<a href="$1">$1</a>') +
        '. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>; converted to a smaller format for this site.';
      $('#controls').hidden = false;
      status('');
      redrawTrail();                         // the footer credit just grew: redraw the route to fit
    } catch (e) {
      status('Sorry, the checklist could not be loaded (' + e.message + '). Please try reloading the page.');
    }
  }

  function show(text, label, keepPlace) {
    if (!keepPlace) { $('#lifer-search').value = ''; lifersShown = LIFERS_FIRST; lastAsk = null; zoomed = null; }   // a new file starts fresh
    try {
      const d = buildDashboard_(parseCsvText_(text), checklist, getFixes());
      current = { text, label, d };
      render(d, label, keepPlace);
      status('');
    } catch (e) {
      status(e.message);
    }
  }

  function render(d, label, keepPlace) {
    const t = d.totals;
    $('#source-label').textContent = label;
    $('#stats').innerHTML = [
      ['Species', num(t.species), 'of ' + num(t.worldSpecies) + ' living species · ' + pct(t.worldPct)],
      ['Families', num(t.families), 'of ' + num(t.worldFamilies)],
      ['Orders', num(t.orders), 'of ' + num(t.worldOrders)],
      ['Countries', num(t.countries), 'where you\'ve recorded a species'],
      ['Threatened', num(t.threatened), 'species listed Vulnerable or worse (IUCN)'],
      ['Records', num(t.records), num(t.skipped) + ' not countable (sp., slashes, hybrids)'],
    ].map(([label, n, of]) =>
      '<div class="stat"><span class="n">' + n + '</span><span class="label">' + esc(label) + '</span><span class="of">' + esc(of) + '</span></div>'
    ).join('');

    renderLifers();
    renderAsk();                               // re-runs the last question on the new numbers (e.g. after a fix)

    renderNameFixes(d);
    quizReset();                               // a new file: back to the start screen
    $('#explore-result').innerHTML = '';
    setupExplore();                            // Explore starts on the country of your latest lifer

    $('#dashboard').hidden = false;     // must be visible before the map and charts measure their size
    renderRegions(d);
    renderCharts(d);
    renderMap(d);
    redrawTrail();                             // the page is taller now: redraw the decorative route
    warmUp();                                  // fetch what fact files and questions need, in the background
    if (!keepPlace) $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Latest lifers: the newest few, Show all / Show fewer, and a search ----------
  const LIFERS_FIRST = 10, LIFERS_STEPS = [50, 100];   // shown at first; then these, or all
  let lifersShown = LIFERS_FIRST;

  /**
   * A bird's icon: its sticker (a small copy kept with the site), or, if it has none or the
   * picture doesn't load, a silhouette of its family's body shape (bird-icons.js).
   */
  function birdIcon(sci, familyLatin, order, size) {
    const shape = birdShape_(familyLatin, order);
    const sp = sci && checklist.species[checklist.bySci.get(String(sci).toLowerCase())];
    const st = sp && stickerFor_(sp, stickers);
    if (st) {
      return '<span class="icon sticker" data-shape="' + esc(shape) + '" data-size="' + size + '"><img src="' + esc(st.thumb) +
        '" width="' + size + '" height="' + size + '" alt="" loading="lazy" decoding="async"></span>';
    }
    return '<span class="icon" title="' + esc(SHAPES[shape].label) + '">' + birdIconSvg_(shape, size) + '</span>';
  }
  // A sticker that fails to load is swapped for the silhouette (error events don't bubble, so this listens on the way down)
  document.addEventListener('error', e => {
    const box = e.target.closest && e.target.closest('.icon.sticker');
    if (!box) return;
    box.classList.remove('sticker');
    box.innerHTML = birdIconSvg_(box.dataset.shape, Number(box.dataset.size) || 26);
  }, true);

  /** An IUCN Red List category as a coloured badge (green for Least Concern through to red for Critically Endangered). */
  const IUCN_CODES = ['LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'EX', 'DD'];
  const iucnBadge = code => {
    const c = String(code || '').split(' ')[0].toUpperCase();
    return IUCN_CODES.includes(c) ? '<span class="iucn iucn-' + c + '" title="' + esc(IUCN_NAMES_[c]) + '">' + c + '</span>' : esc(code);
  };

  /** A bird's name as a button that opens its fact file. */
  const birdButton = (sci, inner) => '<button type="button" class="bird-link" data-sci="' + esc(sci) + '">' + inner + '</button>';

  function liferItem(l) {
    return '<li><span class="date">' + esc(date(l.date)) + '</span>' +
      '<span class="who">' + birdIcon(l.sci, l.familyLatin, l.order, 30) +
        '<span>' + birdButton(l.sci, '<span class="name">' + esc(l.common) + '</span>') + localNameHtml(l.i) + ' <span class="sci">' + esc(l.sci) + '</span></span></span>' +
      // Link only real eBird checklist IDs ("S123…"); the sample data's are made up
      '<span class="where">' + (/^S\d+$/.test(l.checklist)
        ? '<a href="https://ebird.org/checklist/' + encodeURIComponent(l.checklist) + '">' + esc(l.place || 'eBird checklist') + '</a>'
        : esc(l.place)) + '</span></li>';
  }

  function renderLifers() {
    const all = current ? current.d.lifers : [];
    const q = $('#lifer-search').value.trim();
    const matches = filterLifers_(all, q);
    const shown = q ? matches : matches.slice(0, lifersShown);   // a search shows every match
    $('#lifers').innerHTML = shown.map(liferItem).join('') ||
      '<li class="none">' + (q ? 'No lifers match “' + esc(q) + '”.' : 'No countable species found in this file.') + '</li>';
    $('#lifer-count').textContent = q
      ? num(matches.length) + ' lifer' + (matches.length === 1 ? '' : 's') + ' match “' + q + '”'
      : 'Showing ' + num(shown.length) + ' of ' + num(all.length) + ' lifers';
    // Below the list: longer lists to choose from, and Show fewer once it's longer than the first 10.
    // Show fewer is also at the top, so a long list can be closed without scrolling to its end.
    const longer = !q && shown.length > LIFERS_FIRST;
    const options = q ? [] : LIFERS_STEPS.filter(n => n > shown.length && n < all.length)
      .map(n => '<button type="button" class="button small" data-show="' + n + '" aria-controls="lifers">Show latest ' + n + '</button>')
      .concat(shown.length < all.length ? ['<button type="button" class="button small" data-show="all" aria-controls="lifers">Show all ' + num(all.length) + '</button>'] : []);
    $('#lifers-more').innerHTML = options.join('') +
      (longer ? '<button type="button" class="button small lifers-fewer" data-show="fewer" aria-controls="lifers">Show fewer</button>' : '');
    $('.lifer-tools .lifers-fewer').hidden = !longer;
  }

  $('#lifer-search').addEventListener('input', renderLifers);
  // One handler for every Show button, at the top and the bottom of the list
  $('#lifers-title').closest('section').addEventListener('click', e => {
    const b = e.target.closest('[data-show]');
    if (!b || !current) return;
    const v = b.dataset.show, total = current.d.lifers.length;
    lifersShown = v === 'fewer' ? LIFERS_FIRST : v === 'all' ? total : Number(v);
    renderLifers();
    redrawTrail();                                           // the page changed height
    // after collapsing a long list, bring the section back into view
    if (v === 'fewer') $('#lifers-title').scrollIntoView({ block: 'nearest' });
  });

  // ---------- Bird sounds: recordings from xeno-canto, streamed from there when played ----------
  let soundsLoading = null, soundsData = null;           // soundsData: set once loaded
  const loadSounds = () => (soundsLoading = soundsLoading || fetch('data/sounds.json')
    .then(r => (r.ok ? r.json() : null)).then(j => (soundsData = (j && j.species) || {})).catch(() => (soundsData = {})));
  /** A player for one recording, with its credit (required by its licence). */
  const soundPlayer = r => {
    const s = soundInfo_(r);
    return '<div class="sound"><div class="sound-label">' + esc(s.label) + '</div>' +
      '<audio controls preload="none" src="' + esc(s.file) + '"></audio>' +
      '<div class="sound-credit"><a href="' + esc(s.page) + '">' + esc(s.credit.split(',')[0]) + '</a>,' + esc(s.credit.slice(s.credit.indexOf(',') + 1)).replace(/(CC [A-Z-]+ [\d.]+)$/, s.licenceUrl ? '<a href="' + esc(s.licenceUrl) + '">$1</a>' : '$1') + '</div></div>';
  };
  // Only one recording plays at a time, anywhere on the page
  document.addEventListener('play', e => { document.querySelectorAll('audio').forEach(a => { if (a !== e.target) a.pause(); }); }, true);

  // ---------- Bird names in other languages (IOC World Bird List, via huashu-bird-sticker) ----------
  // Pick a language and every bird's name in it is shown beside the English one: in the lifer
  // list, answers, fact files and the quiz (where typed answers in it count too). One small file
  // per language (docs/data/names/), fetched when chosen; the choice is kept in this browser.
  const NAMES_KEY = 'lifelist.namesLang';
  const names = { lang: '', label: '', list: null, langs: [] };
  const localName = i => (names.list && i !== undefined && i !== null && names.list[i]) || '';
  const localNameHtml = i => (localName(i) ? ' <span class="local-name" lang="' + esc(names.lang) + '">' + esc(localName(i)) + '</span>' : '');
  async function setNamesLang(code) {
    const l = names.langs.find(x => x.code === code);
    if (!l) { Object.assign(names, { lang: '', label: '', list: null }); }
    else {
      try {
        const res = await fetch('data/names/' + encodeURIComponent(code) + '.json');
        const data = await res.json();
        if (data.count !== checklist.species.length) throw new Error('names file out of date');
        Object.assign(names, { lang: code, label: l.english, list: data.names });
      } catch (e) { status('Sorry, the ' + l.english + ' names could not be loaded (' + e.message + ').'); return; }
    }
    try { localStorage.setItem(NAMES_KEY, names.lang); } catch (e) { /* not remembered */ }
    $('#names-lang').value = names.lang;
    if (current) { renderLifers(); renderAsk(); }
    if ($('#factfile').open && factOpener) openFactFile(factOpener.dataset.sci, factOpener);
  }
  fetch('data/names/languages.json').then(r => (r.ok ? r.json() : null)).then(data => {
    if (!data) return;
    names.langs = data.languages;
    $('#names-lang').insertAdjacentHTML('beforeend', data.languages.map(l =>
      '<option value="' + esc(l.code) + '">' + esc(l.english) + (l.native && l.native !== l.english ? ' · ' + esc(l.native) : '') + '</option>').join(''));
    $('.names-lang').hidden = false;
    let saved = '';
    try { saved = localStorage.getItem(NAMES_KEY) || ''; } catch (e) { /* none */ }
    if (saved) setNamesLang(saved);
  }).catch(() => {});
  $('#names-lang').addEventListener('change', e => setNamesLang(e.target.value));

  // ---------- Fact files: click a bird for everything known about it ----------
  let rangesLoading = null, rangesData = null;           // rangesData: set once loaded
  const loadRanges = () => (rangesLoading = rangesLoading || fetch('data/ranges.json')
    .then(r => r.ok ? r.json() : null).then(j => (rangesData = (j && j.ranges) || {})).catch(() => (rangesData = {})));
  let factOpener = null;                 // the button that opened it, to return focus there

  async function openFactFile(sci, opener) {
    const sp = checklist.species[checklist.bySci.get(String(sci).toLowerCase())];
    if (!sp || !current) return;
    factOpener = opener || null;
    const dlg = $('#factfile');
    $('#factfile-body').innerHTML = '<p class="working">Opening the fact file…</p>';
    if (!dlg.open) dlg.showModal();
    // The sizes and facts are needed to draw it; AviList's range text (1.9 MB) and the sounds (4 MB)
    // are slotted in when they arrive, so the fact file never waits for them. (They're usually
    // here already: warmUp fetches them while the visitor looks at the dashboard.)
    const [data, other] = await Promise.all([askTables(), loadOtherNames()]);
    const row = data.species.find(r => r.scientific === sp.sci);
    const lifer = current.d.lifers.find(l => l.sci === sp.sci);
    const f = factFile_(sp, row, { lifer, range: (rangesData && rangesData[sp.sci]) || '', stickers });
    $('#factfile-body').innerHTML = factFileHtml(f, row, (soundsData && soundsData[sp.sci]) || [], other.splitFrom[sp.sci]);
    $('#factfile-body').dataset.sci = sp.sci;
    fitFactFileBird(f, row);
    const st = current.d.stats && current.d.stats.species && current.d.stats.species[sp.i];
    drawRangeMap(sp, st && st.points ? [...st.points.values()] : []);
    const stillOpen = () => dlg.open && $('#factfile-body').dataset.sci === sp.sci;
    if (!rangesData) loadRanges().then(ranges => {
      const text = factFile_(sp, row, { lifer, range: ranges[sp.sci] || '', stickers }).range;
      if (stillOpen() && $('#ff-range-slot')) $('#ff-range-slot').innerHTML = rangeBlock(text);
    });
    if (!soundsData) loadSounds().then(sounds => {
      if (stillOpen() && $('#ff-sounds-slot')) $('#ff-sounds-slot').innerHTML = soundsBlock(sounds[sp.sci] || []);
    });
  }

  /** The fact file's "Where it lives" (AviList's range text) and "Sounds" sections. */
  const rangeBlock = text => (text ? '<section class="ff-block ff-range"><h3>Where it lives</h3><p>' + esc(text) + ' <span class="src">AviList</span></p></section>' : '');
  const soundsBlock = recs => (recs.length ? '<section class="ff-block ff-sounds"><h3>Sounds</h3><div class="sounds">' + recs.map(soundPlayer).join('') + '</div>' +
    '<p class="ff-credit">Recordings from <a href="https://xeno-canto.org">xeno-canto</a>, shared by their recordists.</p></section>' : '');

  // ---------- Getting ready for what's likely next ----------
  // Once the dashboard has drawn, while the visitor looks at it: fetch what fact files and
  // questions need (about 1 MB, compressed), build the question tables, and wake Lyrebird.
  // Apps Script takes a few seconds to answer its first request after a quiet spell; a plain
  // visit to its address (no AI, nothing counted) gets that wait over before anyone asks.
  let warmedUp = false;
  function warmUp() {
    if (warmedUp) return;
    warmedUp = true;
    const later = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 4000 }) : f => setTimeout(f, 2000);
    later(() => {
      if (LYREBIRD_URL) fetch(LYREBIRD_URL, { mode: 'no-cors' }).catch(() => {});
      askTables().catch(() => {});
      loadOtherNames(); loadRanges(); loadSounds();
      loadWorld().catch(() => {});
    });
  }

  // ---------- The range map: GBIF records by season, drawn in the page's own colours ----------
  // GBIF (gbif.org) gathers bird records from eBird, museums and other surveys. Its map service
  // sends the records for a species and months as a grid of cells (vector tiles); zoom 1 is four
  // tiles, cells of about 150 km. Two seasons, so eight small requests, made only when a fact file opens.
  // Only eBird's records are asked for: eBird's reviewers check unusual sightings (a Hobby in
  // December, say), so far fewer mistakes and wrong dates get through than in GBIF's other sources.
  // A species with no eBird records on GBIF falls back to every source.
  const GBIF = 'https://api.gbif.org/';
  const EBIRD_ON_GBIF = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';     // "EOD – eBird Observation Dataset"
  const gbifKeys = new Map(), rangeCache = new Map();
  // Some AviList species are under another name on GBIF (renamed, or spelled differently), or are
  // recent splits GBIF still files under the species they were split from: tools/build-other-names.js
  let otherNamesLoading = null;
  const loadOtherNames = () => (otherNamesLoading = otherNamesLoading || fetch('data/other-names.json')
    .then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => j || { renamed: {}, splitFrom: {} }));
  /** GBIF's key for one name, by strict match; asked again as a bird if the name is also a plant or insect. */
  const gbifMatch = name => ['', '&kingdom=Animalia&class=Aves'].reduce((found, extra) => found.then(key => key ||
    fetch(GBIF + 'v1/species/match?rank=SPECIES&strict=true' + extra + '&name=' + encodeURIComponent(name))
      .then(r => (r.ok ? r.json() : null))
      .then(m => (m && m.usageKey && m.rank === 'SPECIES' && m.matchType === 'EXACT' ? m.acceptedUsageKey || m.usageKey : null))), Promise.resolve(null));
  /** { key, as }: GBIF's key for a species, and the other name it was found under (if any). */
  async function gbifKey(sci) {
    if (!gbifKeys.has(sci)) {
      gbifKeys.set(sci, (async () => {
        const key = await gbifMatch(sci);
        if (key) return { key, as: '' };
        const other = (await loadOtherNames()).renamed[sci];
        const otherKey = other ? await gbifMatch(other) : null;
        return { key: otherKey, as: otherKey ? other : '' };
      })());
    }
    return gbifKeys.get(sci);
  }
  async function seasonTiles(key, months, dataset) {
    const tiles = await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(async ([x, y]) => {
      const res = await fetch(GBIF + 'v2/map/occurrence/adhoc/1/' + x + '/' + y + '.mvt?taxonKey=' + key + '&' + months +
        (dataset ? '&datasetKey=' + dataset : '') +
        '&basisOfRecord=HUMAN_OBSERVATION&occurrenceStatus=PRESENT&hasGeospatialIssue=false&mode=GEO_CENTROID&srs=EPSG:3857');
      if (!res.ok) throw new Error('GBIF ' + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.length ? readMvtPoints_(buf).points : [];
    }));
    return tiles.flat();
  }
  // Range maps already drawn are remembered in this browser for a month (the 40 most recent),
  // so opening the same bird again needs no GBIF requests. Only the grid squares are kept.
  const RANGE_STORE = 'lifelist.rangeMaps.v1', RANGE_KEEP = 40, RANGE_DAYS = 30;
  const rangeStore = () => { try { return JSON.parse(localStorage.getItem(RANGE_STORE) || '{}'); } catch (e) { return {}; } };
  function savedRange(sci) {
    const r = rangeStore()[sci];
    if (!r || Date.now() - r.t > RANGE_DAYS * 864e5) return null;
    const cells = r.cells.map(([hash, season, total]) => ({ hash, box: geohashBox_(hash), season, total })).filter(c => c.box);
    return { cells, key: r.key, ebird: r.ebird, as: r.as };
  }
  function saveRange(sci, range) {
    if (!range.key) return;                                  // not found on GBIF: ask again next time
    try {
      const all = rangeStore();
      all[sci] = { t: Date.now(), key: range.key, ebird: range.ebird, as: range.as, cells: range.cells.map(c => [c.hash, c.season, c.total]) };
      const keep = Object.keys(all).sort((a, b) => all[b].t - all[a].t).slice(0, RANGE_KEEP);
      localStorage.setItem(RANGE_STORE, JSON.stringify(Object.fromEntries(keep.map(k => [k, all[k]]))));
    } catch (e) { /* storage full or blocked: the map is just fetched again next time */ }
  }
  function loadRange(sci) {
    const saved = !rangeCache.has(sci) && savedRange(sci);
    if (saved) rangeCache.set(sci, Promise.resolve(saved));
    if (!rangeCache.has(sci)) {
      const p = gbifKey(sci).then(async ({ key, as }) => {
        if (!key) return { cells: [], key: null };
        const seasons = dataset => Promise.all([seasonTiles(key, 'month=6,7', dataset), seasonTiles(key, 'month=12&month=1', dataset)]);
        let [june, december] = await seasons(EBIRD_ON_GBIF), ebird = true;
        if (!june.length && !december.length) { [june, december] = await seasons(null); ebird = false; }
        return { cells: seasonCells_(june, december), key, ebird, as };
      });
      p.then(r => saveRange(sci, r), () => rangeCache.delete(sci));   // remembered; or, if it failed, tried again next time
      rangeCache.set(sci, p);
    }
    return rangeCache.get(sci);
  }
  let worldShapes = null;
  const loadWorld = () => (worldShapes = worldShapes || (countryShapes ? Promise.resolve(countryShapes)
    : fetch(COUNTRIES_URL).then(r => r.json())));

  async function drawRangeMap(sp, sightings) {
    const box = $('#ff-map');
    if (!box) return;
    try {
      const [range, world, other] = await Promise.all([loadRange(sp.sci), loadWorld(), loadOtherNames()]);
      if ($('#ff-map') !== box) return;                      // another bird was opened meanwhile
      // A recent split: GBIF still files its records under the species it was split from
      const parent = !range.cells.length && other.splitFrom[sp.sci];
      const parentSp = parent && checklist.species[checklist.bySci.get(parent.toLowerCase())];
      const splitNote = parent ? 'No range map yet: this species was recently split from ' +
        (parentSp ? esc(parentSp.common) + ' (<i>' + esc(parent) + '</i>)' : '<i>' + esc(parent) + '</i>') +
        ', and GBIF still files its records under that species.' : '';
      if (!range.cells.length && !sightings.length) {
        box.innerHTML = '<p class="ai-note">' + (splitNote || 'No mapped records for this species on GBIF.') + '</p>';
        return;
      }
      box.innerHTML = rangeMapSvg_(range.cells, world, sightings);
      if (splitNote) $('#ff-map-credit').innerHTML = splitNote + ' Only your own sightings are shown.';
      else if (range.key) $('#ff-map-credit').innerHTML = (range.ebird ? 'eBird records' : 'Records (none from eBird, so from all sources)') +
        ', via <a href="https://www.gbif.org/species/' + range.key + '">GBIF.org</a>' +
        (range.as ? ', where it\'s listed as <i>' + esc(range.as) + '</i>' : '') + '. ' +
        'June–July is summer in the north and winter in the south.';
    } catch (e) {
      if ($('#ff-map') === box) box.innerHTML = '<p class="ai-note">The map couldn\'t be loaded just now (' + esc(e.message) + ').</p>';
    }
  }

  /** For a recent split with no measurements of its own: why, in place of a gap. */
  function splitSizeNote(f, parent) {
    if (!parent || f.size.some(x => x.label === 'Wing length')) return '';
    const p = checklist.species[checklist.bySci.get(parent.toLowerCase())];
    return '<p class="ai-note">' + (f.size.length ? 'No measurements' : 'No size facts') + ' of its own yet: it was recently split from ' +
      (p ? esc(p.common) : '<i>' + esc(parent) + '</i>') + ', and the published datasets still measure them together.</p>';
  }

  /** Nest types, each with its drawing (nest-icons.js) where it has one. */
  const nestWithIcons = types => types.map(t => '<span class="with-nest">' +
    (NEST_ICONS_[t] ? '<span class="icon nest" title="' + esc(NEST_ICONS_[t].label) + '">' + nestIconSvg_(t, 20) + '</span>' : '') + esc(t) + '</span>');

  // ---------- Size comparison: the bird beside a person, or beside a hand if it's small ----------
  const PERSON_MM = 1750, HAND_MM = 190;
  const PERSON = '<circle cx="30" cy="11" r="9.5"/><path d="M19 24c5-2.5 17-2.5 22 0 3 1.2 4.6 3.8 5 7l4 30c.4 3.2-3.6 4.2-4.6 1.2L41 37v24l-1.6 63c-.1 3.4-6.8 3.4-7 0L30.6 74h-1.2l-1.8 50c-.2 3.4-6.9 3.4-7 0L19 61V37l-4.4 25.2c-1 3-5 2-4.6-1.2l4-30c.4-3.2 2-5.8 5-7Z"/>';     // 128 tall
  // An open hand, palm on, fingers spread a little (one smooth outline): about 100 wide, 128 tall
  const HAND = '<path d="M36 128 C27 126 21 116 19 104 C17 96 12 86 7 77 C2 68 -2 60 1 55 C4 50 9 51 12 56 C16 63 21 72 25 79 C27 82 29 80 30 74 L17.6 19.6 A6.6 6.6 0 0 1 30.4 16.4 L43 62 Q44.5 65 46 60 L43.2 6.4 A6.8 6.8 0 0 1 56.8 5.6 L60 59 Q61.5 63 63 60 L69.6 13.1 A6.5 6.5 0 0 1 82.4 14.9 L76 63 Q77.5 67 79 64 L89.2 27.4 A6 6 0 0 1 100.8 30.6 L91 68 C92 80 92 98 88 111 C83 122 73 128 60 128 C50 128 43 129 36 128Z"/>';

  // Where the bird is inside a sticker (the pictures have transparent space around the bird), as
  // fractions of the picture: { l, t, r, b }. Measured once per bird from its small thumbnail.
  const birdBoxes = new Map();
  function birdBox(thumb) {
    if (!birdBoxes.has(thumb)) {
      birdBoxes.set(thumb, new Promise(done => {
        const img = new Image();
        img.onload = () => {
          try {
            const n = img.naturalWidth, m = img.naturalHeight, c = document.createElement('canvas');
            c.width = n; c.height = m;
            const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const a = g.getImageData(0, 0, n, m).data;
            let l = n, r = -1, t = m, b = -1;
            for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) {
              if (a[(y * n + x) * 4 + 3] > 24) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
            }
            done(r < 0 ? null : { l: l / n, t: t / m, r: (r + 1) / n, b: (b + 1) / m, aspect: m / n });   // aspect: the picture's height ÷ width
          } catch (e) { done(null); }
        };
        img.onerror = () => done(null);
        img.src = thumb;
      }));
    }
    return birdBoxes.get(thumb);
  }

  // The size comparison. box: where the bird is in its picture (birdBox), so its feet can stand on
  // the ground line and its length can be measured from the bird, not the picture.
  function sizeComparison(f, row, box) {
    const len = estimateLength_(row, birdShape_(f.familyLatin, f.order));
    if (!len || !f.sticker) return '';
    const bb = box || { l: 0.1, t: 0.1, r: 0.9, b: 0.95, aspect: 1 };   // a guess until it's measured
    const small = len <= 200, refMm = small ? HAND_MM : PERSON_MM, H = 150;   // a hand only for birds of 20 cm or less
    const px = H / refMm;                                      // pixels per millimetre
    const w = Math.max(6, len * px / Math.max(0.2, bb.r - bb.l));   // picture width that makes the bird itself to scale
    const h = w * bb.aspect;                                   // the pictures aren't square
    const inset = small ? Math.round(5 * H / 128) : 0;        // room for the hand's thumb, which reaches left
    const refW = (small ? 103 : 64) * H / 128 + inset;
    const tall = Math.max(H, (bb.b - bb.t) * h), ground = tall + 4;   // room for whichever is taller, so nothing is cut off
    const birdX = refW + 14 - bb.l * w, birdY = ground - bb.b * h;   // the bird's feet on the ground line
    const cm = len >= 1000 ? (len / 1000).toFixed(1).replace(/\.0$/, '') + ' m' : Math.round(len / 10) + ' cm';
    // Just the picture: the length is in its label for screen readers, and in a tooltip
    return '<figure class="ff-size" title="About ' + esc(cm) + ' long (estimated)">' +
      '<svg viewBox="0 ' + Math.round(ground - tall - 2) + ' ' + Math.round(refW + 18 + Math.max((bb.r - bb.l) * w, 40)) + ' ' + Math.round(tall + 6) + '" preserveAspectRatio="xMinYMax meet"' +
        ' role="img" aria-label="' + esc(f.common) + ', about ' + esc(cm) + ' long, to scale beside ' + (small ? 'a hand' : 'a person') + '">' +
        '<g class="ref" transform="translate(' + inset + ' ' + Math.round(ground - H) + ') scale(' + (H / 128).toFixed(3) + ')">' + (small ? HAND : PERSON) + '</g>' +
        '<image href="' + esc(f.sticker.full) + '" x="' + birdX.toFixed(1) + '" y="' + birdY.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>' +
        '<line class="ground" x1="0" x2="100%" y1="' + ground + '" y2="' + ground + '"/>' +
      '</svg></figure>';
  }

  // Once the bird's place in its picture is measured: redraw the size comparison with its feet on
  // the line, and lift the fact file's picture so the bird's head lines up with its name
  async function fitFactFileBird(f, row) {
    if (!f.sticker) return;
    const box = await birdBox(f.sticker.thumb);
    const body = $('#factfile-body');
    if (!box || !body || !body.querySelector('#factfile-title') || $('#factfile-title').textContent !== f.common) return;   // another bird is open
    const size = body.querySelector('.ff-size');
    if (size) size.outerHTML = sizeComparison(f, row, box);
    const pic = body.querySelector('.ff-picture img');
    if (pic) {
      const h = pic.getBoundingClientRect().height || 260;
      pic.style.marginTop = -Math.round(box.t * h) + 'px';
      pic.style.marginBottom = -Math.round((1 - box.b) * h) + 'px';
    }
  }

  function factFileHtml(f, row, recordings, splitFrom) {
    const list = (title, facts) => facts.length ? '<section class="ff-block"><h3>' + esc(title) + '</h3><dl>' +
      facts.map(x => '<div><dt>' + esc(x.label) + '</dt><dd>' +
        (x.label === 'Main habitat' && HABITAT_ICONS_[x.value] ? '<span class="icon habitat">' + habitatIconSvg_(x.value, 20) + '</span>' + esc(x.value)
          : x.nest ? nestWithIcons(x.nest).join(' <span class="or">or</span> ')
            : x.sites ? x.sites.map((st, i) => '<span class="with-nest">' + (NEST_SITE_ICONS_[st] ? '<span class="icon nest" title="' + esc(NEST_SITE_ICONS_[st].label) + '">' +
                nestSiteIconSvg_(st, 20) + '</span>' : '') + esc(nestSiteWords_(st, i > 0)) + '</span>').join(' <span class="or">or</span> ') + ' <span class="or">(type not recorded)</span>'
            : x.missing ? '<span class="not-recorded">' + esc(x.value) + '</span>'
            : esc(x.value)) +
        (x.source ? ' <span class="src">' + esc(x.source) + '</span>' : '') + '</dd></div>').join('') + '</dl></section>' : '';
    const rec = f.records;
    const records = rec
      ? '<section class="ff-block ff-mine"><h3>Your records</h3><dl>' +
        '<div><dt>First seen</dt><dd>' + esc(date(new Date(rec.firstSeen + 'T12:00:00'))) +
          (rec.firstPlace ? ' · ' + (rec.checklist ? '<a href="https://ebird.org/checklist/' + encodeURIComponent(rec.checklist) + '">' + esc(rec.firstPlace) + '</a>' : esc(rec.firstPlace)) : '') + '</dd></div>' +
        '<div><dt>On your checklists</dt><dd>' + num(rec.checklists) + '</dd></div>' +
        (rec.countries.length ? '<div><dt>Countries</dt><dd>' + esc(rec.countries.join(', ')) + '</dd></div>' : '') +
        (rec.places.length ? '<div><dt>Places</dt><dd>' + esc(rec.places.slice(0, 12).join(', ')) + (rec.places.length > 12 ? ' and ' + num(rec.places.length - 12) + ' more' : '') + '</dd></div>' : '') +
        '</dl></section>'
      : '<section class="ff-block ff-mine"><h3>Your records</h3><p class="ai-note">Not on your list yet.</p></section>';
    const regions = f.worldwide ? 'Found worldwide' : f.regions.join(', ');
    return '<div class="ff-top">' +
        '<figure class="ff-picture">' + (f.sticker
          ? '<img src="' + esc(f.sticker.full) + '" alt="Illustration of a ' + esc(f.common) + '" width="320" height="320">' +
            '<figcaption><span class="ai-label">AI illustration</span> ' + esc(stickers.credit.replace(/, CC BY 4.0$/, '')) +
              ' · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></figcaption>'
          : '<div class="ff-none">' + birdIconSvg_(birdShape_(f.familyLatin, f.order), 96) + '<p class="ai-note">No illustration for this species.</p></div>') +
        '</figure>' +
        '<div class="ff-head"><h2 id="factfile-title">' + esc(f.common) + '</h2>' +
          (localName(f.i) ? '<p class="ff-local" lang="' + esc(names.lang) + '">' + esc(localName(f.i)) + ' <span class="src">' + esc(names.label) + '</span></p>' : '') +
          '<p class="sci">' + esc(f.sci) + '</p>' +
          '<p class="ff-family">' + esc(f.family) + ' · <span class="sci">' + esc(f.familyLatin) + '</span> · ' + esc(f.order) + '</p>' +
          (f.iucn ? '<p class="ff-iucn">' + iucnBadge(f.iucn) + ' ' + esc(f.iucnName) + ' <span class="src">IUCN Red List</span></p>' : '') +
          (f.tags.length ? '<p class="ff-tags">' + f.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>' : '') +
          (regions ? '<p class="ff-regions"><strong>Regions:</strong> ' + esc(regions) + '</p>' : '') +
        '</div></div>' +
      '<div id="ff-range-slot">' + rangeBlock(f.range) + '</div>' +
      '<section class="ff-block"><h3>Range map</h3><div id="ff-map" class="ff-map"><p class="working">Loading the map…</p></div>' +
        '<ul class="ff-legend"><li><span class="sw june"></span>Recorded in June–July</li><li><span class="sw december"></span>December–January</li>' +
        '<li><span class="sw both"></span>Year-round</li>' + (f.seen ? '<li><span class="sw mine"></span>Your sightings</li>' : '') + '</ul>' +
        '<p id="ff-map-credit" class="ff-credit"></p></section>' +
      '<div class="ff-grid"><div>' + list('Size', f.size) + splitSizeNote(f, splitFrom) + sizeComparison(f, row) + '</div>' + list('Life', f.life) + '</div>' +
      '<div id="ff-sounds-slot">' + soundsBlock(recordings || []) + '</div>' +
      records +
      (f.links.length ? '<p class="ff-links">More: ' + f.links.map(l => '<a href="' + esc(l.url) + '">' + esc(l.label) + '</a>').join(' · ') + '</p>' : '');
  }

  // Any bird name button on the page opens its fact file
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.bird-link');
    if (b) openFactFile(b.dataset.sci, b);
  });
  $('#factfile-close').addEventListener('click', () => $('#factfile').close());
  $('#factfile').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // a click outside the card
  $('#factfile').addEventListener('close', () => { if (factOpener && document.contains(factOpener)) factOpener.focus(); });

  // ---------- Section buttons: highlight the section being read ----------
  // A section counts as "being read" once its top passes a line a third of the way down the window.
  if (window.IntersectionObserver) {
    const navLinks = [...document.querySelectorAll('#section-nav a')];
    const seen = new Map();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => seen.set(e.target.id, e.isIntersecting));
      const reading = navLinks.map(a => a.getAttribute('href').slice(1)).filter(id => seen.get(id));
      navLinks.forEach(a => a.classList.toggle('here', a.getAttribute('href') === '#' + reading[0]));
    }, { rootMargin: '-30% 0px -60% 0px' });
    navLinks.forEach(a => { const sec = $(a.getAttribute('href')); if (sec) io.observe(sec); });
  }

  // ---------- Test yourself: name your lifers from their stickers ----------
  const QUIZ_LENGTH = 10;
  let quiz = null;                     // { mode, level, birds, i, score, missed, answered, options }
  const quizBestKey = (mode, level, by) => 'lifelist.quizBest.' + (by === 'sound' ? 'sound.' : '') + mode + (mode === 'choice' ? '.' + level : '');
  const readBest = k => { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } };
  const quizSetting = name => (document.querySelector('input[name="' + name + '"]:checked') || {}).value;

  function quizReset() {
    quiz = null;
    $('#quiz-game').hidden = true;
    $('#quiz-setup').hidden = false;
    quizSettingsChanged();
  }
  function quizSettingsChanged() {
    const mode = quizSetting('quiz-mode'), level = quizSetting('quiz-level'), by = quizSetting('quiz-by');
    $('#quiz-level').hidden = mode !== 'choice';                 // difficulty is about the four names
    const best = readBest(quizBestKey(mode, level, by));
    $('#quiz-best').textContent = best ? 'Your best this way: ' + best + ' out of ' + QUIZ_LENGTH + '.' : '';
  }
  document.querySelectorAll('#quiz-setup input').forEach(r => r.addEventListener('change', quizSettingsChanged));

  $('#quiz-start').addEventListener('click', async () => {
    if (!current) return;
    const by = quizSetting('quiz-by');
    const pool = quizPool_(current.d.lifers, checklist, stickers);
    // "Quiz me on…": the request goes through Lyrebird as an Ask your list question, and the
    // checked query picks which of your lifers to ask about (the wrong answers still come from all of them)
    const about = $('#quiz-about').value.trim();
    let scope = null, scopeText = '';
    if (about) {
      const btn = $('#quiz-start');
      btn.disabled = true;
      $('#quiz-best').textContent = 'Working out which birds you mean…';
      try {
        const ans = queryFromLyrebird_(await askLyrebird({ action: 'query', question: ('Which species have I seen that match: ' + about).slice(0, ASK.MAX_QUESTION) }));
        if (ans.status !== 'query') throw new Error(ans.reason || 'that couldn\'t be turned into a group of birds');
        const s = quizScopeQuery_(ans.query);
        if (s.problem) throw new Error(s.problem);
        const res = runQuery_(s.query, await askTables());
        const sciCol = res.columns.findIndex(c => c.field === 'scientific');
        scope = new Set(res.rows.map(r => r[sciCol]));
        scopeText = describeQuery_(s.query).split(', ')[0];     // just which birds (not the sort order or limit)
      } catch (e) {
        $('#quiz-best').textContent = 'Sorry: ' + e.message;
        return;
      } finally { btn.disabled = false; }
    }
    // By ear: only birds with a recording are asked about (any of your lifers can still be a wrong answer)
    const sounds = by === 'sound' ? await loadSounds() : {};
    const askable = pool.filter(sp => (!scope || scope.has(sp.sci)) && (by !== 'sound' || (sounds[sp.sci] || []).length));
    if (askable.length < 4) {
      $('#quiz-best').textContent = scope
        ? 'Only ' + askable.length + ' of your lifers match "' + about + '"' + (by === 'sound' ? ' and have a recording' : '') + ': a quiz needs at least four.'
        : by === 'sound' ? 'The sound quiz needs at least four lifers with recordings.' : 'The quiz needs at least four lifers with pictures.';
      return;
    }
    const birds = shuffled_(askable, Math.random).slice(0, QUIZ_LENGTH);
    quiz = { mode: quizSetting('quiz-mode'), level: quizSetting('quiz-level'), by, pool, birds,
      // one recording per bird, chosen at random from its song and call
      recordings: by === 'sound' ? birds.map(sp => { const rs = sounds[sp.sci]; return rs[Math.floor(Math.random() * rs.length)]; }) : null,
      i: 0, score: 0, missed: [], scopeText, scopeSize: askable.length };
    $('#quiz-setup').hidden = true;
    $('#quiz-game').hidden = false;
    quizQuestion();
  });

  function quizQuestion() {
    const sp = quiz.birds[quiz.i], st = stickerFor_(sp, stickers);
    quiz.answered = false;
    quiz.options = quiz.mode === 'choice'
      ? quizOptions_(sp, quiz.pool, quiz.level, Math.random, x => birdShape_(x.family, x.order)) : null;
    const next = quiz.birds[quiz.i + 1];
    if (next) new Image().src = stickerFor_(next, stickers).full;   // fetch the next picture while this one is answered
    const rec = quiz.by === 'sound' ? soundInfo_(quiz.recordings[quiz.i]) : null;
    $('#quiz-game').innerHTML =
      '<div class="quiz-top"><span>Bird ' + (quiz.i + 1) + ' of ' + quiz.birds.length + '</span><span>Score: ' + quiz.score + '</span></div>' +
      (quiz.scopeText ? '<p class="quiz-scope">Quizzing you on: ' + esc(quiz.scopeText) + ' (' + num(quiz.scopeSize) + ' birds)</p>' : '') +
      (rec
        // By ear: the recording, and its credit (the XC number links to the species, so it's added after answering)
        ? '<div class="quiz-sound"><div class="quiz-sound-icon" aria-hidden="true">♪</div>' +
            '<audio controls autoplay src="' + esc(rec.file) + '"></audio>' +
            '<p class="sound-credit">' + esc(rec.type) + ' · recording ' + esc(rec.credit.replace(/^XC\d+ /, '')) + '</p></div>' +
          '<figure class="quiz-picture quiz-reveal" hidden><img src="' + esc(st.full) + '" alt="" width="300" height="300"></figure>'
        : '<figure class="quiz-picture"><img src="' + esc(st.full) + '" alt="A bird to name" width="300" height="300"></figure>') +
      '<p class="quiz-ask">' + (rec ? 'Which bird is singing?' : 'What\'s this bird?') + '</p>' +
      (quiz.mode === 'choice'
        ? '<div class="quiz-options">' + quiz.options.map((o, n) =>
            '<button type="button" class="button quiz-option" data-n="' + n + '">' + esc(o.common) +
              (localName(o.i) ? '<span class="quiz-local" lang="' + esc(names.lang) + '">' + esc(localName(o.i)) + '</span>' : '') + '</button>').join('') + '</div>'
        : '<form class="quiz-typed" autocomplete="off"><label for="quiz-input" class="visually-hidden">The bird\'s name</label>' +
          '<input id="quiz-input" type="text" maxlength="80" placeholder="e.g. Eurasian Bullfinch">' +
          '<button type="submit" class="button primary">Check</button>' +
          '<button type="button" class="button quiz-giveup">I don\'t know</button></form>') +
      '<div class="quiz-feedback" aria-live="polite"></div>' +
      '<div class="quiz-nav" hidden><button type="button" class="button primary quiz-next">' +
        (quiz.i + 1 < quiz.birds.length ? 'Next bird' : 'See your score') + '</button></div>';
    const input = $('#quiz-input');
    if (input) input.focus({ preventScroll: true });
  }

  function quizAnswer(correct, note) {
    if (quiz.answered) return;
    quiz.answered = true;
    const sp = quiz.birds[quiz.i];
    if (correct) quiz.score++; else quiz.missed.push(sp);
    $('#quiz-game .quiz-top span:last-child').textContent = 'Score: ' + quiz.score;
    if (quiz.by === 'sound') {                                    // reveal the bird, and the full credit
      const fig = $('#quiz-game .quiz-reveal');
      if (fig) { fig.hidden = false; fig.querySelector('img').alt = sp.common; }
      const rec = soundInfo_(quiz.recordings[quiz.i]), credit = $('#quiz-game .quiz-sound .sound-credit');
      if (credit) credit.innerHTML = esc(rec.type) + ' · <a href="' + esc(rec.page) + '">' + esc(rec.credit.split(',')[0]) + '</a>,' + esc(rec.credit.slice(rec.credit.indexOf(',') + 1));
    }
    $('#quiz-game .quiz-feedback').innerHTML = (correct
      ? '<p class="quiz-right">Correct' + (note ? ' (' + esc(note) + ')' : '') + '!</p>'
      : '<p class="quiz-wrong">Not this time. It\'s ' + (/^[aeiou]/i.test(sp.common) ? 'an' : 'a') + ' <strong>' + esc(sp.common) + '</strong>.</p>') +
      '<p class="quiz-more">' + birdButton(sp.sci, 'Open the ' + esc(sp.common) + ' fact file') + '</p>';
    $('#quiz-game').querySelectorAll('.quiz-option, .quiz-typed input, .quiz-typed button').forEach(b => { b.disabled = true; });
    if (quiz.options) quiz.options.forEach((o, n) => {
      const b = $('#quiz-game .quiz-option[data-n="' + n + '"]');
      if (o.sci === sp.sci) b.classList.add('right');
    });
    $('#quiz-game .quiz-nav').hidden = false;
    $('#quiz-game .quiz-next').focus({ preventScroll: true });
  }

  function quizEnd() {
    const key = quizBestKey(quiz.mode, quiz.level, quiz.by), best = readBest(key), newBest = quiz.score > best;
    if (newBest) { try { localStorage.setItem(key, String(quiz.score)); } catch (e) { /* storage blocked: no record kept */ } }
    $('#quiz-game').innerHTML =
      '<div class="quiz-result"><p class="quiz-final">' + quiz.score + ' out of ' + quiz.birds.length + '</p>' +
      '<p>' + (newBest ? 'A new best!' : best ? 'Your best this way: ' + best + '.' : '') + '</p>' +
      (quiz.missed.length
        ? '<p class="quiz-missed-title">Birds to look at again:</p><ul class="quiz-missed">' + quiz.missed.map(sp =>
            '<li>' + birdIcon(sp.sci, sp.family, sp.order, 36) + birdButton(sp.sci, esc(sp.common)) + '</li>').join('') + '</ul>'
        : '<p>You named every one.</p>') +
      '<p class="quiz-again"><button type="button" class="button primary quiz-replay">Play again</button> ' +
      '<button type="button" class="button quiz-change">Change the settings</button></p></div>';
  }

  $('#quiz-game').addEventListener('click', e => {
    if (!quiz) return;
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('quiz-option')) {
      const pick = quiz.options[Number(t.dataset.n)], sp = quiz.birds[quiz.i];
      if (pick.sci !== sp.sci) t.classList.add('wrong');
      quizAnswer(pick.sci === sp.sci, '');
    } else if (t.classList.contains('quiz-giveup')) quizAnswer(false, '');
    else if (t.classList.contains('quiz-next')) {
      quiz.i++;
      if (quiz.i < quiz.birds.length) quizQuestion(); else quizEnd();
      $('#quiz-plate').scrollIntoView({ block: 'nearest' });
    } else if (t.classList.contains('quiz-replay')) $('#quiz-start').click();
    else if (t.classList.contains('quiz-change')) quizReset();
  });
  $('#quiz-game').addEventListener('submit', e => {
    e.preventDefault();
    if (!quiz || quiz.answered) return;
    const typed = $('#quiz-input').value;
    if (!typed.trim()) return;
    const res = quizCheck_(typed, quiz.birds[quiz.i], checklist, localName(quiz.birds[quiz.i].i) ? [localName(quiz.birds[quiz.i].i)] : []);
    quizAnswer(res.correct, res.note);
  });

  // ---------- Explore: birds reported in a place lately that aren't on your list ----------
  // Pick a country, then a state and county if you like; Lyrebird asks eBird which species have
  // been reported there in the last 30 days, and the page lists the ones you haven't seen.
  let exploreRegions = null;
  const exploreLoading = fetch('data/explore-regions.json').then(r => (r.ok ? r.json() : null)).then(d => { exploreRegions = d; return d; }).catch(() => null);
  const optionsHtml = (list, first) => (first ? '<option value="">' + esc(first) + '</option>' : '') +
    list.map(([code, name]) => '<option value="' + esc(code) + '">' + esc(name) + '</option>').join('');

  async function setupExplore() {
    const R = await exploreLoading;
    if (!R || !current) { $('#explore-plate').hidden = !R; return; }
    // Start on the country of your most recent lifer
    const recent = current.d.lifers.find(l => l.place);
    const st = recent && current.d.stats && current.d.stats.species[recent.i];
    const lastState = st && [...(st.states || [])].pop();
    const cc = lastState ? lastState.slice(0, 2) : 'GB';
    $('#explore-country').innerHTML = optionsHtml(R.countries);
    $('#explore-country').value = R.countries.some(c => c[0] === cc) ? cc : R.countries[0][0];
    exploreCountryChanged();
    exploreMapWorld();
  }

  // ---------- Explore's own map: click any country, then a state (and a county where eBird has them) ----------
  // Separate from the main map, which is about your list: this one is for choosing somewhere to explore.
  // The state shapes are the same files the main map zooms into (docs/data/regions/, Natural Earth);
  // their codes are the international ones eBird also uses, so most match directly, and the rest
  // (and counties) are matched by name. Clicking a place fills in the picker below and shows its birds.
  let xMap = null, xWorld = null, xStates = null, xPlace = null;
  const tidyName = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  const xStyle = { color: () => css('--rule'), base: () => css('--paper'), hover: () => css('--green-soft'), picked: () => css('--season-june') || '#e0a37c' };

  async function exploreMapWorld() {
    if (!window.L || !$('#explore-map')) return;
    const world = await loadWorld().catch(() => null);
    if (!world) { $('#explore-map').hidden = true; return; }
    if (!xMap) {
      xMap = L.map('explore-map', { worldCopyJump: true, minZoom: 1, maxZoom: 9, zoomSnap: 0.25, attributionControl: false, scrollWheelZoom: false });
      xWorld = L.geoJSON(world, {
        style: () => ({ color: xStyle.color(), weight: 0.6, fillColor: xStyle.base(), fillOpacity: 1 }),
        onEachFeature: (f, layer) => {
          const cc = countryCode_(f.properties);
          layer.bindTooltip(esc(countryName(cc)), { sticky: true });
          layer.on('click', () => exploreMapCountry(cc));
        },
      }).addTo(xMap);
    }
    if (xStates) { xStates.remove(); xStates = null; }
    xWorld.setStyle({ fillColor: xStyle.base(), fillOpacity: 1, opacity: 1 });
    xMap.invalidateSize();
    xMap.fitBounds([[-55, -168], [78, 180]]);
    xPlace = null;
    exploreTrail([]);
  }

  async function regionFile(cc) {
    if (!regionFiles.has(cc)) {
      try { const res = await fetch('data/regions/' + cc + '.json'); regionFiles.set(cc, res.ok ? await res.json() : null); }
      catch (e) { regionFiles.set(cc, null); }
    }
    return regionFiles.get(cc);
  }

  /** eBird's code for a state on the map: the same code if eBird has it, else matched by name, else none. */
  function ebirdState(cc, code, name) {
    const states = exploreRegions.states[cc] || [];
    return (states.find(s => s[0] === code) || states.find(s => tidyName(s[1]) === tidyName(name)) || [])[0] || '';
  }

  /** A country on the Explore map: its states drawn, the country's birds shown. */
  async function exploreMapCountry(cc, parent) {
    const file = await regionFile(cc);
    const all = file ? Object.entries(file.regions) : [];
    // Top level: the regions with no parent; one level down: the parent's parts (counties, départements)
    const shapes = all.filter(([, r]) => (parent ? r.in === parent : !r.in) && r.polys && r.polys.length);
    xWorld.setStyle(f => (countryCode_(f.properties) === cc ? { fillOpacity: 0, opacity: 0 } : { fillColor: xStyle.base(), fillOpacity: 0.4, opacity: 0.4 }));
    if (xStates) xStates.remove();
    xStates = L.geoJSON({ type: 'FeatureCollection', features: shapes.map(([code, r]) =>
      ({ type: 'Feature', properties: { code, name: r.name, hasParts: !parent && all.some(([, x]) => x.in === code) }, geometry: { type: 'MultiPolygon', coordinates: r.polys } })) }, {
      style: () => ({ color: xStyle.color(), weight: 0.8, fillColor: xStyle.base(), fillOpacity: 1 }),
      onEachFeature: (f, layer) => {
        layer.bindTooltip(esc(f.properties.name), { sticky: true });
        layer.on('click', () => exploreMapPlace(cc, parent, f.properties, layer));
      },
    }).addTo(xMap);
    const bounds = xStates.getLayers().length ? xStates.getBounds() : null;
    if (bounds && bounds.isValid()) xMap.fitBounds(bounds, { padding: [10, 10], maxZoom: 7 });
    else xWorld.eachLayer(l => { if (countryCode_(l.feature.properties) === cc) xMap.fitBounds(l.getBounds(), { maxZoom: 6 }); });
    if (parent) {
      exploreTrail([[cc, countryName(cc)], [parent, (file.regions[parent] || {}).name || parent]]);
      exploreAt(ebirdState(cc, parent, (file.regions[parent] || {}).name) || cc, { scroll: false });
    } else {
      exploreTrail([[cc, countryName(cc)]]);
      exploreAt(cc, { scroll: false });
    }
  }

  /** A state or county clicked on the Explore map. */
  function exploreMapPlace(cc, parent, p, layer) {
    // A state with parts that eBird has counties for: zoom in to choose a county
    const state = parent ? ebirdState(cc, parent, '') : ebirdState(cc, p.code, p.name);
    if (!parent && p.hasParts && state && (exploreRegions.counties[state] || []).length) { exploreMapCountry(cc, p.code); return; }
    let code = state;
    if (parent) {
      const county = (exploreRegions.counties[state] || []).find(c => tidyName(c[1]) === tidyName(p.name));
      code = county ? county[0] : state;              // a county eBird doesn't list: its state instead
    }
    xStates.setStyle(f => ({ color: xStyle.color(), weight: 0.8, fillColor: f.properties === p ? xStyle.picked() : xStyle.base(), fillOpacity: 1 }));
    const parentName = parent ? ((regionFiles.get(cc) || { regions: {} }).regions[parent] || {}).name || parent : '';
    exploreTrail([[cc, countryName(cc)]].concat(parent ? [[parent, parentName]] : [], [[p.code, p.name]]));
    exploreAt(code || cc, { scroll: false });
  }

  /** "World › United Kingdom › England": where you are, with a way back up. */
  function exploreTrail(steps) {
    const names = steps.filter(s => s[1]);
    $('#explore-trail').innerHTML = (names.length ? '<button type="button" class="text-button" data-xgo="world">World</button>' : '<span>Click a country</span>') +
      names.map((s, i) => ' › ' + (i < names.length - 1 ? '<button type="button" class="text-button" data-xgo="' + esc(s[0]) + '">' + esc(s[1]) + '</button>' : '<strong>' + esc(s[1]) + '</strong>')).join('');
  }
  $('#explore-trail').addEventListener('click', e => {
    const b = e.target.closest('[data-xgo]');
    if (!b) return;
    const go = b.dataset.xgo;
    if (go === 'world') exploreMapWorld();
    else if (/^[A-Z]{2}$/.test(go)) exploreMapCountry(go);
    else exploreMapCountry(go.slice(0, 2), go);
  });
  function exploreCountryChanged() {
    const R = exploreRegions, cc = $('#explore-country').value;
    $('#explore-state').innerHTML = optionsHtml((R.states[cc] || []), 'All of it');
    $('#explore-state').disabled = !(R.states[cc] || []).length;
    exploreStateChanged();
  }
  function exploreStateChanged() {
    const list = exploreRegions.counties[$('#explore-state').value] || [];
    $('#explore-county').innerHTML = optionsHtml(list, 'All of it');
    $('#explore-county-box').hidden = !list.length;
  }
  $('#explore-country').addEventListener('change', exploreCountryChanged);
  $('#explore-state').addEventListener('change', exploreStateChanged);

  const regionName = code => {
    const R = exploreRegions, all = R.countries.concat(R.states[code.slice(0, 2)] || [], ...Object.values(R.counties));
    const hit = all.find(r => r[0] === code);
    return hit ? hit[1] : code;
  };

  $('#explore-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!current || !exploreRegions) return;
    const region = $('#explore-county').value || $('#explore-state').value || $('#explore-country').value;
    const out = $('#explore-result'), btn = e.target.querySelector('button');
    btn.disabled = true;
    out.innerHTML = '<p class="working">Asking eBird what\'s been seen in ' + esc(regionName(region)) + ' lately…</p>';
    try {
      const reply = await askLyrebird({ action: 'recent', region });
      if (!reply || !reply.ok) throw new Error((reply && reply.message) || 'no answer');
      const seen = new Set(current.d.lifers.map(l => l.i));
      const r = exploreList_(reply, checklist, seen);
      const day = d => { const t = new Date(String(d) + 'T12:00:00'); return isNaN(t) ? String(d || '') : date(t); };   // the raw date if it can't be read
      out.innerHTML = '<p class="explore-summary"><strong>' + num(r.newCount) + ' of the ' + num(r.total) + ' species</strong> reported in ' +
          esc(regionName(region)) + ' in the last ' + reply.days + ' days ' + (r.newCount === 1 ? 'is' : 'are') + ' new for you.</p>' +
        (r.families.length ? r.families.map(f =>
          '<section class="explore-family"><h3>' + esc(f.family) + ' <span class="sci">' + esc(f.familyLatin) + '</span></h3><ul>' +
          f.birds.map(b => {
            const sp = checklist.species[b.i];
            return '<li>' + birdIcon(b.sci, sp.family, sp.order, 32) + '<span class="explore-bird">' + birdButton(b.sci, esc(b.common)) + localNameHtml(b.i) +
              '<span class="explore-when">Last reported ' + esc(day(b.date)) + (b.loc ? ' · ' + esc(b.loc) : '') + '</span></span></li>';
          }).join('') + '</ul></section>').join('')
          : '<p class="ai-note">You\'ve seen every species reported here lately. Impressive!</p>');
    } catch (err) {
      out.innerHTML = '<p class="ai-note">Sorry, the sightings couldn\'t be fetched just now (' + esc(err.message) + ').</p>';
    } finally {
      btn.disabled = false;
      redrawTrail();
    }
  });

  // ---------- Names to check: suggestions, Accept, Don't count it, Undo ----------
  const commonName = sci => { const i = checklist.bySci.get(String(sci).toLowerCase()); return i === undefined ? '' : checklist.species[i].common; };

  function renderNameFixes(d) {
    const fixes = getFixes();
    $('#unmatched-plate').hidden = !d.unmatched.length && !fixes.size;
    $('#section-nav a[href="#unmatched-plate"]').hidden = $('#unmatched-plate').hidden;   // no button for a hidden section
    $('#unmatched').innerHTML = d.unmatched.map((u, i) =>
      '<li data-i="' + i + '">' +
        '<div class="um-name"><span class="sci">' + esc(u.sci) + '</span> ' + esc(u.common) +
          ' <span class="n">· ' + num(u.n) + ' record' + (u.n === 1 ? '' : 's') + '</span></div>' +
        '<div class="um-actions">' +
          '<button type="button" class="button small" data-act="suggest">Suggest a match</button>' +
          '<button type="button" class="text-button" data-act="ignore">Don\'t count it</button>' +
        '</div>' +
        '<div class="um-result" aria-live="polite"></div>' +
      '</li>'
    ).join('') || (fixes.size ? '<li class="all-fixed">Every name now matches an AviList species.</li>' : '');

    $('#fixes').hidden = !fixes.size;
    $('#fixes-list').innerHTML = [...fixes].map(([from, to]) =>
      '<li><span class="sci">' + esc(from) + '</span> → ' +
        (to === 'IGNORE' ? 'not counted' : esc(commonName(to)) + ' <span class="sci">' + esc(to) + '</span>') +
        ' <button type="button" class="text-button" data-act="undo" data-key="' + esc(from) + '">Undo</button></li>'
    ).join('');
  }

  /** Sends a request to Lyrebird, the AI middleman. Throws if it can't be reached. */
  async function askLyrebird(payload) {
    if (!LYREBIRD_URL) throw new Error('the AI isn\'t set up on this site yet');
    // text/plain keeps this a "simple" request, which Apps Script web apps accept from other websites
    const res = await fetch(LYREBIRD_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('the AI service replied with an error (HTTP ' + res.status + ')');
    return res.json();
  }

  // Shown when Lyrebird's first-choice model was out of quota or busy and a backup answered
  const backupNote = model => '<p class="backup-note">Answered by a backup AI model (' +
    esc(String(model || 'unknown').replace(/^groq:/, '')) + '), which may be less accurate. Worth a closer look.</p>';

  async function suggest(li, u) {
    const btn = li.querySelector('[data-act="suggest"]'), out = li.querySelector('.um-result');
    btn.disabled = true;
    out.innerHTML = '<p class="working">Comparing with AviList…</p>';
    await new Promise(r => setTimeout(r, 30));          // let the page update before the slow step
    if (!matching) matching = speciesForMatching_(checklist);
    const ebird = { sci: u.sci, common: u.common };
    const prep = prepareSuggestion_(ebird, matching);   // string matching and shortlist, on this computer
    let d = prep.final, backup = null;
    if (!d) {
      out.innerHTML = '<p class="working">Checking with Lyrebird…</p>';
      let ans;
      try {
        const reply = await askLyrebird({ action: 'nameFix', ebird, shortlist: prep.shortlist.map(c => ({ sci: c.sci, common: c.common })) });
        ans = answerFromLyrebird_(reply, prep.shortlist);
        backup = reply.backup ? reply.model : null;
      } catch (e) {
        ans = { status: 'error', reason: e.message };
      }
      d = suggestionFromAnswer_(prep.str, ans);
    }
    btn.disabled = false;
    btn.textContent = 'Suggest again';
    out.innerHTML = (d.sci
      ? '<div class="suggestion"><span class="conf conf-' + d.confidence.toLowerCase() + '">' + esc(d.confidence) + '</span> ' +
          '<strong>' + esc(commonName(d.sci)) + '</strong> <span class="sci">' + esc(d.sci) + '</span>' +
          '<p class="why">' + esc(d.reason) + '</p>' + (backup ? backupNote(backup) : '') +
          '<button type="button" class="button small primary" data-act="accept" data-sci="' + esc(d.sci) + '">Accept</button></div>'
      : '<div class="suggestion"><strong>No confident match found.</strong><p class="why">' + esc(d.reason) + '</p></div>') +
      othersHtml(prep.shortlist, d.sci);
    redrawTrail();
  }

  /**
   * "Other candidates": the whole shortlist (most similar names first, then the same
   * genus), each with Use this, plus a search box for any AviList species. So the
   * right species can always be reached, even when the AI is wrong or unavailable.
   */
  function othersHtml(shortlist, suggested) {
    const rows = shortlist.map(c =>
      '<li><span><strong>' + esc(c.common) + '</strong> <span class="sci">' + esc(c.sci) + '</span>' +
        (c.sci === suggested ? ' <span class="tag">suggested</span>' : '') + '</span>' +
        '<button type="button" class="text-button" data-act="accept" data-sci="' + esc(c.sci) + '">Use this</button></li>'
    ).join('');
    return '<details class="others"><summary>' + (suggested ? 'Not right? Other candidates' : 'Choose a species') + '</summary>' +
      (rows ? '<ul class="cands">' + rows + '</ul>' : '') +
      '<div class="search-row">' +
        '<label>Or search AviList <input class="search" type="text" list="avilist-names" autocomplete="off" placeholder="Type a species name"></label>' +
        '<button type="button" class="button small" data-act="use-search">Use this</button>' +
      '</div>' +
      '<p class="search-msg" aria-live="polite"></p>' +
    '</details>';
  }

  // The search box's suggestions: every AviList species. Built the first time it's needed,
  // so the page doesn't create 11,000 options for visitors who never open it.
  function fillSpeciesNames() {
    const list = $('#avilist-names');
    if (list.options.length) return;
    list.innerHTML = checklist.species.filter(s => !s.extinct)
      .map(s => '<option value="' + esc(searchLabel_(s)) + '"></option>').join('');
  }

  function useSearch(li, u) {
    const input = li.querySelector('.search'), msg = li.querySelector('.search-msg');
    const s = findSpecies_(checklist, input.value);
    if (!s) { msg.textContent = 'No AviList species by that name. Pick one from the suggestions as you type.'; return; }
    applyFix(u.sci, s.sci);
  }

  function applyFix(ebirdSci, to) {
    const fixes = getFixes();
    if (to) fixes.set(ebirdSci.toLowerCase(), to); else fixes.delete(ebirdSci.toLowerCase());
    saveFixes(fixes);
    show(current.text, current.label, true);            // recalculate everything, staying in place
  }

  $('#unmatched-plate').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !current) return;
    const li = btn.closest('li[data-i]');
    const u = li ? current.d.unmatched[Number(li.dataset.i)] : null;
    if (btn.dataset.act === 'suggest' && u) suggest(li, u);
    if (btn.dataset.act === 'accept' && u) applyFix(u.sci, btn.dataset.sci);
    if (btn.dataset.act === 'ignore' && u) applyFix(u.sci, 'IGNORE');
    if (btn.dataset.act === 'use-search' && u) useSearch(li, u);
    if (btn.dataset.act === 'undo') applyFix(btn.dataset.key, null);
  });
  // Enter in a search box does the same as its Use this button
  $('#unmatched-plate').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('.search') || !current) return;
    e.preventDefault();
    const li = e.target.closest('li[data-i]');
    useSearch(li, current.d.unmatched[Number(li.dataset.i)]);
  });
  // Opening "Other candidates" fills the search suggestions (once) and makes the page taller
  $('#unmatched-plate').addEventListener('toggle', e => {
    if (e.target.matches('details.others') && e.target.open) fillSpeciesNames();
    redrawTrail();
  }, true);

  // ---------- Ask your list: question -> Lyrebird -> checked query -> run here ----------
  let lastAsk = null;                  // { query, reason, backup } of the last answered question
  let askCache = null;                 // { d, data }: the tables for the file shown

  // Size, range, habitat, diet… for every species (AVONET and BIRDBASE): fetched once, when first asked
  let traitsLoading = null, traits = null;
  function loadTraits() {
    traitsLoading = traitsLoading || fetch('data/traits.json')
      .then(res => res.ok ? res.json() : null).catch(() => null)
      .then(t => { traits = t ? unpackTraits_(t) : null; $('#traits-credit').hidden = !t; });
    return traitsLoading;
  }

  async function askTables() {
    await Promise.all([loadTotals(), loadTraits()]);   // eBird totals for places; traits for species
    if (!askCache || askCache.d !== current.d || askCache.countries !== countries || askCache.totals !== regionTotals || askCache.traits !== traits) {
      askCache = { d: current.d, countries, totals: regionTotals, traits, data: askData_(current.d, checklist, countries, regionTotals, traits) };
    }
    return askCache.data;
  }

  // Tables whose rows are birds (a species, family or order) get a silhouette in the first column
  const BIRD_TABLES = ['species', 'families', 'orders'];

  /** One table cell, formatted by the kind of value; `kind` adds a silhouette (bird-icons.js). */
  function askCell(col, v, kind) {
    const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    const cls = col.type === 'number' ? ' class="num"' : '';
    if (empty) return '<td' + cls + '>—</td>';
    let text;
    if (col.type === 'date') text = date(new Date(v + 'T12:00:00'));
    else if (col.type === 'number') text = col.field === 'pctSeen' ? Number(v).toFixed(1) + '%' : col.field === 'year' ? String(v) : num(v);
    else if (col.type === 'yesno') text = v ? 'Yes' : 'No';
    else if (col.type === 'list') text = v.join(', ');
    else text = v;
    const latin = ['scientific', 'familyLatin', 'order'].includes(col.field);
    const words = latin ? '<span class="sci">' + esc(text) + '</span>' : esc(text);
    if (col.field === 'iucn') return '<td>' + iucnBadge(v) + '</td>';
    if (col.field === 'nest') return '<td>' + nestWithIcons(v).join(' ') + '</td>';     // each nest type with its drawing
    // Habitats get a small drawing (habitat-icons.js)
    if (col.field === 'habitat' && HABITAT_ICONS_[v]) {
      return '<td><span class="with-icon"><span class="icon habitat" title="' + esc(HABITAT_ICONS_[v].label) + '">' +
        habitatIconSvg_(v, 20) + '</span>' + words + '</span></td>';
    }
    if (!kind) return '<td' + cls + '>' + words + '</td>';
    // Species rows: the bird's sticker, and its name opens the fact file. Families and orders: a silhouette.
    return '<td' + cls + '><span class="with-icon">' + birdIcon(kind.sci, kind.familyLatin, kind.order, 28) +
      (kind.sci ? birdButton(kind.sci, words) + localNameHtml(checklist.bySci.get(String(kind.sci).toLowerCase())) : words) + '</span></td>';
  }

  async function renderAsk() {
    if (!lastAsk || !current) return;
    const data = await askTables();
    if (!lastAsk || !current) return;                    // cleared while the totals loaded
    const q = lastAsk.query, res = runQuery_(q, data);
    const noun = ASK_TABLES_[q.table].noun[res.total === 1 ? 0 : 1];
    const sciCol = q.table === 'species' ? res.columns.findIndex(c => c.field === 'scientific') : -1;   // species rows open fact files
    $('#ask-result').innerHTML =
      '<div class="understood"><span class="label">Understood as</span>' + esc(describeQuery_(q)) +
        (lastAsk.backup ? backupNote(lastAsk.backup) : '') +
        '<span class="total">' + (!res.total ? 'None found'
          : res.total > res.rows.length ? 'Showing ' + num(res.rows.length) + ' of ' + num(res.total) + ' ' + ASK_TABLES_[q.table].noun[1] + ' found'
            : num(res.total) + ' ' + noun + ' found') + '</span></div>' +
      (res.rows.length
        ? '<div class="table-wrap"><table class="ask-table"><thead><tr>' +
            res.columns.map(c => '<th' + (c.type === 'number' ? ' class="num"' : '') + ' scope="col">' + esc(c.label) + '</th>').join('') +
          '</tr></thead><tbody>' +
            res.rows.map((r, ri) => '<tr>' + r.map((v, i) => i === 0 && BIRD_TABLES.includes(q.table)
              ? askCell(res.columns[i], v, Object.assign({ sci: sciCol >= 0 ? r[sciCol] : '' }, res.kinds[ri])) : askCell(res.columns[i], v)).join('') + '</tr>').join('') +
          '</tbody></table></div>'
        : '') +
      // Only when the question didn't say how many: a hint that more can be asked for
      (res.total > res.rows.length && q.limit === ASK.DEFAULT_LIMIT
        ? '<p class="ask-more">To see more, add how many to your question, e.g. “… show 100”.</p>' : '');
    redrawTrail();
  }

  async function ask(question) {
    const text = String(question || '').trim();
    if (!text || !current) return;
    const btn = $('#ask-button'), out = $('#ask-result');
    btn.disabled = true;
    out.innerHTML = '<p class="working">Asking Lyrebird…</p>';
    let ans;
    try {
      const reply = await askLyrebird({ action: 'query', question: text.slice(0, ASK.MAX_QUESTION) });
      ans = queryFromLyrebird_(reply);
      ans.backup = reply.backup ? reply.model : null;
    } catch (e) {
      ans = { status: 'error', reason: e.message };
    }
    btn.disabled = false;
    if (ans.status === 'query') {
      lastAsk = ans;
      renderAsk();
      return;
    }
    lastAsk = null;
    const why = {
      cannot: 'That question can\'t be answered from your list yet.',
      invalid: 'The AI\'s answer didn\'t pass the checks, so it wasn\'t run.',
      error: 'Lyrebird couldn\'t answer just now.',
    }[ans.status];
    out.innerHTML = '<p class="ask-problem"><strong>' + esc(why) + '</strong> ' + esc(ans.reason) +
      (ans.status === 'error' ? '' : '<br>Try asking about species, families, orders, countries, states and counties, years or months.') + '</p>';
    redrawTrail();
  }

  $('#ask-form').addEventListener('submit', e => { e.preventDefault(); ask($('#ask-input').value); });
  document.querySelector('.ask-examples').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#ask-input').value = chip.textContent;
    ask(chip.textContent);
  });

  // ---------- Plate II: region bars and the Oceans card ----------
  function renderRegions(d) {
    const bar = r =>
      '<div class="row"><span class="name">' + esc(r.name) + '</span>' +
      '<span class="figs">' + num(r.seen) + ' / ' + num(r.total) + ' · ' + pct(r.pct) + '</span></div>' +
      '<div class="track" aria-hidden="true"><div class="fill" style="width:' + (r.pct * 100).toFixed(2) + '%"></div></div>';
    const land = d.regions.filter(r => r.name !== 'Oceans');
    const sea = d.regions.find(r => r.name === 'Oceans');
    $('#region-bars').innerHTML = land.map(r => '<li>' + bar(r) + '</li>').join('') +
      (sea ? '<li class="sea">' + bar(sea) + '<span class="note">Seabirds found at sea or on remote islands, so not shaded on the map.</span></li>' : '');
  }

  // ---------- Plate III: lifers per year and per month ----------
  function renderCharts(d) {
    charts.forEach(c => c.destroy());
    charts = [];
    if (!window.Chart) { $('.charts').textContent = 'The charts could not load (no internet?).'; return; }
    const ink = css('--ink-soft'), rule = css('--rule');
    Chart.defaults.font.family = css('--sans');
    const plural = (n, word) => n + ' ' + (word === 'species' || n === 1 ? word : word + 's');   // "species" is the same either way
    const title = word => (word === 'species' ? 'Species' : word[0].toUpperCase() + word.slice(1) + 's');

    // Bars, with an optional dashed checklists line on its own scale (right-hand axis)
    const chart = (labels, data, colour, unit, checklists) => {
      const datasets = [{ label: title(unit), data, backgroundColor: colour, borderRadius: 2, maxBarThickness: 40, order: 2 }];
      const scales = {
        x: { grid: { display: false }, ticks: { color: ink } },
        y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: rule } },
      };
      if (checklists) {
        datasets.push({ type: 'line', label: 'Checklists', data: checklists, yAxisID: 'y2', order: 1,
          borderColor: ink, backgroundColor: ink, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 2, tension: 0.25 });
        scales.y2 = { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: ink, precision: 0 } };
      }
      return {
        type: 'bar',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: !!checklists, position: 'bottom', labels: { color: ink, boxWidth: 14, boxHeight: 10 } },
            tooltip: { callbacks: { label: c => plural(c.parsed.y, c.dataset.type === 'line' ? 'checklist' : unit) } },
          },
          scales,
        },
      };
    };

    // Every year from the first to the last, including quiet years
    const ys = Object.keys(d.checklistsPerYear).concat(Object.keys(d.perYear)).map(Number).sort((a, b) => a - b);
    const years = ys.length ? Array.from({ length: ys[ys.length - 1] - ys[0] + 1 }, (_, i) => ys[0] + i) : [];
    const byYear = obj => years.map(y => obj[y] || 0);

    charts.push(new Chart($('#chart-years'), chart(years.map(String), byYear(d.perYear), css('--green-soft'), 'lifer')));
    charts.push(new Chart($('#chart-months'), chart(MONTHS, Array.from(d.perMonth), css('--rust'), 'lifer')));
    charts.push(new Chart($('#chart-sp-years'), chart(years.map(String), byYear(d.speciesPerYear), css('--map-3'), 'species', byYear(d.checklistsPerYear))));
    charts.push(new Chart($('#chart-sp-months'), chart(MONTHS, Array.from(d.speciesPerMonth), css('--map-2'), 'species', Array.from(d.checklistsPerMonth))));
  }

  // ---------- Plate II: the progress map ----------
  async function renderMap(d) {
    if (!window.L) { $('#map').textContent = 'The map could not load (no internet?). The figures beside it still work.'; return; }
    const byRegion = new Map(d.regions.map(r => [r.name, r]));
    const speciesIn = new Map(d.countries.map(c => [c.code, c.species]));
    await loadTotals();
    // Birded countries shaded by the share of eBird's recorded species seen there; unbirded stay plain
    const scale = shadeScale(d.countries.map(c => c.species));
    const totalOf = cc => (regionTotals && regionTotals.regions && regionTotals.regions[cc]) || null;

    if (!map) {
      map = L.map('map', { worldCopyJump: true, minZoom: 1, maxZoom: 6, zoomSnap: 0.25, scrollWheelZoom: false })
        .setView([20, 10], 1.25);
      map.attributionControl.setPrefix(false)
        .addAttribution('Outlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    }
    if (!countryShapes) {
      try {
        const res = await fetch(COUNTRIES_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        countryShapes = await res.json();
      } catch (e) {
        $('.map-note').textContent = 'Country outlines could not load (no internet?). The figures beside the map still work.';
        return;
      }
    }
    if (countryLayer) countryLayer.remove();
    if (stateLayer) { stateLayer.remove(); stateLayer = null; }
    countryLayer = L.geoJSON(countryShapes, {
      style: f => ({
        fillColor: scale.fill(speciesIn.get(countryCode_(f.properties)), totalOf(countryCode_(f.properties))), fillOpacity: 1, color: css('--rule'), weight: 0.6,
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties, region = regionForCountry_(p), r = byRegion.get(region);
        const n = speciesIn.get(countryCode_(p)), t = totalOf(countryCode_(p));
        if (n) layer.on('click', () => openCountry(countryCode_(p)));          // zoom in to its regions
        layer.bindTooltip('<strong>' + esc(p.NAME) + '</strong><br>' +
          (n ? num(n) + (t ? ' of ' + num(t) + ' species (' + pct(Math.min(1, n / t)) + ')' : ' species recorded here') +
            '<br><em>Click to see its regions</em>' : 'Not birded yet') +
          (r ? '<br><span class="tip-region">' + esc(region) + ': ' + num(r.seen) + ' of ' + num(r.total) +
            ' regional species seen (' + pct(r.pct) + ')</span>' : ''), { sticky: true });
      },
    }).addTo(map);
    map.invalidateSize();
    if (!map._fittedWorld) {          // first time only, so a zoom the visitor chose is kept on redraws
      map.fitBounds([[-55, -168], [78, 180]]);
      map._fittedWorld = true;
    }

    $('#map-legend').innerHTML = scale.legend;
    // A button per birded country: another way in, for phones and keyboards
    $('#map-countries').innerHTML = d.countries.length ? '<span class="lead">See the regions of:</span>' +
      d.countries.map(c => '<button type="button" class="chip" data-cc="' + esc(c.code) + '">' + esc(countryName(c.code)) + '</button>').join('') : '';
    if (zoomed) openCountry(zoomed.cc);              // redrawn after a change (e.g. a name fix): stay zoomed in
  }

  /**
   * How the map is shaded, and its legend. With eBird's totals: five fixed bands of
   * the share of the species recorded in a place that you've seen there, the same
   * on the world map and inside a country, so a shade always means the same thing.
   * A birded place with no total gets its own shade, rather than a guess. Without
   * the totals file: species seen, on a square-root scale up to the best place.
   * @param {number[]} counts  species seen in each birded place (for the fallback scale)
   */
  const PCT_BANDS = [5, 10, 20, 40];               // upper edges, in %; the fifth band is 40% or more
  function shadeScale(counts) {
    const colour = n => css(n ? '--map-' + n : '--map-none');
    const key = (c, words) => '<span class="key"><span class="swatch" style="background:' + c + '"></span>' + words + '</span>';
    if (regionTotals) {
      const band = p => 1 + PCT_BANDS.filter(edge => p >= edge).length;
      return {
        fill: (n, total) => !n ? colour(0) : total ? colour(band(100 * n / total)) : css('--map-unknown'),
        legend: key(colour(0), 'not birded') +
          [1, 2, 3, 4, 5].map(k => key(colour(k), k === 1 ? 'under ' + PCT_BANDS[0] + '%'
            : k === 5 ? PCT_BANDS[3] + '%+' : PCT_BANDS[k - 2] + '–' + PCT_BANDS[k - 1] + '%')).join('') +
          '<span class="key">of the species recorded there (eBird)</span>' + key(css('--map-unknown'), 'birded, no eBird total'),
      };
    }
    const most = Math.max(0, ...counts);
    const shade = n => (!n || !most) ? 0 : Math.max(1, Math.min(5, Math.ceil(Math.sqrt(n / most) * 5)));
    const upTo = k => Math.round(most * (k / 5) ** 2);
    return {
      fill: n => colour(shade(n)),
      legend: key(colour(0), 'not birded') +
        [1, 2, 3, 4, 5].map(k => key(colour(k), 'up to ' + num(Math.max(1, upTo(k))))).join('') + '<span class="key">species</span>',
    };
  }

  /** A country's English name: from countries.json, else the map's own, else its code. */
  function countryName(cc) {
    if (countries && countries.byCode[cc]) return countries.byCode[cc].name;
    const f = countryShapes && countryShapes.features.find(x => countryCode_(x.properties) === cc);
    return f ? f.properties.NAME : cc;
  }

  /** The totals file, fetched once: optional, so without it there are no % bars and states show as codes. */
  let totalsLoading = null;
  function loadTotals() {
    totalsLoading = totalsLoading || fetch('data/region-totals.json')
      .then(res => res.ok ? res.json() : null).catch(() => null)
      .then(t => { regionTotals = t; $('#totals-credit').hidden = !t; });   // credit eBird whenever its totals are used
    return totalsLoading;
  }

  // ---------- Zooming into a country: its states, provinces or regions ----------
  async function openCountry(cc) {
    if (!map || !current) return;
    zoomed = { cc };
    let file = regionFiles.get(cc);
    if (file === undefined) {                       // fetched the first time, then kept
      try { const res = await fetch('data/regions/' + cc + '.json'); file = res.ok ? await res.json() : null; }
      catch (e) { file = null; }
      regionFiles.set(cc, file);
    }
    await loadTotals();
    if (!zoomed || zoomed.cc !== cc) return;        // the visitor moved on while it loaded
    const { level, shapes, unmapped } = countryRegions_(file, current.d.stats, cc, regionTotals);
    // The same % bands as the world map (or, without totals, the country's own species scale)
    const scale = shadeScale(shapes.map(s => s.species).concat(unmapped.map(s => s.species)));

    countryLayer.setStyle(f => countryCode_(f.properties) === cc ? { fillOpacity: 0, opacity: 0 } : { fillOpacity: 0.35, opacity: 0.5 });
    if (stateLayer) stateLayer.remove();
    stateLayer = L.geoJSON({ type: 'FeatureCollection', features: shapes.map(s =>
      ({ type: 'Feature', properties: s, geometry: { type: 'MultiPolygon', coordinates: s.polys } })) }, {
      // A group (Sulawesi, Leinster...) is drawn as its parts: lines in its own colour, so it reads as one region
      style: f => { const fill = scale.fill(f.properties.species, f.properties.total);
        // (a slightly thicker line also covers hairline gaps where simplified neighbours don't quite meet)
        return { fillColor: fill, fillOpacity: 1, color: f.properties.group ? fill : css('--rule'), weight: f.properties.group ? 1.6 : 0.6 }; },
      onEachFeature: (f, layer) => {
        const s = f.properties;
        layer.bindTooltip('<strong>' + esc(s.name) + '</strong><br>' + (s.species
          ? num(s.species) + (s.total ? ' of ' + num(s.total) : '') + ' species · ' + num(s.lifers) + ' lifer' + (s.lifers === 1 ? '' : 's')
          : 'Not birded yet' + (s.total ? ' · ' + num(s.total) + ' species recorded there' : '')), { sticky: true });
      },
    }).addTo(map);
    // Fit the birded regions (the whole country if none are drawn)
    const birded = L.featureGroup();
    stateLayer.eachLayer(l => { if (l.feature.properties.species) birded.addLayer(L.geoJSON(l.feature)); });
    const bounds = birded.getLayers().length ? birded.getBounds() : stateLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 6 });

    $('#map-legend').innerHTML = scale.legend;
    renderCountryPanel(cc, level, shapes.filter(s => s.species).concat(unmapped.map(u => Object.assign({ unmapped: true }, u))));
    redrawTrail();
  }

  /**
   * Beside the map: the country's birded counties or regions, most species first, and a way back.
   * Like the world bars, a bar shows the share of the species recorded there (eBird's total) you've seen;
   * where no total is known there's no bar, so nothing looks complete that isn't.
   */
  function renderCountryPanel(cc, level, rows) {
    rows.sort((a, b) => b.species - a.species);
    const unit = level === 'counties' ? ['county', 'counties'] : ['region', 'regions'];
    const anyTotals = rows.some(r => r.total);
    $('#region-bars').innerHTML =
      '<li class="country-head"><button type="button" class="text-button" data-act="world">← Back to world</button>' +
        '<span class="country-title">' + esc(countryName(cc)) + ' <button type="button" class="text-button explore-link" data-explore="' + esc(cc) + '">Explore new birds here</button></span>' +
        '<span class="note">' + num(rows.length) + ' ' + unit[rows.length === 1 ? 0 : 1] + ' birded. ' +
        (anyTotals ? 'Bars show how many of the species ever recorded there (eBird) you\'ve seen.' : 'Shaded by species recorded.') + '</span></li>' +
      rows.map(r => {
        const pctSeen = r.total ? Math.min(1, r.species / r.total) : null;
        const ebirdCode = exploreCodeFor(cc, level, r);
        return '<li><div class="row"><span class="name">' + esc(r.name) + (r.unmapped ? ' <span class="note">(not on the map)</span>' : '') +
            (ebirdCode ? ' <button type="button" class="text-button explore-link" data-explore="' + esc(ebirdCode) + '">Explore</button>' : '') + '</span>' +
          '<span class="figs">' + num(r.species) + (r.total ? ' / ' + num(r.total) + ' · ' + pct(pctSeen) : ' species') +
          ' · ' + num(r.lifers) + ' lifer' + (r.lifers === 1 ? '' : 's') + '</span></div>' +
          (pctSeen === null ? '' : '<div class="track" aria-hidden="true"><div class="fill" style="width:' + (pctSeen * 100).toFixed(2) + '%"></div></div>') + '</li>';
      }).join('');
  }

  function closeCountry() {
    zoomed = null;
    if (stateLayer) { stateLayer.remove(); stateLayer = null; }
    renderRegions(current.d);
    renderMap(current.d);
    map.fitBounds([[-55, -168], [78, 180]]);
    redrawTrail();
  }

  $('#region-bars').addEventListener('click', e => {
    if (e.target.closest('[data-act="world"]')) closeCountry();
    const x = e.target.closest('[data-explore]');
    if (x) exploreAt(x.dataset.explore);
  });

  /**
   * A map row's eBird region code, for Explore: state rows already use eBird's codes; counties on
   * the map come from Natural Earth, so they're matched to eBird's counties by name.
   */
  function exploreCodeFor(cc, level, r) {
    if (!exploreRegions) return '';
    if (level !== 'counties') return /^[A-Z]{2}-[A-Z0-9]+$/.test(r.code || '') ? r.code : '';
    const tidy = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    for (const [state, list] of Object.entries(exploreRegions.counties)) {
      if (state.slice(0, 2) !== cc) continue;
      const hit = list.find(c => tidy(c[1]) === tidy(r.name));
      if (hit) return hit[0];
    }
    return '';
  }

  /** Fills in Explore's place picker with an eBird region code, and shows that place's new birds. */
  function exploreAt(code, opts) {
    if (!exploreRegions) return;
    $('#explore-country').value = code.slice(0, 2);
    exploreCountryChanged();
    const parts = code.split('-');
    if (parts.length >= 2) { $('#explore-state').value = parts[0] + '-' + parts[1]; exploreStateChanged(); }
    if (parts.length === 3) $('#explore-county').value = code;
    if (!opts || opts.scroll !== false) $('#explore-plate').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#explore-form').requestSubmit();
  }
  $('#map-countries').addEventListener('click', e => {
    const b = e.target.closest('button[data-cc]');
    if (b) { openCountry(b.dataset.cc); $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });


  /** Reads an eBird file chosen with the button or dropped on the page (in the browser: never uploaded). */
  function readFile(file) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      status('That\'s the .zip from eBird. Please unzip it first and upload the MyEBirdData.csv file inside.');
      return;
    }
    if (!/\.csv$/i.test(file.name) && !/csv/.test(file.type)) {
      status('That doesn\'t look like a .csv file. Please use the MyEBirdData.csv file from eBird.');
      return;
    }
    status('Reading ' + file.name + '…');
    const reader = new FileReader();
    reader.onload = () => show(reader.result, 'Your life list, from ' + file.name);
    reader.onerror = () => status('Sorry, that file could not be read.');
    reader.readAsText(file);
  }

  $('#file').addEventListener('change', e => {
    readFile(e.target.files[0]);
    e.target.value = '';   // allow choosing the same file again
  });

  // Drag and drop: a file dragged anywhere over the page shows a drop target, and dropping it
  // reads it like the button. Only once the page is ready (the buttons are showing).
  // Counting enters and leaves, since moving over child elements fires both.
  let dragDepth = 0;
  const draggingFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const ready = () => !$('#controls').hidden;
  const dropZone = on => { document.body.classList.toggle('dragging', on); if (!on) dragDepth = 0; };
  window.addEventListener('dragenter', e => {
    if (!draggingFiles(e) || !ready()) return;
    e.preventDefault();
    dragDepth++;
    dropZone(true);
  });
  window.addEventListener('dragover', e => {
    if (!draggingFiles(e)) return;
    e.preventDefault();                          // without this the browser opens the file instead
    e.dataTransfer.dropEffect = ready() ? 'copy' : 'none';
  });
  window.addEventListener('dragleave', e => {
    if (!draggingFiles(e)) return;
    if (--dragDepth <= 0) dropZone(false);
  });
  window.addEventListener('drop', e => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    dropZone(false);
    if (!ready()) return;
    if (e.dataTransfer.files.length > 1) status('Please drop just one file: MyEBirdData.csv.');
    else { readFile(e.dataTransfer.files[0]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  $('#sample').addEventListener('click', async () => {
    status('Loading the sample data…');
    try {
      const res = await fetch('data/sample-ebird.csv');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      show(await res.text(), 'Sample data: the author\'s own life list');
    } catch (e) {
      status('Sorry, the sample data could not be loaded (' + e.message + ').');
    }
  });

  // ---------- Decoration: a dotted "expedition route" behind the page ----------
  // Measures where the title, sections and footer are, then draws a smooth winding
  // line through the gaps between them (the sections hide it as it passes behind).
  // Mountain at the start, forest at a bend partway down, lake at the end.
  // Each icon is drawn in a 24 x 24 box. ax, ay = the point that sits on the route
  // (bottom centre for things standing on the ground, the middle for the X).
  const ICONS = {
    signpost: { ax: 12, ay: 23, art:
      '<rect x="10.8" y="2.5" width="2.4" height="20.5" fill="#b08b5e"/>' +
      '<path d="M9 3.6 h10 l3 2.4 -3 2.4 h-10 Z" fill="#e7cfa4"/>' +                      // points right
      '<path d="M15 9.4 h-10.5 l-3 2.4 3 2.4 h10.5 Z" fill="#e7cfa4"/>' +                // points left
      '<path d="M9.5 15.4 h8.5 l2.6 2.1 -2.6 2.1 h-8.5 Z" fill="#e7cfa4" transform="rotate(-16 12 17.5)"/>' +   // points up-right
      '<path d="M7 23 h10" fill="none"/>' },
    mountain: { ax: 12, ay: 21, art:
      '<path d="M1 21 L8.5 6 L12.5 13 L15.5 9 L23 21 Z" fill="#e3d8c0"/>' +
      '<path d="M8.5 6 L6.7 9.6 L8.4 8.9 L10.1 10 Z" fill="#fbf8f1" stroke-width="0.8"/>' },
    forest: { ax: 12, ay: 22, art:
      '<path d="M2 20 L4.6 12 L7.2 20 Z M6.5 19 L9.5 8 L12.5 19 Z M12 19.5 L15.8 5 L19.6 19.5 Z" fill="#a9cf9f"/>' +
      '<path d="M4.6 20 v2 M9.5 19 v3 M15.8 19.5 v2.5" fill="none"/>' },
    lake: { ax: 12, ay: 21, art:
      '<ellipse cx="13" cy="17" rx="10" ry="4.2" fill="#c9d8d4"/>' +
      '<path d="M8 17 h4 M14 18.6 h4" fill="none" stroke-width="0.8"/>' +
      '<path d="M2.5 15 q0.8 -5 -0.4 -8.5 M4.2 15 q0.4 -4 2.2 -6.2 M3.3 15 v-5" fill="none" stroke-width="0.9"/>' },
    x: { ax: 12, ay: 12, art:                                                            // "X marks the spot"
      '<path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" fill="none" stroke="#b23a28" stroke-width="3.2"/>' },
  };
  const ICON_SCALE = 2.2;

  /** A smooth curve through the points (Catmull-Rom spline as cubic Béziers). */
  function smoothPath(pts) {
    const f = n => Math.round(n * 10) / 10;
    return pts.reduce((d, p, i) => {
      if (i === 0) return 'M' + f(p[0]) + ',' + f(p[1]);
      const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || p;
      const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
      const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
      return d + ' C' + [c1, c2, p].map(q => f(q[0]) + ',' + f(q[1])).join(' ');
    }, '');
  }

  function drawTrail() {
    const svg = $('#trail');
    if (!svg) return;
    const W = document.documentElement.clientWidth;
    svg.style.height = '0px';                                // measure the page without the old drawing
    const H = document.documentElement.scrollHeight;
    const box = el => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right }; };
    const clampX = x => Math.max(10, Math.min(W - 10, x));

    const title = box($('h1')), lede = box($('.lede'));
    const parts = [$('.masthead'), ...document.querySelectorAll('main:not([hidden]) .plate:not([hidden])'), $('.colophon')].map(box);
    const content = parts.length > 2 ? parts[1] : { left: Math.max(16, (W - 948) / 2), right: Math.min(W - 16, (W + 948) / 2) };
    const out = side => side > 0 ? clampX(content.right + Math.min(56, (W - content.right) * 0.55))
                                 : clampX(content.left - Math.min(56, content.left * 0.55));
    const marginRoom = Math.min(content.left, W - content.right);   // space beside the sections

    const pts = [], icons = [];
    const stopAt = (x, y, icon) => { pts.push([x, y]); if (icon) icons.push([icon, x, y]); };

    // 1. Around the title, where the decoration is seen most.
    //    Wide screens: signpost (bottom left) -> mountain -> over the title -> forest -> lake -> down.
    //    Narrow screens: signpost -> over the title -> down (no room beside the text for more).
    const top = parts[0].top + 14, mid = (title.left + title.right) / 2;
    if (lede.left > 150) {
      const L = lede.left - 80, R = lede.right + 80;
      stopAt(L + 20, parts[0].bottom - 50, 'signpost');
      stopAt(L - 40, title.bottom + 40, 'mountain');
      pts.push([L + 10, top + 34], [mid - 120, top + 6], [mid + 120, top + 10], [R - 10, title.top + 14]);
      stopAt(R + 24, title.bottom + 30, 'forest');
      stopAt(R - 6, lede.bottom + 70, 'lake');
    } else {
      stopAt(clampX(title.left - 50), title.bottom + 8, 'signpost');
      pts.push([mid - 70, top + 4], [mid + 70, top + 8], [clampX(title.right + 36), title.top + 34]);
    }
    pts.push([out(1), parts[0].bottom - 30]);

    // 2. Gentle S-curves across each gap between sections, alternating direction,
    //    and down the margins in between
    let dir = -1;                                             // first crossing goes right to left
    const sideStops = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const y = (parts[i].bottom + parts[i + 1].top) / 2;
      const from = dir < 0 ? content.right - 40 : content.left + 40;
      const to = dir < 0 ? content.left + 40 : content.right - 40;
      pts.push([from, y + 3], [(from + to) / 2, y - 5], [to, y + 2]);
      if (i < parts.length - 2) {
        const next = parts[i + 1];
        const stop = [out(dir), next.top + (next.bottom - next.top) * 0.45];
        pts.push(stop);
        sideStops.push(stop);
      }
      dir = -dir;
    }

    // 3. Round the side of the footer text, ending below it: X marks the spot
    const foot = parts[parts.length - 1];
    const side = -dir;                                        // the side the last crossing finished on
    const end = [clampX(W / 2 + side * 150), foot.bottom - 20];
    pts.push([out(side), foot.bottom - 44], [clampX(end[0] + side * 70), foot.bottom - 24], end);
    icons.push(['x', end[0], end[1]]);
    if (sideStops.length >= 2 && marginRoom >= 60) {          // forest and lake at bends, if they fit beside the sections
      const f = sideStops[Math.floor((sideStops.length - 1) / 2)];
      const l = sideStops[sideStops.length - 1];
      icons.push(['forest', f[0], f[1]], ['lake', l[0], l[1]]);
    }

    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.height = H + 'px';
    // Each icon is drawn twice: first a slightly fatter "halo" in the paper colour (hides the
    // route behind it, so the icon looks solid), then the icon itself.
    const s = ICON_SCALE, half = 12 * s;
    const place = ([name, x, y]) => {
      const ic = ICONS[name];
      const cx = Math.max(half + 2, Math.min(W - half - 2, x));          // keep icons on screen
      return 'translate(' + Math.round(cx - ic.ax * s) + ',' + Math.round(y - ic.ay * s) + ') scale(' + s + ')';
    };
    svg.innerHTML = '<path class="route" d="' + smoothPath(pts) + '"/>' +
      icons.map(ic =>
        '<g transform="' + place(ic) + '">' +
          '<g class="halo">' + ICONS[ic[0]].art + '</g>' +
          '<g class="icon" stroke="#5e574b" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">' + ICONS[ic[0]].art + '</g>' +
        '</g>'
      ).join('');
  }

  // Redraw whenever the layout can change: first load, fonts arriving, new data, resizing
  let trailFrame = 0;
  const redrawTrail = () => { cancelAnimationFrame(trailFrame); trailFrame = requestAnimationFrame(() => { drawTrail(); drawScatter(); }); };

  // ---------- Decoration: your latest lifers' stickers, scattered in the margins ----------
  // Like stickers in a field notebook: the newest lifers, tilted, in the empty space either side
  // of the page. Only where there is room (wide screens), never over the content. A seeded random
  // number generator keeps each bird in the same place every time the page is redrawn.
  // Where the stickers go. The places are fixed (the birds in them are random each load):
  // 16 down the page, plus set places around the title card and the footer. Each place is the
  // centre of a sticker: x from the page's centre (c) or across a margin (left/right, 0 = by the
  // page, 1 = the window edge); y in pixels below the top of the title card (or the footer).
  // "in" and "out" keep a sticker inside or outside the dotted route.
  const SCATTER_BODY = 16;
  const HEAD_PLACES = [
    { c: -265, y: 80, where: 'in' },          // beside the heading, left
    { c: -305, y: 280, where: 'in' },         // by the buttons, left
    { left: 0.45, y: 255, where: 'out' },     // left margin
    { left: 0.35, y: 455, where: 'any' },     // left margin, lower
    { c: 315, y: 80, where: 'in' },           // beside the heading, right
    { c: 290, y: 300, where: 'in' },          // by the buttons, right, inside the route
    { right: 0.55, y: 350, where: 'out' },    // right margin, outside the route
  ];
  const FOOT_PLACES = [{ left: 0.5, y: 40, where: 'any' }, { right: 0.5, y: 95, where: 'any' }];
  const SCATTER_ALL = SCATTER_BODY + HEAD_PLACES.length + FOOT_PLACES.length;
  // Once a sticker has popped in, drop the animation so hovering can straighten it
  $('#lifer-scatter').addEventListener('animationend', e => e.target.classList.remove('pop'));
  let scatterKey = '';
  // A fresh random choice of birds each time a file is shown (their places stay the same);
  // kept while it's on screen, so resizing the window doesn't reshuffle them.
  let scatterPick = null;                // { text, birds }
  function seeded(text) {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  function drawScatter() {
    const box = $('#lifer-scatter');
    if (!current || !stickers || $('#dashboard').hidden) { box.innerHTML = ''; scatterKey = ''; $('#sticker-controls').hidden = true; return; }
    // The switch and Shuffle only where there's room for stickers (set first: it changes the title card's height)
    const roomy = Math.min($('main').getBoundingClientRect().left + 16, document.documentElement.clientWidth - $('main').getBoundingClientRect().right + 16) - 20 >= 70;
    if ($('#sticker-controls').hidden === roomy) $('#sticker-controls').hidden = !roomy;
    // A new file, the other kind of bird, or Shuffle: pick again (a name fix keeps them)
    if (!scatterPick || scatterPick.text !== current.text || scatterPick.mode !== stickerMode) {
      const pool = stickerMode === 'all'
        ? checklist.species.filter(sp => !sp.extinct && stickerFor_(sp, stickers))       // any living bird with a sticker
        : current.d.lifers.filter(l => stickerFor_(checklist.species[l.i], stickers));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }   // shuffle
      scatterPick = { text: current.text, mode: stickerMode, birds: pool.slice(0, SCATTER_ALL) };
      scatterKey = '';                                           // new birds: let them pop in
    }
    const birds = scatterPick.birds;
    const main = $('main').getBoundingClientRect(), top = $('.masthead').getBoundingClientRect().top + scrollY;
    const headBottom = $('#dashboard').getBoundingClientRect().top + scrollY;
    const footTop = $('.colophon').getBoundingClientRect().top + scrollY;
    const pageBottom = document.documentElement.scrollHeight;
    const left = main.left + 16, right = main.right - 16, width = document.documentElement.clientWidth;
    const gutter = Math.min(left, width - right) - 20;          // room either side of the page
    const key = birds.map(b => b.sci).join() + '|' + Math.round(width) + '|' + Math.round(footTop);
    if (key === scatterKey) return;                              // nothing has moved
    const fresh = !scatterKey;                                   // first time: let them pop in
    scatterKey = key;
    if (gutter < 70 || !birds.length) { box.innerHTML = ''; return; }
    const size = Math.min(124, gutter * 0.9);                  // never wider than the margin

    // What a sticker mustn't cover: the words (not their full-width blocks), buttons, the route's icons
    const pageBox = r => ({ l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY });
    const textBox = el => { const rg = document.createRange(); rg.selectNodeContents(el); return pageBox(rg.getBoundingClientRect()); };
    const blocked = [];
    [...document.querySelectorAll('.masthead > *, .colophon > *')].filter(el => el.offsetParent && !el.hidden).forEach(el => {
      if (el.id === 'controls') [...el.children, ...el.querySelectorAll('.binoculars')].forEach(c => blocked.push(pageBox(c.getBoundingClientRect())));
      else if (el.tagName === 'DETAILS') blocked.push(textBox(el.querySelector('summary')));
      else if (el.textContent.trim()) blocked.push(textBox(el));
    });
    document.querySelectorAll('#trail > g').forEach(g => blocked.push(pageBox(g.getBoundingClientRect())));
    const clear = (x, y, s, gap) => blocked.every(o => x + s + gap < o.l || x - gap > o.r || y + s + gap < o.t || y - gap > o.b);

    // The dotted route, as points on the page, to tell "inside the loop" from "outside it"
    const route = $('#trail .route'), routePts = [];
    if (route && route.getTotalLength) {
      const m = route.getScreenCTM(), len = route.getTotalLength();
      for (let d = 0; d <= len; d += 8) {
        const p = route.getPointAtLength(d).matrixTransform(m);
        routePts.push([p.x, p.y + scrollY]);
      }
    }
    const insideRoute = (cx, cy) => {
      const xs = routePts.filter(p => Math.abs(p[1] - cy) < 10).map(p => p[0]);
      return xs.some(x => x < cx) && xs.some(x => x > cx);     // the route on both sides of it
    };

    // A set place, turned into a spot on this screen. If it would touch text, an icon or another
    // sticker (or be on the wrong side of the route), the nearest clear spot is used instead,
    // searching outwards in rings. Always the same answer for the same layout.
    const placeSpot = (pl, s, y0) => {
      const cx = pl.c !== undefined ? width / 2 + pl.c
        : pl.left !== undefined ? left - 12 - (left - 24) * pl.left
          : right + 12 + (width - right - 24) * pl.right;
      const cy = y0 + pl.y;
      const ok = (x, y) => x >= 6 && x + s <= width - 6 && clear(x, y, s, 14) &&
        (pl.where === 'any' || insideRoute(x + s / 2, y + s / 2) === (pl.where === 'in'));
      for (let r = 0; r <= 180; r += 12) {
        const tries = r ? Math.max(8, Math.round(r / 4)) : 1;
        for (let a = 0; a < tries; a++) {
          const x = cx - s / 2 + r * Math.cos(2 * Math.PI * a / tries), y = cy - s / 2 + r * Math.sin(2 * Math.PI * a / tries);
          if (ok(x, y)) { blocked.push({ l: x, r: x + s, t: y, b: y + s }); return [x, y]; }
        }
      }
      return null;                                                 // no room: leave this one out
    };

    // Down the page: alternating sides, evenly spaced, with a random place, size and tilt in each slot
    const nHead = HEAD_PLACES.length, nFoot = FOOT_PLACES.length;
    const step = (footTop - headBottom - size) / SCATTER_BODY;
    box.style.height = pageBottom + 'px';
    const headPlaced = [];                                       // where the title-card stickers landed, for the hint
    box.innerHTML = birds.map((b, i) => {
      const rnd = seeded('place ' + i);                           // the place's own numbers: the same every load
      const part = i < nHead ? 'head' : i < nHead + nFoot ? 'foot' : 'body';
      let x, y, s;
      if (part === 'body') {
        const k = i - nHead - nFoot, onLeft = k % 2 === 0;
        s = Math.round(size * (0.8 + rnd() * 0.2));
        const room = Math.max(0, gutter - s);
        x = onLeft ? left - 12 - s - rnd() * room : right + 12 + rnd() * room;
        y = headBottom + step * (k + 0.2 + rnd() * 0.6);
      } else {
        // By the title and the footer they aren't squeezed into a margin, so they keep a steady size
        s = Math.round(76 + rnd() * 22);
        const spot = part === 'head' ? placeSpot(HEAD_PLACES[i], s, top) : placeSpot(FOOT_PLACES[i - nHead], s, footTop);
        if (!spot) return '';
        [x, y] = spot;
        if (part === 'head') headPlaced.push({ x, y, s });
      }
      const turn = Math.round((rnd() * 2 - 1) * 14);
      const st = stickerFor_(checklist.species[b.i], stickers);
      // A button that opens the bird's fact file. Out of the tab order: the lifer list has the same birds for keyboards.
      return '<button type="button" class="scatter-sticker bird-link' + (fresh ? ' pop' : '') + '" data-sci="' + esc(b.sci) + '" tabindex="-1"' +
        ' title="' + esc(b.common) + '" style="left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + s + 'px;height:' + s + 'px;--turn:' + turn + 'deg;animation-delay:' + (i * 60) + 'ms">' +
        '<img src="' + esc(st.thumb) + '" alt="" width="' + s + '" height="' + s + '"></button>';
    }).join('') + stickerHint(headPlaced, routePts, clear, width);
  }

  // A hint that the stickers can be clicked: "click me" and a dotted arrow pointing at the
  // leftmost sticker by the title (where eyes usually land first). The label goes on whichever
  // side of the bird is clear of text, other stickers and the dotted route. Shown on each visit
  // until a sticker is clicked (it used to be hidden for good after the first click, which made
  // it look as if it had stopped working).
  const HINT_KEY = 'lifelist.stickerClicked';
  const hintDone = () => { try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; } };
  function stickerHint(placed, routePts, clear, width) {
    if (!placed.length || hintDone()) return '';
    const p = placed.reduce((a, b) => (b.x < a.x ? b : a));
    const cx = p.x + p.s / 2, cy = p.y + p.s / 2, W = 74, H = 24;      // the bird's centre; the label's size
    const awayFromRoute = (x, y) => routePts.every(([rx, ry]) => Math.hypot(rx - x, ry - y) > 14);
    // Where the label could go, nearest first: below, below-right, right, above, below-left
    const options = [[cx - W / 2, p.y + p.s + 34], [p.x + p.s * 0.75, p.y + p.s + 26], [p.x + p.s + 30, cy - H / 2],
      [cx - W / 2, p.y - H - 34], [p.x - W - 6, p.y + p.s + 26]];
    for (const [lx, ly] of options) {
      if (lx < 6 || lx + W > width - 6 || !clear(lx, ly, Math.max(W, H), 6)) continue;
      // The arrow: from the label's nearest edge to just outside the bird, bowed a little
      const ax = Math.max(lx, Math.min(lx + W, cx)), ay = ly + H / 2 < cy ? ly + H : ly + H / 2 > cy + p.s / 2 ? ly : ly + H / 2;
      const d = Math.hypot(cx - ax, cy - ay), ux = (cx - ax) / d, uy = (cy - ay) / d;
      const bx = cx - ux * p.s * 0.48, by = cy - uy * p.s * 0.48;      // stop at the bird's edge
      const mx = (ax + bx) / 2 - uy * 12, my = (ay + by) / 2 + ux * 12;
      const label = [[lx, ly], [lx + W, ly], [lx, ly + H], [lx + W, ly + H], [lx + W / 2, ly + H / 2]];
      const arrow = [0.25, 0.5, 0.75, 1].map(t => [(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by]);
      if (!label.concat(arrow).every(([x, y]) => awayFromRoute(x, y))) continue;   // keep off the red dotted line
      // Arrowhead: two short strokes back from the tip
      const hx = bx - mx, hy = by - my, hl = Math.hypot(hx, hy) || 1;
      const head = [28, -28].map(deg => {
        const r = deg * Math.PI / 180, vx = -hx / hl, vy = -hy / hl;
        return 'M' + bx.toFixed(1) + ' ' + by.toFixed(1) + 'l' + (8 * (vx * Math.cos(r) - vy * Math.sin(r))).toFixed(1) + ' ' + (8 * (vx * Math.sin(r) + vy * Math.cos(r))).toFixed(1);
      }).join('');
      return '<svg class="sticker-hint-arrow" aria-hidden="true" style="left:0;top:0" width="1" height="1">' +
          '<path class="hint-line" d="M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1) + '"/>' +
          '<path class="hint-head" d="' + head + '"/></svg>' +
        '<div class="sticker-hint" style="left:' + Math.round(lx) + 'px;top:' + Math.round(ly) + 'px;width:' + W + 'px;height:' + H + 'px">click me</div>';
    }
    return '';                                                       // nowhere clear: no hint
  }
  $('#lifer-scatter').addEventListener('click', e => {
    if (!e.target.closest('.scatter-sticker')) return;
    try { sessionStorage.setItem(HINT_KEY, '1'); } catch (err) { /* storage blocked: it just shows again next time */ }
    document.querySelectorAll('#lifer-scatter .sticker-hint, #lifer-scatter .sticker-hint-arrow').forEach(h => h.remove());
  });
  // Stickers of: your lifers or all birds (remembered in this browser), and Shuffle
  const STICKER_MODE_KEY = 'lifelist.stickerMode';
  let stickerMode = 'lifers';
  try { if (localStorage.getItem(STICKER_MODE_KEY) === 'all') stickerMode = 'all'; } catch (e) { /* not remembered */ }
  function showStickerMode() {
    $('.mode-switch').dataset.mode = stickerMode;
    $('.mode-switch').querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-checked', String(b.dataset.mode === stickerMode));
      b.tabIndex = b.dataset.mode === stickerMode ? 0 : -1;        // one tab stop; arrow keys switch
    });
  }
  function setStickerMode(mode) {
    stickerMode = mode;
    try { localStorage.setItem(STICKER_MODE_KEY, mode); } catch (e) { /* not remembered */ }
    showStickerMode();
    drawScatter();                                               // a different kind of bird: picks again
  }
  showStickerMode();
  $('.mode-switch').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (b && b.dataset.mode !== stickerMode) setStickerMode(b.dataset.mode);
  });
  $('.mode-switch').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    setStickerMode(stickerMode === 'all' ? 'lifers' : 'all');
    $('.mode-switch [data-mode="' + stickerMode + '"]').focus();
  });
  $('#sticker-shuffle').addEventListener('click', () => { scatterPick = null; drawScatter(); });

  addEventListener('resize', redrawTrail);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawTrail);
  // …and whenever the page's height changes for any other reason (text appearing or
  // disappearing, sections shown or hidden), so the route always fits the final layout
  if (window.ResizeObserver) new ResizeObserver(redrawTrail).observe(document.body);

  init();
  redrawTrail();
})();
