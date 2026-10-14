import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

// ReliefWeb API v2. Since late 2025 an approved appname is required (a made-up
// one is answered with HTTP 403), so the name comes from the environment and
// the proxy reports `keyRequired` honestly when it is absent.
const API_URL = 'https://api.reliefweb.int/v2/disasters';
const STATUSES = Object.freeze(['ongoing', 'alert']);
const FIELDS = Object.freeze([
  'name',
  'status',
  'glide',
  'type',
  'type.code',
  'type.primary',
  'country',
  'country.iso3',
  'country.primary',
  'country.location',
  'date',
  'url',
]);
const TTL_MS = 6 * 3600_000;
const STALE_LIMIT_MS = 24 * 3600_000;
const RESPONSE_CAP = 4 * 1024 * 1024;
const APPNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

/** Build one fixed-origin ReliefWeb request URL. */
export function reliefWebUrl(appname, status) {
  const url = new URL(API_URL);
  url.searchParams.set('appname', appname);
  url.searchParams.set('filter[field]', 'status');
  url.searchParams.set('filter[value]', status);
  for (const field of FIELDS)
    url.searchParams.append('fields[include][]', field);
  url.searchParams.set('sort[]', 'date.event:desc');
  url.searchParams.set('limit', '200');
  return url.href;
}

/** ReliefWeb disasters at `/api/crises`, cached for six hours. */
export function crisesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
} = {}) {
  let cache = null;
  let inFlight = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function load(appname) {
    const data = [];
    for (const status of STATUSES) {
      const signal = AbortSignal.timeout(20_000);
      const response = await fetchImpl(reliefWebUrl(appname, status), {
        signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`reliefweb_http_${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await readResponseJsonCapped(
        response,
        RESPONSE_CAP,
        signal,
      );
      if (!Array.isArray(payload?.data))
        throw new Error('invalid_reliefweb_payload');
      data.push(...payload.data);
    }
    return { fetchedAt: now(), data };
  }

  function describe(extra) {
    return {
      schemaVersion: 1,
      source: 'ReliefWeb',
      attribution: 'ReliefWeb · UN OCHA',
      coverage: 'Disasters ReliefWeb lists as ongoing or on alert.',
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
    const appname = String(env.RELIEFWEB_APPNAME || '').trim();
    if (!APPNAME_PATTERN.test(appname)) {
      return describe({
        unavailable: true,
        keyRequired: true,
        data: [],
        reason:
          'ReliefWeb now requires an approved appname. Set RELIEFWEB_APPNAME to enable this layer.',
      });
    }
    if (cache && now() - cache.fetchedAt < TTL_MS) return describe({});
    if (!inFlight) {
      inFlight = load(appname)
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
    } catch (error) {
      if (cache && now() - cache.fetchedAt < STALE_LIMIT_MS)
        return describe({
          stale: true,
          reason: 'Cached data; ReliefWeb unavailable',
        });
      return describe({
        unavailable: true,
        keyRequired: error?.status === 403,
        data: [],
        reason:
          error?.status === 403
            ? 'ReliefWeb rejected the configured appname'
            : 'ReliefWeb unavailable',
      });
    }
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
