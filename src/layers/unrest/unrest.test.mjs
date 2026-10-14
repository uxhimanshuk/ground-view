import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  expectedSlices,
  readFirstZipEntry,
  unrestProxy,
} from '../../../server/providers/unrest.js';
import {
  buildUnrestCard,
  createUnrestLayer,
  createUnrestSource,
  isRecentUnrest,
  mapUnrestAnalystRecord,
  normalizeUnrestSnapshot,
  unrestLabel,
  unrestPointSize,
  unrestStats,
  unrestStyle,
  UNREST_CAVEAT,
} from './index.js';

const fixtureUrl = (name) => new URL(`../../data/fixtures/${name}`, import.meta.url);
const zipBytes = new Uint8Array(readFileSync(fixtureUrl('gdelt-export-sample.zip')));
const tsv = readFileSync(fixtureUrl('gdelt-export-sample.tsv'), 'utf8');

test('the zip reader returns the export text unchanged', () => {
  assert.equal(Buffer.from(readFirstZipEntry(zipBytes)).toString('utf8'), tsv);
  assert.throws(() => readFirstZipEntry(new Uint8Array(10)), /zip_invalid/);
  assert.throws(() => readFirstZipEntry(zipBytes, 100), /zip_too_large/);
});

test('the window is 96 aligned quarter-hour slices ending before the publish lag', () => {
  const slices = expectedSlices(Date.UTC(2026, 9, 14, 5, 1, 30));
  assert.equal(slices.length, 96);
  assert.equal(slices[0], Date.UTC(2026, 9, 14, 4, 45));
  assert.equal(slices[1] - slices[0], -900_000);
  assert.equal(slices[95], Date.UTC(2026, 9, 13, 5, 0));
});

function run(plugin, url = '/', method = 'GET') {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(path, callback) {
        assert.equal(path, '/api/unrest');
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

test('the proxy backfills slices, clusters protests, and never ships the raw export', async () => {
  const requested = [];
  const NOW = Date.UTC(2026, 9, 14, 5, 3);
  const plugin = unrestProxy({
    now: () => NOW,
    fetchImpl: async (url) => {
      requested.push(url);
      // Slices older than two hours are not published in this scenario.
      const stamp = /(\d{14})\.export/.exec(url)[1];
      if (stamp < '20261014030000')
        return { ok: false, status: 404, body: null };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () =>
          zipBytes.buffer.slice(
            zipBytes.byteOffset,
            zipBytes.byteOffset + zipBytes.byteLength,
          ),
      };
    },
  });
  const res = await run(plugin);
  assert.equal(res.statusCode, 200);
  assert.ok(requested.every((url) => url.startsWith('https://data.gdeltproject.org/gdeltv2/')));
  assert.equal(requested.length, 96);
  const body = JSON.parse(res.body);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.mode, 'export');
  assert.equal(body.unavailable, false);
  assert.equal(body.slicesLoaded, 9, 'slices from 03:00 to 05:00');
  assert.equal(body.slicesExpected, 9, 'absent slices are not counted as expected');
  assert.ok(body.clusters.length > 0);
  assert.ok(!res.body.includes('\t'), 'no raw export rows');
  assert.ok(!/actor/i.test(res.body));
  const glasgow = body.clusters.find((c) => c.placeName.startsWith('Glasgow'));
  assert.equal(glasgow.count, 16 * 9, 'the same fixture, nine slices');
  // A second request inside five minutes answers from memory.
  const before = requested.length;
  await run(plugin);
  assert.equal(requested.length, before);
  assert.equal((await run(plugin, '/?q=1')).statusCode, 400);
  assert.equal((await run(plugin, '/', 'POST')).statusCode, 405);
});

test('the proxy reports unavailable when no slice can be read', async () => {
  const plugin = unrestProxy({
    now: () => Date.UTC(2026, 9, 14, 5, 3),
    fetchImpl: async () => ({ ok: false, status: 503, body: null }),
  });
  const body = JSON.parse((await run(plugin)).body);
  assert.equal(body.unavailable, true);
  assert.deepEqual(body.clusters, []);
});

const payload = (over = {}) => ({
  schemaVersion: 1,
  source: 'GDELT 2.0 events export',
  mode: 'export',
  fetchedAt: Date.UTC(2026, 9, 14, 5, 5),
  newestSliceAt: Date.UTC(2026, 9, 14, 5, 0),
  slicesLoaded: 96,
  slicesExpected: 96,
  stale: false,
  unavailable: false,
  reason: null,
  clusters: [
    {
      stableId: 'unrest:1:2',
      lon: 10,
      lat: 20,
      placeName: 'Testville, Testland',
      country: 'Testland',
      count: 12,
      events: 3,
      sampleUrls: ['https://news.example/a', 'ftp://bad.example/x', 'https://news.example/b'],
      updatedAt: '2026-10-14T05:00:00.000Z',
      actor1Name: 'SHOULD NOT SURVIVE',
    },
  ],
  ...over,
});

test('snapshot validation keeps only the aggregate fields', () => {
  const { rows, meta } = normalizeUnrestSnapshot(payload());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sampleUrls, ['https://news.example/a', 'https://news.example/b']);
  assert.ok(!('actor1Name' in rows[0]));
  assert.equal(meta.mode, 'export');
  assert.equal(normalizeUnrestSnapshot({ schemaVersion: 2 }), null);
  assert.equal(
    normalizeUnrestSnapshot(payload({ clusters: [{ ...payload().clusters[0], lat: 91 }] })),
    null,
  );
  assert.equal(
    normalizeUnrestSnapshot(
      payload({ clusters: [payload().clusters[0], payload().clusters[0]] }),
    ),
    null,
    'duplicate ids',
  );
});

test('markers scale with log(count) and only recent clusters get a halo', () => {
  assert.ok(unrestPointSize(1) < unrestPointSize(10));
  assert.ok(unrestPointSize(10) < unrestPointSize(1000));
  assert.ok(unrestPointSize(1e9) <= 26);
  const { rows } = normalizeUnrestSnapshot(payload());
  const now = Date.parse('2026-10-14T05:30:00Z');
  assert.equal(isRecentUnrest(rows[0], now), true);
  assert.ok(unrestStyle(rows[0], now).ring);
  assert.equal(isRecentUnrest(rows[0], now + 3 * 3_600_000), false);
  assert.equal(unrestStyle(rows[0], now + 3 * 3_600_000).ring, undefined);
  assert.equal(unrestLabel(rows[0]).title, 'Testville · 12');
});

test('card shows place, 24h count, up to three links, source, as-of and the caveat', () => {
  const { rows, meta } = normalizeUnrestSnapshot(payload());
  const card = buildUnrestCard(rows[0], meta, Date.parse('2026-10-14T06:00:00Z'));
  assert.match(card.title, /Testville/);
  assert.match(card.lines[0], /12 reports in 24h/);
  assert.ok(card.links.length <= 3);
  assert.equal(card.caveat, UNREST_CAVEAT);
  assert.equal(card.source, 'GDELT 2.0 events export');
  assert.equal(card.asOf, '14 Oct 2026 05:00 UTC');
  assert.ok(!JSON.stringify(card).includes(String.fromCharCode(0x2014)));
});

test('feed state treats the export files as the normal source and a short window as partial', () => {
  const { meta } = normalizeUnrestSnapshot(payload());
  assert.equal(unrestStats(meta).fallback, false);
  assert.equal(unrestStats(meta).coverage, 'GDELT 2.0 event files, last 24 h');
  assert.equal(unrestStats(meta).partial, false);
  assert.equal(unrestStats({ ...meta, slicesLoaded: 10 }).partial, true);
  assert.equal(unrestStats({ ...meta, stale: true }).stale, true);
});

test('analyst rows answer which place has the most protest reports', () => {
  const rows = normalizeUnrestSnapshot(
    payload({
      clusters: [
        { ...payload().clusters[0], stableId: 'a', count: 5, placeName: 'A, X' },
        { ...payload().clusters[0], stableId: 'b', count: 50, placeName: 'B, Y', country: 'Y' },
      ],
    }),
  ).rows.map(mapUnrestAnalystRecord);
  const top = rows.sort((a, b) => b.value - a.value)[0];
  assert.equal(top.name, 'B, Y');
  assert.equal(top.country, 'Y');
  assert.equal(top.unit, 'reports');
  assert.equal(top.kind, 'unrest');
  assert.ok(Number.isFinite(top.lat) && Number.isFinite(top.lon));
});

test('layer lifecycle: disable keeps data, destroy removes every entity', async () => {
  const added = [];
  const dataSources = [];
  const viewer = {
    dataSources: {
      add: (source) => dataSources.push(source),
      remove: (source) => dataSources.splice(dataSources.indexOf(source), 1),
    },
  };
  const entries = [];
  const layer = createUnrestLayer({
    // "Recent" is judged against the wall clock, so stamp the cluster relative
    // to now instead of a fixed date that ages out of the halo window.
    source: {
      getSnapshot: async () =>
        normalizeUnrestSnapshot(
          payload({
            clusters: [
              {
                ...payload().clusters[0],
                updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
              },
            ],
          }),
        ),
    },
    overlayHost: {
      setEntries: (...args) => entries.push(args),
      setVisible: (...args) => added.push(args),
      clearSource() {},
    },
  });
  assert.equal(layer.id, 'unrest');
  assert.equal(layer.updateInterval, 900_000);
  layer.init(viewer);
  assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layers expose nothing');
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(layer.getStats().count, 1);
  assert.equal(dataSources[0].entities.values.length, 2, 'point plus halo for a recent cluster');
  assert.equal(entries.at(-1)[1].length, 1);
  assert.equal(entries.at(-1)[1][0].title, 'Testville · 12');
  assert.equal(layer.getAnalystRecords().length, 1);
  layer.disable(viewer);
  assert.equal(layer.getStats().count, 1, 'disable keeps loaded data');
  assert.equal(layer.getAnalystRecords().length, 0);
  layer.enable(viewer);
  assert.equal(layer.getAnalystRecords().length, 1);
  layer.destroy(viewer);
  assert.equal(dataSources.length, 0);
  assert.equal(layer.getStats().count, 0);
});

test('the source validates the proxy response', async () => {
  const good = createUnrestSource({
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify(payload()),
    }),
  });
  assert.equal((await good.getSnapshot()).rows.length, 1);
  const bad = createUnrestSource({
    fetchImpl: async () => ({
      ok: true,
      headers: new Headers(),
      text: async () => '{"schemaVersion":9}',
    }),
  });
  await assert.rejects(bad.getSnapshot(), /Malformed unrest response/);
});
