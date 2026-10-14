#!/usr/bin/env node
/**
 * build-snapshots.mjs: writes the JSON snapshots the static Ground View demo
 * reads in place of its four server-backed feeds.
 *
 *   node scripts/build-snapshots.mjs out/ [--previous-base <url|dir>]
 *
 * It calls the same provider aggregation code as the dev proxies (the shared
 * GDELT slice hub, unrest, news tone, attention, GDACS crises), as library
 * functions, and writes unrest.json, news-tone.json, attention.json,
 * crises.json and manifest.json. If a feed fails, the previous file (fetched
 * from `--previous-base`, a URL prefix or a local folder) is kept and the feed
 * is marked stale in the manifest, so one outage does not blank a layer.
 * Exit code is 1 only when no feed has a file at all.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGdeltSlices } from '../server/providers/gdelt/slices.js';
import { buildUnrestSnapshot } from '../server/providers/unrest.js';
import { buildNewsToneSnapshot } from '../server/providers/newsTone.js';
import { buildAttentionSnapshot } from '../server/providers/attention.js';
import { buildCrisesSnapshot } from '../server/providers/crises.js';

export const DEFAULT_PREVIOUS_BASE =
  'https://raw.githubusercontent.com/uxhimanshuk/ground-view/snapshots/';

export const FEEDS = Object.freeze([
  { id: 'unrest', file: 'unrest.json' },
  { id: 'news-tone', file: 'news-tone.json' },
  { id: 'attention', file: 'attention.json' },
  { id: 'crises', file: 'crises.json' },
]);

/** The default builders. The two GDELT feeds share one slice hub, so each slice downloads once. */
export function defaultBuilders({ fetchImpl, now }) {
  const gdelt = createGdeltSlices({ fetchImpl, now });
  return {
    unrest: async () => {
      const payload = await buildUnrestSnapshot({ fetchImpl, now, gdelt });
      if (payload.unavailable) throw new Error('unrest_unavailable');
      // A mostly empty window must not replace a good previous snapshot.
      if (payload.slicesLoaded < payload.slicesExpected * 0.5)
        throw new Error('unrest_window_incomplete');
      return payload;
    },
    'news-tone': () => buildNewsToneSnapshot({ fetchImpl, now, gdelt }),
    attention: () => buildAttentionSnapshot({ fetchImpl, now }),
    crises: () => buildCrisesSnapshot({ fetchImpl, now }),
  };
}

/** Read a previous snapshot file from a URL prefix or a local folder; null when absent. */
export async function readPrevious(base, file, fetchImpl) {
  if (!base) return null;
  try {
    if (/^https?:\/\//.test(base)) {
      const response = await fetchImpl(new URL(file, base), {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        await response.body?.cancel?.();
        return null;
      }
      return JSON.parse(await response.text());
    }
    return JSON.parse(await readFile(path.join(base, file), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build every feed once and write the folder.
 * @returns {Promise<{manifest: object, files: number}>}
 */
export async function runSnapshots({
  outDir,
  previousBase = DEFAULT_PREVIOUS_BASE,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  builders = defaultBuilders({ fetchImpl, now }),
  log = () => {},
} = {}) {
  await mkdir(outDir, { recursive: true });
  const startedAt = now();
  const manifest = { schemaVersion: 1, generatedAt: startedAt, feeds: {} };
  let files = 0;
  // Feeds run one after another: the two GDELT feeds share downloads and the
  // runner stays within the sources' fair-use limits.
  for (const { id, file } of FEEDS) {
    let payload = null;
    let error = null;
    try {
      payload = await builders[id]();
      if (!payload || typeof payload !== 'object')
        throw new Error('empty_snapshot');
    } catch (cause) {
      error = String(cause?.message || cause).slice(0, 200);
    }
    if (payload) {
      const generatedAt = now();
      await writeFile(
        path.join(outDir, file),
        JSON.stringify({ ...payload, generatedAt }),
      );
      manifest.feeds[id] = { file, generatedAt, status: 'ok' };
      files++;
      log(`${id}: ok`);
      continue;
    }
    const previous = await readPrevious(previousBase, file, fetchImpl);
    if (previous && Number.isFinite(previous.generatedAt)) {
      await writeFile(path.join(outDir, file), JSON.stringify(previous));
      manifest.feeds[id] = {
        file,
        generatedAt: previous.generatedAt,
        status: 'stale',
        error,
      };
      files++;
      log(`${id}: failed (${error}), kept previous snapshot`);
    } else {
      manifest.feeds[id] = {
        file: null,
        generatedAt: null,
        status: 'error',
        error,
      };
      log(`${id}: failed (${error}), no previous snapshot`);
    }
  }
  await writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return { manifest, files };
}

async function main(argv) {
  const outDir = argv.find((arg) => !arg.startsWith('--'));
  if (!outDir) {
    console.error(
      'usage: node scripts/build-snapshots.mjs <out-dir> [--previous-base <url|dir>]',
    );
    return 2;
  }
  const i = argv.indexOf('--previous-base');
  const previousBase = i >= 0 ? argv[i + 1] : DEFAULT_PREVIOUS_BASE;
  const { manifest, files } = await runSnapshots({
    outDir,
    previousBase,
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(manifest.feeds));
  return files === 0 ? 1 : 0;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) process.exitCode = await main(process.argv.slice(2));
