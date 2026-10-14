import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWS_TONE_CAVEAT,
  formatTone,
  normalizeNewsToneSnapshot,
} from './records.js';
import { createNewsToneSource } from './source.js';
import { FIPS_TO_ISO3, fipsToIso3 } from './fips.js';

const payload = {
  schemaVersion: 1,
  fetchedAt: '2026-10-14T05:07:00.000Z',
  files: 90,
  countries: [
    { iso3: 'DEU', tone: -1.25, events: 400, mentions: 900 },
    { iso3: 'FRA', tone: 0.4, events: 300, mentions: 700 },
    { iso3: 'xx', tone: 1, events: 1, mentions: 1 },
    { iso3: 'USA', tone: 'bad', events: 1, mentions: 1 },
  ],
};

test('snapshot keeps valid country rows only', () => {
  const snapshot = normalizeNewsToneSnapshot(payload);
  assert.deepEqual(
    snapshot.rows.map((r) => [r.iso3, r.value]),
    [
      ['DEU', -1.25],
      ['FRA', 0.4],
    ],
  );
  assert.equal(snapshot.asOf, '2026-10-14 05:07 UTC');
  assert.equal(normalizeNewsToneSnapshot({ schemaVersion: 2 }), null);
  assert.equal(normalizeNewsToneSnapshot(null), null);
});

test('caveat text is the required wording and has no em-dash', () => {
  assert.equal(
    NEWS_TONE_CAVEAT,
    'Tone of news coverage about a place, machine-scored. Not how people there feel.',
  );
  assert.ok(!NEWS_TONE_CAVEAT.includes(String.fromCharCode(0x2014)));
  assert.equal(formatTone(-1.26), '-1.3');
  assert.equal(formatTone(2), '+2.0');
});

test('FIPS table covers the tricky GDELT codes', () => {
  assert.equal(fipsToIso3('GM'), 'DEU');
  assert.equal(fipsToIso3('GV'), 'GIN');
  assert.equal(fipsToIso3('NG'), 'NER');
  assert.equal(fipsToIso3('NI'), 'NGA');
  assert.equal(fipsToIso3('UK'), 'GBR');
  assert.equal(fipsToIso3('KV'), 'KOS');
  assert.equal(fipsToIso3('ZZ'), null);
  assert.ok(Object.keys(FIPS_TO_ISO3).length > 200);
});

test('source reads the proxy and rejects bad responses', async () => {
  const ok = createNewsToneSource({
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  });
  const dataset = await ok.fetchData({});
  assert.equal(dataset.rows.length, 2);
  const down = createNewsToneSource({
    fetchImpl: async () => ({ ok: false, status: 502 }),
  });
  await assert.rejects(() => down.fetchData({}), /502/);
  const bad = createNewsToneSource({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(() => bad.fetchData({}), /Malformed/);
});
