import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageviewDay, shiftDay, filterArticles, isJunkTitle, parseTop, sumViews,
  createAttention, createLimiter,
} from '../src/attention.js';
import { LANGUAGE_HEARTLANDS } from '../src/heartlands.js';

const de = LANGUAGE_HEARTLANDS.find((h) => h.code === 'de');
const en = LANGUAGE_HEARTLANDS.find((h) => h.code === 'en');
const A = (article, views) => ({ article, views });

test('pageviewDay and shiftDay use UTC', () => {
  const t = Date.UTC(2026, 9, 15, 0, 30);
  assert.equal(pageviewDay(t, 1), '2026-10-14');
  assert.equal(pageviewDay(t, 0), '2026-10-15');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('isJunkTitle', () => {
  assert.ok(isJunkTitle('-'));
  assert.ok(isJunkTitle('  '));
  assert.ok(isJunkTitle(''));
  assert.ok(isJunkTitle(null));
  assert.ok(!isJunkTitle('Goethe'));
  assert.ok(!isJunkTitle('東京'));
});

test('filterArticles hides main page, namespaces and junk, keeps rank order', () => {
  const out = filterArticles(de, [
    A('Wikipedia:Hauptseite', 900), A('Spezial:Suche', 800), A('-', 700),
    A('Wikipedia:Portal', 600), A('Angela_Merkel', 500), A('Berlin', 400),
  ]);
  assert.deepEqual(out.map((o) => o.title), ['Angela Merkel', 'Berlin']);
  assert.deepEqual(out.map((o) => o.rank), [1, 2]);
  assert.equal(out[0].slug, 'Angela_Merkel');
});

test('filterArticles does not filter on topic and caps at the limit', () => {
  const arts = Array.from({ length: 40 }, (_, i) => A(`Person_${i}`, 100 - i));
  assert.equal(filterArticles(en, arts).length, 25);
  assert.equal(filterArticles(en, arts, 10).length, 10);
  assert.equal(filterArticles(en, [A('Main_Page', 5), A('Special:Search', 4)]).length, 0);
});

test('filterArticles tolerates bad rows', () => {
  assert.deepEqual(filterArticles(en, null), []);
  assert.equal(filterArticles(en, [{ article: 1, views: 2 }, { article: 'X', views: NaN }, A('Y', 3)]).length, 1);
});

test('parseTop and sumViews', () => {
  assert.equal(parseTop({}), null);
  assert.deepEqual(parseTop({ items: [{ articles: [1] }] }), [1]);
  assert.equal(sumViews([{ views: 1 }, { views: 2 }, { views: 3 }], 2), 3);
});

const payload = (arts) => ({ items: [{ articles: arts }] });
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('loadEdition falls back one day on 404 and caches', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/2026/10/14')) return resp(404);
    return resp(200, payload([A('Berlin', 10)]));
  };
  const a = createAttention({ fetchImpl });
  const r = await a.loadEdition(de, '2026-10-14');
  assert.equal(r.fellBack, true);
  assert.equal(r.date, '2026-10-13');
  assert.equal(calls.length, 2);
  await a.loadEdition(de, '2026-10-14');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith('https://wikimedia.org/api/rest_v1/metrics/pageviews/top/de.wikipedia/all-access/2026/10/14'));
});

test('loadEdition rejects on server error and does not cache the failure', async () => {
  let n = 0;
  const fetchImpl = async () => (n++ === 0 ? resp(500) : resp(200, payload([A('X', 1)])));
  const a = createAttention({ fetchImpl });
  await assert.rejects(a.loadEdition(de, '2026-10-14'));
  const r = await a.loadEdition(de, '2026-10-14');
  assert.equal(r.items.length, 1);
});

test('limiter never exceeds 6 in flight', async () => {
  const limit = createLimiter(6);
  let active = 0, peak = 0;
  const task = () => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  await Promise.all(Array.from({ length: 30 }, task));
  assert.equal(peak, 6);
});
