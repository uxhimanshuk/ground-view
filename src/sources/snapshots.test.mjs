import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SNAPSHOT_STALE_MS,
  isSnapshotStale,
  snapshotAgeText,
  snapshotUrl,
  withSnapshotAge,
} from './snapshots.js';
import { runSnapshots } from '../../scripts/build-snapshots.mjs';
import { createUnrestSource } from '../layers/unrest/source.js';
import { createCrisesSource } from '../layers/crises/source.js';
import { createNewsToneSource } from '../layers/newsTone/source.js';
import { createWikimediaAttentionSource } from '../layers/attention/source.js';

const fixture = (name) =>
  new URL(`../data/fixtures/${name}`, import.meta.url);
const zip = new Uint8Array(readFileSync(fixture('gdelt-export-sample.zip')));
const gdacs = JSON.parse(
  readFileSync(fixture('gdacs-events-2026-10-14.json'), 'utf8'),
);
const wiki = JSON.parse(
  readFileSync(fixture('wikimedia-top-2026-10-12.json'), 'utf8'),
)['en.wikipedia'];
const NOW = Date.UTC(2026, 9, 14, 5, 7);

/** A network-free fetch that answers GDELT, GDACS and Wikimedia from fixtures. */
function fakeFetch({ failGdacs = false } = {}) {
  return async (url) => {
    const u = String(url);
    const json = (body, status = 200) => ({
      ok: status === 200,
      status,
      headers: new Headers(),
      body: { cancel: async () => {} },
      text: async () => JSON.stringify(body),
      json: async () => body,
    });
    if (u.includes('data.gdeltproject.org'))
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () =>
          zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      };
    if (u.includes('gdacs.org'))
      return failGdacs ? json({}, 503) : json(gdacs);
    if (u.includes('wikimedia.org')) return json(wiki);
    throw new Error(`unexpected request ${u}`);
  };
}

test('snapshotUrl joins a base with or without a trailing slash', () => {
  assert.equal(snapshotUrl('a.json', 'https://x.test/s'), 'https://x.test/s/a.json');
  assert.equal(snapshotUrl('a.json', 'https://x.test/s/'), 'https://x.test/s/a.json');
});

test('a snapshot is stale after two hours or without a time', () => {
  assert.equal(isSnapshotStale(NOW - SNAPSHOT_STALE_MS + 1, NOW), false);
  assert.equal(isSnapshotStale(NOW - SNAPSHOT_STALE_MS - 1, NOW), true);
  assert.equal(isSnapshotStale(undefined, NOW), true);
  assert.equal(withSnapshotAge({ generatedAt: NOW - 1000 }, NOW).stale, false);
  assert.equal(
    withSnapshotAge({ generatedAt: NOW - 1000, stale: true }, NOW).stale,
    true,
  );
});

test('snapshot age is spoken plainly', () => {
  assert.equal(snapshotAgeText(NOW - 18 * 60_000, NOW), 'updated 18 min ago');
  assert.equal(snapshotAgeText(NOW - 3 * 3_600_000, NOW), 'updated 3 h ago');
  assert.equal(snapshotAgeText(NaN, NOW), 'update time unknown');
});

test('the snapshot script writes every feed and the layers read them back', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gv-snap-'));
  try {
    const fetchImpl = fakeFetch();
    const { manifest, files } = await runSnapshots({
      outDir: dir,
      previousBase: null,
      fetchImpl,
      now: () => NOW,
    });
    assert.equal(files, 4);
    for (const feed of Object.values(manifest.feeds)) {
      assert.equal(feed.status, 'ok');
      assert.equal(feed.generatedAt, NOW);
    }
    const read = async (file) =>
      JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    const serve = (file) => async () => {
      const body = JSON.stringify(await read(file));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => body,
        json: async () => JSON.parse(body),
        body: new Response(body).body,
      };
    };
    const unrest = await createUnrestSource({
      useSnapshot: true,
      fetchImpl: serve('unrest.json'),
      now: () => NOW + 60_000,
    }).getSnapshot();
    assert.ok(unrest.rows.length > 0);
    assert.equal(unrest.meta.generatedAt, NOW);
    assert.equal(unrest.meta.stale, false);
    const crises = await createCrisesSource({
      useSnapshot: true,
      fetchImpl: serve('crises.json'),
      now: () => NOW,
    }).getSnapshot();
    assert.ok(crises.rows.length > 0);
    const tone = await createNewsToneSource({
      useSnapshot: true,
      fetchImpl: serve('news-tone.json'),
      now: () => NOW + 3 * 3_600_000,
    }).fetchData();
    assert.ok(tone.rows.length > 0);
    assert.equal(tone.stale, true, 'three hours old is stale');
    assert.equal(tone.updatedAt, NOW);
    const attention = await createWikimediaAttentionSource({
      useSnapshot: true,
      fetchImpl: serve('attention.json'),
      now: () => NOW,
    }).getSnapshot();
    assert.ok(attention.rows.length > 0);
    assert.equal(attention.meta.stale, false);
    assert.equal(attention.meta.generatedAt, NOW);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed feed keeps its previous snapshot and is marked stale', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'gv-snap-out-'));
  const prev = await mkdtemp(path.join(os.tmpdir(), 'gv-snap-prev-'));
  try {
    const before = { schemaVersion: 2, generatedAt: NOW - 3_600_000, data: [] };
    await writeFile(path.join(prev, 'crises.json'), JSON.stringify(before));
    const { manifest, files } = await runSnapshots({
      outDir: out,
      previousBase: prev,
      fetchImpl: fakeFetch({ failGdacs: true }),
      now: () => NOW,
    });
    assert.equal(files, 4);
    assert.equal(manifest.feeds.crises.status, 'stale');
    assert.equal(manifest.feeds.crises.generatedAt, before.generatedAt);
    assert.match(manifest.feeds.crises.error, /GDACS/);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(out, 'crises.json'), 'utf8')),
      before,
    );
    assert.equal(manifest.feeds.unrest.status, 'ok');
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(prev, { recursive: true, force: true });
  }
});

test('a failed feed with no previous snapshot is an error with no file', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'gv-snap-out-'));
  try {
    const { manifest, files } = await runSnapshots({
      outDir: out,
      previousBase: null,
      fetchImpl: fakeFetch({ failGdacs: true }),
      now: () => NOW,
    });
    assert.equal(files, 3);
    assert.equal(manifest.feeds.crises.status, 'error');
    assert.equal(manifest.feeds.crises.file, null);
    await assert.rejects(readFile(path.join(out, 'crises.json')));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
