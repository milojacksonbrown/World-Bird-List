// Tests for the bird quiz (quizPool_, quizOptions_ and quizCheck_ in docs/js/dashboard-data.js).
// Run with:   node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const f of ['LifeList.gs', 'NameFixesAssistant.gs', 'docs/js/dashboard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const run = e => vm.runInContext(e, ctx);
const plain = x => JSON.parse(JSON.stringify(x));
ctx.AVILIST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'avilist.json'), 'utf8'));
run('var CL = loadChecklist_(AVILIST)');
const sp = sci => { ctx.S = sci.toLowerCase(); return run('CL.species[CL.bySci.get(S)]'); };
const check = (typed, sci) => { ctx.QUIZ_TYPED = typed; ctx.QUIZ_SP = sp(sci); return plain(run('quizCheck_(QUIZ_TYPED, QUIZ_SP, CL)')); };   // (not "SP": LifeList.gs has a constant of that name)
// A fixed sequence instead of Math.random, so results are repeatable
const rnd = () => { let n = 0; return () => ((n = (n * 9301 + 49297) % 233280) / 233280); };

test('typed answers: exact names, other names, scientific names, any capitals or accents', () => {
  assert.deepEqual(check('Eurasian Bullfinch', 'Pyrrhula pyrrhula'), { correct: true, note: '' });
  assert.deepEqual(check('  eurasian   BULLFINCH ', 'Pyrrhula pyrrhula'), { correct: true, note: '' });
  assert.deepEqual(check('Pyrrhula pyrrhula', 'Pyrrhula pyrrhula'), { correct: true, note: '' });
  assert.deepEqual(check('Gray Heron', 'Ardea cinerea'), { correct: true, note: '' });          // grey or gray
  assert.equal(check('Grey Tinamou', 'Tinamus tao').correct, true);
  assert.equal(check('Ruppells Vulture', 'Gyps rueppelli').correct, true);                       // no accent or apostrophe needed
});

test('typed answers: a small spelling slip is forgiven, and said', () => {
  assert.deepEqual(check('Eurasian Bulfinch', 'Pyrrhula pyrrhula'), { correct: true, note: 'spelled Eurasian Bullfinch' });
  assert.equal(check('Eurasain Bullfinch', 'Pyrrhula pyrrhula').correct, true);   // two slips in 18 letters
  assert.equal(check('Eurasian Bluefinch', 'Pyrrhula pyrrhula').correct, false);  // three: too far
  assert.equal(check('Eurasian Chaffinch', 'Pyrrhula pyrrhula').correct, false);  // a different bird
  assert.equal(check('', 'Pyrrhula pyrrhula').correct, false);
});

test('typed answers: the name without its first word counts, unless another bird has that name', () => {
  assert.deepEqual(check('Bullfinch', 'Pyrrhula pyrrhula'), { correct: true, note: 'in full, Eurasian Bullfinch' });
  assert.equal(check('Kingfisher', 'Alcedo atthis').correct, true);             // Common Kingfisher
  // "Gull" alone is too short to count
  assert.equal(check('Gull', 'Larus marinus').correct, false);
});

test('multiple choice: four different names including the answer; "hard" picks the same family first', () => {
  ctx.POOL = ['Pyrrhula pyrrhula', 'Fringilla coelebs', 'Chloris chloris', 'Carduelis carduelis', 'Ardea cinerea', 'Anas platyrhynchos', 'Corvus corax']
    .map(s => sp(s));
  ctx.ANS = ctx.POOL[0];
  ctx.RND = rnd();
  const hard = plain(run('quizOptions_(ANS, POOL, "hard", RND)'));
  assert.equal(hard.length, 4);
  assert.ok(hard.some(o => o.sci === 'Pyrrhula pyrrhula'));
  assert.ok(hard.every(o => o.family === 'Fringillidae'), 'all finches: ' + hard.map(o => o.common));
  assert.equal(new Set(hard.map(o => o.common)).size, 4);
  ctx.RND = rnd();
  const easy = plain(run('quizOptions_(ANS, POOL, "easy", RND)'));
  assert.equal(easy.length, 4);
  assert.ok(easy.some(o => o.sci === 'Pyrrhula pyrrhula'));
});

test('multiple choice: with only a few lifers, it offers as many as there are', () => {
  ctx.POOL = ['Pyrrhula pyrrhula', 'Ardea cinerea'].map(s => sp(s));
  ctx.ANS = ctx.POOL[0];
  ctx.RND = rnd();
  assert.equal(plain(run('quizOptions_(ANS, POOL, "hard", RND)')).length, 2);
});

test('the quiz asks only about lifers that have a sticker', () => {
  ctx.LIF = [{ i: sp('Pyrrhula pyrrhula').i }, { i: sp('Ardea cinerea').i }];
  ctx.ST = { cdn: 'x/', none: ['Ardea cinerea'] };
  assert.deepEqual(plain(run('quizPool_(LIF, CL, ST)')).map(s => s.sci), ['Pyrrhula pyrrhula']);
});

test('typed answers: the bird\'s name in the language chosen on the page counts too', () => {
  ctx.QUIZ_SP = sp('Pyrrhula pyrrhula');
  ctx.QUIZ_OTHER = ['Bouvreuil pivoine'];
  const typed = t => { ctx.QUIZ_TYPED = t; return plain(run('quizCheck_(QUIZ_TYPED, QUIZ_SP, CL, QUIZ_OTHER)')); };
  assert.deepEqual(typed('bouvreuil pivoine'), { correct: true, note: '' });
  assert.equal(typed('Bouvreuil pivione').correct, true);            // a slip, forgiven
  assert.equal(typed('Pinson des arbres').correct, false);           // a different bird
});
