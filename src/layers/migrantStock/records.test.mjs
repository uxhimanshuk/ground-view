import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildArcs, createCentroidTable } from '../arcs/model.js';
import { normalizeMigrantStock } from './records.js';
import { createBundledMigrantStockSource } from './source.js';
import {
  buildMigrantStock,
  MIN_PAIR,
} from '../../../scripts/build-migrant-stock.mjs';

const read = (rel) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const table = createCentroidTable(
  read('../../data/local_data/flows/country-centroids.json'),
);

test('destination-keyed table flips into origin to destination records', () => {
  const out = normalizeMigrantStock({
    meta: { year: 2024, asOf: 'mid-year 2024' },
    flows: { DEU: { TUR: 1500000, POL: 1800000 }, FRA: { DZA: 0 } },
  });
  assert.equal(out.year, 2024);
  assert.deepEqual(out.records, [
    { originIso3: 'TUR', destIso3: 'DEU', value: 1500000, year: 2024 },
    { originIso3: 'POL', destIso3: 'DEU', value: 1800000, year: 2024 },
  ]);
  assert.equal(normalizeMigrantStock({}), null);
});

test('the bundled UN DESA table joins fully onto the centroid table', () => {
  const data = read('../../data/local_data/flows/migrant-stock-2024.json');
  assert.equal(data.meta.year, 2024);
  assert.match(data.meta.licence, /CC BY 3\.0 IGO/);
  const out = normalizeMigrantStock(data);
  const { arcs, skipped } = buildArcs(out.records, table);
  assert.deepEqual(skipped, { invalid: 0, self: 0, noCentroid: 0 });
  assert.equal(arcs.length, out.records.length);
  const mexUsa = arcs.find((a) => a.id === 'MEX>USA');
  assert.ok(mexUsa.value > 10_000_000);
  const bytes = readFileSync(
    new URL(
      '../../data/local_data/flows/migrant-stock-2024.json',
      import.meta.url,
    ),
  ).length;
  assert.ok(bytes < 1_500_000, `${bytes}`);
});

test('the source reads the bundled file through the injected fetch', async () => {
  const data = read('../../data/local_data/flows/migrant-stock-2024.json');
  let url = '';
  const source = createBundledMigrantStockSource({
    fetchImpl: async (u) => {
      url = String(u);
      return { ok: true, status: 200, json: async () => data };
    },
  });
  const snapshot = await source.getSnapshot();
  assert.match(url, /migrant-stock-2024\.json$/);
  assert.equal(snapshot.year, 2024);
  const failing = createBundledMigrantStockSource({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /404/);
});

test('builder keeps pairs of 50,000 or more plus each destination top five', () => {
  const iso3ByM49 = new Map([
    [1, 'AAA'],
    [2, 'BBB'],
    [3, 'CCC'],
    [4, 'DDD'],
    [5, 'EEE'],
    [6, 'FFF'],
    [7, 'GGG'],
    [8, 'HHH'],
  ]);
  const row = (dest, origin, v) => {
    const r = [];
    r[4] = dest;
    r[6] = origin;
    r[14] = v;
    return r;
  };
  const rows = [
    [],
    row(1, 2, 90_000),
    row(1, 3, 10),
    row(1, 4, 9),
    row(1, 5, 8),
    row(1, 6, 7),
    row(1, 7, 6),
    row(1, 8, 5),
    row(1, 1, 999_999),
    row(900, 2, 5_000_000),
    row(2, 1, 0),
    row(2, 3, 49_999),
  ];
  const { flows, pairs } = buildMigrantStock(rows, iso3ByM49);
  assert.equal(MIN_PAIR, 50_000);
  assert.deepEqual(Object.keys(flows.AAA), ['BBB', 'CCC', 'DDD', 'EEE', 'FFF']);
  assert.deepEqual(flows.BBB, { CCC: 49_999 });
  assert.equal(pairs, 6);
});
