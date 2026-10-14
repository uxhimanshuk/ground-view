#!/usr/bin/env node
// Build src/data/local_data/values/values.json from a CSV of published
// country-level Inglehart-Welzel scores. Never invents data: with no CSV the
// script refuses to run, and the committed file stays a marked placeholder.
//
// Usage: node scripts/build-values.mjs table.csv "Full citation" "https://source"
// CSV header: iso3,name,year,wave,tradSecular,survSelfExpr
import { readFileSync, writeFileSync } from 'node:fs';

const [csvPath, citation, url] = process.argv.slice(2);
if (!csvPath || !citation || !url) {
  console.error(
    'Usage: node scripts/build-values.mjs table.csv "Full citation" "https://source"',
  );
  process.exit(1);
}

const lines = readFileSync(csvPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim());
const header = lines
  .shift()
  .split(',')
  .map((h) => h.trim());
const need = ['iso3', 'year', 'tradSecular', 'survSelfExpr'];
for (const key of need) {
  if (!header.includes(key)) {
    console.error(`CSV is missing column: ${key}`);
    process.exit(1);
  }
}
const countries = [];
let wave = null;
for (const line of lines) {
  const cells = line.split(',').map((c) => c.trim());
  const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  const num = (v) =>
    v === '' || v === undefined || !Number.isFinite(+v) ? null : +v;
  if (!/^[A-Za-z]{3}$/.test(row.iso3 || '')) continue;
  if (row.wave) wave = row.wave;
  countries.push({
    iso3: row.iso3.toUpperCase(),
    name: row.name || null,
    year: num(row.year),
    tradSecular: num(row.tradSecular),
    survSelfExpr: num(row.survSelfExpr),
  });
}
if (!countries.length) {
  console.error('No usable rows; leaving values.json untouched.');
  process.exit(1);
}
const out = new URL(
  '../src/data/local_data/values/values.json',
  import.meta.url,
);
writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        placeholder: false,
        title: 'Inglehart-Welzel cultural map country scores',
        source: `${citation} ${url}`,
        wave,
        retrieved: new Date().toISOString().slice(0, 10),
      },
      countries,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Wrote ${countries.length} countries to ${out.pathname}`);
