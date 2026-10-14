/** Pure normalisation of the bundled Inglehart-Welzel country-score table. */

export const VALUE_DIMENSIONS = Object.freeze([
  {
    id: 'tradSecular',
    label: 'Traditional to secular',
    title: 'Traditional (-) to secular-rational (+) values',
    ends: 'Traditional to secular-rational',
  },
  {
    id: 'survSelfExpr',
    label: 'Survival to self-expression',
    title: 'Survival (-) to self-expression (+) values',
    ends: 'Survival to self-expression',
  },
]);

export const DEFAULT_DIMENSION = VALUE_DIMENSIONS[0].id;

/**
 * Validate the bundled table. Returns null when malformed; an empty
 * `countries` list is valid (the shipped placeholder).
 * @returns {{placeholder: boolean, note: string|null, source: string|null,
 *   wave: string|null, retrieved: string|null,
 *   countries: Array<{iso3: string, name: string|null, year: number|null,
 *   tradSecular: number|null, survSelfExpr: number|null}>}|null}
 */
export function normalizeValuesTable(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.countries)) return null;
  const meta = payload.meta || {};
  const countries = [];
  for (const row of payload.countries) {
    if (typeof row?.iso3 !== 'string' || !/^[A-Za-z]{3}$/.test(row.iso3))
      continue;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const item = {
      iso3: row.iso3.toUpperCase(),
      name: typeof row.name === 'string' ? row.name : null,
      year: num(row.year),
      tradSecular: num(row.tradSecular),
      survSelfExpr: num(row.survSelfExpr),
    };
    if (item.tradSecular === null && item.survSelfExpr === null) continue;
    countries.push(item);
  }
  return {
    placeholder: meta.placeholder === true || countries.length === 0,
    note: typeof meta.note === 'string' ? meta.note : null,
    source: typeof meta.source === 'string' ? meta.source : null,
    wave: meta.wave == null ? null : String(meta.wave),
    retrieved: typeof meta.retrieved === 'string' ? meta.retrieved : null,
    countries,
  };
}

/** Rows for one dimension. */
export function rowsForDimension(table, dimension) {
  const key = VALUE_DIMENSIONS.some((d) => d.id === dimension)
    ? dimension
    : DEFAULT_DIMENSION;
  return table.countries
    .filter((c) => c[key] !== null)
    .map((c) => ({ iso3: c.iso3, value: c[key], year: c.year }));
}

export const formatScore = (value) =>
  Number.isFinite(value) ? (value > 0 ? '+' : '') + value.toFixed(2) : '';
