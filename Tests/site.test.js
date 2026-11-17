// The website's copies of the shared code must match the Apps Script files.
// If this fails, run:   node tools/build-site.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FILES, header, copyTarget } = require('../tools/build-site');

FILES.forEach(src => {
  test('docs/lib copy of ' + src + ' is up to date (else run: node tools/build-site.js)', () => {
    const expected = header(src) + fs.readFileSync(path.join(__dirname, '..', src), 'utf8');
    assert.ok(fs.existsSync(copyTarget(src)), 'missing copy of ' + src);
    assert.ok(fs.readFileSync(copyTarget(src), 'utf8') === expected, src + ' has changed since it was copied');
  });
});

test('the sample data contains only the agreed columns', () => {
  const first = fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'sample-ebird.csv'), 'utf8').split('\n')[0];
  assert.equal(first, 'Submission ID,Common Name,Scientific Name,State/Province,County,Location ID,Location,Latitude,Longitude,Date,Time');
});

test('the page scripts have no syntax errors (they aren\'t loaded by any other test)', () => {
  const { execFileSync } = require('node:child_process');
  for (const f of ['docs/js/app.js', 'docs/js/config.js', 'docs/js/habitat-icons.js', 'docs/js/nest-icons.js', 'docs/js/bird-icons.js']) {
    execFileSync(process.execPath, ['--check', path.join(__dirname, '..', f)]);      // throws on a syntax error
  }
});
