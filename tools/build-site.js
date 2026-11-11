// Copies the shared code from the Apps Script files into the website, so the
// spreadsheet and the website use exactly the same functions.
// (Web servers don't serve .gs files as JavaScript, hence the copies.)
//
// Run from the repo folder after changing LifeList.gs, NameFixesAssistant.gs or AskYourList.gs:
//   node tools/build-site.js
// A test (Tests/site.test.js) fails if the copies are out of date.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const FILES = ['LifeList.gs', 'NameFixesAssistant.gs', 'AskYourList.gs'];
const header = src => '// GENERATED from ' + src + ' by tools/build-site.js. Do not edit here: edit ' + src + ' and re-run.\n';

function copyTarget(src) {
  return path.join(root, 'docs', 'lib', src.replace(/\.gs$/, '.js'));
}

function build() {
  FILES.forEach(src => {
    const out = copyTarget(src);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, header(src) + fs.readFileSync(path.join(root, src), 'utf8'));
    console.log('Copied ' + src + ' -> ' + path.relative(root, out));
  });
}

module.exports = { FILES, header, copyTarget };
if (require.main === module) build();
