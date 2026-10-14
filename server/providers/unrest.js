import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { createGdeltSlices, readFirstZipEntry } from './gdelt/slices.js';
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
const SLICE_MS = 15 * 60_000;
const WINDOW_SLICES = 96; // 24 hours
const PUBLISH_LAG_MS = 2 * 60_000;
const REFRESH_MS = 5 * 60_000;
const FIRST_LOAD_BUDGET_MS = 25_000;
const CONCURRENCY = 4;
export { readFirstZipEntry };

const MAX_CLUSTERS = 600;
const RETRY_NEWEST_MS = 60 * 60_000;

/** Slice timestamps (epoch ms, quarter-hour aligned) for the 24 h window ending at `nowMs`. */
export function expectedSlices(nowMs) {
  const newest = Math.floor((nowMs - PUBLISH_LAG_MS) / SLICE_MS) * SLICE_MS;
  return Array.from({ length: WINDOW_SLICES }, (_, i) => newest - i * SLICE_MS);
}

/** The cached refresh-and-describe core shared by the proxy and the snapshot script. */
export function createUnrestCore({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  // Pass one shared hub to every GDELT proxy so a slice downloads once.
  gdelt = createGdeltSlices({ fetchImpl, now }),
} = {}) {
  gdelt.register('unrest', (csv) => parseProtestEvents(csv));
  /** @type {Map<number, number>} slice start to time it was found missing */
  const missing = new Map();
  let refreshing = null;
  let lastAttempt = -Infinity;
  let lastSuccess = null;
  let lastFailure = false;

  async function loadSlice(ts) {
    if ((await gdelt.load(ts)) === 'missing') {
      missing.set(ts, now());
      return;
    }
    missing.delete(ts);
  }

  async function refresh() {
    lastAttempt = now();
    const wanted = expectedSlices(now());
    const oldest = wanted[wanted.length - 1];
    gdelt.prune('unrest', oldest);
    for (const ts of [...missing.keys()]) if (ts < oldest) missing.delete(ts);
    const todo = wanted.filter((ts) => {
      if (gdelt.has('unrest', ts)) return false;
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
    const loaded = wanted.filter((ts) => gdelt.has('unrest', ts));
    const absent = wanted.filter((ts) => missing.has(ts)).length;
    const events = loaded.flatMap((ts) => gdelt.get('unrest', ts));
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

  return {
    refresh,
    ensureRefresh,
    describe,
    hasData: () => gdelt.count('unrest') > 0,
  };
}

/**
 * One complete payload for the static snapshot: downloads the whole 24 h window
 * (no first-load budget) and describes it. Pass a shared `gdelt` hub to reuse
 * downloads with the news-tone snapshot.
 */
export async function buildUnrestSnapshot(options = {}) {
  const core = createUnrestCore(options);
  await core.refresh();
  return core.describe();
}

/** Rolling 24 h GDELT protest clusters at `/api/unrest`. */
export function unrestProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  gdelt = createGdeltSlices({ fetchImpl, now }),
} = {}) {
  const core = createUnrestCore({ fetchImpl, now, gdelt });
  const { ensureRefresh, describe } = core;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

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
      const first = !core.hasData();
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
