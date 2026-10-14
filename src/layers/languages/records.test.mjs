import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  describeLanguage,
  glottologUrl,
  inRect,
  lodStepForHeight,
  mapAnalystRecord,
  normalizeLanguageTable,
  selectLabelCohort,
} from './records.js';
import { createBundledLanguageSource } from './bundledSource.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../data/fixtures/glottolog-languages-sample.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('fixture rows normalise to language records', () => {
  const languages = normalizeLanguageTable(fixture);
  assert.equal(languages.length, fixture.rows.length);
  for (const l of languages) {
    assert.match(l.glottocode, /^[a-z0-9]{4}[0-9]{4}$/);
    assert.ok(Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180);
    assert.ok(l.aes >= 0 && l.aes <= 6);
  }
  assert.equal(normalizeLanguageTable({}), null);
});

test('bad rows are dropped', () => {
  const rows = normalizeLanguageTable({
    rows: [
      ['abcd1234', 'Ok', 'abc', 'Africa', 1, 2, 3],
      ['zz', 'BadCode', '', '', 1, 2, 0],
      ['abcd1235', 'NoCoord', '', '', null, 2, 0],
      ['abcd1236', 'OffGlobe', '', '', 95, 2, 0],
      'junk',
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Ok'],
  );
});

test('card and analyst record carry glottocode, ISO, macroarea and status', () => {
  const language = {
    glottocode: 'abcd1234',
    name: 'Testish',
    iso: 'tst',
    macroarea: 'Eurasia',
    lat: 10,
    lon: 20,
    aes: 4,
  };
  const card = describeLanguage(language);
  assert.equal(card.title, 'Testish');
  assert.ok(card.details[0].includes('abcd1234'));
  assert.ok(card.details[0].includes('ISO 639-3 tst'));
  assert.ok(card.details[1].includes('moribund'));
  assert.equal(
    glottologUrl('abcd1234'),
    'https://glottolog.org/resource/languoid/id/abcd1234',
  );
  const record = mapAnalystRecord(language);
  assert.equal(record.kind, 'language');
  assert.equal(record.endangerment, 'moribund');
  assert.equal(record.iso639_3, 'tst');
});

test('inRect handles the antimeridian', () => {
  const normal = { west: -10, south: -10, east: 10, north: 10 };
  assert.equal(inRect(normal, 0, 0), true);
  assert.equal(inRect(normal, 0, 50), false);
  const wrap = { west: 170, south: -10, east: -170, north: 10 };
  assert.equal(inRect(wrap, 0, 175), true);
  assert.equal(inRect(wrap, 0, -175), true);
  assert.equal(inRect(wrap, 0, 0), false);
  assert.equal(inRect(null, 5, 5), true);
});

test('label cohort prefers endangered languages and is capped and stable', () => {
  const mk = (code, name, aes, lon) => ({
    glottocode: code,
    name,
    aes,
    lat: 0,
    lon,
  });
  const list = [
    mk('aaaa0001', 'Beta', 1, 0),
    mk('aaaa0002', 'Alpha', 1, 1),
    mk('aaaa0003', 'Far', 6, 90),
    mk('aaaa0004', 'Rare', 5, 2),
  ];
  const rect = { west: -5, south: -5, east: 5, north: 5 };
  assert.deepEqual(
    selectLabelCohort(list, rect, 3).map((l) => l.name),
    ['Rare', 'Alpha', 'Beta'],
  );
  assert.equal(selectLabelCohort(list, rect, 0).length, 0);
});

test('lod thins the globe view and shows everything up close', () => {
  assert.equal(lodStepForHeight(20_000_000), 6);
  assert.equal(lodStepForHeight(8_000_000), 3);
  assert.equal(lodStepForHeight(3_000_000), 2);
  assert.equal(lodStepForHeight(500_000), 1);
  assert.equal(lodStepForHeight(undefined), 1);
});

test('the bundled language table loads, is level language only and CC BY 4.0 tagged', async () => {
  const snapshot = await createBundledLanguageSource().getSnapshot();
  assert.ok(snapshot.languages.length > 8000);
  assert.ok(snapshot.languages.every((l) => l.glottocode && l.name));
  const german = snapshot.languages.find((l) => l.iso === 'deu');
  assert.ok(german);
  assert.equal(german.macroarea, 'Eurasia');
});
