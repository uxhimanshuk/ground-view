import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildArcs, createCentroidTable } from '../arcs/model.js';
import { formatUsdMillions, REMITTANCES_CAVEAT } from './index.js';
import { normalizeRemittances } from './records.js';
import { createBundledRemittanceSource } from './source.js';
import { buildRemittances } from '../../../scripts/build-remittances.mjs';

const read = (rel) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const table = createCentroidTable(
  read('../../data/local_data/flows/country-centroids.json'),
);

test('sender-keyed table becomes origin to destination records in USD millions', () => {
  const out = normalizeRemittances({
    meta: { year: 2021, asOf: '2021 estimates' },
    flows: { USA: { MEX: 52595.3, IND: 15808 }, ARE: { IND: 0 } },
  });
  assert.equal(out.year, 2021);
  assert.deepEqual(out.records, [
    { originIso3: 'USA', destIso3: 'MEX', value: 52595.3, year: 2021 },
    { originIso3: 'USA', destIso3: 'IND', value: 15808, year: 2021 },
  ]);
  assert.equal(normalizeRemittances(null), null);
});

test('the bundled matrix joins fully and keeps the sender to receiver direction', () => {
  const data = read('../../data/local_data/flows/remittances-2021.json');
  assert.equal(data.meta.unit, 'USD millions');
  assert.equal(data.meta.year, 2021);
  const out = normalizeRemittances(data);
  const { arcs, skipped } = buildArcs(out.records, table);
  assert.deepEqual(skipped, { invalid: 0, self: 0, noCentroid: 0 });
  // Mexico received about USD 50 billion in 2021, most of it from the USA.
  const usaMex = arcs.find((a) => a.id === 'USA>MEX');
  assert.ok(usaMex.value > 40_000 && usaMex.value < 60_000, `${usaMex.value}`);
  const mexUsa = arcs.find((a) => a.id === 'MEX>USA');
  assert.ok(!mexUsa || mexUsa.value < usaMex.value / 20);
  const size = readFileSync(
    new URL(
      '../../data/local_data/flows/remittances-2021.json',
      import.meta.url,
    ),
  ).length;
  assert.ok(size < 1_500_000, `${size}`);
});

test('the source reads the bundled file through the injected fetch', async () => {
  const data = read('../../data/local_data/flows/remittances-2021.json');
  const source = createBundledRemittanceSource({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => data }),
  });
  assert.equal((await source.getSnapshot()).year, 2021);
  const bad = createBundledRemittanceSource({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  await assert.rejects(() => bad.getSnapshot(), /Malformed/);
});

test('formatting and caveat copy', () => {
  assert.equal(formatUsdMillions(52595.3), '$52.6B');
  assert.equal(formatUsdMillions(850.4), '$850M');
  assert.ok(!REMITTANCES_CAVEAT.includes('—'));
});

test('builder reads senders down and receivers across, skips WORLD and footnotes', () => {
  const rows = [
    ['Title row'],
    [
      'Remittance-receiving country (across) - sending (down)',
      'Mexico',
      'India',
      'WORLD',
    ],
    ['United States', 52000.44, 15800, 70000],
    ['Mexico', null, 3, 30],
    ['India', 1, null, 1],
    ['WORLD', 52001, 15803, 1],
    ['A long footnote '.repeat(10)],
  ];
  const { flows, pairs, unmatched } = buildRemittances(rows, table, {
    minPair: 100,
    top: 1,
  });
  assert.deepEqual(flows.USA, { MEX: 52000.4, IND: 15800 });
  // Below the cut, a flow survives only if it is a receiver's top sender.
  assert.equal(flows.MEX, undefined);
  assert.equal(flows.IND, undefined);
  assert.equal(pairs, 2);
  assert.deepEqual(unmatched, []);
});
