export const CRISIS_FAMILIES = Object.freeze([
  'flood',
  'epidemic',
  'conflict',
  'drought',
  'storm',
  'other',
]);

const MAX_DISASTERS = 600;

/** Group a ReliefWeb disaster type name into one of the display families. */
export function crisisFamily(typeName) {
  const name = String(typeName ?? '').toLowerCase();
  if (/flood|storm surge/.test(name)) return 'flood';
  if (/epidemic/.test(name)) return 'epidemic';
  if (/complex emergency|conflict/.test(name)) return 'conflict';
  if (/drought/.test(name)) return 'drought';
  if (/cyclone|storm|typhoon|hurricane/.test(name)) return 'storm';
  return 'other';
}

function reliefWebUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'reliefweb.int' ||
        url.hostname.endsWith('.reliefweb.int'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const finiteIn = (value, limit) =>
  Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * Validate the `/api/crises` payload (ReliefWeb v2 `disasters` records wrapped
 * by the proxy) before it can replace the last good snapshot. A disaster whose
 * primary country has no centroid cannot be placed and is skipped; a record
 * with no usable name or id makes the whole payload malformed.
 * @param {object} payload Parsed JSON from the proxy.
 * @returns {?{rows: Array, meta: object}}
 */
export function normalizeCrisesSnapshot(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.data) ||
    payload.data.length > MAX_DISASTERS
  )
    return null;
  const rows = [];
  const ids = new Set();
  for (const record of payload.data) {
    const fields = record?.fields;
    const id = record?.id ?? fields?.id;
    if (
      !fields ||
      id == null ||
      typeof fields.name !== 'string' ||
      !fields.name.trim()
    )
      return null;
    const stableId = `crisis:${id}`;
    if (ids.has(stableId)) continue;
    const countries = Array.isArray(fields.country) ? fields.country : [];
    const primary = countries.find((c) => c?.primary) || countries[0];
    const lat = primary?.location?.lat;
    const lon = primary?.location?.lon;
    if (!finiteIn(lat, 90) || !finiteIn(lon, 180)) continue;
    const types = Array.isArray(fields.type) ? fields.type : [];
    const type = (types.find((t) => t?.primary) || types[0])?.name;
    const dateText = fields.date?.event || fields.date?.created || null;
    const dateMs = Date.parse(dateText);
    ids.add(stableId);
    rows.push({
      stableId,
      name: fields.name.trim().slice(0, 200),
      type: typeof type === 'string' ? type : 'Other',
      family: crisisFamily(type),
      status: typeof fields.status === 'string' ? fields.status : 'unknown',
      countries: countries
        .map((c) => (typeof c?.name === 'string' ? c.name : null))
        .filter(Boolean)
        .slice(0, 12),
      country: typeof primary?.name === 'string' ? primary.name : null,
      lon,
      lat,
      date: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null,
      url: reliefWebUrl(fields.url),
    });
  }
  return {
    rows,
    meta: {
      source: 'ReliefWeb',
      fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
      stale: payload.stale === true,
      unavailable: payload.unavailable === true,
      keyRequired: payload.keyRequired === true,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    },
  };
}
