import { LANGUAGE_HEARTLANDS } from './heartlands.js';
import { normalizeTopArticles } from './records.js';
import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  STATIC_MODE,
  isSnapshotStale,
  snapshotUrl,
} from '../../sources/snapshots.js';

// Wikimedia's pageviews API answers a custom Api-User-Agent header without CORS
// (its preflight returns 405), so the same-origin proxy sends that header.
const API_ROOT = '/api/attention/';
const RESPONSE_LIMIT = 512 * 1024;
const SNAPSHOT_LIMIT = 2 * 1024 * 1024;
const DAY_MS = 86_400_000;
const CONCURRENCY = 6;
/** Yesterday (UTC) first, then one more day back if the edition has not published. */
const MAX_DAYS_BACK = 2;

const two = (n) => String(n).padStart(2, '0');

/** The `yyyy/mm/dd` path segment for the UTC day `daysBack` before `nowMs`. */
export function pageviewDay(nowMs, daysBack) {
  const d = new Date(nowMs - daysBack * DAY_MS);
  return `${d.getUTCFullYear()}/${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}`;
}

/**
 * Request yesterday's most-read articles for each large Wikipedia edition.
 * Results are cached per UTC day, so the layer's refresh cadence does not
 * repeat requests within a day. A failed edition is omitted and reported as
 * `partial`; the call fails only when no edition answers.
 */
export function createWikimediaAttentionSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  heartlands = LANGUAGE_HEARTLANDS,
  useSnapshot = STATIC_MODE,
  url = snapshotUrl('attention.json'),
} = {}) {
  let cached = null;

  /** The static demo: one file holds yesterday's trimmed list for every edition. */
  async function readSnapshot(signal) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok)
      throw new Error(`Attention snapshot HTTP ${response.status}`);
    const payload = await readResponseJsonCapped(
      response,
      SNAPSHOT_LIMIT,
      signal,
    );
    if (payload?.schemaVersion !== 1 || typeof payload.editions !== 'object')
      throw new Error('Malformed attention snapshot');
    const rows = [];
    let failures = 0;
    for (const heartland of heartlands) {
      const row = normalizeTopArticles(
        heartland,
        payload.editions[heartland.code],
      );
      if (row) rows.push(row);
      else failures++;
    }
    if (!rows.length) throw new Error('Wikimedia pageviews unavailable');
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return {
      rows,
      meta: {
        source: 'Wikimedia pageviews',
        date: rows.map((row) => row.date).sort()[0],
        fetchedAt: payload.fetchedAt,
        generatedAt: payload.generatedAt,
        stale: isSnapshotStale(payload.generatedAt, now()),
        partial: failures > 0,
        failed: failures,
        unavailable: false,
      },
    };
  }

  async function fetchEdition(heartland, nowMs, signal) {
    for (let back = 1; back <= MAX_DAYS_BACK; back++) {
      const url = `${API_ROOT}${heartland.code}/${pageviewDay(nowMs, back)}`;
      const response = await fetchImpl(url, { signal });
      if (response.status === 404) {
        await response.body?.cancel?.();
        continue;
      }
      if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        RESPONSE_LIMIT,
        signal,
      );
      const row = normalizeTopArticles(heartland, payload);
      if (!row) throw new Error('Malformed Wikimedia response');
      return row;
    }
    throw new Error('No pageview data for the last two days');
  }

  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      if (useSnapshot) return readSnapshot(signal);
      const nowMs = now();
      const dayKey = pageviewDay(nowMs, 1);
      if (cached?.dayKey === dayKey && !cached.meta.partial)
        return cached.value;
      const rows = [];
      const queue = [...heartlands];
      let failures = 0;
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          while (queue.length) {
            const heartland = queue.shift();
            try {
              rows.push(await fetchEdition(heartland, nowMs, signal));
            } catch (error) {
              signal?.throwIfAborted();
              failures++;
            }
          }
        }),
      );
      signal?.throwIfAborted();
      if (!rows.length) throw new Error('Wikimedia pageviews unavailable');
      rows.sort((a, b) => a.code.localeCompare(b.code));
      const value = {
        rows,
        meta: {
          source: 'Wikimedia pageviews',
          date: rows.map((row) => row.date).sort()[0],
          fetchedAt: nowMs,
          partial: failures > 0,
          failed: failures,
          unavailable: false,
        },
      };
      cached = { dayKey, meta: value.meta, value };
      return value;
    },
  };
}
