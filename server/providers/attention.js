import { readResponseTextCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { LANGUAGE_HEARTLANDS } from '../../src/layers/attention/heartlands.js';

// Wikimedia answers the pageviews API without CORS for requests that carry a
// custom Api-User-Agent header (the preflight returns HTTP 405), so the
// browser asks this fixed-origin proxy, which sends the descriptive header
// Wikimedia asks automated clients to use.
const API_ROOT = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/';
const API_USER_AGENT =
  'ground-view/0.1 (aggregate Wikipedia pageview globe; local proxy; keyless)';
const CODES = new Set(LANGUAGE_HEARTLANDS.map((h) => h.code));
const ROUTE = /^\/([a-z]{2,3})\/(\d{4})\/(\d{2})\/(\d{2})$/;
const OK_TTL_MS = 6 * 3600_000;
const MISSING_TTL_MS = 10 * 60_000;
const RESPONSE_CAP = 512 * 1024;
const MAX_ENTRIES = 256;

const SNAPSHOT_ARTICLES = 60;
const SNAPSHOT_CONCURRENCY = 3;
// Wikimedia throttles bursts from shared CI addresses: retry 429 and 5xx with backoff.
const SNAPSHOT_ATTEMPTS = 4;
const SNAPSHOT_DAYS_BACK = 2;

const two = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Yesterday's top-article lists for every heartland edition, for the static
 * snapshot. Each list is trimmed to its first articles (the browser keeps the
 * top five after dropping utility pages). Falls back one more day when an
 * edition has not published; an edition that fails is left out. Throws when
 * no edition answers.
 */
export async function buildAttentionSnapshot({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  retryDelayMs = 1_000,
  heartlands = LANGUAGE_HEARTLANDS,
} = {}) {
  const nowMs = now();
  const editions = {};
  const queue = [...heartlands];
  const failed = [];
  async function one(h) {
    for (let back = 1; back <= SNAPSHOT_DAYS_BACK; back++) {
      const d = new Date(nowMs - back * 86_400_000);
      const path = `${h.code}.wikipedia/all-access/${d.getUTCFullYear()}/${two(d.getUTCMonth() + 1)}/${two(d.getUTCDate())}`;
      const signal = AbortSignal.timeout(20_000);
      let response;
      for (let attempt = 1; ; attempt++) {
        response = await fetchImpl(`${API_ROOT}${path}`, {
          signal,
          redirect: 'error',
          headers: {
            'Api-User-Agent': API_USER_AGENT,
            Accept: 'application/json',
          },
        });
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= SNAPSHOT_ATTEMPTS) break;
        await response.body?.cancel();
        await sleep(retryDelayMs * attempt);
      }
      if (response.status === 404) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('upstream_unavailable');
      }
      const payload = JSON.parse(
        await readResponseTextCapped(response, RESPONSE_CAP, signal),
      );
      const item = payload?.items?.[0];
      if (!item || !Array.isArray(item.articles))
        throw new Error('invalid_attention_payload');
      return {
        items: [
          {
            year: item.year,
            month: item.month,
            day: item.day,
            articles: item.articles.slice(0, SNAPSHOT_ARTICLES),
          },
        ],
      };
    }
    throw new Error('no_pageview_data');
  }
  await Promise.all(
    Array.from({ length: SNAPSHOT_CONCURRENCY }, async () => {
      while (queue.length) {
        const h = queue.shift();
        try {
          editions[h.code] = await one(h);
        } catch {
          failed.push(h.code);
        }
      }
    }),
  );
  if (!Object.keys(editions).length) throw new Error('attention_unavailable');
  return {
    schemaVersion: 1,
    source: 'Wikimedia pageviews',
    attribution: 'Wikimedia Foundation',
    fetchedAt: nowMs,
    failed: failed.sort(),
    editions,
  };
}

/** Cached pass-through of daily top-article lists at `/api/attention/{code}/{yyyy}/{mm}/{dd}`. */
export function attentionProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 240,
    globalMax: 2400,
  });

  async function load(code, y, m, d) {
    const url = `${API_ROOT}${code}.wikipedia/all-access/${y}/${m}/${d}`;
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { 'Api-User-Agent': API_USER_AGENT, Accept: 'application/json' },
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: 404, body: '{"error":"not_found"}' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream_unavailable');
    }
    const body = await readResponseTextCapped(response, RESPONSE_CAP, signal);
    JSON.parse(body);
    return { status: 200, body };
  }

  async function handler(req, res) {
    const send = (status, body, headers = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...headers,
      });
      res.end(body);
    };
    if (req.method !== 'GET')
      return send(405, '{"error":"method_not_allowed"}');
    const match = ROUTE.exec((req.url || '').split('?')[0]);
    if (!match || !CODES.has(match[1]))
      return send(400, '{"error":"invalid_attention_query"}');
    const [, code, y, m, d] = match;
    const date = Date.UTC(+y, +m - 1, +d);
    if (
      !Number.isFinite(date) ||
      date > now() ||
      now() - date > 10 * 86_400_000
    )
      return send(400, '{"error":"invalid_attention_date"}');
    if (!allow(clientKey(req)))
      return send(429, '{"error":"rate_limited"}', { 'Retry-After': '60' });
    const key = `${code}/${y}/${m}/${d}`;
    const hit = cache.get(key);
    if (
      hit &&
      now() - hit.savedAt < (hit.status === 200 ? OK_TTL_MS : MISSING_TTL_MS)
    )
      return send(hit.status, hit.body);
    try {
      if (!inFlight.has(key)) {
        inFlight.set(
          key,
          load(code, y, m, d).finally(() => inFlight.delete(key)),
        );
      }
      const value = await inFlight.get(key);
      cache.delete(key);
      cache.set(key, { ...value, savedAt: now() });
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
      send(value.status, value.body);
    } catch {
      if (hit?.status === 200)
        return send(200, hit.body, { 'X-Data-Stale': 'true' });
      send(502, '{"error":"attention_unavailable"}');
    }
  }

  return {
    name: 'attention',
    configureServer({ middlewares }) {
      middlewares.use('/api/attention', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/attention', handler);
    },
  };
}
