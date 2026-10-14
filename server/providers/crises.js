import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

// GDACS (UN OCHA + European Commission JRC) event list, keyless. The API
// answers at most 100 events per request and ignores paging, so Orange and Red
// alerts are fetched in one request and Green alerts one hazard type at a time.
const API_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const EVENT_TYPES = Object.freeze(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF']);
const HIGH_WINDOW_DAYS = 30;
const GREEN_WINDOW_DAYS = 14;
const TTL_MS = 15 * 60_000;
const STALE_LIMIT_MS = 6 * 3600_000;
const RESPONSE_CAP = 4 * 1024 * 1024;
const DAY_MS = 86_400_000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Build one fixed-origin GDACS request URL. */
export function gdacsUrl({ eventTypes, alertLevels, fromMs, toMs }) {
  const url = new URL(API_URL);
  // GDACS expects literal semicolons, so the lists are not percent-encoded.
  return (
    `${url.origin}${url.pathname}?eventlist=${eventTypes.join(';')}` +
    `&fromdate=${isoDay(fromMs)}&todate=${isoDay(toMs)}` +
    `&alertlevel=${alertLevels.join(';')}`
  );
}

/** The request plan: every Orange/Red alert, then recent Green ones by type. */
export function gdacsRequests(nowMs) {
  return [
    gdacsUrl({
      eventTypes: EVENT_TYPES,
      alertLevels: ['Orange', 'Red'],
      fromMs: nowMs - HIGH_WINDOW_DAYS * DAY_MS,
      toMs: nowMs,
    }),
    ...EVENT_TYPES.map((type) =>
      gdacsUrl({
        eventTypes: [type],
        alertLevels: ['Green'],
        fromMs: nowMs - GREEN_WINDOW_DAYS * DAY_MS,
        toMs: nowMs,
      }),
    ),
  ];
}

/** The cached GDACS loader shared by the proxy and the snapshot script. */
export function createCrisesCore({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  let cache = null;
  let inFlight = null;

  async function loadOne(requestUrl) {
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(requestUrl, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(`gdacs_http_${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await readResponseJsonCapped(
      response,
      RESPONSE_CAP,
      signal,
    );
    if (!Array.isArray(payload?.features))
      throw new Error('invalid_gdacs_payload');
    return payload.features;
  }

  async function load() {
    const settled = await Promise.allSettled(gdacsRequests(now()).map(loadOne));
    // The Orange/Red request is the one that matters: without it, fail.
    if (settled[0].status === 'rejected') throw settled[0].reason;
    const data = settled.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );
    return { fetchedAt: now(), data };
  }

  function describe(extra) {
    return {
      schemaVersion: 2,
      source: 'GDACS',
      attribution: 'GDACS · United Nations and European Commission JRC',
      coverage:
        'Earthquakes, cyclones, floods, volcanoes, droughts and forest fires GDACS has alerted on.',
      fetchedAt: cache?.fetchedAt ?? null,
      stale: false,
      unavailable: false,
      keyRequired: false,
      reason: null,
      data: cache?.data ?? [],
      ...extra,
    };
  }

  async function snapshot() {
    if (cache && now() - cache.fetchedAt < TTL_MS) return describe({});
    if (!inFlight) {
      inFlight = load()
        .then((value) => {
          cache = value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    try {
      await inFlight;
      return describe({});
    } catch {
      if (cache && now() - cache.fetchedAt < STALE_LIMIT_MS)
        return describe({
          stale: true,
          reason: 'Cached data; GDACS unavailable',
        });
      return describe({
        unavailable: true,
        data: [],
        reason: 'GDACS unavailable',
      });
    }
  }

  return { snapshot };
}

/** One fresh GDACS payload for the static snapshot; throws if GDACS is down. */
export async function buildCrisesSnapshot(options = {}) {
  const payload = await createCrisesCore(options).snapshot();
  if (payload.unavailable)
    throw new Error(payload.reason || 'crises_unavailable');
  return payload;
}

/** GDACS disaster alerts at `/api/crises`, cached for fifteen minutes. */
export function crisesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const { snapshot } = createCrisesCore({ fetchImpl, now });
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
      return json(400, { error: 'invalid_crises_query' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    json(200, await snapshot());
  }

  return {
    name: 'crises',
    configureServer({ middlewares }) {
      middlewares.use('/api/crises', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/crises', handler);
    },
  };
}
