import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildUnrestSnapshot,
  clusterProtestEvents,
  expectedSlices,
  parseProtestEvents,
} from '../scripts/lib/unrest.mjs';
import { runSnapshot } from '../scripts/build-unrest-snapshot.mjs';

const csv = await readFile(
  new URL('./fixtures/sample-export.tsv', import.meta.url),
  'utf8',
);

test('parses only protest rows with a precise location', () => {
  const events = parseProtestEvents(csv);
  // root 19 (not protest), geo type 1 (country) and the row with no coordinates are dropped.
  assert.deepEqual(
    events.map((e) => e.id),
    ['1', '2', '3'],
  );
  assert.equal(events[0].articles, 5);
  assert.equal(events[0].url, 'https://example.com/a');
});

test('CAMEO root 14 filter excludes other event types', () => {
  const events = parseProtestEvents(csv);
  assert.ok(!events.some((e) => e.id === '4'));
});

test('precision filter drops country-level geocodes', () => {
  const events = parseProtestEvents(csv);
  assert.ok(!events.some((e) => e.id === '5'));
});

test('malformed and short rows are skipped', () => {
  assert.deepEqual(parseProtestEvents('a\tb\n\n'), []);
  assert.deepEqual(parseProtestEvents(undefined), []);
});

test('clusters nearby events and weights by article count', () => {
  const clusters = clusterProtestEvents(parseProtestEvents(csv));
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].placeName, 'Paris, Ile-de-France, France');
  assert.equal(clusters[0].count, 8);
  assert.equal(clusters[0].events, 2);
  assert.equal(clusters[0].country, 'France');
  assert.equal(clusters[1].country, 'Germany');
  assert.match(clusters[0].stableId, /^unrest:/);
});

test('expectedSlices gives 96 quarter-hour slices', () => {
  const slices = expectedSlices(Date.UTC(2026, 9, 14, 5, 7));
  assert.equal(slices.length, 96);
  assert.equal(slices[0], Date.UTC(2026, 9, 14, 5, 0));
  assert.equal(slices[0] - slices[1], 15 * 60_000);
});

test('snapshot shape matches the live file', async () => {
  const gdelt = {
    register() {},
    prune() {},
    has: () => true,
    get: () => parseProtestEvents(csv),
    async load() {
      return 'ok';
    },
  };
  const now = () => Date.UTC(2026, 9, 14, 5, 7);
  const snap = await buildUnrestSnapshot({ gdelt, now });
  assert.deepEqual(Object.keys(snap), [
    'schemaVersion',
    'source',
    'attribution',
    'mode',
    'coverage',
    'fetchedAt',
    'newestSliceAt',
    'windowHours',
    'slicesExpected',
    'slicesLoaded',
    'stale',
    'unavailable',
    'reason',
    'clusters',
  ]);
  assert.equal(snap.slicesLoaded, 96);
  assert.equal(snap.unavailable, false);
  assert.ok(snap.clusters.length > 0);
});

test('failure keeps the previous file and marks it stale', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gv-'));
  const prev = path.join(dir, 'prev');
  const out = path.join(dir, 'out');
  await import('node:fs/promises').then((fs) => fs.mkdir(prev));
  await writeFile(
    path.join(prev, 'unrest.json'),
    JSON.stringify({ generatedAt: 123, clusters: [] }),
  );
  const { manifest, files } = await runSnapshot({
    outDir: out,
    previousBase: prev,
    build: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(files, 1);
  assert.equal(manifest.feeds.unrest.status, 'stale');
  assert.equal(manifest.feeds.unrest.generatedAt, 123);
  const none = await runSnapshot({
    outDir: out,
    previousBase: path.join(dir, 'missing'),
    build: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(none.files, 0);
});
