import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  arcAnalystRecords,
  buildArcs,
  createCentroidTable,
  formatCount,
  nearestCountry,
  normalizeCountryName,
  selectArcs,
  summarizeCountry,
  valueRange,
} from './model.js';
import { wrapCardLines } from './index.js';

const table = createCentroidTable(
  JSON.parse(
    readFileSync(
      new URL(
        '../../data/local_data/flows/country-centroids.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);

test('the bundled centroid table covers the sovereign states', () => {
  assert.ok(table.size > 230);
  for (const iso3 of ['USA', 'FRA', 'NOR', 'DEU', 'IND', 'SYR', 'XKX']) {
    assert.ok(table.has(iso3), iso3);
  }
  const fra = table.get('FRA');
  assert.ok(Math.abs(fra.lat - 46.7) < 1 && Math.abs(fra.lon - 2.55) < 1);
});

test('centroid resolve joins by ISO3, M49 code, name and alias', () => {
  assert.equal(table.resolve({ iso3: 'deu' }), 'DEU');
  assert.equal(table.resolve({ iso3: 'XXK' }), 'XKX');
  assert.equal(table.resolve({ m49: 276 }), 'DEU');
  assert.equal(table.resolve({ name: 'Germany' }), 'DEU');
  assert.equal(table.resolve({ name: 'Türkiye' }), 'TUR');
  assert.equal(table.resolve({ name: 'Korea, Rep.' }), 'KOR');
  assert.equal(table.resolve({ name: 'Russian Federation' }), 'RUS');
  assert.equal(table.resolve({ iso3: 'UNK' }), null);
  assert.equal(table.resolve({}), null);
  assert.equal(normalizeCountryName('Côte d’Ivoire'), 'cote d ivoire');
});

const records = [
  { originIso3: 'SYR', destIso3: 'TUR', value: 3_000_000, year: 2025 },
  { originIso3: 'SYR', destIso3: 'DEU', value: 700_000, year: 2025 },
  { originIso3: 'AFG', destIso3: 'DEU', value: 200_000, year: 2025 },
  { originIso3: 'SYR', destIso3: 'TUR', value: 500_000, year: 2025 },
  { originIso3: 'SYR', destIso3: 'SYR', value: 10, year: 2025 },
  { originIso3: 'ZZZ', destIso3: 'DEU', value: 99, year: 2025 },
  { originIso3: 'AFG', destIso3: 'IRN', value: 0, year: 2025 },
  { originIso3: 'AFG', destIso3: 'PAK', value: -4, year: 2025 },
];

test('buildArcs joins centroids, sums duplicates and reports what it skipped', () => {
  const { arcs, skipped } = buildArcs(records, table);
  assert.deepEqual(
    arcs.map((a) => [a.id, a.value]),
    [
      ['SYR>TUR', 3_500_000],
      ['SYR>DEU', 700_000],
      ['AFG>DEU', 200_000],
    ],
  );
  assert.deepEqual(skipped, { invalid: 2, self: 1, noCentroid: 1 });
  const first = arcs[0];
  assert.equal(first.originName, table.get('SYR').name);
  assert.deepEqual(first.from, {
    lon: table.get('SYR').lon,
    lat: table.get('SYR').lat,
  });
  assert.ok(first.distanceM > 500_000);
});

test('selectArcs caps by value with a stable tie break', () => {
  const { arcs } = buildArcs(records, table);
  assert.deepEqual(
    selectArcs(arcs, { maxArcs: 2 }).map((a) => a.id),
    ['SYR>TUR', 'SYR>DEU'],
  );
  assert.equal(selectArcs(arcs, { maxArcs: 0 }).length, 0);
  assert.equal(selectArcs(arcs).length, 3);
  const ties = [
    { id: 'B>X', value: 5, originIso3: 'B', destIso3: 'X' },
    { id: 'A>X', value: 5, originIso3: 'A', destIso3: 'X' },
    { id: 'C>X', value: 5, originIso3: 'C', destIso3: 'X' },
  ];
  assert.deepEqual(
    selectArcs(ties, { maxArcs: 2 }).map((a) => a.id),
    ['A>X', 'B>X'],
  );
});

test('selectArcs isolates one country inbound and outbound', () => {
  const { arcs } = buildArcs(records, table);
  assert.deepEqual(
    selectArcs(arcs, { country: 'DEU' }).map((a) => a.id),
    ['SYR>DEU', 'AFG>DEU'],
  );
  assert.deepEqual(
    selectArcs(arcs, { country: 'syr', maxArcs: 1 }).map((a) => a.id),
    ['SYR>TUR'],
  );
  assert.deepEqual(selectArcs(arcs, { country: 'JPN' }), []);
});

test('valueRange and summarizeCountry', () => {
  const { arcs } = buildArcs(records, table);
  assert.deepEqual(valueRange(arcs), { min: 200_000, max: 3_500_000 });
  assert.deepEqual(valueRange([]), { min: 1, max: 1 });
  const deu = summarizeCountry(arcs, 'deu');
  assert.equal(deu.inbound, 900_000);
  assert.equal(deu.outbound, 0);
  assert.equal(deu.topIn.originIso3, 'SYR');
  assert.equal(deu.topOut, null);
  const syr = summarizeCountry(arcs, 'SYR');
  assert.equal(syr.outbound, 4_200_000);
});

test('nearestCountry finds the closest label point inside the radius', () => {
  assert.equal(nearestCountry(table, 10.4, 51.1), 'DEU');
  assert.equal(nearestCountry(table, -150, 0), null);
});

test('analyst records cover every arc, largest first, with aggregate fields only', () => {
  const { arcs } = buildArcs(records, table);
  const rows = arcAnalystRecords(arcs, { unit: 'people', source: 'UNHCR' });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'flow');
  assert.equal(rows[0].destinationIso3, 'TUR');
  assert.equal(rows[0].country, rows[0].destination);
  assert.equal(rows[0].unit, 'people');
  assert.equal(rows[0].value, 3_500_000);
  assert.deepEqual(
    rows.filter((r) => r.destinationIso3 === 'DEU').map((r) => r.originIso3),
    ['SYR', 'AFG'],
  );
  assert.equal(arcAnalystRecords(arcs, { maxCount: 1 }).length, 1);
  for (const row of rows) {
    for (const value of Object.values(row)) {
      assert.ok(value === null || ['string', 'number'].includes(typeof value));
    }
  }
});

test('formatCount and wrapCardLines', () => {
  assert.equal(formatCount(950), '950');
  assert.equal(formatCount(5200), '5,200');
  assert.equal(formatCount(340_000), '340k');
  assert.equal(formatCount(1_234_567), '1.23M');
  assert.equal(formatCount(NaN), 'n/a');
  const lines = wrapCardLines(
    'Refugees and asylum-seekers under UNHCR mandate, by country of origin and asylum.',
    30,
  );
  assert.ok(lines.length >= 3);
  for (const line of lines) assert.ok(line.length <= 30, line);
  assert.equal(
    lines.join(' '),
    'Refugees and asylum-seekers under UNHCR mandate, by country of origin and asylum.',
  );
});

test('arc layer copy contains no em-dashes', () => {
  const sample = [
    'Source: UNHCR · as of 2025',
    ...wrapCardLines('Stocks, not yearly movement.'),
  ];
  for (const line of sample) assert.ok(!line.includes('—'), line);
});
