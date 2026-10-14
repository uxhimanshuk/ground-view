import { formatUtcDate, formatUtcDateTime } from '../pulse/format.js';

/** Okabe-Ito based palette, distinguishable under common colour-vision deficiencies. */
export const CRISIS_COLORS = Object.freeze({
  flood: '#0072B2',
  epidemic: '#CC79A7',
  conflict: '#D55E00',
  drought: '#E69F00',
  storm: '#56B4E9',
  other: '#BBBBBB',
});
export const CRISIS_FAMILY_LABELS = Object.freeze({
  flood: 'Flood',
  epidemic: 'Epidemic',
  conflict: 'Conflict and displacement',
  drought: 'Drought',
  storm: 'Storm',
  other: 'Other',
});
export const CRISIS_OUTLINE = '#101418';
export const CRISES_CAVEAT =
  'Situations listed by ReliefWeb. Absence here is not absence of need.';

export function crisisStyle(row) {
  return {
    pixelSize: row.status === 'alert' ? 11 : 13,
    color: CRISIS_COLORS[row.family] || CRISIS_COLORS.other,
    outline: CRISIS_OUTLINE,
  };
}

/** Name labels would be long; only the country is shown, and only for the newest situations. */
export function crisisLabel(row) {
  if (!row.country) return null;
  return {
    title: row.country,
    accent: CRISIS_COLORS[row.family] || CRISIS_COLORS.other,
    priority: Number.isFinite(Date.parse(row.date)) ? Date.parse(row.date) : 0,
  };
}

export function buildCrisisCard(row, meta) {
  const lines = [
    `${row.type} · ${row.status}`,
    `Started ${formatUtcDate(Date.parse(row.date)) || 'date not listed'}`,
  ];
  if (row.countries.length > 1)
    lines.push(`Countries: ${row.countries.join(', ')}`);
  return {
    title: `CRISIS · ${row.name}`,
    subtitle: row.country || undefined,
    accent: CRISIS_COLORS[row.family] || CRISIS_COLORS.other,
    lines,
    links: row.url ? [{ text: 'ReliefWeb page ↗', href: row.url }] : [],
    source: 'ReliefWeb',
    asOf: formatUtcDateTime(meta?.fetchedAt),
    caveat: CRISES_CAVEAT,
  };
}

/** One record per situation; `value` is the days since it started. */
export function mapCrisisAnalystRecord(row, meta) {
  const startMs = Date.parse(row.date);
  const fetchedAt = meta?.fetchedAt ?? Date.now();
  return {
    id: row.stableId,
    kind: 'crisis',
    name: row.name,
    country: row.country,
    value: Number.isFinite(startMs)
      ? Math.max(0, Math.floor((fetchedAt - startMs) / 86_400_000))
      : null,
    unit: 'days since start',
    crisisType: row.type,
    family: row.family,
    status: row.status,
    countries: row.countries.join(', '),
    startMs: Number.isFinite(startMs) ? startMs : null,
    lat: row.lat,
    lon: row.lon,
  };
}

export function crisesStats(meta) {
  return {
    stale: meta.stale === true,
    asOf: meta.fetchedAt,
    coverage: 'ReliefWeb disasters marked ongoing or alert',
  };
}
