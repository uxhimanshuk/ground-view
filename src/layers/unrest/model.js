import {
  formatAge,
  formatCount,
  formatUtcDateTime,
  hostLabel,
  shortPlace,
} from '../pulse/format.js';

export const UNREST_ACCENT = '#f2a65a';
export const UNREST_OUTLINE = '#6b3410';
export const UNREST_RECENT_MS = 3_600_000;
export const UNREST_CAVEAT =
  'Machine-coded from news reports. Counts reflect coverage, not crowd size.';

/** Marker diameter in pixels, growing with log(count). */
export function unrestPointSize(count) {
  const size = 6 + 3.2 * Math.log2(Math.max(1, count));
  return Math.round(Math.min(26, size) * 10) / 10;
}

/** A cluster reported on in the last hour. */
export function isRecentUnrest(row, nowMs) {
  const updated = Date.parse(row.updatedAt);
  return Number.isFinite(updated) && nowMs - updated <= UNREST_RECENT_MS;
}

/** Point style for one cluster: calm warm colour, a static halo when recent. */
export function unrestStyle(row, nowMs) {
  const pixelSize = unrestPointSize(row.count);
  return {
    pixelSize,
    color: UNREST_ACCENT,
    outline: UNREST_OUTLINE,
    ...(isRecentUnrest(row, nowMs)
      ? { ring: { pixelSize: pixelSize + 12, color: UNREST_ACCENT } }
      : {}),
  };
}

/** Ambient label for the busiest clusters. */
export function unrestLabel(row) {
  return {
    title: `${shortPlace(row.placeName)} · ${row.count}`,
    accent: UNREST_ACCENT,
    priority: row.count,
  };
}

/** Card model for one cluster. */
export function buildUnrestCard(row, meta, nowMs) {
  const lines = [
    `${formatCount(row.count)} report${row.count === 1 ? '' : 's'} in 24h` +
      (row.events ? ` · ${formatCount(row.events)} coded events` : ''),
  ];
  const age = formatAge(nowMs - Date.parse(row.updatedAt));
  if (age) lines.push(`Latest report ${age} ago`);
  return {
    title: `UNREST · ${row.placeName}`,
    subtitle: row.country || undefined,
    accent: UNREST_ACCENT,
    lines,
    links: row.sampleUrls.map((href) => ({
      text: `${hostLabel(href)} ↗`,
      href,
    })),
    source: 'GDELT 2.0 events export',
    asOf: formatUtcDateTime(meta?.newestSliceAt ?? Date.parse(row.updatedAt)),
    caveat: UNREST_CAVEAT,
  };
}

/** JSON-safe analyst record. `value` is the 24 h report count. */
export function mapUnrestAnalystRecord(row) {
  return {
    id: row.stableId,
    kind: 'unrest',
    name: row.placeName,
    country: row.country,
    value: row.count,
    unit: 'reports',
    count: row.count,
    events: row.events,
    placeName: row.placeName,
    updatedMs: Date.parse(row.updatedAt),
    lat: row.lat,
    lon: row.lon,
  };
}

/** Feed-state fields: the export is the fallback path, a partial window is partial. */
export function unrestStats(meta) {
  const expected = meta.slicesExpected || 0;
  return {
    stale: meta.stale === true,
    fallback: meta.mode !== 'geo',
    partial: expected > 0 && meta.slicesLoaded < Math.ceil(expected * 0.75),
    coverage:
      meta.mode === 'geo'
        ? 'GDELT GEO 2.0'
        : 'GDELT 2.0 15-minute export (GEO API unavailable)',
    asOf: meta.newestSliceAt,
  };
}
