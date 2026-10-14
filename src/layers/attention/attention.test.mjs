import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attentionProxy } from '../../../server/providers/attention.js';
import {
  ATTENTION_CAVEAT,
  buildAttentionCard,
  createAttentionLayer,
  createWikimediaAttentionSource,
  isArticleTitle,
  LANGUAGE_HEARTLANDS,
  mapAttentionAnalystRecord,
  normalizeTopArticles,
} from './index.js';
import { pageviewDay } from './source.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../data/fixtures/wikimedia-top-2026-10-12.json', import.meta.url),
    'utf8',
  ),
);
const heartland = (code) => LANGUAGE_HEARTLANDS.find((h) => h.code === code);

test('about twenty editions, each pinned once, English included once', () => {
  assert.equal(LANGUAGE_HEARTLANDS.length, 22);
  assert.equal(new Set(LANGUAGE_HEARTLANDS.map((h) => h.code)).size, 22);
  assert.equal(LANGUAGE_HEARTLANDS.filter((h) => h.code === 'en').length, 1);
  for (const h of LANGUAGE_HEARTLANDS) {
    assert.ok(Math.abs(h.lat) <= 90 && Math.abs(h.lon) <= 180, h.code);
    assert.ok(h.languageName && h.anchor && h.country && h.main.length, h.code);
  }
});

test('main pages and namespace pages are not articles', () => {
  const en = heartland('en');
  for (const t of ['Main_Page', 'Special:Search', 'Wikipedia:Featured_pictures', 'File:X.png', 'Portal:Current_events', 'Category:Foo', 'Help:Contents'])
    assert.equal(isArticleTitle(t, en), false, t);
  assert.equal(isArticleTitle('Mathematics', en), true);
  assert.equal(isArticleTitle("Narnia:_The_Magician's_Nephew", en), true, 'colon in a real title');
  const de = heartland('de');
  assert.equal(isArticleTitle('Wikipedia:Hauptseite', de), false);
  assert.equal(isArticleTitle('Spezial:Suche', de), false);
  assert.equal(isArticleTitle('Datei:UEFA_Logo.png', de), false);
  assert.equal(isArticleTitle('Tatort:_Warum', de), true);
  assert.equal(isArticleTitle('メインページ', heartland('ja')), false);
  assert.equal(isArticleTitle('特別:検索', heartland('ja')), false);
});

test('captured Wikimedia payloads become top-five rows without utility pages', () => {
  const en = normalizeTopArticles(heartland('en'), fixture['en.wikipedia']);
  assert.equal(en.articles.length, 5);
  assert.deepEqual(
    en.articles.map((a) => a.title).slice(0, 3),
    ['RJ Mitte', 'Selma Blair', 'Mathematics'],
  );
  assert.equal(en.date, '2026-10-12');
  assert.equal(en.articles[0].url, 'https://en.wikipedia.org/wiki/RJ_Mitte');
  assert.ok(en.articles[0].views > en.articles[4].views);
  const ja = normalizeTopArticles(heartland('ja'), fixture['ja.wikipedia']);
  assert.equal(ja.articles[0].title, '救命病棟24時');
  assert.match(ja.articles[0].url, /^https:\/\/ja\.wikipedia\.org\/wiki\/%/);
  const de = normalizeTopArticles(heartland('de'), fixture['de.wikipedia']);
  assert.ok(de.articles.every((a) => !/^(Wikipedia|Spezial)/.test(a.title)));
});

test('malformed payloads yield null', () => {
  assert.equal(normalizeTopArticles(heartland('en'), {}), null);
  assert.equal(normalizeTopArticles(heartland('en'), { items: [{ articles: 3 }] }), null);
  assert.equal(
    normalizeTopArticles(heartland('en'), {
      items: [{ year: '2026', month: '10', day: '12', articles: [{ article: 'A', views: 'x' }] }],
    }),
    null,
  );
  assert.equal(
    normalizeTopArticles(heartland('en'), {
      items: [{ year: '2026', month: '10', day: '12', articles: [{ article: 'Main_Page', views: 5 }] }],
    }),
    null,
    'only utility pages',
  );
});

test('card lists five linked titles with views, source, date and the caveat', () => {
  const row = normalizeTopArticles(heartland('en'), fixture['en.wikipedia']);
  const card = buildAttentionCard(row, { date: row.date });
  assert.match(card.title, /English/);
  assert.equal(card.links.length, 5);
  assert.match(card.links[0].note, /views$/);
  assert.equal(card.source, 'Wikimedia pageviews');
  assert.equal(card.asOf, '12 Oct 2026');
  assert.ok(card.caveat.startsWith(ATTENTION_CAVEAT));
  assert.ok(!JSON.stringify(card).includes(String.fromCharCode(0x2014)));
});

test('analyst records are per language, never per person', () => {
  const row = normalizeTopArticles(heartland('en'), fixture['en.wikipedia']);
  const record = mapAttentionAnalystRecord(row);
  assert.equal(record.kind, 'attention');
  assert.equal(record.name, 'English');
  assert.equal(record.unit, 'views');
  assert.equal(record.value, row.articles[0].views);
  assert.equal(record.id, 'attention:en');
  assert.equal(record.articles.split('; ').length, 5);
});

test('yesterday in UTC is requested first and a 404 falls back one more day', async () => {
  const NOW = Date.UTC(2026, 9, 13, 23, 30);
  assert.equal(pageviewDay(NOW, 1), '2026/10/12');
  const requests = [];
  const source = createWikimediaAttentionSource({
    now: () => NOW,
    heartlands: [heartland('en')],
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('2026/10/12'))
        return { ok: false, status: 404, body: null };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(fixture['en.wikipedia']),
      };
    },
  });
  const { rows, meta } = await source.getSnapshot();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/attention/en/2026/10/12');
  assert.equal(requests[1].url, '/api/attention/en/2026/10/11');
  assert.equal(rows.length, 1);
  assert.equal(meta.partial, false);
  // The result is cached for the rest of the UTC day.
  await source.getSnapshot();
  assert.equal(requests.length, 2);
});

test('some editions failing makes the snapshot partial, none makes it throw', async () => {
  const ok = {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(fixture['en.wikipedia']),
  };
  const mixed = createWikimediaAttentionSource({
    now: () => Date.UTC(2026, 9, 13),
    heartlands: [heartland('en'), heartland('de')],
    fetchImpl: async (url) =>
      url.includes('/en/') ? ok : { ok: false, status: 500, body: null },
  });
  const { rows, meta } = await mixed.getSnapshot();
  assert.equal(rows.length, 1);
  assert.equal(meta.partial, true);
  const none = createWikimediaAttentionSource({
    now: () => Date.UTC(2026, 9, 13),
    heartlands: [heartland('en')],
    fetchImpl: async () => ({ ok: false, status: 500, body: null }),
  });
  await assert.rejects(none.getSnapshot(), /unavailable/);
});

test('layer exposes per-language analyst rows only while enabled', async () => {
  const dataSources = [];
  const viewer = {
    dataSources: {
      add: (s) => dataSources.push(s),
      remove: (s) => dataSources.splice(dataSources.indexOf(s), 1),
    },
  };
  const entries = [];
  const rows = ['en', 'de', 'ja'].map((code) =>
    normalizeTopArticles(heartland(code), fixture[`${code}.wikipedia`]),
  );
  const layer = createAttentionLayer({
    source: {
      getSnapshot: async () => ({
        rows,
        meta: { date: '2026-10-12', partial: false, unavailable: false },
      }),
    },
    overlayHost: {
      setEntries: (...args) => entries.push(args),
      setVisible() {},
      clearSource() {},
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update();
  assert.equal(layer.getAnalystRecords().length, 3);
  assert.equal(entries.at(-1)[1].length, 3, 'one label per edition');
  assert.equal(layer.getStats().count, 3);
  layer.destroy(viewer);
  assert.equal(dataSources.length, 0);
});

function run(plugin, url, method = 'GET') {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(path, callback) {
        assert.equal(path, '/api/attention');
        handler = callback;
      },
    },
  });
  const res = new EventEmitter();
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    res.headers = headers;
  };
  res.end = (body) => {
    res.body = body;
  };
  return handler({ url, method }, res).then(() => res);
}

test('proxy sends the descriptive Api-User-Agent, validates the route and caches', async () => {
  const seen = [];
  const NOW = Date.UTC(2026, 9, 14, 6);
  const plugin = attentionProxy({
    now: () => NOW,
    fetchImpl: async (url, options) => {
      seen.push({ url, headers: options.headers });
      if (url.endsWith('/2026/10/12'))
        return { ok: false, status: 404, body: null };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(fixture['en.wikipedia']),
      };
    },
  });
  const ok = await run(plugin, '/en/2026/10/13');
  assert.equal(ok.statusCode, 200);
  assert.equal(
    seen[0].url,
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/10/13',
  );
  assert.match(seen[0].headers['Api-User-Agent'], /^ground-view\//);
  await run(plugin, '/en/2026/10/13');
  assert.equal(seen.length, 1, 'cached');
  assert.equal((await run(plugin, '/en/2026/10/12')).statusCode, 404);
  assert.equal((await run(plugin, '/xx/2026/10/13')).statusCode, 400, 'unknown edition');
  assert.equal((await run(plugin, '/en/2026/10/13/extra')).statusCode, 400);
  assert.equal((await run(plugin, '/en/2030/01/01')).statusCode, 400, 'future date');
  assert.equal((await run(plugin, '/en/2026/10/13', 'POST')).statusCode, 405);
  assert.equal(seen.length, 2);
});
