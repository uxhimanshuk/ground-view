#!/usr/bin/env node
/**
 * Build the bundled migrant-stock flow table for the Ground View
 * `migrant-stock` layer.
 *
 * Source: UN DESA Population Division, International Migrant Stock 2024,
 * "destination and origin" workbook, Table 1 (both sexes, 2024 column).
 * Download (the UN site rejects clients without a browser User-Agent):
 *   https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx
 * Licence: CC BY 3.0 IGO.
 *
 * Output: src/data/local_data/flows/migrant-stock-2024.json
 *   { meta, flows: { DEST_ISO3: { ORIGIN_ISO3: people } } }
 * Kept pairs: every pair with at least 50,000 people, plus each destination's
 * five largest origins.
 *
 * Usage: node scripts/build-migrant-stock.mjs [--file <downloaded .xlsx>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from './lib/xlsx-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL =
  'https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx';
const CENTROIDS = path.join(
  ROOT,
  'src/data/local_data/flows/country-centroids.json',
);
const OUT = path.join(
  ROOT,
  'src/data/local_data/flows/migrant-stock-2024.json',
);
export const MIN_PAIR = 50_000;
export const TOP_ORIGINS = 5;
const SHEET = 'Table 1';
const COL = { destCode: 4, originCode: 6, y2024: 14 };

/**
 * Pure: workbook rows to the trimmed destination-keyed table.
 * @param {Iterable<Array>} rows Sheet rows.
 * @param {Map<number,string>} iso3ByM49
 */
export function buildMigrantStock(
  rows,
  iso3ByM49,
  { minPair = MIN_PAIR, top = TOP_ORIGINS } = {},
) {
  const all = new Map();
  const unmatched = new Map();
  for (const row of rows) {
    const dest = row[COL.destCode];
    const origin = row[COL.originCode];
    const value = row[COL.y2024];
    if (!Number.isInteger(dest) || !Number.isInteger(origin)) continue;
    if (typeof value !== 'number' || !(value > 0)) continue;
    const d = iso3ByM49.get(dest);
    const o = iso3ByM49.get(origin);
    if (!d || !o) {
      // Aggregates (codes 900 and up) are expected; real countries are not.
      if (dest < 900 && origin < 900) {
        const key = `${dest}>${origin}`;
        unmatched.set(key, (unmatched.get(key) || 0) + value);
      }
      continue;
    }
    if (d === o) continue;
    if (!all.has(d)) all.set(d, []);
    all.get(d).push([o, Math.round(value)]);
  }
  const flows = {};
  let pairs = 0;
  for (const [d, list] of [...all].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const kept = list.filter(([, v], i) => v >= minPair || i < top);
    flows[d] = Object.fromEntries(kept);
    pairs += kept.length;
  }
  return { flows, pairs, unmatched };
}

async function main() {
  const fileArg = process.argv.indexOf('--file');
  let bytes;
  if (fileArg > 0) bytes = await readFile(process.argv[fileArg + 1]);
  else {
    const response = await fetch(SOURCE_URL, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    });
    if (!response.ok)
      throw new Error(`UN DESA download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const centroids = JSON.parse(await readFile(CENTROIDS, 'utf8')).countries;
  const iso3ByM49 = new Map(
    Object.entries(centroids)
      .filter(([, c]) => c.m49)
      .map(([iso3, c]) => [c.m49, iso3]),
  );
  const wb = openWorkbook(bytes);
  const { flows, pairs, unmatched } = buildMigrantStock(
    wb.rows(SHEET),
    iso3ByM49,
  );
  const lost = [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (lost.length)
    console.warn('Unmatched country pairs (dest>origin, people):', lost);
  const out = {
    meta: {
      title:
        'International Migrant Stock 2024, destination by origin (trimmed)',
      source:
        'UN DESA Population Division, International Migrant Stock 2024, Table 1',
      url: SOURCE_URL,
      licence: 'CC BY 3.0 IGO',
      year: 2024,
      asOf: 'mid-year 2024',
      rule: `pairs >= ${MIN_PAIR} people plus each destination's top ${TOP_ORIGINS} origins`,
      retrieved: new Date().toISOString().slice(0, 10),
      pairs,
    },
    flows,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(
    `Wrote ${OUT}: ${Object.keys(flows).length} destinations, ${pairs} pairs`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
