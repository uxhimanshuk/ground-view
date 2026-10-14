import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createGdeltSlices } from './slices.js';
import { unrestProxy } from '../unrest.js';
import { newsToneProxy } from '../newsTone.js';

const zipBytes = new Uint8Array(
  readFileSync(
    new URL(
      '../../../src/data/fixtures/gdelt-export-sample.zip',
      import.meta.url,
    ),
  ),
);
const NOW = Date.UTC(2026, 9, 14, 5, 7);

function handlerOf(plugin, path) {
  let handler;
  plugin.configureServer({
    middlewares: {
      use(p, callback) {
        if (p === path) handler = callback;
      },
    },
  });
  return handler;
}

function call(handler) {
  return new Promise((resolve) => {
    const res = new EventEmitter();
    res.writeHead = (code) => {
      res.statusCode = code;
    };
    res.end = (body) =>
      resolve({ status: res.statusCode, body: JSON.parse(body) });
    handler({ method: 'GET', url: '/' }, res);
  });
}

test('unrest and news tone share one download per GDELT slice', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
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
  };
  const gdelt = createGdeltSlices({ fetchImpl, now: () => NOW });
  const unrest = unrestProxy({ gdelt, now: () => NOW });
  const tone = newsToneProxy({ gdelt, now: () => NOW });
  const [unrestRes, toneRes] = await Promise.all([
    call(handlerOf(unrest, '/api/unrest')),
    call(handlerOf(tone, '/api/news-tone')),
  ]);
  assert.equal(unrestRes.status, 200);
  assert.equal(toneRes.status, 200);
  assert.ok(unrestRes.body.clusters.length > 0);
  assert.ok(toneRes.body.files > 0);
  assert.equal(
    new Set(requested).size,
    requested.length,
    'no slice is downloaded twice',
  );
  assert.ok(requested.length <= 97, `${requested.length} downloads`);
  assert.equal(gdelt.stats.downloads, requested.length);
});

test('a hub shared by two parsers returns each its own result from one fetch', async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches++;
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
  };
  const hub = createGdeltSlices({ fetchImpl, now: () => NOW });
  hub.register('a', (csv) => csv.length);
  hub.register('b', () => 'b');
  const ts = Date.UTC(2026, 9, 14, 5, 0);
  assert.equal(await hub.load(ts), 'ok');
  assert.equal(await hub.load(ts), 'ok');
  assert.equal(fetches, 1);
  assert.ok(hub.get('a', ts) > 0);
  assert.equal(hub.get('b', ts), 'b');
  hub.prune('a', ts + 1);
  assert.equal(hub.has('a', ts), false);
  assert.equal(hub.has('b', ts), true);
});
