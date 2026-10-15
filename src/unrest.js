// Protest-report snapshot (GDELT), published hourly by the snapshots workflow.
export const UNREST_URL =
  'https://raw.githubusercontent.com/uxhimanshuk/ground-view/snapshots/unrest.json';
export const STALE_HOURS = 8;

function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** Validate a snapshot. Returns {clusters, fetchedAt, ageHours, stale}. */
export function parseUnrest(json, nowMs = Date.now()) {
  if (!json || !Array.isArray(json.clusters)) throw new Error('Malformed snapshot');
  const clusters = [];
  for (const c of json.clusters) {
    const lon = Number(c?.lon);
    const lat = Number(c?.lat);
    const count = Number(c?.count);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    clusters.push({
      lon,
      lat,
      count: Number.isFinite(count) && count > 0 ? count : 1,
      placeName: typeof c.placeName === 'string' ? c.placeName : 'Unnamed place',
    });
  }
  const fetchedAt = toMs(json.fetchedAt) ?? toMs(json.generatedAt);
  const ageHours = fetchedAt == null ? null : Math.max(0, (nowMs - fetchedAt) / 3_600_000);
  return {
    clusters,
    fetchedAt,
    ageHours,
    stale: ageHours != null && ageHours > STALE_HOURS,
  };
}

export async function loadUnrest({
  fetchImpl = (...a) => globalThis.fetch(...a),
  nowMs = Date.now(),
} = {}) {
  const res = await fetchImpl(UNREST_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseUnrest(await res.json(), nowMs);
}
