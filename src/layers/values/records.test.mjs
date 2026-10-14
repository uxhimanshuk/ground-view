import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScore,
  normalizeValuesTable,
  rowsForDimension,
} from './records.js';
import { createBundledValuesSource } from './bundledSource.js';

test('shipped values file holds real WVS aggregates with the documented quirks handled', async () => {
  const source = createBundledValuesSource();
  const dataset = await source.fetchData({ option: 'tradSecular' });
  assert.equal(dataset.placeholder, false);
  assert.equal(dataset.note, null);
  assert.ok(dataset.rows.length >= 70, `${dataset.rows.length} countries`);
  const byIso = new Map(dataset.rows.map((r) => [r.iso3, r]));
  const survival = new Map(
    (await source.fetchData({ option: 'survSelfExpr' })).rows.map((r) => [
      r.iso3,
      r,
    ]),
  );
  // Sanity reference values from the WVS file (latest wave).
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  near(byIso.get('JPN').value, 1.79);
  near(survival.get('JPN').value, -0.28);
  near(byIso.get('SWE').value, 0.57);
  near(survival.get('SWE').value, 2.71);
  near(byIso.get('NGA').value, -1.51);
  near(survival.get('NGA').value, -1.04);
  near(byIso.get('USA').value, -0.92);
  near(survival.get('USA').value, 1.71);
  // Blank ISO3 on wave 6 rows is filled, so India and Brazil are present.
  assert.ok(byIso.has('IND') && byIso.has('BRA') && byIso.has('ARG'));
  // Germany is the West sample, flagged for the card; East Germany is dropped.
  assert.equal(byIso.get('DEU').note, 'West German sample');
  assert.equal(byIso.get('DEU').year, 2013);
  assert.equal(byIso.get('GBR').note, undefined);
  assert.equal(
    dataset.rows.length,
    new Set(dataset.rows.map((r) => r.iso3)).size,
  );
  for (const row of dataset.rows) {
    assert.match(row.iso3, /^[A-Z]{3}$/);
    assert.ok(row.year >= 1995 && row.year <= 2020);
  }
  // Countries WVS never scored stay absent rather than imputed.
  for (const iso3 of [
    'AUT',
    'BEL',
    'DNK',
    'GRC',
    'ISL',
    'IRL',
    'ISR',
    'LUX',
    'MLT',
    'PRT',
  ])
    assert.equal(byIso.has(iso3), false, iso3);
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
      {
        iso3: 'BBB',
        year: 2021,
        wave: 6,
        note: 'sample note',
        tradSecular: 0.8,
        survSelfExpr: null,
      },
      { iso3: 'CCC', tradSecular: null, survSelfExpr: null },
      { iso3: 'bad!', tradSecular: 1, survSelfExpr: 1 },
    ],
  });
  assert.equal(table.placeholder, false);
  assert.equal(table.countries.length, 2);
  assert.deepEqual(rowsForDimension(table, 'tradSecular'), [
    { iso3: 'AAA', value: -1.2, year: 2020 },
    { iso3: 'BBB', value: 0.8, year: 2021, wave: 6, note: 'sample note' },
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
