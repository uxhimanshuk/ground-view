import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIVERGING_RAMP,
  NO_DATA_COLOR,
  SEQUENTIAL_RAMP,
  buildAnalystRecords,
  buildScale,
  describeCountry,
  isFresh,
  joinRows,
  normalizeIso3,
  rankRows,
} from './model.js';
import { decodeCountryPack, loadCountryShapes } from './shapes.js';

test('normalizeIso3 aliases dataset codes to the bundled pack', () => {
  assert.equal(normalizeIso3('xkx'), 'KOS');
  assert.equal(normalizeIso3('PSE'), 'PSX');
  assert.equal(normalizeIso3('DEU'), 'DEU');
  assert.equal(normalizeIso3('DE'), null);
  assert.equal(normalizeIso3(null), null);
});

test('sequential scale buckets low to high and clamps outliers', () => {
  const values = Array.from({ length: 101 }, (_, i) => i);
  const scale = buildScale({ values });
  assert.equal(scale.colors, SEQUENTIAL_RAMP);
  assert.equal(scale.bucketOf(0), 0);
  assert.equal(scale.bucketOf(100), SEQUENTIAL_RAMP.length - 1);
  assert.equal(scale.bucketOf(-500), 0);
  assert.equal(scale.bucketOf(5000), SEQUENTIAL_RAMP.length - 1);
  assert.equal(scale.bucketOf(NaN), -1);
  assert.equal(scale.colorOf(undefined), NO_DATA_COLOR);
  const mid = scale.bucketOf(50);
  assert.ok(mid > 0 && mid < SEQUENTIAL_RAMP.length - 1);
});

test('diverging scale is centred on zero with a neutral middle bucket', () => {
  const scale = buildScale({ kind: 'diverging', values: [-4, -1, 0, 2, 3] });
  assert.equal(scale.colors, DIVERGING_RAMP);
  const middle = (DIVERGING_RAMP.length - 1) / 2;
  assert.equal(scale.bucketOf(0), middle);
  assert.equal(scale.bucketOf(-0.01), middle);
  assert.ok(scale.bucketOf(-3) < middle);
  assert.ok(scale.bucketOf(3) > middle);
  assert.equal(scale.domain[0], -scale.domain[1]);
});

test('legend lists every bucket then No data', () => {
  const scale = buildScale({ values: [0, 10, 20, 30] });
  assert.equal(scale.legend.length, SEQUENTIAL_RAMP.length + 1);
  assert.deepEqual(scale.legend.at(-1), {
    color: NO_DATA_COLOR,
    label: 'No data',
  });
  assert.match(scale.legend[0].label, /^</);
  assert.match(scale.legend[SEQUENTIAL_RAMP.length - 1].label, /^>/);
});

test('an empty or constant dataset still yields a usable scale', () => {
  assert.equal(buildScale({ values: [] }).bucketOf(0.5) >= 0, true);
  const flat = buildScale({ values: [5, 5, 5] });
  assert.ok(Number.isFinite(flat.domain[1] - flat.domain[0]));
});

test('joinRows keeps known countries, drops unknown and non-finite rows', () => {
  const joined = joinRows(
    [
      { iso3: 'XKX', value: 3 },
      { iso3: 'DEU', value: 1 },
      { iso3: 'DEU', value: 2 },
      { iso3: 'ZZZ', value: 9 },
      { iso3: 'FRA', value: NaN },
      { iso3: 'NOR', value: null },
    ],
    ['KOS', 'DEU', 'FRA', 'NOR'],
  );
  assert.deepEqual([...joined.keys()].sort(), ['DEU', 'KOS']);
  assert.equal(joined.get('DEU').value, 2);
});

test('rankRows ranks high to low with shared ties', () => {
  const joined = joinRows(
    [
      { iso3: 'AAA', value: 10 },
      { iso3: 'BBB', value: 30 },
      { iso3: 'CCC', value: 30 },
      { iso3: 'DDD', value: 5 },
    ],
    ['AAA', 'BBB', 'CCC', 'DDD'],
  );
  const { ranks, total } = rankRows(joined);
  assert.equal(total, 4);
  assert.equal(ranks.get('BBB'), 1);
  assert.equal(ranks.get('CCC'), 1);
  assert.equal(ranks.get('AAA'), 3);
  assert.equal(ranks.get('DDD'), 4);
});

test('describeCountry shows value, rank, year and source, or No data', () => {
  const base = {
    name: 'Germany',
    formatValue: (v) => v.toFixed(1),
    unit: '%',
    sourceLabel: 'World Bank',
    asOf: '2026-10-08',
    caveat: 'Years differ.',
  };
  const withData = describeCountry({
    ...base,
    row: { value: 33.7, year: 2022 },
    rank: 4,
    total: 160,
  });
  assert.equal(withData.title, 'Germany');
  assert.deepEqual(withData.details.slice(0, 2), [
    '33.7 %',
    'Rank 4 of 160 · Year 2022',
  ]);
  assert.ok(withData.details.includes('World Bank · as of 2026-10-08'));
  assert.ok(withData.details.includes('Years differ.'));
  const none = describeCountry({ ...base, row: undefined });
  assert.equal(none.details[0], 'No data');
});

test('analyst records are country rows and respect the limit', () => {
  const joined = joinRows(
    [
      { iso3: 'DEU', value: 1, year: 2020 },
      { iso3: 'FRA', value: 2, year: 2021 },
    ],
    ['DEU', 'FRA'],
  );
  const { ranks } = rankRows(joined);
  const names = new Map([
    ['DEU', 'Germany'],
    ['FRA', 'France'],
  ]);
  const rows = buildAnalystRecords({
    joined,
    ranks,
    names,
    indicator: 'Gini',
    unit: 'x',
    sourceLabel: 'WB',
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    kind: 'country',
    name: 'Germany',
    country: 'DEU',
    value: 1,
    unit: 'x',
    indicator: 'Gini',
    year: 2020,
    rank: 2,
    source: 'WB',
  });
  assert.equal(
    buildAnalystRecords({ joined, ranks, names, limit: 1 }).length,
    1,
  );
});

test('isFresh honours the ttl', () => {
  assert.equal(isFresh(1000, 500, 1400), true);
  assert.equal(isFresh(1000, 500, 1600), false);
  assert.equal(isFresh(null, 500, 1600), false);
});

test('bundled country pack decodes with ADM0_A3 codes for the tricky countries', async () => {
  const shapes = await loadCountryShapes();
  assert.ok(shapes.size > 230);
  for (const code of ['FRA', 'NOR', 'KOS', 'DEU', 'USA', 'RUS'])
    assert.ok(shapes.has(code), code);
  assert.ok(!shapes.has('ENG'));
  const france = shapes.get('FRA');
  assert.ok(france.polygons.length >= 1);
  const [outer] = france.polygons[0];
  assert.ok(outer.length > 8);
  assert.ok(
    Math.abs(france.anchor.lon) < 180 && Math.abs(france.anchor.lat) < 90,
  );
  assert.equal(decodeCountryPack(null).size, 0);
});
