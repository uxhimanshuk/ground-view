/**
 * Pure flow model: centroid table, record-to-arc join, capping and the
 * per-country summary. Every record is a country pair, never an individual.
 */
import { haversineM } from './geo.js';

export const DEFAULT_MAX_ARCS = 300;

/** Alternative codes that map onto the table's ISO3 keys. */
const CODE_ALIASES = Object.freeze({ XXK: 'XKX', KOS: 'XKX' });

/** Source-specific spellings that Natural Earth names do not cover. */
const NAME_ALIASES = Object.freeze({
  'russian federation': 'RUS',
  'korea republic of': 'KOR',
  'republic of korea': 'KOR',
  'south korea': 'KOR',
  'korea dem peoples republic of': 'PRK',
  'north korea': 'PRK',
  'iran islamic republic of': 'IRN',
  'iran islamic rep': 'IRN',
  'viet nam': 'VNM',
  vietnam: 'VNM',
  turkiye: 'TUR',
  'syrian arab republic': 'SYR',
  'lao pdr': 'LAO',
  'lao peoples democratic republic': 'LAO',
  'egypt arab rep': 'EGY',
  'yemen rep': 'YEM',
  'congo dem rep': 'COD',
  'democratic republic of the congo': 'COD',
  'congo rep': 'COG',
  congo: 'COG',
  'republic of the congo': 'COG',
  'cote divoire': 'CIV',
  'gambia the': 'GMB',
  'bahamas the': 'BHS',
  'kyrgyz republic': 'KGZ',
  'slovak republic': 'SVK',
  'micronesia fed sts': 'FSM',
  'venezuela rb': 'VEN',
  'bolivia plurinational state of': 'BOL',
  'tanzania united republic of': 'TZA',
  'united republic of tanzania': 'TZA',
  'moldova republic of': 'MDA',
  'hong kong sar china': 'HKG',
  'macao sar china': 'MAC',
  'china hong kong sar': 'HKG',
  'china macao sar': 'MAC',
  'west bank and gaza': 'PSE',
  'state of palestine': 'PSE',
  'cabo verde': 'CPV',
  'cape verde': 'CPV',
  'timor leste': 'TLS',
  'north macedonia': 'MKD',
  macedonia: 'MKD',
  eswatini: 'SWZ',
  swaziland: 'SWZ',
  'st kitts and nevis': 'KNA',
  'st lucia': 'LCA',
  'st vincent and the grenadines': 'VCT',
  'united states': 'USA',
  'united kingdom': 'GBR',
  'czech republic': 'CZE',
  czechia: 'CZE',
  'brunei darussalam': 'BRN',
  'myanmar burma': 'MMR',
  curacao: 'CUW',
  'sint maarten dutch part': 'SXM',
  'virgin islands us': 'VIR',
  'british virgin islands': 'VGB',
  'virgin islands british': 'VGB',
  'faeroe islands': 'FRO',
  'faroe islands': 'FRO',
});

/** Lower-case, accent-free, punctuation-free key for name joins. */
export function normalizeCountryName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Build the lookup table from the bundled centroid JSON.
 * @param {{countries: Record<string,{name:string,lat:number,lon:number,m49?:number,alt?:string[]}>}} json
 */
export function createCentroidTable(json) {
  const countries = json?.countries;
  if (!countries || typeof countries !== 'object')
    throw new TypeError('Centroid table needs a countries object');
  const byM49 = new Map();
  const byName = new Map();
  for (const [iso3, c] of Object.entries(countries)) {
    if (c.m49) byM49.set(c.m49, iso3);
    for (const n of [c.name, ...(c.alt || [])]) {
      const key = normalizeCountryName(n);
      if (key && !byName.has(key)) byName.set(key, iso3);
    }
  }
  const find = (iso3) => {
    const code = CODE_ALIASES[iso3] || iso3;
    return Object.hasOwn(countries, code) ? code : null;
  };
  return Object.freeze({
    size: Object.keys(countries).length,
    /** Canonical ISO3 for a code, numeric M49 code or name; null if unknown. */
    resolve({ iso3, m49, name } = {}) {
      if (typeof iso3 === 'string' && iso3) {
        const hit = find(iso3.trim().toUpperCase());
        if (hit) return hit;
      }
      if (m49 != null && byM49.has(Number(m49))) return byM49.get(Number(m49));
      if (name) {
        const key = normalizeCountryName(name);
        const hit = byName.get(key) || find(NAME_ALIASES[key]);
        if (hit) return hit;
      }
      return null;
    },
    get(iso3) {
      const code = find(iso3);
      return code ? { iso3: code, ...countries[code] } : null;
    },
    has: (iso3) => find(iso3) !== null,
    entries: () => Object.entries(countries),
  });
}

/**
 * Join flow records to centroids. Duplicate origin/destination pairs sum.
 * @param {Array<{originIso3:string,destIso3:string,value:number,year?:number}>} records
 * @param {ReturnType<createCentroidTable>} table
 */
export function buildArcs(records, table) {
  const skipped = { invalid: 0, self: 0, noCentroid: 0 };
  const merged = new Map();
  for (const r of records || []) {
    const value = Number(r?.value);
    if (!(value > 0) || !Number.isFinite(value)) {
      skipped.invalid++;
      continue;
    }
    const originIso3 = table.resolve({ iso3: r.originIso3 });
    const destIso3 = table.resolve({ iso3: r.destIso3 });
    if (!originIso3 || !destIso3) {
      skipped.noCentroid++;
      continue;
    }
    if (originIso3 === destIso3) {
      skipped.self++;
      continue;
    }
    const id = `${originIso3}>${destIso3}`;
    const prior = merged.get(id);
    if (prior) prior.value += value;
    else {
      const from = table.get(originIso3);
      const to = table.get(destIso3);
      merged.set(id, {
        id,
        originIso3,
        destIso3,
        originName: from.name,
        destName: to.name,
        from: { lon: from.lon, lat: from.lat },
        to: { lon: to.lon, lat: to.lat },
        value,
        year: r.year ?? null,
      });
    }
  }
  const arcs = [...merged.values()].sort(
    (a, b) => b.value - a.value || a.id.localeCompare(b.id),
  );
  for (const arc of arcs) arc.distanceM = haversineM(arc.from, arc.to);
  return { arcs, skipped };
}

/**
 * Top-N arcs, optionally limited to flows touching one country.
 * Input order is irrelevant; ties break on id so the cut is stable.
 */
export function selectArcs(
  arcs,
  { maxArcs = DEFAULT_MAX_ARCS, country = null } = {},
) {
  const cap = Math.max(0, Math.floor(Number(maxArcs) || 0));
  const code = country ? String(country).toUpperCase() : null;
  return (arcs || [])
    .filter((a) => !code || a.originIso3 === code || a.destIso3 === code)
    .slice()
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, cap);
}

/** Min and max value of a set, for the log scale. */
export function valueRange(arcs) {
  let min = Infinity;
  let max = 0;
  for (const a of arcs) {
    if (a.value < min) min = a.value;
    if (a.value > max) max = a.value;
  }
  return Number.isFinite(min) ? { min, max } : { min: 1, max: 1 };
}

/** Inbound and outbound totals plus the largest partners for one country. */
export function summarizeCountry(arcs, iso3) {
  const code = String(iso3).toUpperCase();
  let inbound = 0;
  let outbound = 0;
  let topIn = null;
  let topOut = null;
  let name = null;
  for (const a of arcs) {
    if (a.destIso3 === code) {
      name = a.destName;
      inbound += a.value;
      if (!topIn || a.value > topIn.value) topIn = a;
    }
    if (a.originIso3 === code) {
      name = a.originName;
      outbound += a.value;
      if (!topOut || a.value > topOut.value) topOut = a;
    }
  }
  return { iso3: code, name, inbound, outbound, topIn, topOut };
}

/** Nearest table country to a lon/lat within `maxKm`, else null. */
export function nearestCountry(table, lon, lat, maxKm = 450) {
  let best = null;
  let bestM = maxKm * 1000;
  for (const [iso3, c] of table.entries()) {
    const d = haversineM({ lon, lat }, c);
    if (d < bestM) {
      bestM = d;
      best = iso3;
    }
  }
  return best;
}

/** Compact human number: 1.2M, 340k, 5,200. */
export function formatCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e3)}k`;
  return Math.round(v).toLocaleString('en-US');
}

/** Analyst rows for every arc (not just the drawn cohort), largest first. */
export function arcAnalystRecords(
  arcs,
  { unit, source, maxCount = 2000 } = {},
) {
  const limit = Number.isFinite(maxCount)
    ? Math.max(1, Math.floor(maxCount))
    : 2000;
  return arcs.slice(0, limit).map((a) => ({
    id: a.id,
    kind: 'flow',
    name: `${a.originName} to ${a.destName}`,
    origin: a.originName,
    originIso3: a.originIso3,
    destination: a.destName,
    destinationIso3: a.destIso3,
    country: a.destName,
    value: a.value,
    unit: unit ?? null,
    year: a.year,
    source: source ?? null,
    lat: a.to.lat,
    lon: a.to.lon,
  }));
}
