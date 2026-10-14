/** Pure World Bank Indicators API v2 normalisation. No network, no DOM. */

export const INDICATORS = Object.freeze([
  {
    id: 'SI.POV.GINI',
    label: 'Gini',
    title: 'Gini index of income inequality',
    unit: '0 to 100 scale',
    decimals: 1,
  },
  {
    id: 'SP.URB.TOTL.IN.ZS',
    label: 'Urban %',
    title: 'Urban population, % of total',
    unit: '% of population',
    decimals: 1,
  },
  {
    id: 'IT.NET.USER.ZS',
    label: 'Internet %',
    title: 'Individuals using the internet, % of population',
    unit: '% of population',
    decimals: 1,
  },
  {
    id: 'SL.TLF.CACT.FE.ZS',
    label: 'Women in labour force',
    title: 'Female labour force participation, % of women 15+',
    unit: '% of women 15+',
    decimals: 1,
  },
  {
    id: 'SL.UEM.1524.ZS',
    label: 'Youth unemployment',
    title: 'Youth unemployment, % of labour force aged 15 to 24',
    unit: '% of youth labour force',
    decimals: 1,
  },
  {
    id: 'SP.POP.65UP.TO.ZS',
    label: 'Aged 65+',
    title: 'Population aged 65 and above, % of total',
    unit: '% of population',
    decimals: 1,
  },
]);

export const DEFAULT_INDICATOR = INDICATORS[0].id;

/**
 * Country ids from the metadata endpoint. Aggregates (regions, income groups)
 * carry `region.id === 'NA'` and are excluded.
 * @returns {Set<string>|null} ISO3 codes, or null when the payload is malformed.
 */
export function normalizeCountryList(payload) {
  const rows = Array.isArray(payload) ? payload[1] : null;
  if (!Array.isArray(rows)) return null;
  const ids = new Set();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || row.region?.id === 'NA') continue;
    ids.add(row.id);
  }
  return ids;
}

/**
 * Keep the most recent non-empty value per real country.
 * @param {*} payload Raw `[meta, rows]` response.
 * @param {Set<string>} countries ISO3 codes from `normalizeCountryList`.
 * @returns {{rows: Array<{iso3: string, value: number, year: number}>, lastUpdated: string|null}|null}
 */
export function normalizeIndicatorSnapshot(payload, countries) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return null;
  const best = new Map();
  for (const row of payload[1]) {
    const iso3 = row?.countryiso3code;
    if (typeof iso3 !== 'string' || !countries.has(iso3)) continue;
    const value = row.value;
    const year = Number(row.date);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!Number.isFinite(year)) continue;
    const previous = best.get(iso3);
    if (!previous || year > previous.year)
      best.set(iso3, { iso3, value, year });
  }
  return {
    rows: [...best.values()],
    lastUpdated:
      typeof payload[0]?.lastupdated === 'string'
        ? payload[0].lastupdated
        : null,
  };
}

/** Value formatter for one indicator. */
export function indicatorFormatter(decimals = 1) {
  return (value) =>
    Number.isFinite(value)
      ? value.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: decimals,
        })
      : '';
}
