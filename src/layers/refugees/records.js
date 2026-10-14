/**
 * UNHCR Refugee Population Statistics rows to country-pair flow records.
 * Pure: no network, DOM or Cesium. Aggregate only, every row is a pair of
 * countries.
 */

/** Origin codes that are not a country: unknown, stateless, Tibetan. */
const NON_COUNTRY_ORIGINS = new Set(['UNK', 'XXA', 'TIB']);

/** UNHCR returns numbers as numbers, numeric strings or "-". */
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * @param {{items?: Array<object>}} payload One UNHCR population page.
 * @returns {{records: Array<{originIso3:string,destIso3:string,value:number,year:number}>,
 *   unknownByAsylum: Record<string,number>, year: number|null}|null}
 *   null when the payload is not a UNHCR page.
 */
export function normalizeUnhcrPopulation(payload) {
  if (!Array.isArray(payload?.items)) return null;
  const records = [];
  const unknownByAsylum = {};
  let year = null;
  for (const row of payload.items) {
    if (!row || typeof row !== 'object') return null;
    const value = count(row.refugees) + count(row.asylum_seekers);
    const rowYear = Number(row.year);
    if (Number.isFinite(rowYear)) year = Math.max(year ?? rowYear, rowYear);
    if (value <= 0) continue;
    const origin = String(row.coo_iso ?? '').toUpperCase();
    const dest = String(row.coa_iso ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(dest)) continue;
    if (NON_COUNTRY_ORIGINS.has(origin) || !/^[A-Z]{3}$/.test(origin)) {
      unknownByAsylum[dest] = (unknownByAsylum[dest] || 0) + value;
      continue;
    }
    records.push({
      originIso3: origin,
      destIso3: dest,
      value,
      year: Number.isFinite(rowYear) ? rowYear : null,
    });
  }
  return { records, unknownByAsylum, year };
}
