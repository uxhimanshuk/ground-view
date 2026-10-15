#!/usr/bin/env node
/**
 * build-unrest-snapshot.mjs: writes the unrest snapshot the Ground View site reads.
 *
 *   node scripts/build-unrest-snapshot.mjs <out-dir> [--previous-base <url|dir>]
 *
 * Downloads the last 24 h of GDELT 2.0 event exports, keeps anonymous protest
 * clusters and writes <out-dir>/unrest.json and <out-dir>/manifest.json. If the
 * build fails, the previous unrest.json (from `--previous-base`, a URL prefix or
 * a local folder) is kept and marked stale in the manifest. Exit code is 1 only
 * when no file exists at all. Node built-ins only.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildUnrestSnapshot } from './lib/unrest.mjs';

export const DEFAULT_PREVIOUS_BASE =
  'https://raw.githubusercontent.com/uxhimanshuk/ground-view/snapshots/';
const FILE = 'unrest.json';

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

export async function defaultBuild({ fetchImpl, now }) {
  const payload = await buildUnrestSnapshot({ fetchImpl, now });
  if (payload.unavailable) throw new Error('unrest_unavailable');
  // A mostly empty window must not replace a good previous snapshot.
  if (payload.slicesLoaded < payload.slicesExpected * 0.5)
    throw new Error('unrest_window_incomplete');
  return payload;
}

/** Build once and write the folder. */
export async function runSnapshot({
  outDir,
  previousBase = DEFAULT_PREVIOUS_BASE,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  build = () => defaultBuild({ fetchImpl, now }),
  log = () => {},
} = {}) {
  await mkdir(outDir, { recursive: true });
  const manifest = { schemaVersion: 1, generatedAt: now(), feeds: {} };
  let files = 0;
  let payload = null;
  let error = null;
  try {
    payload = await build();
    if (!payload || typeof payload !== 'object')
      throw new Error('empty_snapshot');
  } catch (cause) {
    error = String(cause?.message || cause).slice(0, 200);
  }
  if (payload) {
    const generatedAt = now();
    await writeFile(
      path.join(outDir, FILE),
      JSON.stringify({ ...payload, generatedAt }),
    );
    manifest.feeds.unrest = { file: FILE, generatedAt, status: 'ok' };
    files++;
    log('unrest: ok');
  } else {
    const previous = await readPrevious(previousBase, FILE, fetchImpl);
    if (previous && Number.isFinite(previous.generatedAt)) {
      await writeFile(path.join(outDir, FILE), JSON.stringify(previous));
      manifest.feeds.unrest = {
        file: FILE,
        generatedAt: previous.generatedAt,
        status: 'stale',
        error,
      };
      files++;
      log(`unrest: failed (${error}), kept previous snapshot`);
    } else {
      manifest.feeds.unrest = {
        file: null,
        generatedAt: null,
        status: 'error',
        error,
      };
      log(`unrest: failed (${error}), no previous snapshot`);
    }
  }
  await writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  return { manifest, files };
}

async function main(argv) {
  const i = argv.indexOf('--previous-base');
  const previousBase = i >= 0 ? argv[i + 1] : DEFAULT_PREVIOUS_BASE;
  const outDir = argv.find(
    (arg, k) => !arg.startsWith('--') && (i < 0 || k !== i + 1),
  );
  if (!outDir) {
    console.error(
      'usage: node scripts/build-unrest-snapshot.mjs <out-dir> [--previous-base <url|dir>]',
    );
    return 2;
  }
  const { manifest, files } = await runSnapshot({
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
if (import.meta.url === invoked)
  process.exitCode = await main(process.argv.slice(2));
