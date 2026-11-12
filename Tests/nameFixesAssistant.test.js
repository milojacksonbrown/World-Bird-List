// Tests for the Name Fixes assistant's pure functions (and a few existing ones).
// Run from the repo folder with:   node --test
//
// Apps Script files share one global scope, so we load LifeList.gs and
// NameFixesAssistant.gs into the same sandbox here to mimic that.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const file of ['LifeList.gs', 'NameFixesAssistant.gs']) {
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

// ---------- existing LifeList.gs function, from walkthrough part 1 ----------
test('parseEbirdName_ keeps the subspecies as a form', () => {
  const p = call('parseEbirdName_', 'Motacilla alba yarrellii', 'White Wagtail (British)');
  assert.equal(p.binomial, 'Motacilla alba');
  assert.equal(p.form, 'yarrellii (British)');
});

// ===================== part 2: AI check and Accept tick box =====================
// The AI is replaced by a fake function, so these tests never call the internet.
const fakeAi = reply => () => (typeof reply === 'string' ? reply : JSON.stringify(reply));
const RINGED = { sci: 'Charadrius hiaticula', common: 'Ringed Plover' };

test('buildAiPrompt_ sends bird names only, as a numbered shortlist', () => {
  const list = call('buildShortlist_', RINGED, SPECIES);
  const p = call('buildAiPrompt_', RINGED, list);
  assert.match(p, /eBird name: Charadrius hiaticula \(Ringed Plover\)/);
  assert.match(p, /^1\. Charadrius hiaticula \(Common Ringed Plover\)$/m);
  assert.match(p, new RegExp('^' + list.length + '\\. ', 'm'));
});

test('readGeminiText_ pulls out the reply text, and fails on an empty answer', () => {
  assert.equal(call('readGeminiText_', { candidates: [{ content: { parts: [{ text: '{"choice":1}' }] } }] }), '{"choice":1}');
  assert.throws(() => call('readGeminiText_', { candidates: [] }));
});

test('parseAiAnswer_ accepts a candidate number, 0 for none, and rejects anything else', () => {
  const list = call('buildShortlist_', RINGED, SPECIES);
  const pick = call('parseAiAnswer_', '```json\n{"choice": 1, "reason": "same species"}\n```', list);
  assert.equal(pick.status, 'pick');
  assert.equal(pick.pick.sci, 'Charadrius hiaticula');
  assert.equal(call('parseAiAnswer_', '{"choice": 0, "reason": "not here"}', list).status, 'none');
  assert.equal(call('parseAiAnswer_', '{"choice": 99, "reason": "x"}', list).status, 'invalid');
  assert.equal(call('parseAiAnswer_', '{"choice": "Aquila chrysaetos", "reason": "x"}', list).status, 'invalid');
  assert.equal(call('parseAiAnswer_', 'I think it is a plover', list).status, 'invalid');
});

test('suggestFor_: string matching and AI agree gives High', () => {
  // a typo, so string matching isn't certain and the AI is asked too
  const d = call('suggestFor_', { sci: 'Sylvia communis', common: 'Comon Whitethroat' }, SPECIES,
    fakeAi({ choice: 1, reason: 'Sylvia communis moved to Curruca' }));
  assert.equal(d.sci, 'Curruca communis');
  assert.equal(d.confidence, 'High');
});

test('suggestFor_: an AI answer off the shortlist is rejected, not used', () => {
  const d = call('suggestFor_', { sci: 'Aquila chrysaetos', common: 'Golden Eagle' }, SPECIES,
    fakeAi({ choice: 42, reason: 'made up' }));
  assert.equal(d.sci, '');
  assert.match(d.reason, /AI answer rejected/);
});

test('suggestFor_: if the AI is unavailable, string matching still suggests', () => {
  const d = call('suggestFor_', { sci: '', common: 'Eurasian Blackbrid' }, SPECIES,
    () => { throw new Error('free-tier limit reached'); });
  assert.equal(d.sci, 'Turdus merula');
  assert.match(d.reason, /AI check unavailable: free-tier limit reached/);
});

test('suggestFor_: an identical name is High without asking the AI', () => {
  const d = call('suggestFor_', { sci: '', common: 'Gray Heron' }, SPECIES,
    () => { throw new Error('the AI should not have been asked'); });
  assert.equal(d.sci, 'Ardea cinerea');
  assert.equal(d.confidence, 'High');
  assert.match(d.reason, /AI check not needed/);
});

test('buildAiPrompt_ tells the AI how to handle species merged as subspecies', () => {
  const p = call('buildAiPrompt_', { sci: 'Corvus cornix', common: 'Hooded Crow' }, []);
  assert.match(p, /subspecies or form of one of the candidates/);
});

test('geminiRequestBody_: low thinking for the default model only, and no temperature', () => {
  const body = call('geminiRequestBody_', 'hello', 'gemini-3-flash-preview');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.equal(body.generationConfig.temperature, undefined);
  assert.equal(body.contents[0].parts[0].text, 'hello');
  assert.equal(call('geminiRequestBody_', 'hello', 'gemini-3.6-flash').generationConfig.thinkingConfig, undefined);
});

test('suggestFor_: the AI alone can find a renamed species (Medium)', () => {
  // "Pied Wagtail" without other names: string matching can't find it, the AI can
  const noAlt = SPECIES.map(s => (s.row === 18 ? { ...s, alt: '' } : s));
  const list = call('buildShortlist_', { sci: 'Motacilla alba', common: 'Pied Wagtail' }, noAlt);
  const n = list.findIndex(c => c.sci === 'Motacilla alba') + 1;
  const d = call('suggestFor_', { sci: 'Motacilla alba', common: 'Pied Wagtail' }, noAlt,
    fakeAi({ choice: n, reason: 'Pied Wagtail is a form of White Wagtail' }));
  assert.equal(d.sci, 'Motacilla alba');
});

test('acceptEdit_: ticking copies the suggestion into column C', () => {
  const r = call('acceptEdit_', run('FX.ACCEPT'), true, 'Ardea cinerea', '');
  assert.equal(r.fix, 'Ardea cinerea');
  assert.equal(r.accept, true);
});
test('acceptEdit_: ticking with no suggestion does nothing and says why', () => {
  const r = call('acceptEdit_', run('FX.ACCEPT'), true, '', '');
  assert.equal(r.accept, false);
  assert.ok(r.message);
});
test('acceptEdit_: unticking clears the suggestion from column C', () => {
  assert.equal(call('acceptEdit_', run('FX.ACCEPT'), false, 'Ardea cinerea', 'Ardea cinerea').fix, '');
});
test('acceptEdit_: unticking keeps a fix typed by hand', () => {
  assert.equal(call('acceptEdit_', run('FX.ACCEPT'), false, 'Ardea cinerea', 'IGNORE').fix, 'IGNORE');
});
test('acceptEdit_: typing in column C keeps the tick box in step', () => {
  assert.equal(call('acceptEdit_', run('FX.FIX'), true, 'Ardea cinerea', 'Ardea alba').accept, false);
  assert.equal(call('acceptEdit_', run('FX.FIX'), false, 'Ardea cinerea', 'ardea cinerea').accept, true);
});

// ---------- safety: the API key must never be in the code ----------
test('no file in the repo contains something that looks like a Google API key', () => {
  const root = path.join(__dirname, '..');
  const files = [...fs.readdirSync(root).map(f => path.join(root, f)), ...fs.readdirSync(__dirname).map(f => path.join(__dirname, f))]
    .filter(f => /\.(gs|js|json|md)$/.test(f));
  files.forEach(f => assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /AIza[0-9A-Za-z_-]{30,}/, f));
});

// ---------- AviList's own answer: the eBird bird is an AviList subspecies ----------

// Species with their subspecies names (the `ssp` field), as on the website
const WITH_SSP = [
  { row: 0, sci: 'Corvus corone', common: 'Carrion Crow', alt: '', ssp: 'corone;cornix;sharpii;pallescens;capellanus' },
  { row: 1, sci: 'Corvus corax', common: 'Northern Raven', alt: '', ssp: 'corax;varius;tingitanus' },
  { row: 2, sci: 'Porphyrio porphyrio', common: 'Purple Swamphen', alt: '', ssp: 'porphyrio;madagascariensis;melanotus;poliocephalus' },
  { row: 3, sci: 'Porphyrio albus', common: 'White Swamphen', alt: '', ssp: '' },
  // Two Aus species sharing a subspecies name: no single answer
  { row: 4, sci: 'Aus alpha', common: 'Alpha Bird', alt: '', ssp: 'alpha;orientalis' },
  { row: 5, sci: 'Aus beta', common: 'Beta Bird', alt: '', ssp: 'beta;orientalis' },
];
const sspMatch = (sci, common) => { ctx.E = { sci, common }; ctx.SSP_SPECIES = WITH_SSP; return run('subspeciesMatch_(E, SSP_SPECIES)'); };

test('an eBird species that AviList lists as a subspecies is matched to its parent species', () => {
  assert.equal(sspMatch('Corvus cornix', 'Hooded Crow').sci, 'Corvus corone');
  assert.equal(sspMatch('Corvus cornix', 'Hooded Crow').ssp, 'Corvus corone cornix');
  assert.equal(sspMatch('Porphyrio melanotus', 'Australasian Swamphen').sci, 'Porphyrio porphyrio');
  assert.equal(sspMatch('Corvus corone cornix', '').sci, 'Corvus corone');     // eBird subspecies form too
  assert.equal(sspMatch('Corvus cornix [cornix Group]', 'Hooded Crow (Hooded)').sci, 'Corvus corone');   // eBird group name
  assert.equal(sspMatch('Corvus cornix capellanus', 'Hooded Crow (Mesopotamian)').sci, 'Corvus corone');
});

test('no subspecies answer when there is none, or more than one, or the genus differs', () => {
  assert.equal(sspMatch('Corvus splendens', 'House Crow'), null);
  assert.equal(sspMatch('Aus orientalis', 'Eastern Bird'), null);              // in two species: ambiguous
  assert.equal(sspMatch('Pica cornix', 'Made-up Magpie'), null);              // right name, wrong genus
  assert.equal(sspMatch('Corvus', ''), null);
});

test('a subspecies answer is a High suggestion with no AI call, on the shortlist', () => {
  ctx.E = { sci: 'Corvus cornix', common: 'Hooded Crow' }; ctx.SSP_SPECIES = WITH_SSP;
  const prep = run('prepareSuggestion_(E, SSP_SPECIES)');
  assert.equal(prep.final.sci, 'Corvus corone');
  assert.equal(prep.final.confidence, 'High');
  assert.match(prep.final.reason, /AviList lists it as a subspecies: Corvus corone cornix, part of Carrion Crow/);
  assert.ok(prep.shortlist.some(c => c.sci === 'Corvus corone'));
  // suggestFor_ never asks the AI for it
  let asked = false;
  ctx.ASK = () => { asked = true; return '{"choice":2,"reason":"x"}'; };
  assert.equal(run('suggestFor_(E, SSP_SPECIES, ASK)').sci, 'Corvus corone');
  assert.equal(asked, false);
});

test('species records without subspecies names (the spreadsheet) behave as before', () => {
  ctx.E = { sci: 'Corvus cornix', common: 'Hooded Crow' };
  ctx.SSP_SPECIES = WITH_SSP.map(({ ssp, ...rest }) => rest);
  assert.equal(run('subspeciesMatch_(E, SSP_SPECIES)'), null);
  assert.equal(run('prepareSuggestion_(E, SSP_SPECIES)').final, null);
});

test('real species whose names contain "domesticus" or "hybrida" are counted; domestic types and hybrids are not', () => {
  const parse = (sci, common) => { ctx.S = sci; ctx.N = common; return run('parseEbirdName_(S, N)'); };
  assert.equal(parse('Passer domesticus', 'House Sparrow').binomial, 'Passer domesticus');
  assert.equal(parse('Chlidonias hybrida', 'Whiskered Tern').binomial, 'Chlidonias hybrida');
  assert.equal(parse('Chloephaga hybrida', 'Kelp Goose').binomial, 'Chloephaga hybrida');
  assert.equal(parse('Anas platyrhynchos (Domestic type)', 'Mallard (Domestic type)').reason, 'domestic');
  assert.equal(parse('Anser sp. (Domestic type)', 'Domestic goose sp. (Domestic type)').skip, true);
  assert.equal(parse('Corvus corone x cornix', 'Carrion x Hooded Crow (hybrid)').reason, 'sp/hybrid');
  assert.equal(parse('Anas platyrhynchos x rubripes', 'Mallard x American Black Duck (hybrid)').skip, true);
  assert.equal(parse('Larus sp.', 'gull sp.').skip, true);
});
