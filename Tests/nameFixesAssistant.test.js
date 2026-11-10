// Tests for the Name Fixes assistant's pure functions (and a few existing ones).
// Run from the repo folder with:   node --test
//
// Apps Script files share one global scope, so we load Code.gs and
// NameFixesAssistant.gs into the same sandbox here to mimic that.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['Code.gs', 'NameFixesAssistant.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const run = expr => vm.runInContext(expr, ctx);
const call = (fn, ...args) => run(fn)(...args);

// A small, made-up slice of the Species tab: row, scientific, common, other names.
const SPECIES = [
  [0, 'Ardea cinerea', 'Grey Heron', ''],
  [1, 'Ardea alba', 'Great Egret', 'Western Great Egret'],
  [2, 'Ardea purpurea', 'Purple Heron', ''],
  [3, 'Ardea herodias', 'Great Blue Heron', ''],
  [4, 'Turdus merula', 'Eurasian Blackbird', 'Common Blackbird'],
  [5, 'Turdus philomelos', 'Song Thrush', ''],
  [6, 'Curruca curruca', 'Lesser Whitethroat', ''],
  [7, 'Curruca communis', 'Greater Whitethroat', 'Common Whitethroat'],
  [8, 'Gyps rueppelli', "Rüppell's Vulture", ''],
  [9, 'Charadrius hiaticula', 'Common Ringed Plover', ''],
  [10, 'Charadrius dubius', 'Little Ringed Plover', ''],
  [11, 'Charadrius alexandrinus', 'Kentish Plover', ''],
  [12, 'Charadrius mongolus', 'Siberian Sand Plover', ''],
  [13, 'Charadrius leschenaultii', 'Greater Sand Plover', ''],
  [14, 'Charadrius vociferus', 'Killdeer', ''],
  [15, 'Charadrius semipalmatus', 'Semipalmated Plover', ''],
  [16, 'Charadrius morinellus', 'Eurasian Dotterel', ''],
  [17, 'Picus canus', 'Grey-headed Woodpecker', ''],
  [18, 'Motacilla alba', 'White Wagtail', 'Pied Wagtail'],
  [19, 'Parus major', 'Great Tit', ''],
  [20, 'Cyanistes caeruleus', 'Eurasian Blue Tit', ''],
  [21, 'Erithacus rubecula', 'European Robin', ''],
  [22, 'Columba palumbus', 'Common Wood Pigeon', ''],
].map(([row, sci, common, alt]) => ({ row, sci, common, alt }));

// ---------- tidying names ----------
test('nameKey_ ignores case, punctuation, brackets and Grey/Gray', () => {
  assert.equal(call('nameKey_', 'Grey-headed Woodpecker (Grey-faced)'), 'grayheadedwoodpecker');
  assert.equal(call('nameKey_', 'Gray-headed woodpecker'), 'grayheadedwoodpecker');
});

test('nameSimilarity_ treats spelling and accent differences as identical', () => {
  assert.equal(call('nameSimilarity_', 'Gray Heron', 'Grey Heron'), 1);
  assert.equal(call('nameSimilarity_', "Ruppell's Vulture", "Rüppell's Vulture"), 1);
});

test('nameSimilarity_ scores a typo highly but not as identical', () => {
  const s = call('nameSimilarity_', 'Eurasian Blackbrid', 'Eurasian Blackbird');
  assert.ok(s >= 0.8 && s < 1, 'got ' + s);
});

test('nameSimilarity_ never calls look-alike different birds identical', () => {
  const s = call('nameSimilarity_', 'Lesser Whitethroat', 'Greater Whitethroat');
  assert.ok(s < 1, 'got ' + s);
});

// ---------- method 1: string matching ----------
test('stringMatch_ finds the right species from a Gray/Grey spelling', () => {
  const m = call('stringMatch_', { sci: '', common: 'Gray Heron' }, SPECIES);
  assert.equal(m.sci, 'Ardea cinerea');
  assert.equal(m.score, 1);
});

test('stringMatch_ uses other names, e.g. Pied Wagtail', () => {
  const m = call('stringMatch_', { sci: '', common: 'Pied Wagtail' }, SPECIES);
  assert.equal(m.sci, 'Motacilla alba');
  assert.match(m.via, /other name/);
});

test('stringMatch_ picks the closer of two look-alikes', () => {
  const m = call('stringMatch_', { sci: '', common: 'Lesser Whitethroat' }, SPECIES);
  assert.equal(m.sci, 'Curruca curruca');
});

test('stringMatch_ matches an old genus name by species name and common name', () => {
  // eBird may still use Sylvia for whitethroats; AviList uses Curruca
  const m = call('stringMatch_', { sci: 'Sylvia curruca', common: 'Lesser Whitethroat' }, SPECIES);
  assert.equal(m.sci, 'Curruca curruca');
});

test('stringMatch_ returns null when nothing is similar enough', () => {
  assert.equal(call('stringMatch_', { sci: 'Aquila chrysaetos', common: 'Golden Eagle' }, SPECIES), null);
});

// ---------- shortlist ----------
test('buildShortlist_ includes the right answer and same-genus species, capped at 15', () => {
  const list = call('buildShortlist_', { sci: 'Charadrius hiaticula', common: 'Ringed Plover' }, SPECIES);
  const scis = list.map(x => x.sci);
  assert.ok(list.length <= 15);
  assert.equal(scis[0], 'Charadrius hiaticula');          // best first
  assert.ok(scis.includes('Charadrius vociferus'));       // Killdeer: same genus, unlike name
  assert.equal(new Set(list.map(x => x.row)).size, list.length); // no duplicates
});

// ---------- combining the two methods ----------
const str = (sci, row, score) => ({ sci, row, score, via: 'common name' });
const ai = (sci, row) => ({ sci, row, reason: 'test reason' });

test('decideSuggestion_: near-identical string match is High', () => {
  assert.equal(call('decideSuggestion_', str('Ardea cinerea', 0, 1), null).confidence, 'High');
});
test('decideSuggestion_: both methods agree is High', () => {
  assert.equal(call('decideSuggestion_', str('Ardea alba', 1, 0.85), ai('Ardea alba', 1)).confidence, 'High');
});
test('decideSuggestion_: only one method is Medium', () => {
  assert.equal(call('decideSuggestion_', str('Ardea alba', 1, 0.85), null).confidence, 'Medium');
  assert.equal(call('decideSuggestion_', null, ai('Ardea alba', 1)).confidence, 'Medium');
});
test('decideSuggestion_: methods disagree is Low, and the reason names both', () => {
  const d = call('decideSuggestion_', str('Curruca communis', 7, 0.82), ai('Curruca curruca', 6));
  assert.equal(d.confidence, 'Low');
  assert.match(d.reason, /Curruca communis/);
});
test('decideSuggestion_: neither method is blank', () => {
  const d = call('decideSuggestion_', null, null);
  assert.equal(d.sci, '');
  assert.equal(d.confidence, '');
});

// ---------- existing Code.gs function, from walkthrough part 1 ----------
test('parseEbirdName_ keeps the subspecies as a form', () => {
  const p = call('parseEbirdName_', 'Motacilla alba yarrellii', 'White Wagtail (British)');
  assert.equal(p.binomial, 'Motacilla alba');
  assert.equal(p.form, 'yarrellii (British)');
});
