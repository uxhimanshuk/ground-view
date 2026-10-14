import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { crisesProxy, reliefWebUrl } from '../../../server/providers/crises.js';
import {
  buildCrisisCard,
  CRISES_CAVEAT,
  CRISIS_COLORS,
  crisisFamily,
  createCrisesLayer,
  createCrisesSource,
  mapCrisisAnalystRecord,
  normalizeCrisesSnapshot,
} from './index.js';

const sample = JSON.parse(
  readFileSync(
    new URL(
      '../../data/fixtures/reliefweb-disasters-schema-sample.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const wrap = (extra = {}) => ({
  schemaVersion: 1,
  fetchedAt: Date.UTC(2026, 9, 14),
  data: sample.data,
  ...extra,
});

test('type names group into six display families', () => {
  assert.equal(crisisFamily('Flood'), 'flood');
  assert.equal(crisisFamily('Flash Flood'), 'flood');
  assert.equal(crisisFamily('Epidemic'), 'epidemic');
  assert.equal(crisisFamily('Complex Emergency'), 'conflict');
  assert.equal(crisisFamily('Drought'), 'drought');
  assert.equal(crisisFamily('Tropical Cyclone'), 'storm');
  assert.equal(crisisFamily('Earthquake'), 'other');
  assert.equal(crisisFamily(undefined), 'other');
  for (const color of Object.values(CRISIS_COLORS))
    assert.match(color, /^#[0-9A-F]{6}$/);
});

test('records use the primary country centroid and skip unplaceable situations', () => {
  const { rows, meta } = normalizeCrisesSnapshot(wrap());
  assert.equal(rows.length, 5, 'the situation without a centroid is skipped');
  const epidemic = rows.find((r) => r.stableId === 'crisis:900002');
  assert.deepEqual(
    { lon: epidemic.lon, lat: epidemic.lat, type: epidemic.type },
    { lon: 28.5, lat: -12.75, type: 'Epidemic' },
  );
  assert.deepEqual(epidemic.countries, ['Demoland', 'Sampleland']);
  assert.equal(epidemic.status, 'alert');
  assert.equal(epidemic.date, '2026-08-15T00:00:00.000Z');
  assert.equal(meta.unavailable, false);
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), [
      'countries',
      'country',
      'date',
      'family',
      'lat',
      'lon',
      'name',
      'stableId',
      'status',
      'type',
      'url',
    ]);
});

test('only ReliefWeb links are kept', () => {
  const { rows } = normalizeCrisesSnapshot(wrap());
  assert.equal(rows.find((r) => r.stableId === 'crisis:900004').url, null);
  assert.match(rows[0].url, /^https:\/\/reliefweb\.int\//);
});

test('malformed payloads are rejected as a whole', () => {
  assert.equal(normalizeCrisesSnapshot(null), null);
  assert.equal(normalizeCrisesSnapshot({ schemaVersion: 2, data: [] }), null);
  assert.equal(normalizeCrisesSnapshot(wrap({ data: 'nope' })), null);
  assert.equal(
    normalizeCrisesSnapshot(wrap({ data: [{ id: '1', fields: { name: '' } }] })),
    null,
  );
});

test('card names source, as-of date and the caveat', () => {
  const { rows, meta } = normalizeCrisesSnapshot(wrap());
  const card = buildCrisisCard(rows[0], meta, Date.now());
  assert.equal(card.source, 'ReliefWeb');
  assert.equal(card.caveat, CRISES_CAVEAT);
  assert.match(card.asOf, /2026 .*UTC$/);
  assert.equal(card.links[0].href, rows[0].url);
  assert.ok(!JSON.stringify(card).includes(String.fromCharCode(0x2014)), 'no em-dashes in copy');
});

test('analyst records answer which situation has run longest', () => {
  const { rows, meta } = normalizeCrisesSnapshot(wrap());
  const records = rows.map((r) => mapCrisisAnalystRecord(r, meta));
  const longest = records.sort((a, b) => b.value - a.value)[0];
  assert.equal(longest.name, 'Test Complex Emergency: Fictionia');
  assert.equal(longest.kind, 'crisis');
  assert.equal(longest.unit, 'days since start');
  assert.equal(longest.country, 'Fictionia');
});

test('the source validates what the proxy returns', async () => {
  const source = createCrisesSource({
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify(wrap()),
      headers: new Headers(),
    }),
  });
  const { rows } = await source.getSnapshot();
  assert.equal(rows.length, 5);
  const bad = createCrisesSource({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(bad.getSnapshot(), /Crises HTTP 500/);
});

test('an unavailable snapshot never replaces displayed rows and reports the key', async () => {
  const entries = [];
  let call = 0;
  const source = {
    async getSnapshot() {
      call++;
      return call === 1
        ? normalizeCrisesSnapshot(wrap())
        : normalizeCrisesSnapshot(
            wrap({ data: [], unavailable: true, keyRequired: true, reason: 'needs appname' }),
          );
    },
  };
  const layer = createCrisesLayer({
    source,
    overlayHost: {
      setEntries: (...args) => entries.push(args),
      setVisible() {},
      clearSource() {},
    },
  });
  const viewer = { dataSources: { add() {}, remove() {} } };
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().count, 5);
  assert.equal(await layer.update(), false);
  const stats = layer.getStats();
  assert.equal(stats.count, 5, 'last good rows remain');
  assert.equal(stats.error, 'needs appname');
  assert.equal(stats.keyRequired, true);
  assert.equal(layer.requiresKeyId, 'reliefweb');
  assert.equal(layer.getAnalystRecords().length, 5);
  layer.destroy(viewer);
});

function run(plugin, url = '/', method = 'GET') {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(path, callback) {
        assert.equal(path, '/api/crises');
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

test('proxy without an appname says a key is required and never calls ReliefWeb', async () => {
  let calls = 0;
  const plugin = crisesProxy({
    env: {},
    fetchImpl: async () => {
      calls++;
    },
  });
  const res = await run(plugin);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.unavailable, true);
  assert.equal(body.keyRequired, true);
  assert.match(body.reason, /RELIEFWEB_APPNAME/);
  assert.equal(calls, 0);
});

test('proxy fetches ongoing and alert situations, caches, and serves stale on failure', async () => {
  const urls = [];
  let now = 1_000_000;
  let fail = false;
  const plugin = crisesProxy({
    env: { RELIEFWEB_APPNAME: 'approved-name' },
    now: () => now,
    fetchImpl: async (url) => {
      urls.push(url);
      if (fail) return { ok: false, status: 503, body: null };
      return {
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ data: [sample.data[0]] }),
      };
    },
  });
  const first = JSON.parse((await run(plugin)).body);
  assert.equal(first.data.length, 2, 'one record from each status request');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /filter%5Bvalue%5D=ongoing/);
  assert.match(urls[1], /filter%5Bvalue%5D=alert/);
  assert.match(urls[0], /appname=approved-name/);
  await run(plugin);
  assert.equal(urls.length, 2, 'cached for six hours');
  now += 7 * 3600_000;
  fail = true;
  const stale = JSON.parse((await run(plugin)).body);
  assert.equal(stale.stale, true);
  assert.equal(stale.data.length, 2);
  assert.equal((await run(plugin, '/?x=1')).statusCode, 400);
  assert.equal((await run(plugin, '/', 'POST')).statusCode, 405);
});

test('request URL targets the fixed v2 origin', () => {
  const url = new URL(reliefWebUrl('name-ok', 'ongoing'));
  assert.equal(url.origin, 'https://api.reliefweb.int');
  assert.equal(url.pathname, '/v2/disasters');
  assert.equal(url.searchParams.get('limit'), '200');
});
