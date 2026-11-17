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
    if (!keepPlace) { $('#lifer-search').value = ''; lifersExpanded = false; lastAsk = null; zoomed = null; }   // a new file starts fresh
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

    $('#dashboard').hidden = false;     // must be visible before the map and charts measure their size
    renderRegions(d);
    renderCharts(d);
    renderMap(d);
    redrawTrail();                             // the page is taller now: redraw the decorative route
    if (!keepPlace) $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Latest lifers: the newest few, Show all / Show fewer, and a search ----------
  const LIFERS_SHOWN = 10;
  let lifersExpanded = false;

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
        '<span>' + birdButton(l.sci, '<span class="name">' + esc(l.common) + '</span>') + ' <span class="sci">' + esc(l.sci) + '</span></span></span>' +
      // Link only real eBird checklist IDs ("S123…"); the sample data's are made up
      '<span class="where">' + (/^S\d+$/.test(l.checklist)
        ? '<a href="https://ebird.org/checklist/' + encodeURIComponent(l.checklist) + '">' + esc(l.place || 'eBird checklist') + '</a>'
        : esc(l.place)) + '</span></li>';
  }

  function renderLifers() {
    const all = current ? current.d.lifers : [];
    const q = $('#lifer-search').value.trim();
    const matches = filterLifers_(all, q);
    const shown = q || lifersExpanded ? matches : matches.slice(0, LIFERS_SHOWN);   // a search shows every match
    $('#lifers').innerHTML = shown.map(liferItem).join('') ||
      '<li class="none">' + (q ? 'No lifers match “' + esc(q) + '”.' : 'No countable species found in this file.') + '</li>';
    $('#lifer-count').textContent = q
      ? num(matches.length) + ' lifer' + (matches.length === 1 ? '' : 's') + ' match “' + q + '”'
      : 'Showing ' + num(shown.length) + ' of ' + num(all.length) + ' lifers';
    const toggle = $('#lifers-toggle');
    toggle.hidden = !!q || all.length <= LIFERS_SHOWN;
    toggle.textContent = lifersExpanded ? 'Show fewer' : 'Show all ' + num(all.length) + ' lifers';
    toggle.setAttribute('aria-expanded', String(lifersExpanded));
  }

  $('#lifer-search').addEventListener('input', renderLifers);
  $('#lifers-toggle').addEventListener('click', () => {
    lifersExpanded = !lifersExpanded;
    renderLifers();
    // after collapsing a long list, bring the section back into view
    if (!lifersExpanded) $('#lifers-title').scrollIntoView({ block: 'nearest' });
  });

  // ---------- Fact files: click a bird for everything known about it ----------
  let rangesLoading = null;
  const loadRanges = () => (rangesLoading = rangesLoading || fetch('data/ranges.json')
    .then(r => r.ok ? r.json() : null).then(j => (j && j.ranges) || {}).catch(() => ({})));
  let factOpener = null;                 // the button that opened it, to return focus there

  async function openFactFile(sci, opener) {
    const sp = checklist.species[checklist.bySci.get(String(sci).toLowerCase())];
    if (!sp || !current) return;
    factOpener = opener || null;
    const dlg = $('#factfile');
    $('#factfile-body').innerHTML = '<p class="working">Opening the fact file…</p>';
    if (!dlg.open) dlg.showModal();
    const [data, ranges] = await Promise.all([askTables(), loadRanges()]);
    const row = data.species.find(r => r.scientific === sp.sci);
    const lifer = current.d.lifers.find(l => l.sci === sp.sci);
    const f = factFile_(sp, row, { lifer, range: ranges[sp.sci] || '', stickers });
    $('#factfile-body').innerHTML = factFileHtml(f);
    const st = current.d.stats && current.d.stats.species && current.d.stats.species[sp.i];
    drawRangeMap(sp, st && st.points ? [...st.points.values()] : []);
  }

  // ---------- The range map: GBIF records by season, drawn in the page's own colours ----------
  // GBIF (gbif.org) gathers bird records from eBird, museums and other surveys. Its map service
  // sends the records for a species and months as a grid of cells (vector tiles); zoom 1 is four
  // tiles, cells of about 150 km. Two seasons, so eight small requests, made only when a fact file opens.
  const GBIF = 'https://api.gbif.org/';
  const gbifKeys = new Map(), rangeCache = new Map();
  async function gbifKey(sci) {
    if (!gbifKeys.has(sci)) {
      gbifKeys.set(sci, fetch(GBIF + 'v1/species/match?rank=SPECIES&strict=true&name=' + encodeURIComponent(sci))
        .then(r => r.ok ? r.json() : null)
        .then(m => (m && m.usageKey && m.rank === 'SPECIES' && m.matchType === 'EXACT' ? m.acceptedUsageKey || m.usageKey : null)));
    }
    return gbifKeys.get(sci);
  }
  async function seasonTiles(key, months) {
    const tiles = await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(async ([x, y]) => {
      const res = await fetch(GBIF + 'v2/map/occurrence/adhoc/1/' + x + '/' + y + '.mvt?taxonKey=' + key + '&' + months +
        '&basisOfRecord=HUMAN_OBSERVATION&occurrenceStatus=PRESENT&hasGeospatialIssue=false&mode=GEO_CENTROID&srs=EPSG:3857');
      if (!res.ok) throw new Error('GBIF ' + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.length ? readMvtPoints_(buf).points : [];
    }));
    return tiles.flat();
  }
  function loadRange(sci) {
    if (!rangeCache.has(sci)) {
      const p = gbifKey(sci).then(async key => {
        if (!key) return { cells: [], key: null };
        const [june, december] = await Promise.all([seasonTiles(key, 'month=6,7'), seasonTiles(key, 'month=12&month=1')]);
        return { cells: seasonCells_(june, december), key };
      });
      p.catch(() => rangeCache.delete(sci));              // try again next time
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
      const [range, world] = await Promise.all([loadRange(sp.sci), loadWorld()]);
      if ($('#ff-map') !== box) return;                      // another bird was opened meanwhile
      if (!range.cells.length && !sightings.length) { box.innerHTML = '<p class="ai-note">No mapped records for this species on GBIF.</p>'; return; }
      box.innerHTML = rangeMapSvg_(range.cells, world, sightings);
      if (range.key) $('#ff-map-credit').innerHTML = 'Records: <a href="https://www.gbif.org/species/' + range.key + '">GBIF.org</a>, including eBird. ' +
        'June–July is summer in the north and winter in the south.';
    } catch (e) {
      if ($('#ff-map') === box) box.innerHTML = '<p class="ai-note">The map couldn\'t be loaded just now (' + esc(e.message) + ').</p>';
    }
  }

  function factFileHtml(f) {
    const list = (title, facts) => facts.length ? '<section class="ff-block"><h3>' + esc(title) + '</h3><dl>' +
      facts.map(x => '<div><dt>' + esc(x.label) + '</dt><dd>' +
        (x.label === 'Main habitat' && HABITAT_ICONS_[x.value] ? '<span class="icon habitat">' + habitatIconSvg_(x.value, 20) + '</span>' : '') +
        esc(x.value) + (x.source ? ' <span class="src">' + esc(x.source) + '</span>' : '') + '</dd></div>').join('') + '</dl></section>' : '';
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
        '<div class="ff-head"><h2 id="factfile-title">' + esc(f.common) + '</h2><p class="sci">' + esc(f.sci) + '</p>' +
          '<p class="ff-family">' + esc(f.family) + ' · <span class="sci">' + esc(f.familyLatin) + '</span> · ' + esc(f.order) + '</p>' +
          (f.iucn ? '<p class="ff-iucn">' + iucnBadge(f.iucn) + ' ' + esc(f.iucnName) + ' <span class="src">IUCN Red List</span></p>' : '') +
          (f.tags.length ? '<p class="ff-tags">' + f.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</p>' : '') +
          (regions ? '<p class="ff-regions"><strong>Regions:</strong> ' + esc(regions) + '</p>' : '') +
        '</div></div>' +
      (f.range ? '<section class="ff-block ff-range"><h3>Where it lives</h3><p>' + esc(f.range) + ' <span class="src">AviList</span></p></section>' : '') +
      '<section class="ff-block"><h3>Range map</h3><div id="ff-map" class="ff-map"><p class="working">Loading the map…</p></div>' +
        '<ul class="ff-legend"><li><span class="sw june"></span>Recorded in June–July</li><li><span class="sw december"></span>December–January</li>' +
        '<li><span class="sw both"></span>Both</li>' + (f.seen ? '<li><span class="sw mine"></span>Your sightings</li>' : '') + '</ul>' +
        '<p id="ff-map-credit" class="ff-credit"></p></section>' +
      '<div class="ff-grid">' + list('Size', f.size) + list('Life', f.life) + '</div>' +
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

  // ---------- Names to check: suggestions, Accept, Don't count it, Undo ----------
  const commonName = sci => { const i = checklist.bySci.get(String(sci).toLowerCase()); return i === undefined ? '' : checklist.species[i].common; };

  function renderNameFixes(d) {
    const fixes = getFixes();
    $('#unmatched-plate').hidden = !d.unmatched.length && !fixes.size;
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
    // Habitats get a small drawing (habitat-icons.js)
    if (col.field === 'habitat' && HABITAT_ICONS_[v]) {
      return '<td><span class="with-icon"><span class="icon habitat" title="' + esc(HABITAT_ICONS_[v].label) + '">' +
        habitatIconSvg_(v, 20) + '</span>' + words + '</span></td>';
    }
    if (!kind) return '<td' + cls + '>' + words + '</td>';
    // Species rows: the bird's sticker, and its name opens the fact file. Families and orders: a silhouette.
    return '<td' + cls + '><span class="with-icon">' + birdIcon(kind.sci, kind.familyLatin, kind.order, 28) +
      (kind.sci ? birdButton(kind.sci, words) : words) + '</span></td>';
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
        '<span class="country-title">' + esc(countryName(cc)) + '</span>' +
        '<span class="note">' + num(rows.length) + ' ' + unit[rows.length === 1 ? 0 : 1] + ' birded. ' +
        (anyTotals ? 'Bars show how many of the species ever recorded there (eBird) you\'ve seen.' : 'Shaded by species recorded.') + '</span></li>' +
      rows.map(r => {
        const pctSeen = r.total ? Math.min(1, r.species / r.total) : null;
        return '<li><div class="row"><span class="name">' + esc(r.name) + (r.unmapped ? ' <span class="note">(not on the map)</span>' : '') + '</span>' +
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

  $('#region-bars').addEventListener('click', e => { if (e.target.closest('[data-act="world"]')) closeCountry(); });
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
  const redrawTrail = () => { cancelAnimationFrame(trailFrame); trailFrame = requestAnimationFrame(drawTrail); };
  addEventListener('resize', redrawTrail);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawTrail);
  // …and whenever the page's height changes for any other reason (text appearing or
  // disappearing, sections shown or hidden), so the route always fits the final layout
  if (window.ResizeObserver) new ResizeObserver(redrawTrail).observe(document.body);

  init();
  redrawTrail();
})();
