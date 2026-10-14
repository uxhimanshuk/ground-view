import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INDICATORS,
  indicatorFormatter,
  normalizeCountryList,
  normalizeIndicatorSnapshot,
} from './records.js';
import { createWorldBankIndicatorSource } from './source.js';

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../data/fixtures/${name}`, import.meta.url),
      'utf8',
    ),
  );
const countriesPayload = fixture('worldbank-countries-sample.json');
const giniPayload = fixture('worldbank-gini-sample.json');

test('the picker lists the six requested indicators', () => {
  assert.deepEqual(
    INDICATORS.map((i) => i.id),
    [
      'SI.POV.GINI',
      'SP.URB.TOTL.IN.ZS',
      'IT.NET.USER.ZS',
      'SL.TLF.CACT.FE.ZS',
      'SL.UEM.1524.ZS',
      'SP.POP.65UP.TO.ZS',
    ],
  );
});

test('country list drops aggregates (region id NA)', () => {
  const ids = normalizeCountryList(countriesPayload);
  assert.ok(ids.has('DEU') && ids.has('XKX'));
  for (const aggregate of ['ARB', 'WLD', 'HIC', 'EUU'])
    assert.ok(!ids.has(aggregate), aggregate);
  assert.equal(normalizeCountryList({}), null);
});

test('snapshot keeps the latest non-empty value per real country', () => {
  const ids = normalizeCountryList(countriesPayload);
  const snapshot = normalizeIndicatorSnapshot(giniPayload, ids);
  const by = Object.fromEntries(snapshot.rows.map((r) => [r.iso3, r]));
  assert.equal(by.DEU.value, 33.7);
  assert.equal(by.DEU.year, 2022);
  assert.equal(by.FRA.year, 2023);
  assert.ok(by.XKX);
  assert.equal(snapshot.lastUpdated, giniPayload[0].lastupdated);
});

test('snapshot ignores aggregates, null values and older years', () => {
  const ids = new Set(['AAA', 'BBB']);
  const row = (iso, date, value) => ({ countryiso3code: iso, date, value });
  const snapshot = normalizeIndicatorSnapshot(
    [
      {},
      [
        row('AAA', '2018', 1),
        row('AAA', '2020', 2),
        row('AAA', '2019', 3),
        row('BBB', '2020', null),
        row('WLD', '2020', 9),
        row('', '2020', 9),
      ],
    ],
    ids,
  );
  assert.deepEqual(snapshot.rows, [{ iso3: 'AAA', value: 2, year: 2020 }]);
  assert.equal(normalizeIndicatorSnapshot({}, ids), null);
});

test('formatter trims to the indicator precision', () => {
  assert.equal(indicatorFormatter(1)(33.756), '33.8');
  assert.equal(indicatorFormatter(1)(40), '40');
  assert.equal(indicatorFormatter(1)(NaN), '');
});

test('source fetches the country list once and caches an indicator for 24 h', async () => {
  const urls = [];
  let clock = 0;
  // Pad the country list so the >=100 sanity check passes with fixture rows.
  const bigCountries = [
    countriesPayload[0],
    [
      ...countriesPayload[1],
      ...Array.from({ length: 120 }, (_, i) => ({
        id: `Z${String(i).padStart(2, '0')}`,
        region: { id: 'EAS' },
      })),
    ],
  ];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () =>
        String(url).includes('/indicator/') ? giniPayload : bigCountries,
    };
  };
  const source = createWorldBankIndicatorSource({
    fetchImpl,
    now: () => clock,
  });
  const first = await source.fetchData({ option: 'SI.POV.GINI' });
  assert.ok(first.rows.length >= 5);
  assert.ok(
    urls.some((u) => u.includes('mrnev=1') && u.includes('per_page=20000')),
  );
  const callsAfterFirst = urls.length;
  await source.fetchData({ option: 'SI.POV.GINI' });
  assert.equal(urls.length, callsAfterFirst, 'served from cache');
  clock = 25 * 3600_000;
  await source.fetchData({ option: 'SI.POV.GINI' });
  assert.equal(
    urls.length,
    callsAfterFirst + 1,
    'only the indicator refetched',
  );
  const failing = createWorldBankIndicatorSource({
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(() => failing.fetchData({}), /HTTP 503/);
});
