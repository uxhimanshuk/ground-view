import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clusterProtestEvents,
  countryFromPlaceName,
  formatGdeltTimestamp,
  parseGdeltTimestamp,
  parseProtestEvents,
  safeNewsUrl,
} from './gdeltUnrest.js';

const fixture = readFileSync(
  new URL('./fixtures/gdelt-export-sample.tsv', import.meta.url),
  'utf8',
);

test('timestamps round-trip through the GDELT stamp format', () => {
  const ms = parseGdeltTimestamp('20261014050000');
  assert.equal(ms, Date.UTC(2026, 9, 14, 5, 0, 0));
  assert.equal(formatGdeltTimestamp(ms), '20261014050000');
  assert.equal(parseGdeltTimestamp('2026'), null);
  assert.equal(parseGdeltTimestamp(undefined), null);
});

test('only http(s) news links without credentials survive', () => {
  assert.equal(safeNewsUrl('https://example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(safeNewsUrl('javascript:alert(1)'), null);
  assert.equal(safeNewsUrl('https://user:pw@example.org/'), null);
  assert.equal(safeNewsUrl(`https://example.org/${'a'.repeat(600)}`), null);
  assert.equal(safeNewsUrl(null), null);
});

test('country is the last part of a GDELT place name', () => {
  assert.equal(countryFromPlaceName('Glasgow, Glasgow City, United Kingdom'), 'United Kingdom');
  assert.equal(countryFromPlaceName('Peru'), 'Peru');
  assert.equal(countryFromPlaceName(''), null);
});

test('the real export sample keeps protest rows with city or region precision only', () => {
  const rows = fixture.split('\n').filter(Boolean);
  assert.equal(rows.length, 21);
  const events = parseProtestEvents(fixture);
  // 18 protest rows, of which the one country-level and one US-state row are dropped.
  assert.equal(events.length, 16);
  for (const event of events) {
    assert.ok(event.place.includes(','));
    assert.ok(event.articles >= 1);
    assert.ok(Math.abs(event.lat) <= 90 && Math.abs(event.lon) <= 180);
  }
});

test('events carry no actor fields', () => {
  const [event] = parseProtestEvents(fixture);
  assert.deepEqual(Object.keys(event).sort(), [
    'addedMs',
    'articles',
    'id',
    'lat',
    'lon',
    'place',
    'url',
  ]);
});

test('malformed and non-protest rows are skipped without throwing', () => {
  const bad = ['short\trow', '', 'x'.repeat(10)].join('\n');
  assert.deepEqual(parseProtestEvents(bad), []);
  assert.deepEqual(parseProtestEvents(null), []);
});

test('clusters group by about half a degree and sum reports', () => {
  const clusters = clusterProtestEvents(parseProtestEvents(fixture));
  const state = clusters.find((c) => c.placeName.startsWith('New Jersey'));
  assert.equal(state, undefined, 'US-state rows are dropped before clustering');
  const sonoma = clusters.find((c) => c.placeName.startsWith('Sonoma'));
  assert.equal(sonoma.events, 6);
  const glasgow = clusters.find((c) => c.placeName.startsWith('Glasgow'));
  assert.equal(glasgow.country, 'United Kingdom');
  assert.equal(glasgow.events, 2);
  assert.equal(glasgow.count, 16);
  assert.ok(glasgow.sampleUrls.length >= 1 && glasgow.sampleUrls.length <= 3);
  assert.match(glasgow.stableId, /^unrest:/);
  assert.equal(glasgow.updatedAt, '2026-10-14T05:00:00.000Z');
  for (let i = 1; i < clusters.length; i++)
    assert.ok(clusters[i - 1].count >= clusters[i].count, 'sorted by count');
});

test('nearby points merge into one cell and sample links are capped at three', () => {
  const base = {
    id: '1',
    lat: 10.1,
    lon: 20.1,
    place: 'Alpha, Testland',
    articles: 2,
    addedMs: 1000,
    url: 'https://a.example/1',
  };
  const events = [
    base,
    { ...base, id: '2', lat: 10.2, lon: 20.2, url: 'https://a.example/2', addedMs: 3000 },
    { ...base, id: '3', url: 'https://a.example/3', articles: 9 },
    { ...base, id: '4', url: 'https://a.example/4' },
    { ...base, id: '5', lat: 40, lon: 40, place: 'Far, Elsewhere' },
  ];
  const clusters = clusterProtestEvents(events);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 15);
  assert.equal(clusters[0].events, 4);
  assert.equal(clusters[0].sampleUrls.length, 3);
  assert.equal(clusters[0].sampleUrls[0], 'https://a.example/3');
});
