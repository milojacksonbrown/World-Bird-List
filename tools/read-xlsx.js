// Minimal .xlsx reader: no libraries needed.
// An .xlsx file is a zip of XML files. This uses macOS/Linux's built-in
// `unzip` to read them, then pulls out the rows of one sheet as arrays.
//
//   const { readSheet, sheetNames } = require('./read-xlsx');
//   const rows = readSheet('file.xlsx', 'AviList v2026');   // [[cell, cell, …], …]

const { execFileSync } = require('node:child_process');

const unzipText = (file, inner) =>
  execFileSync('unzip', ['-p', file, inner], { maxBuffer: 1024 * 1024 * 1024 }).toString('utf8');

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** Joins all the <t> text pieces inside a bit of XML (rich text is split into runs). */
const textOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

/** "AB" -> 27 (0-based column number from a cell reference's letters) */
const colIndex = letters => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The workbook's sheet names, mapped to their XML file inside the zip. */
function sheetNames(file) {
  const wb = unzipText(file, 'xl/workbook.xml');
  const rels = unzipText(file, 'xl/_rels/workbook.xml.rels');
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const t = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && t) target[id] = 'xl/' + t.replace(/^\/?xl\//, '');
  }
  const out = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode((m[0].match(/name="([^"]+)"/) || [])[1] || '');
    const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
    out[name] = target[rid];
  }
  return out;
}

/** Reads one sheet (by name) as an array of rows of strings. */
function readSheet(file, name) {
  const path = sheetNames(file)[name];
  if (!path) throw new Error('No sheet called "' + name + '" in ' + file);
  const shared = [...unzipText(file, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const xml = unzipText(file, path);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      let v = '';
      if (type === 's') v = shared[+((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] || '';
      else if (type === 'inlineStr') v = textOf(body);
      else v = decode((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      row[ref ? colIndex(ref) : row.length] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row);
  }
  return rows;
}

module.exports = { readSheet, sheetNames };
