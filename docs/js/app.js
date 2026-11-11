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

  let checklist = null;

  // Name fixes the visitor has accepted, kept in their own browser (used fully in a later version)
  function loadFixes() {
    try { return new Map(JSON.parse(localStorage.getItem('lifelist.fixes') || '[]')); } catch (e) { return new Map(); }
  }

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
    } catch (e) {
      status('Sorry, the checklist could not be loaded (' + e.message + '). Please try reloading the page.');
    }
  }

  function show(text, label) {
    try {
      const d = buildDashboard_(parseCsvText_(text), checklist, loadFixes());
      render(d, label);
      status('');
    } catch (e) {
      status(e.message);
    }
  }

  function render(d, label) {
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

    $('#unmatched-plate').hidden = !d.unmatched.length;
    $('#unmatched').innerHTML = d.unmatched.map(u =>
      '<li><span class="sci">' + esc(u.sci) + '</span> ' + esc(u.common) +
      ' <span class="n">· ' + num(u.n) + ' record' + (u.n === 1 ? '' : 's') + '</span></li>'
    ).join('');

    $('#dashboard').hidden = false;
    $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  init();
})();
