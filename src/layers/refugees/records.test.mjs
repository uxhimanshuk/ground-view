import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeUnhcrPopulation } from './records.js';
import { createUnhcrSource } from './source.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../data/fixtures/flows/unhcr-population-2025.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('UNHCR rows become origin to asylum records with refugees plus asylum-seekers', () => {
  const out = normalizeUnhcrPopulation(fixture);
  assert.equal(out.year, 2025);
  assert.ok(out.records.length > 15);
  for (const r of out.records) {
    assert.match(r.originIso3, /^[A-Z]{3}$/);
    assert.match(r.destIso3, /^[A-Z]{3}$/);
    assert.ok(r.value > 0);
    assert.equal(r.year, 2025);
  }
  const row = fixture.items.find(
    (i) => i.coo_iso === 'AFG' && i.coa_iso !== 'AFG' && Number(i.refugees) > 0,
  );
  const rec = out.records.find(
    (r) => r.originIso3 === 'AFG' && r.destIso3 === row.coa_iso,
  );
  assert.equal(rec.value, Number(row.refugees) + Number(row.asylum_seekers));
});

test('ISO3 fields are used, not UNHCR internal codes', () => {
  const out = normalizeUnhcrPopulation({
    items: [
      {
        coo_iso: 'SYR',
        coa: 'ARE',
        coa_iso: 'EGY',
        refugees: '1500',
        asylum_seekers: 12,
        year: 2025,
      },
    ],
  });
  assert.deepEqual(out.records, [
    { originIso3: 'SYR', destIso3: 'EGY', value: 1512, year: 2025 },
  ]);
});

test('unknown and stateless origins are counted for the asylum country, not drawn', () => {
  const out = normalizeUnhcrPopulation(fixture);
  assert.ok(
    !out.records.some((r) => ['UNK', 'XXA', 'TIB'].includes(r.originIso3)),
  );
  const unknownRows = fixture.items.filter((i) =>
    ['UNK', 'XXA', 'TIB'].includes(i.coo_iso),
  );
  assert.ok(unknownRows.length > 0, 'fixture must include unknown origins');
  const expected = {};
  for (const i of unknownRows) {
    const v = (Number(i.refugees) || 0) + (Number(i.asylum_seekers) || 0);
    if (v > 0) expected[i.coa_iso] = (expected[i.coa_iso] || 0) + v;
  }
  assert.deepEqual(out.unknownByAsylum, expected);
});

test('zero rows, same-country rows and "-" values are tolerated', () => {
  const out = normalizeUnhcrPopulation({
    items: [
      {
        coo_iso: 'AFG',
        coa_iso: 'PAK',
        refugees: '0',
        asylum_seekers: '-',
        year: 2025,
      },
      {
        coo_iso: 'AFG',
        coa_iso: 'PAK',
        refugees: '-',
        asylum_seekers: 7,
        year: 2025,
      },
    ],
  });
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].value, 7);
});

test('a payload that is not a UNHCR page is rejected', () => {
  assert.equal(normalizeUnhcrPopulation(null), null);
  assert.equal(normalizeUnhcrPopulation({}), null);
  assert.equal(normalizeUnhcrPopulation({ items: [null] }), null);
});

function sourceHarness(responses, now = { t: 1_000_000 }) {
  const urls = [];
  const source = createUnhcrSource({
    now: () => now.t,
    currentYear: () => 2026,
    fetchImpl: async (url) => {
      urls.push(url);
      const body = responses.shift();
      return {
        ok: body !== 'fail',
        status: body === 'fail' ? 500 : 200,
        json: async () => body,
      };
    },
  });
  return { source, urls, now };
}

test('source tries last year first, then the year before, and caches for 24 hours', async () => {
  const { source, urls, now } = sourceHarness([{ items: [] }, fixture]);
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.year, 2025);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /yearFrom=2025&yearTo=2025/);
  assert.match(urls[1], /yearFrom=2024&yearTo=2024/);
  assert.match(urls[0], /coo_all=true&coa_all=true/);
  assert.ok(snapshot.extra.unknownByAsylum);
  await source.getSnapshot();
  assert.equal(urls.length, 2, 'served from cache');
  now.t += 25 * 3600_000;
  assert.ok(urls.length === 2);
});

test('source fails loudly when no year answers', async () => {
  const { source } = sourceHarness(['fail', 'fail']);
  await assert.rejects(() => source.getSnapshot(), /UNHCR HTTP 500/);
});

test('source honours an aborted signal', async () => {
  const { source } = sourceHarness([fixture]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => source.getSnapshot({ signal: controller.signal }));
});
