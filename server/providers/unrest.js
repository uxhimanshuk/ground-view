import { inflateRawSync } from 'node:zlib';
import { readResponseBytesCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import {
  clusterProtestEvents,
  formatGdeltTimestamp,
  parseProtestEvents,
} from '../../src/data/gdeltUnrest.js';

// GDELT 2.0 publishes one events export every 15 minutes. The GEO 2.0 API this
// layer would prefer returned HTTP 404 when probed on 2026-10-14, so the
// export is the working source: this proxy downloads each 15-minute slice,
// unzips it, keeps only anonymous protest rows and serves clusters. The raw
// export never reaches the browser.
const EXPORT_BASE = 'https://data.gdeltproject.org/gdeltv2/';
const SLICE_MS = 15 * 60_000;
const WINDOW_SLICES = 96; // 24 hours
const PUBLISH_LAG_MS = 2 * 60_000;
const REFRESH_MS = 5 * 60_000;
const FIRST_LOAD_BUDGET_MS = 25_000;
const CONCURRENCY = 4;
const ZIP_CAP = 2 * 1024 * 1024;
const CSV_CAP = 64 * 1024 * 1024;
const MAX_CLUSTERS = 600;
const RETRY_NEWEST_MS = 60 * 60_000;

/**
 * Return the decompressed bytes of the first entry of a ZIP archive. Reads the
 * central directory so a data-descriptor archive (sizes zero in the local
 * header) still works. Supports stored and deflate entries only.
 */
export function readFirstZipEntry(bytes, maxOutput = CSV_CAP) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let i = buf.length - 22;
    i >= Math.max(0, buf.length - 22 - 65535);
    i--
  ) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip_invalid');
  const entries = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (!entries || centralOffset + 46 > buf.length)
    throw new Error('zip_invalid');
  if (buf.readUInt32LE(centralOffset) !== 0x02014b50)
    throw new Error('zip_invalid');
  const method = buf.readUInt16LE(centralOffset + 10);
  const compressedSize = buf.readUInt32LE(centralOffset + 20);
  const uncompressedSize = buf.readUInt32LE(centralOffset + 24);
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  if (uncompressedSize > maxOutput) throw new Error('zip_too_large');
  if (
    localOffset + 30 > buf.length ||
    buf.readUInt32LE(localOffset) !== 0x04034b50
  )
    throw new Error('zip_invalid');
  const dataStart =
    localOffset +
    30 +
    buf.readUInt16LE(localOffset + 26) +
    buf.readUInt16LE(localOffset + 28);
  if (dataStart + compressedSize > buf.length) throw new Error('zip_invalid');
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data, { maxOutputLength: maxOutput });
  throw new Error('zip_unsupported');
}

/** Slice timestamps (epoch ms, quarter-hour aligned) for the 24 h window ending at `nowMs`. */
export function expectedSlices(nowMs) {
  const newest = Math.floor((nowMs - PUBLISH_LAG_MS) / SLICE_MS) * SLICE_MS;
  return Array.from({ length: WINDOW_SLICES }, (_, i) => newest - i * SLICE_MS);
}

/** Rolling 24 h GDELT protest clusters at `/api/unrest`. */
export function unrestProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  /** @type {Map<number, Array>} slice start (ms) to protest events */
  const slices = new Map();
  /** @type {Map<number, number>} slice start to time it was found missing */
  const missing = new Map();
  let refreshing = null;
  let lastAttempt = -Infinity;
  let lastSuccess = null;
  let lastFailure = false;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function loadSlice(ts) {
    const url = `${EXPORT_BASE}${formatGdeltTimestamp(ts)}.export.CSV.zip`;
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (response.status === 404) {
      await response.body?.cancel();
      missing.set(ts, now());
      return;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream_unavailable');
    }
    const zip = await readResponseBytesCapped(response, ZIP_CAP, signal);
    const csv = readFirstZipEntry(zip);
    slices.set(ts, parseProtestEvents(Buffer.from(csv).toString('utf8')));
    missing.delete(ts);
  }

  async function refresh() {
    lastAttempt = now();
    const wanted = expectedSlices(now());
    const oldest = wanted[wanted.length - 1];
    for (const ts of [...slices.keys()]) if (ts < oldest) slices.delete(ts);
    for (const ts of [...missing.keys()]) if (ts < oldest) missing.delete(ts);
    const todo = wanted.filter((ts) => {
      if (slices.has(ts)) return false;
      const checked = missing.get(ts);
      // An old slice that is absent stays absent; a recent one may still be published.
      return (
        checked == null ||
        (now() - ts < RETRY_NEWEST_MS && now() - checked > REFRESH_MS)
      );
    });
    let failures = 0;
    const queue = [...todo];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length) {
          const ts = queue.shift();
          try {
            await loadSlice(ts);
          } catch {
            failures++;
          }
        }
      }),
    );
    lastFailure = failures > 0 && failures === todo.length && todo.length > 0;
    if (!lastFailure) lastSuccess = now();
  }

  function ensureRefresh() {
    if (refreshing) return refreshing;
    if (now() - lastAttempt < REFRESH_MS) return null;
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function describe() {
    const wanted = expectedSlices(now());
    const loaded = wanted.filter((ts) => slices.has(ts));
    const absent = wanted.filter((ts) => missing.has(ts)).length;
    const events = loaded.flatMap((ts) => slices.get(ts));
    const clusters = clusterProtestEvents(events).slice(0, MAX_CLUSTERS);
    const newest = loaded.length ? Math.max(...loaded) : null;
    const unavailable = loaded.length === 0;
    return {
      schemaVersion: 1,
      source: 'GDELT 2.0 events export',
      attribution: 'The GDELT Project',
      mode: 'export',
      coverage:
        'Protest-coded events (CAMEO root 14) with city or region precision, last 24 hours.',
      fetchedAt: lastSuccess,
      newestSliceAt: newest,
      windowHours: 24,
      slicesExpected: wanted.length - absent,
      slicesLoaded: loaded.length,
      stale: !unavailable && (lastFailure || newest < now() - 2 * 60 * 60_000),
      unavailable,
      reason: unavailable ? 'GDELT events export unavailable' : null,
      clusters: unavailable ? [] : clusters,
    };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    if (req.url !== '/' && req.url !== '')
      return json(400, { error: 'invalid_unrest_query' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const pending = ensureRefresh();
    if (pending) {
      // The first request waits for the 24 h backfill, bounded; later ones
      // answer from memory while the refresh continues.
      const first = slices.size === 0;
      await Promise.race([
        pending.catch(() => {}),
        new Promise((resolve) =>
          setTimeout(resolve, first ? FIRST_LOAD_BUDGET_MS : 0),
        ),
      ]);
    }
    json(200, describe());
  }

  return {
    name: 'unrest',
    configureServer({ middlewares }) {
      middlewares.use('/api/unrest', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/unrest', handler);
    },
  };
}
