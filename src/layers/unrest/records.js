import { safeNewsUrl } from '../../data/gdeltUnrest.js';

const MAX_CLUSTERS = 1000;

/**
 * Validate the `/api/unrest` payload before it can replace the last good
 * snapshot. Returns null for a malformed payload. Actor fields are not part
 * of the contract: any other key on a cluster is dropped.
 * @param {object} payload Parsed JSON from the proxy.
 * @returns {?{rows: Array, meta: object}}
 */
export function normalizeUnrestSnapshot(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.clusters) ||
    payload.clusters.length > MAX_CLUSTERS
  )
    return null;
  const rows = [];
  const ids = new Set();
  for (const cluster of payload.clusters) {
    if (
      !cluster ||
      typeof cluster.stableId !== 'string' ||
      !cluster.stableId ||
      ids.has(cluster.stableId) ||
      !Number.isFinite(cluster.lon) ||
      Math.abs(cluster.lon) > 180 ||
      !Number.isFinite(cluster.lat) ||
      Math.abs(cluster.lat) > 90 ||
      !Number.isInteger(cluster.count) ||
      cluster.count < 1 ||
      typeof cluster.placeName !== 'string' ||
      !cluster.placeName ||
      !Array.isArray(cluster.sampleUrls) ||
      !Number.isFinite(Date.parse(cluster.updatedAt))
    )
      return null;
    ids.add(cluster.stableId);
    rows.push({
      stableId: cluster.stableId,
      lon: cluster.lon,
      lat: cluster.lat,
      placeName: cluster.placeName.slice(0, 160),
      country:
        typeof cluster.country === 'string' && cluster.country
          ? cluster.country.slice(0, 80)
          : null,
      count: cluster.count,
      events: Number.isInteger(cluster.events) ? cluster.events : null,
      sampleUrls: cluster.sampleUrls
        .map(safeNewsUrl)
        .filter(Boolean)
        .slice(0, 3),
      updatedAt: new Date(Date.parse(cluster.updatedAt)).toISOString(),
    });
  }
  const finite = (value) => (Number.isFinite(value) ? value : null);
  return {
    rows,
    meta: {
      source: typeof payload.source === 'string' ? payload.source : 'GDELT 2.0',
      mode: payload.mode === 'geo' ? 'geo' : 'export',
      fetchedAt: finite(payload.fetchedAt),
      newestSliceAt: finite(payload.newestSliceAt),
      slicesLoaded: finite(payload.slicesLoaded),
      slicesExpected: finite(payload.slicesExpected),
      stale: payload.stale === true,
      unavailable: payload.unavailable === true,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    },
  };
}
