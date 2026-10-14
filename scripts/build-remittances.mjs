#!/usr/bin/env node
/**
 * Build the bundled bilateral remittance flow table for the Ground View
 * `remittances` layer.
 *
 * Source: World Bank / KNOMAD Bilateral Remittance Matrix 2021 (December 2022
 * version, the latest edition published; KNOMAD has issued no newer matrix).
 * Official file:
 *   https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx
 * knomad.org currently answers that path with its HTML home page, so the copy
 * used here is the Internet Archive snapshot of the same official file:
 *   https://web.archive.org/web/2023/https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx
 * Licence: World Bank Open Data terms, CC BY 4.0.
 *
 * Layout: header row lists receiving countries (across), first column lists
 * sending countries (down), values in millions of US dollars, a WORLD column
 * and row hold totals (skipped here).
 *
 * Output: src/data/local_data/flows/remittances-2021.json
 *   { meta, flows: { SENDER_ISO3: { RECEIVER_ISO3: usdMillions } } }
 * Kept pairs: at least USD 50 million, plus each receiver's five largest
 * senders.
 *
 * Usage: node scripts/build-remittances.mjs [--file <downloaded .xlsx>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCentroidTable } from '../src/layers/arcs/model.js';
import { openWorkbook } from './lib/xlsx-lite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL =
  'https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx';
export const ARCHIVE_URL = `https://web.archive.org/web/2023/${SOURCE_URL}`;
const CENTROIDS = path.join(
  ROOT,
  'src/data/local_data/flows/country-centroids.json',
);
const OUT = path.join(ROOT, 'src/data/local_data/flows/remittances-2021.json');
export const MIN_PAIR_USD_M = 50;
export const TOP_SENDERS = 5;

/**
 * Pure: matrix rows (header first) to the trimmed sender-keyed table.
 * @param {Array<Array>} rows
 * @param {ReturnType<createCentroidTable>} table
 */
export function buildRemittances(
  rows,
  table,
  { minPair = MIN_PAIR_USD_M, top = TOP_SENDERS } = {},
) {
  const header = rows.find((r) => typeof r[1] === 'string' && r[1].trim());
  if (!header) throw new Error('Remittance header row not found');
  const receivers = header.map((name, col) =>
    col === 0 || typeof name !== 'string' || /^world$/i.test(name.trim())
      ? null
      : table.resolve({ name }),
  );
  const unmatched = new Set();
  header.forEach((name, col) => {
    if (
      col > 0 &&
      typeof name === 'string' &&
      !/^world$/i.test(name.trim()) &&
      !receivers[col]
    )
      unmatched.add(name.trim());
  });
  const byReceiver = new Map();
  let total = 0;
  for (const row of rows.slice(rows.indexOf(header) + 1)) {
    const senderName = row[0];
    // Footnotes sit below the matrix in the same column.
    if (
      typeof senderName !== 'string' ||
      senderName.length > 60 ||
      /^world$/i.test(senderName.trim())
    )
      continue;
    const sender = table.resolve({ name: senderName });
    if (!sender) {
      unmatched.add(senderName.trim());
      continue;
    }
    for (let col = 1; col < row.length; col++) {
      const value = row[col];
      const receiver = receivers[col];
      if (!receiver || receiver === sender) continue;
      if (typeof value !== 'number' || !(value > 0)) continue;
      total++;
      if (!byReceiver.has(receiver)) byReceiver.set(receiver, []);
      byReceiver.get(receiver).push([sender, Math.round(value * 10) / 10]);
    }
  }
  const flows = {};
  let pairs = 0;
  for (const [receiver, list] of byReceiver) {
    list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [sender, value] of list.filter(
      ([, v], i) => v >= minPair || i < top,
    )) {
      (flows[sender] ||= {})[receiver] = value;
      pairs++;
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(flows).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { flows: sorted, pairs, total, unmatched: [...unmatched] };
}

async function main() {
  const fileArg = process.argv.indexOf('--file');
  let bytes;
  if (fileArg > 0) bytes = await readFile(process.argv[fileArg + 1]);
  else {
    let response = await fetch(SOURCE_URL);
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/spreadsheet|octet-stream/.test(type))
      response = await fetch(ARCHIVE_URL);
    if (!response.ok)
      throw new Error(`KNOMAD download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const table = createCentroidTable(
    JSON.parse(await readFile(CENTROIDS, 'utf8')),
  );
  const wb = openWorkbook(bytes);
  const rows = [...wb.rows(wb.sheetNames[0])];
  const { flows, pairs, total, unmatched } = buildRemittances(rows, table);
  if (unmatched.length) console.warn('Unmatched names (skipped):', unmatched);
  const out = {
    meta: {
      title:
        'Bilateral remittance estimates 2021, sender by receiver (trimmed)',
      source:
        'World Bank / KNOMAD Bilateral Remittance Matrix 2021 (December 2022 version)',
      url: SOURCE_URL,
      retrievedFrom: ARCHIVE_URL,
      licence: 'World Bank Open Data terms (CC BY 4.0)',
      year: 2021,
      asOf: '2021 estimates, published December 2022',
      unit: 'USD millions',
      rule: `pairs >= USD ${MIN_PAIR_USD_M} million plus each receiver's top ${TOP_SENDERS} senders`,
      retrieved: new Date().toISOString().slice(0, 10),
      pairs,
      pairsBeforeTrim: total,
    },
    flows,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(
    `Wrote ${OUT}: ${Object.keys(flows).length} senders, ${pairs} of ${total} pairs`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
