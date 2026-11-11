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

  let checklist = null, matching = null;
  let charts = [], map = null, countryLayer = null, countryShapes = null;
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

    $('#lifers').innerHTML = d.lifers.slice(0, 20).map(l =>
      '<li><span class="date">' + esc(date(l.date)) + '</span>' +
      '<span><span class="name">' + esc(l.common) + '</span> <span class="sci">' + esc(l.sci) + '</span></span>' +
      '<span class="where">' + (l.checklist
        ? '<a href="https://ebird.org/checklist/' + encodeURIComponent(l.checklist) + '">' + esc(l.place || 'eBird checklist') + '</a>'
        : esc(l.place)) + '</span></li>'
    ).join('') || '<li>No countable species found in this file.</li>';

    renderNameFixes(d);

    $('#dashboard').hidden = false;     // must be visible before the map and charts measure their size
    renderRegions(d);
    renderCharts(d);
    renderMap(d);
    redrawTrail();                             // the page is taller now: redraw the decorative route
    if (!keepPlace) $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  async function suggest(li, u) {
    const btn = li.querySelector('[data-act="suggest"]'), out = li.querySelector('.um-result');
    btn.disabled = true;
    out.innerHTML = '<p class="working">Comparing with AviList…</p>';
    await new Promise(r => setTimeout(r, 30));          // let the page update before the slow step
    if (!matching) matching = speciesForMatching_(checklist);
    const ebird = { sci: u.sci, common: u.common };
    const prep = prepareSuggestion_(ebird, matching);   // string matching and shortlist, on this computer
    let d = prep.final;
    if (!d) {
      out.innerHTML = '<p class="working">Checking with Lyrebird…</p>';
      let ans;
      try {
        const reply = await askLyrebird({ action: 'nameFix', ebird, shortlist: prep.shortlist.map(c => ({ sci: c.sci, common: c.common })) });
        ans = answerFromLyrebird_(reply, prep.shortlist);
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
          '<p class="why">' + esc(d.reason) + '</p>' +
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

  // ---------- Plate II: region bars and the Oceans card ----------
  function renderRegions(d) {
    const bar = r =>
      '<div class="row"><span class="name">' + esc(r.name) + '</span>' +
      '<span class="figs">' + num(r.seen) + ' / ' + num(r.total) + ' · ' + pct(r.pct) + '</span></div>' +
      '<div class="track" aria-hidden="true"><div class="fill" style="width:' + (r.pct * 100).toFixed(2) + '%"></div></div>';
    const land = d.regions.filter(r => r.name !== 'Oceans');
    const sea = d.regions.find(r => r.name === 'Oceans');
    $('#region-bars').innerHTML = land.map(r => '<li>' + bar(r) + '</li>').join('') +
      (sea ? '<li class="sea">' + bar(sea) + '<span class="note">Seabirds that breed at sea or on remote islands, so not shaded on the map.</span></li>' : '');
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
    // Birded countries in five shades by species recorded there; unbirded countries stay plain.
    // Square-root scale, so countries with a handful of species still differ from those with dozens.
    const most = Math.max(0, ...d.countries.map(c => c.species));
    const shade = n => (!n || !most) ? 0 : Math.max(1, Math.min(5, Math.ceil(Math.sqrt(n / most) * 5)));
    const upTo = k => Math.round(most * (k / 5) ** 2);
    const colour = n => css(n ? '--map-' + n : '--map-none');

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
    countryLayer = L.geoJSON(countryShapes, {
      style: f => ({
        fillColor: colour(shade(speciesIn.get(countryCode_(f.properties)))), fillOpacity: 1, color: css('--rule'), weight: 0.6,
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties, region = regionForCountry_(p), r = byRegion.get(region);
        const n = speciesIn.get(countryCode_(p));
        layer.bindTooltip('<strong>' + esc(p.NAME) + '</strong><br>' +
          (n ? num(n) + ' species recorded here' : 'Not birded yet') +
          (r ? '<br><span class="tip-region">' + esc(region) + ': ' + num(r.seen) + ' of ' + num(r.total) +
            ' breeding species seen (' + pct(r.pct) + ')</span>' : ''), { sticky: true });
      },
    }).addTo(map);
    map.invalidateSize();
    if (!map._fittedWorld) {          // first time only, so a zoom the visitor chose is kept on redraws
      map.fitBounds([[-55, -168], [78, 180]]);
      map._fittedWorld = true;
    }

    $('#map-legend').innerHTML = '<span class="key"><span class="swatch" style="background:' + colour(0) + '"></span>not birded</span>' +
      [1, 2, 3, 4, 5].map(k => '<span class="key"><span class="swatch" style="background:' + colour(k) + '"></span>up to ' +
        num(Math.max(1, upTo(k))) + '</span>').join('') + '<span class="key">species</span>';
  }


  $('#file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      status('That\'s the .zip from eBird. Please unzip it first and upload the MyEBirdData.csv file inside.');
      return;
    }
    status('Reading ' + file.name + '…');
    const reader = new FileReader();
    reader.onload = () => show(reader.result, 'Your life list, from ' + file.name);
    reader.onerror = () => status('Sorry, that file could not be read.');
    reader.readAsText(file);
    e.target.value = '';   // allow choosing the same file again
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
