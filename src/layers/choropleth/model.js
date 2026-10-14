/**
 * Pure choropleth model: value to colour bucket, legend stops, ISO3 join, rank.
 * No Cesium and no DOM, so every rule here is unit-tested in Node.
 */

/** Cividis-like, colour-vision-deficiency safe, dark (low) to yellow (high). */
export const SEQUENTIAL_RAMP = Object.freeze([
  '#00224e',
  '#2f4a78',
  '#575d6d',
  '#7c7b78',
  '#a49d75',
  '#cdbd68',
  '#fee838',
]);

/** Blue to orange diverging ramp (negative to positive), light centre. */
export const DIVERGING_RAMP = Object.freeze([
  '#1b5fa8',
  '#5b9bd5',
  '#a9cbe8',
  '#e6e6e6',
  '#f5c58f',
  '#ee9a45',
  '#c25b0c',
]);

export const NO_DATA_COLOR = '#5a5f66';
export const NO_DATA_LABEL = 'No data';

/** Codes that other datasets use for units Natural Earth spells differently. */
const ISO3_ALIASES = Object.freeze({
  XKX: 'KOS',
  PSE: 'PSX',
  ROM: 'ROU',
  TMP: 'TLS',
  ZAR: 'COD',
});

/** Normalise any dataset's three-letter code to the bundled pack's code. */
export function normalizeIso3(code) {
  const value = String(code ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) return null;
  return ISO3_ALIASES[value] || value;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Build a bucketed scale from the values actually present.
 * Sequential: equal intervals across the 2nd to 98th percentile so one outlier
 * cannot flatten the map. Diverging: symmetric about `center` (default 0).
 * @param {{kind?: 'sequential'|'diverging', values: number[], center?: number,
 *   formatValue?: function(number): string, colors?: string[]}} options
 */
export function buildScale({
  kind = 'sequential',
  values,
  center = 0,
  formatValue = (v) => String(Math.round(v * 10) / 10),
  colors,
}) {
  const ramp =
    colors || (kind === 'diverging' ? DIVERGING_RAMP : SEQUENTIAL_RAMP);
  const n = ramp.length;
  const sorted = (values || []).filter((v) => Number.isFinite(v));
  sorted.sort((a, b) => a - b);
  let lo = quantile(sorted, 0.02);
  let hi = quantile(sorted, 0.98);
  if (!sorted.length) {
    lo = 0;
    hi = 1;
  }
  if (kind === 'diverging') {
    const half = Math.max(Math.abs(lo - center), Math.abs(hi - center)) || 1;
    lo = center - half;
    hi = center + half;
  } else if (hi <= lo) {
    hi = lo + 1;
  }
  const width = (hi - lo) / n;
  const bucketOf = (value) => {
    if (!Number.isFinite(value)) return -1;
    const index = Math.floor((value - lo) / width);
    return Math.max(0, Math.min(n - 1, index));
  };
  const edges = Array.from({ length: n + 1 }, (_, i) => lo + width * i);
  const legend = ramp.map((color, i) => {
    const from = formatValue(edges[i]);
    const to = formatValue(edges[i + 1]);
    const label =
      i === 0 ? `< ${to}` : i === n - 1 ? `> ${from}` : `${from} to ${to}`;
    return { color, label };
  });
  return Object.freeze({
    kind,
    colors: ramp,
    domain: [lo, hi],
    edges,
    bucketOf,
    colorOf: (value) => {
      const index = bucketOf(value);
      return index < 0 ? NO_DATA_COLOR : ramp[index];
    },
    legend: [...legend, { color: NO_DATA_COLOR, label: NO_DATA_LABEL }],
  });
}

/**
 * Join dataset rows to the country geometry ids. Unknown codes and non-finite
 * values are dropped; a later row for the same country replaces an earlier one.
 * @param {Array<{iso3: string, value: number}>} rows
 * @param {Iterable<string>} knownIds Geometry ISO3 codes.
 * @returns {Map<string, object>}
 */
export function joinRows(rows, knownIds) {
  const known = new Set(knownIds);
  const joined = new Map();
  for (const row of rows || []) {
    const iso3 = normalizeIso3(row?.iso3);
    if (!iso3 || !known.has(iso3) || !Number.isFinite(row.value)) continue;
    joined.set(iso3, { ...row, iso3 });
  }
  return joined;
}

/** Rank 1 = highest value. Ties share the better rank. */
export function rankRows(joined) {
  const ordered = [...joined.values()].sort((a, b) => b.value - a.value);
  const ranks = new Map();
  let previous = null;
  let rank = 0;
  ordered.forEach((row, i) => {
    if (row.value !== previous) {
      rank = i + 1;
      previous = row.value;
    }
    ranks.set(row.iso3, rank);
  });
  return { ranks, total: ordered.length };
}

/**
 * Card lines for one country. `row` may be undefined for no-data countries.
 * @returns {{title: string, details: string[]}}
 */
export function describeCountry({
  name,
  row,
  rank,
  total,
  formatValue,
  unit = '',
  sourceLabel,
  asOf,
  caveat,
  extra = [],
}) {
  const details = [];
  if (row && Number.isFinite(row.value)) {
    const value = formatValue(row.value);
    details.push(`${value}${unit ? ` ${unit}` : ''}`);
    const facts = [];
    if (rank) facts.push(`Rank ${rank} of ${total}`);
    if (row.year != null && row.year !== '') facts.push(`Year ${row.year}`);
    if (facts.length) details.push(facts.join(' · '));
  } else {
    details.push(NO_DATA_LABEL);
  }
  for (const line of extra) if (line) details.push(line);
  const src = [sourceLabel, asOf ? `as of ${asOf}` : null]
    .filter(Boolean)
    .join(' · ');
  if (src) details.push(src);
  if (caveat) details.push(caveat);
  return { title: name, details };
}

/** Analyst records: one JSON-safe row per country with data. */
export function buildAnalystRecords({
  joined,
  ranks,
  names,
  indicator,
  unit,
  sourceLabel,
  limit = 400,
}) {
  const out = [];
  for (const row of joined.values()) {
    if (out.length >= limit) break;
    out.push({
      kind: 'country',
      name: names.get(row.iso3) || row.iso3,
      country: row.iso3,
      value: row.value,
      unit: unit || null,
      indicator: indicator || null,
      year: row.year ?? null,
      rank: ranks.get(row.iso3) ?? null,
      source: sourceLabel || null,
    });
  }
  return out;
}

/** Is a dataset still fresh? */
export function isFresh(fetchedAt, ttlMs, now = Date.now()) {
  return Number.isFinite(fetchedAt) && now - fetchedAt < ttlMs;
}
