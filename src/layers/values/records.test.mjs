import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScore,
  normalizeValuesTable,
  rowsForDimension,
} from './records.js';
import { createBundledValuesSource } from './bundledSource.js';

test('shipped values file is an honest placeholder with no invented rows', async () => {
  const source = createBundledValuesSource();
  const dataset = await source.fetchData({ option: 'tradSecular' });
  assert.equal(dataset.placeholder, true);
  assert.deepEqual(dataset.rows, []);
  assert.match(dataset.note, /Placeholder/);
});

test('a real table is accepted and split by dimension', () => {
  const table = normalizeValuesTable({
    meta: { placeholder: false, wave: '7', source: 'test table' },
    countries: [
      {
        iso3: 'aaa',
        name: 'A',
        year: 2020,
        tradSecular: -1.2,
        survSelfExpr: 0.5,
      },
      { iso3: 'BBB', year: 2021, tradSecular: 0.8, survSelfExpr: null },
      { iso3: 'CCC', tradSecular: null, survSelfExpr: null },
      { iso3: 'bad!', tradSecular: 1, survSelfExpr: 1 },
    ],
  });
  assert.equal(table.placeholder, false);
  assert.equal(table.countries.length, 2);
  assert.deepEqual(rowsForDimension(table, 'tradSecular'), [
    { iso3: 'AAA', value: -1.2, year: 2020 },
    { iso3: 'BBB', value: 0.8, year: 2021 },
  ]);
  assert.deepEqual(rowsForDimension(table, 'survSelfExpr'), [
    { iso3: 'AAA', value: 0.5, year: 2020 },
  ]);
});

test('malformed tables are rejected and empty ones read as placeholders', () => {
  assert.equal(normalizeValuesTable(null), null);
  assert.equal(normalizeValuesTable({ countries: 'x' }), null);
  assert.equal(normalizeValuesTable({ countries: [] }).placeholder, true);
});

test('formatScore signs and rounds', () => {
  assert.equal(formatScore(0.456), '+0.46');
  assert.equal(formatScore(-1), '-1.00');
  assert.equal(formatScore(NaN), '');
});
