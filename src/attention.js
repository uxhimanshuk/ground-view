// Top reads per Wikipedia edition per day, fetched straight from Wikimedia.
// No custom headers: they would trigger a CORS preflight that Wikimedia rejects.
import { isArticleTitle } from './heartlands.js';

export const TOP_N = 25;
export const MAX_IN_FLIGHT = 6;
const DAY_MS = 86_400_000;
const TOP_URL = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/';

const two = (n) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` for the UTC day `daysBack` before `nowMs`. */
export function pageviewDay(nowMs, daysBack = 0) {
  const d = new Date(nowMs - daysBack * DAY_MS);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** Shift an ISO date string by whole days. */
export function shiftDay(iso, delta) {
  return pageviewDay(Date.parse(`${iso}T00:00:00Z`), -delta);
}

export function yesterdayUtc(nowMs = Date.now()) {
  return pageviewDay(nowMs, 1);
}

/** Titles that are never articles: separators, empty or punctuation-only. */
export function isJunkTitle(title) {
  if (typeof title !== 'string') return true;
  const t = title.replace(/_/g, ' ').trim();
  if (!t) return true;
  return !/[\p{L}\p{N}]/u.test(t);
}

/**
 * Keep articles only: hide the edition's main page, namespaced project pages,
 * Special: pages and junk. No filtering on topic.
 * @returns {{title:string, views:number, rank:number}[]} in rank order
 */
export function filterArticles(heartland, articles, limit = TOP_N) {
  const out = [];
  if (!Array.isArray(articles)) return out;
  for (const entry of articles) {
    if (out.length >= limit) break;
    if (typeof entry?.article !== 'string' || !Number.isFinite(entry.views))
      continue;
    if (isJunkTitle(entry.article)) continue;
    if (!isArticleTitle(entry.article, heartland)) continue;
    out.push({
      title: entry.article.replace(/_/g, ' '),
      slug: entry.article,
      views: Math.floor(entry.views),
      rank: out.length + 1,
    });
  }
  return out;
}

/** Pull the article list out of a Wikimedia top payload; null if malformed. */
export function parseTop(payload) {
  const item = payload?.items?.[0];
  return item && Array.isArray(item.articles) ? item.articles : null;
}

export function sumViews(items, n = 10) {
  return items.slice(0, n).reduce((s, i) => s + i.views, 0);
}

export function articleUrl(code, slug) {
  return `https://${code}.wikipedia.org/wiki/${encodeURIComponent(slug)}`;
}

/** At most `max` tasks in flight at once, across everything that uses it. */
export function createLimiter(max = MAX_IN_FLIGHT) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= max || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  const run = (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
  run.stats = () => ({ active, waiting: waiting.length });
  return run;
}

/**
 * Create a loader with an in-memory cache keyed by (code, date).
 * loadEdition resolves to {code, date, requested, fellBack, items} or throws.
 * An edition that 404s for the day falls back one more day.
 */
export function createAttention({
  fetchImpl = (...a) => globalThis.fetch(...a),
  limit = createLimiter(),
} = {}) {
  const cache = new Map();

  async function fetchDay(heartland, date) {
    const url = `${TOP_URL}${heartland.code}.wikipedia/all-access/${date.replace(/-/g, '/')}`;
    const res = await limit(() => fetchImpl(url));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const articles = parseTop(await res.json());
    if (!articles) throw new Error('Malformed response');
    const items = filterArticles(heartland, articles);
    if (!items.length) throw new Error('No articles');
    return items;
  }

  function loadEdition(heartland, requested) {
    const key = `${heartland.code}|${requested}`;
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      let items = await fetchDay(heartland, requested);
      let date = requested;
      let fellBack = false;
      if (!items) {
        date = shiftDay(requested, -1);
        items = await fetchDay(heartland, date);
        fellBack = true;
        if (!items) throw new Error('No data for the last two days');
      }
      return { code: heartland.code, date, requested, fellBack, items };
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    return p;
  }

  return { loadEdition, limit };
}
