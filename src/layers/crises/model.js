import { formatUtcDate, formatUtcDateTime } from '../pulse/format.js';

/** Alert level colours: Okabe-Ito based, so green/orange/red stay distinguishable. */
export const ALERT_COLORS = Object.freeze({
  green: '#009E73',
  orange: '#E69F00',
  red: '#D55E00',
});
/** The level also changes the dot size, so colour is never the only cue. */
export const ALERT_SIZES = Object.freeze({ green: 9, orange: 13, red: 17 });
export const ALERT_LABELS = Object.freeze({
  green: 'Green alert',
  orange: 'Orange alert',
  red: 'Red alert',
});
/** The hazard type is carried by the halo colour around the dot and by the label. */
export const TYPE_COLORS = Object.freeze({
  EQ: '#A6761D',
  TC: '#56B4E9',
  FL: '#0072B2',
  VO: '#CC79A7',
  DR: '#F0E442',
  WF: '#F0F0F0',
});
export const TYPE_LABELS = Object.freeze({
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Forest fire',
});
export const CRISIS_OUTLINE = '#101418';
export const CRISES_CAVEAT =
  'Automatic alerts from GDACS, estimated from hazard models. Conflicts and epidemics are not covered.';

export function crisisStyle(row) {
  const size = ALERT_SIZES[row.alertLevel] ?? ALERT_SIZES.green;
  return {
    pixelSize: size,
    color: ALERT_COLORS[row.alertLevel] || ALERT_COLORS.green,
    outline: CRISIS_OUTLINE,
    ring: {
      pixelSize: size + 9,
      color: TYPE_COLORS[row.eventType] || '#BBBBBB',
    },
  };
}

const ALERT_PRIORITY = { red: 3e15, orange: 2e15, green: 1e15 };

/** Name labels would be long; show type and country, red and orange first. */
export function crisisLabel(row) {
  if (!row.country) return null;
  const end = Date.parse(row.toDate);
  return {
    title: `${TYPE_LABELS[row.eventType] || row.eventType} · ${row.country}`,
    accent: ALERT_COLORS[row.alertLevel] || ALERT_COLORS.green,
    priority:
      (ALERT_PRIORITY[row.alertLevel] || 0) + (Number.isFinite(end) ? end : 0),
  };
}

export function buildCrisisCard(row, meta) {
  const from = formatUtcDate(Date.parse(row.fromDate));
  const to = formatUtcDate(Date.parse(row.toDate));
  const lines = [
    `${TYPE_LABELS[row.eventType] || row.eventType} · ${ALERT_LABELS[row.alertLevel] || row.alertLevel}`,
    from && to && from !== to
      ? `${from} to ${to}`
      : from || to || 'Dates not listed',
  ];
  if (row.countries.length > 0)
    lines.push(
      `Affected: ${row.countries.slice(0, 8).join(', ')}${row.countries.length > 8 ? ` and ${row.countries.length - 8} more` : ''}`,
    );
  return {
    title: `ALERT · ${row.name}`,
    subtitle: row.country || undefined,
    accent: ALERT_COLORS[row.alertLevel] || ALERT_COLORS.green,
    lines,
    links: row.url ? [{ text: 'GDACS report ↗', href: row.url }] : [],
    source: 'GDACS',
    asOf: formatUtcDateTime(meta?.fetchedAt),
    caveat: CRISES_CAVEAT,
  };
}

/** One record per alert; `value` is the alert level as 1 to 3. */
export function mapCrisisAnalystRecord(row) {
  const startMs = Date.parse(row.fromDate);
  const endMs = Date.parse(row.toDate);
  return {
    id: row.stableId,
    kind: 'disaster-alert',
    name: row.name,
    country: row.country,
    value: ALERT_LEVELS_RANK[row.alertLevel] ?? null,
    unit: 'alert level (1 green, 2 orange, 3 red)',
    eventType: row.eventType,
    hazard: TYPE_LABELS[row.eventType] || row.eventType,
    alertLevel: row.alertLevel,
    countries: row.countries.join(', '),
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
    lat: row.lat,
    lon: row.lon,
  };
}
const ALERT_LEVELS_RANK = Object.freeze({ green: 1, orange: 2, red: 3 });

export function crisesStats(meta) {
  return {
    stale: meta.stale === true,
    asOf: meta.fetchedAt,
    coverage: 'GDACS Green, Orange and Red alerts, last 14 to 30 days',
  };
}
