import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  crisesProxy,
  gdacsRequests,
  gdacsUrl,
} from '../../../server/providers/crises.js';
import {
  ALERT_COLORS,
  ALERT_SIZES,
  buildCrisisCard,
  CRISES_CAVEAT,
  createCrisesLayer,
  createCrisesSource,
  crisisStyle,
  mapCrisisAnalystRecord,
  normalizeCrisesSnapshot,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../data/fixtures/gdacs-events-2026-10-14.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const wrap = (extra = {}) => ({
  schemaVersion: 2,
  fetchedAt: Date.UTC(2026, 9, 14, 8),
  data: fixture.features,
  ...extra,
});

test('records carry type, alert level, country, point and dates', () => {
  const { rows, meta } = normalizeCrisesSnapshot(wrap());
  assert.equal(rows.length, fixture.features.length);
  const red = rows.find((r) => r.alertLevel === 'red');
  assert.equal(red.eventType, 'TC');
  assert.equal(red.country, 'Mexico');
  assert.equal(red.stableId, 'gdacs:TC:' + red.stableId.split(':')[2]);
  assert.match(red.fromDate, /^2026-10-\d\dT\d\d:\d\d:\d\d\.000Z$/);
  assert.match(red.url, /^https:\/\/www\.gdacs\.org\/report\.aspx/);
  assert.equal(meta.unavailable, false);
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), [
      'alertLevel',
      'countries',
      'country',
      'eventType',
      'fromDate',
      'lat',
      'lon',
      'name',
      'stableId',
      'toDate',
      'url',
    ]);
});

test('a multi-country drought lists every affected country', () => {
  const { rows } = normalizeCrisesSnapshot(wrap());
  const drought = rows.find(
    (r) => r.eventType === 'DR' && r.countries.length > 3,
  );
  assert.ok(drought);
  assert.equal(drought.country, drought.countries[0]);
});

test('episodes of one event collapse and unplaceable features are skipped', () => {
  const [a] = fixture.features;
  const later = structuredClone(a);
  later.properties.todate = '2026-12-01T00:00:00';
  const noPoint = structuredClone(a);
  noPoint.properties.eventid = 42;
  noPoint.geometry = { type: 'Polygon', coordinates: [] };
  const unknown = structuredClone(a);
  unknown.properties.eventid = 43;
  unknown.properties.eventtype = 'XX';
  const { rows } = normalizeCrisesSnapshot(
    wrap({ data: [a, later, noPoint, unknown] }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].toDate, '2026-12-01T00:00:00.000Z');
});

test('malformed payloads are rejected as a whole', () => {
  assert.equal(normalizeCrisesSnapshot(null), null);
  assert.equal(normalizeCrisesSnapshot({ schemaVersion: 1, data: [] }), null);
  assert.equal(normalizeCrisesSnapshot(wrap({ data: 'nope' })), null);
  assert.equal(
    normalizeCrisesSnapshot(wrap({ data: [{ properties: {} }] })),
    null,
  );
});

test('alert level changes colour and size, and the hazard type rings the dot', () => {
  const { rows } = normalizeCrisesSnapshot(wrap());
  const styles = new Map(rows.map((r) => [r.alertLevel, crisisStyle(r)]));
  assert.equal(styles.get('red').color, ALERT_COLORS.red);
  assert.ok(styles.get('red').pixelSize > styles.get('orange').pixelSize);
  assert.ok(styles.get('orange').pixelSize > styles.get('green').pixelSize);
  assert.equal(styles.get('green').pixelSize, ALERT_SIZES.green);
  assert.ok(styles.get('red').ring.pixelSize > styles.get('red').pixelSize);
  const rings = new Set(rows.map((r) => crisisStyle(r).ring.color));
  assert.ok(rings.size >= 4, 'hazard types are told apart by ring colour');
});

test('card names source, as-of date, dates, countries and the caveat', () => {
  const { rows, meta } = normalizeCrisesSnapshot(wrap());
  const card = buildCrisisCard(rows[0], meta, Date.now());
  assert.equal(card.source, 'GDACS');
  assert.equal(card.caveat, CRISES_CAVEAT);
  assert.match(card.caveat, /Conflicts and epidemics are not covered/);
  assert.match(card.asOf, /2026 .*UTC$/);
  assert.equal(card.links[0].href, rows[0].url);
  assert.match(card.lines[0], /Tropical cyclone · (Orange|Red) alert/);
  assert.ok(card.lines.some((l) => l.startsWith('Affected: ')));
  assert.ok(
    !JSON.stringify(card).includes(String.fromCharCode(0x2014)),
    'no em-dashes in copy',
  );
});

test('analyst records answer which alerts are red', () => {
  const { rows } = normalizeCrisesSnapshot(wrap());
  const records = rows.map((r) => mapCrisisAnalystRecord(r));
  const top = records.sort((a, b) => b.value - a.value)[0];
  assert.equal(top.value, 3);
  assert.equal(top.alertLevel, 'red');
  assert.equal(top.kind, 'disaster-alert');
  assert.equal(top.country, 'Mexico');
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
  assert.equal(rows.length, fixture.features.length);
  const bad = createCrisesSource({
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(bad.getSnapshot(), /Crises HTTP 500/);
});

test('an unavailable snapshot never replaces displayed rows', async () => {
  const entries = [];
  let call = 0;
  const source = {
    async getSnapshot() {
      call++;
      return call === 1
        ? normalizeCrisesSnapshot(wrap())
        : normalizeCrisesSnapshot(
            wrap({ data: [], unavailable: true, reason: 'GDACS unavailable' }),
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
  const count = layer.getStats().count;
  assert.equal(count, fixture.features.length);
  assert.equal(await layer.update(), false);
  const stats = layer.getStats();
  assert.equal(stats.count, count, 'last good rows remain');
  assert.equal(stats.error, 'GDACS unavailable');
  assert.equal(layer.requiresKeyId, undefined, 'GDACS needs no key');
  assert.equal(layer.getAnalystRecords().length, count);
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

test('request plan: one Orange/Red request, then Green per hazard type', () => {
  const urls = gdacsRequests(Date.UTC(2026, 9, 14));
  assert.equal(urls.length, 7);
  assert.match(
    urls[0],
    /eventlist=EQ;TC;FL;VO;DR;WF&fromdate=2026-09-14&todate=2026-10-14&alertlevel=Orange;Red$/,
  );
  assert.match(
    urls[1],
    /eventlist=EQ&fromdate=2026-09-30&todate=2026-10-14&alertlevel=Green$/,
  );
  const url = new URL(
    gdacsUrl({ eventTypes: ['EQ'], alertLevels: ['Red'], fromMs: 0, toMs: 0 }),
  );
  assert.equal(url.origin, 'https://www.gdacs.org');
  assert.equal(url.pathname, '/gdacsapi/api/events/geteventlist/SEARCH');
});

test('proxy fetches all requests, caches 15 minutes, serves stale on failure', async () => {
  const urls = [];
  let now = Date.UTC(2026, 9, 14);
  let fail = false;
  const plugin = crisesProxy({
    now: () => now,
    fetchImpl: async (url) => {
      urls.push(url);
      if (fail) return { ok: false, status: 503, body: null };
      return {
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ features: [fixture.features[0]] }),
      };
    },
  });
  const first = JSON.parse((await run(plugin)).body);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.data.length, 7, 'one feature from each request');
  assert.equal(urls.length, 7);
  await run(plugin);
  assert.equal(urls.length, 7, 'cached');
  now += 20 * 60_000;
  fail = true;
  const stale = JSON.parse((await run(plugin)).body);
  assert.equal(stale.stale, true);
  assert.equal(stale.data.length, 7);
  assert.equal((await run(plugin, '/?x=1')).statusCode, 400);
  assert.equal((await run(plugin, '/', 'POST')).statusCode, 405);
});

test('a failed Green request still serves the Orange and Red alerts', async () => {
  let n = 0;
  const plugin = crisesProxy({
    fetchImpl: async () => {
      if (n++ > 0) return { ok: false, status: 500, body: null };
      return {
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ features: [fixture.features[0]] }),
      };
    },
  });
  const body = JSON.parse((await run(plugin)).body);
  assert.equal(body.unavailable, false);
  assert.equal(body.data.length, 1);
});

test('with every request failing and no cache, the proxy says unavailable', async () => {
  const plugin = crisesProxy({
    fetchImpl: async () => ({ ok: false, status: 502, body: null }),
  });
  const body = JSON.parse((await run(plugin)).body);
  assert.equal(body.unavailable, true);
  assert.deepEqual(body.data, []);
});
