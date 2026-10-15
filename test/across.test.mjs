import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAcross, parseResolved, resolveUrl, resolveTitles } from '../src/across.js';
import { parseUnrest, STALE_HOURS } from '../src/unrest.js';

const it = (title, views, qid, en) => ({ title, views, qid, en });

test('groupAcross groups by Wikidata id, sorts by count then views', () => {
  const eds = [
    { code: 'en', languageName: 'English', items: [it('Oct Storm', 100, 'Q1'), it('Solo EN', 90, 'Q9')] },
    { code: 'de', languageName: 'German', items: [it('Sturm', 300, 'Q1', 'Oct Storm'), it('Zwei', 50, 'Q2', 'Pair'), it('Nur DE', 40, 'Q8')] },
    { code: 'fr', languageName: 'French', items: [it('Tempete', 10, 'Q1', 'Oct Storm'), it('Paire', 70, 'Q2', 'Pair')] },
  ];
  const { shared, only } = groupAcross(eds);
  assert.deepEqual(shared.map((s) => s.qid), ['Q1', 'Q2']);
  assert.equal(shared[0].count, 3);
  assert.equal(shared[0].views, 410);
  assert.equal(shared[0].title, 'Oct Storm');
  assert.deepEqual(shared[0].languages, ['English', 'German', 'French']);
  assert.equal(shared[1].title, 'Pair');
  assert.deepEqual(only.map((o) => [o.code, o.title]), [['en', 'Solo EN'], ['de', 'Nur DE']]);
});

test('groupAcross title falls back to the most-viewed edition title', () => {
  const eds = [
    { code: 'ja', languageName: 'Japanese', items: [it('A', 5, 'Q5')] },
    { code: 'ko', languageName: 'Korean', items: [it('B', 50, 'Q5')] },
  ];
  assert.equal(groupAcross(eds).shared[0].title, 'B');
});

test('groupAcross: unresolved items never merge, one hit per edition', () => {
  const eds = [
    { code: 'a', languageName: 'A', items: [it('X', 1), it('X2', 2, 'Q1'), it('X3', 3, 'Q1')] },
    { code: 'b', languageName: 'B', items: [it('X', 1)] },
  ];
  const { shared, only } = groupAcross(eds);
  assert.equal(shared.length, 0);
  assert.equal(only.length, 2);
});

test('only picks the highest-ranked item with no match elsewhere', () => {
  const eds = [
    { code: 'a', languageName: 'A', items: [it('Shared', 9, 'Q1'), it('Mine', 8, 'Q2'), it('Mine2', 7, 'Q3')] },
    { code: 'b', languageName: 'B', items: [it('Shared', 9, 'Q1')] },
  ];
  const { only } = groupAcross(eds);
  assert.deepEqual(only.map((o) => o.title), ['Mine']);
});

test('parseResolved follows normalized and redirects', () => {
  const json = { query: {
    normalized: [{ from: 'angela merkel', to: 'Angela merkel' }],
    redirects: [{ from: 'Angela merkel', to: 'Angela Merkel' }],
    pages: [
      { title: 'Angela Merkel', pageprops: { wikibase_item: 'Q567' }, langlinks: [{ lang: 'en', title: 'Angela Merkel' }] },
      { title: 'Nope', missing: true },
    ],
  } };
  const m = parseResolved(['angela merkel', 'Nope'], json);
  assert.equal(m.get('angela merkel').qid, 'Q567');
  assert.equal(m.get('angela merkel').en, 'Angela Merkel');
  assert.ok(!m.has('Nope'));
});

test('resolveUrl has no custom-header need and carries all params', () => {
  const u = new URL(resolveUrl('de', ['A', 'B C']));
  assert.equal(u.host, 'de.wikipedia.org');
  assert.equal(u.searchParams.get('titles'), 'A|B C');
  assert.equal(u.searchParams.get('origin'), '*');
  assert.equal(u.searchParams.get('lllang'), 'en');
});

test('resolveTitles batches by 50 and survives failures', async () => {
  const titles = Array.from({ length: 120 }, (_, i) => `T${i}`);
  let n = 0;
  const fetchImpl = async (url) => {
    n++;
    if (n === 2) throw new Error('boom');
    const ts = new URL(url).searchParams.get('titles').split('|');
    return { ok: true, json: async () => ({ query: { pages: ts.map((t) => ({ title: t, pageprops: { wikibase_item: `Q${t}` } })) } }) };
  };
  const m = await resolveTitles('en', titles, { fetchImpl });
  assert.equal(n, 3);
  assert.equal(m.size, 70);
});

test('parseUnrest validates clusters and flags stale data', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const r = parseUnrest({
    fetchedAt: '2026-10-15T01:00:00Z',
    clusters: [
      { lon: 10, lat: 50, count: 4, placeName: 'Berlin' },
      { lon: 'x', lat: 1, count: 1 },
      { lon: 200, lat: 1, count: 1 },
      { lon: 1, lat: 2 },
    ],
  }, now);
  assert.equal(r.clusters.length, 2);
  assert.equal(r.clusters[1].count, 1);
  assert.equal(r.clusters[1].placeName, 'Unnamed place');
  assert.equal(r.stale, true);
  assert.equal(Math.round(r.ageHours), 11);
  assert.equal(STALE_HOURS, 8);
  assert.equal(parseUnrest({ fetchedAt: now - 3600_000, clusters: [] }, now).stale, false);
  assert.throws(() => parseUnrest({}, now));
});
