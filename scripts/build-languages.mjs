#!/usr/bin/env node
// Build src/data/local_data/languages/languages.json from Glottolog (CC BY 4.0).
//   - languages_and_dialects_geo.csv from the Glottolog 5.3 release
//   - AES endangerment status (parameter "aes") from glottolog-cldf values.csv
// Keeps level == language rows that have coordinates. Run: node scripts/build-languages.mjs
import { writeFileSync } from 'node:fs';

const GEO_URL =
  'https://cdstar.eva.mpg.de//bitstreams/EAEA0-608B-9919-A962-0/languages_and_dialects_geo.csv';
const AES_URL =
  'https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/values.csv';
const OUT = new URL(
  '../src/data/local_data/languages/languages.json',
  import.meta.url,
);

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, embedded newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function get(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

const r1 = (n) => Math.round(n * 1000) / 1000;

async function main() {
  const [geoText, aesText] = await Promise.all([get(GEO_URL), get(AES_URL)]);
  const aes = new Map();
  const values = parseCsv(aesText);
  const vh = values.shift();
  const iLang = vh.indexOf('Language_ID');
  const iParam = vh.indexOf('Parameter_ID');
  const iValue = vh.indexOf('Value');
  for (const r of values) {
    if (r[iParam] === 'aes') aes.set(r[iLang], Number(r[iValue]));
  }
  const geo = parseCsv(geoText);
  const gh = geo.shift();
  const col = Object.fromEntries(gh.map((h, i) => [h, i]));
  const rows = [];
  for (const r of geo) {
    if (r[col.level] !== 'language') continue;
    const lat = parseFloat(r[col.latitude]);
    const lon = parseFloat(r[col.longitude]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const iso = (r[col.isocodes] || '').split(/\s+/).filter(Boolean)[0] || '';
    rows.push([
      r[col.glottocode],
      r[col.name],
      iso,
      r[col.macroarea] || '',
      r1(lat),
      r1(lon),
      aes.get(r[col.glottocode]) ?? 0,
    ]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const out = {
    meta: {
      title: 'Glottolog languages with coordinates',
      source: 'Glottolog 5.3 languages_and_dialects_geo.csv',
      url: GEO_URL,
      aesSource: AES_URL,
      license: 'CC BY 4.0',
      citation:
        'Hammarstrom, Harald & Forkel, Robert & Haspelmath, Martin & Bank, Sebastian. Glottolog. Leipzig: Max Planck Institute for Evolutionary Anthropology. https://glottolog.org',
      retrieved: new Date().toISOString().slice(0, 10),
      columns: [
        'glottocode',
        'name',
        'iso639_3',
        'macroarea',
        'lat',
        'lon',
        'aes',
      ],
      aesCodes: {
        0: 'unknown',
        1: 'not endangered',
        2: 'threatened',
        3: 'shifting',
        4: 'moribund',
        5: 'nearly extinct',
        6: 'extinct',
      },
    },
    rows,
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${rows.length} languages to ${OUT.pathname}`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
