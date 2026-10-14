export const EVENT_TYPES = Object.freeze(['EQ', 'TC', 'FL', 'VO', 'DR', 'WF']);
export const ALERT_LEVELS = Object.freeze(['green', 'orange', 'red']);

const MAX_EVENTS = 800;

const finiteIn = (value, limit) =>
  Number.isFinite(value) && Math.abs(value) <= limit;

function gdacsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'gdacs.org' || url.hostname.endsWith('.gdacs.org'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** GDACS dates are UTC without a zone suffix. */
function toIso(text) {
  if (typeof text !== 'string' || !text) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Validate the `/api/crises` payload (GDACS GeoJSON features wrapped by the
 * proxy) before it can replace the last good snapshot. Several episodes of one
 * event collapse to the most recently ended one; a feature without a point or
 * a known hazard type is skipped; a feature with no event id makes the whole
 * payload malformed.
 * @param {object} payload Parsed JSON from the proxy.
 * @returns {?{rows: Array, meta: object}}
 */
export function normalizeCrisesSnapshot(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 2 ||
    !Array.isArray(payload.data) ||
    payload.data.length > MAX_EVENTS
  )
    return null;
  const byId = new Map();
  for (const feature of payload.data) {
    const props = feature?.properties;
    if (!props || props.eventid == null) return null;
    const eventType = String(props.eventtype ?? '').toUpperCase();
    const alertLevel = String(props.alertlevel ?? '').toLowerCase();
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (
      !EVENT_TYPES.includes(eventType) ||
      !ALERT_LEVELS.includes(alertLevel) ||
      feature.geometry?.type !== 'Point' ||
      !finiteIn(lat, 90) ||
      !finiteIn(lon, 180)
    )
      continue;
    const name = String(props.name || props.eventname || '').trim();
    if (!name) continue;
    const stableId = `gdacs:${eventType}:${props.eventid}`;
    const affected = (
      Array.isArray(props.affectedcountries) ? props.affectedcountries : []
    )
      .map((c) => (typeof c?.countryname === 'string' ? c.countryname : null))
      .filter(Boolean);
    const countries = affected.length
      ? affected
      : String(props.country || '')
          .split(', ')
          .filter(Boolean);
    const row = {
      stableId,
      eventType,
      name: name.slice(0, 200),
      alertLevel,
      country: countries[0] || null,
      countries: countries.slice(0, 40),
      lon,
      lat,
      fromDate: toIso(props.fromdate),
      toDate: toIso(props.todate),
      url: gdacsUrl(props.url?.report),
    };
    const prior = byId.get(stableId);
    if (!prior || String(row.toDate) >= String(prior.toDate))
      byId.set(stableId, row);
  }
  return {
    rows: [...byId.values()],
    meta: {
      source: 'GDACS',
      fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
      generatedAt: Number.isFinite(payload.generatedAt)
        ? payload.generatedAt
        : null,
      stale: payload.stale === true,
      unavailable: payload.unavailable === true,
      keyRequired: false,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    },
  };
}
