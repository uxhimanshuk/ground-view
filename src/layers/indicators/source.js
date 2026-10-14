import {
  DEFAULT_INDICATOR,
  INDICATORS,
  normalizeCountryList,
  normalizeIndicatorSnapshot,
} from './records.js';

const API = 'https://api.worldbank.org/v2';
const DAY_MS = 24 * 3600_000;

/**
 * World Bank Indicators API v2 (keyless, CORS open). Each indicator is cached
 * for 24 h, and the country list that filters out aggregates is fetched once.
 */
export function createWorldBankIndicatorSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  let countries = null;

  async function getJson(url, signal) {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`World Bank HTTP ${response.status}`);
    const json = await response.json();
    signal?.throwIfAborted();
    return json;
  }

  async function getCountries(signal) {
    if (countries) return countries;
    const payload = await getJson(
      `${API}/country?format=json&per_page=400`,
      signal,
    );
    const ids = normalizeCountryList(payload);
    if (!ids || ids.size < 100)
      throw new Error('Malformed World Bank country list');
    countries = ids;
    return ids;
  }

  return {
    label: 'World Bank',
    async fetchData({ signal, option } = {}) {
      const code = INDICATORS.some((i) => i.id === option)
        ? option
        : DEFAULT_INDICATOR;
      const hit = cache.get(code);
      if (hit && now() - hit.at < DAY_MS) return hit.dataset;
      const [ids, payload] = await Promise.all([
        getCountries(signal),
        getJson(
          `${API}/country/all/indicator/${code}?format=json&per_page=20000&mrnev=1`,
          signal,
        ),
      ]);
      const snapshot = normalizeIndicatorSnapshot(payload, ids);
      if (!snapshot) throw new Error('Malformed World Bank response');
      const dataset = {
        rows: snapshot.rows,
        asOf: snapshot.lastUpdated,
      };
      cache.set(code, { at: now(), dataset });
      return dataset;
    },
  };
}
