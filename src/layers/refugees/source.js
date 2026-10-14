import { normalizeUnhcrPopulation } from './records.js';

const API = 'https://api.unhcr.org/population/v1/population/';
const DAY_MS = 24 * 3600_000;

function pageUrl(year) {
  const query = new URLSearchParams({
    limit: '10000',
    yearFrom: String(year),
    yearTo: String(year),
    coo_all: 'true',
    coa_all: 'true',
  });
  return `${API}?${query}`;
}

/**
 * UNHCR serves CORS `*`, so the browser reads it directly. The latest year is
 * the first of current year - 1 and - 2 that returns rows. One snapshot is
 * kept for 24 hours.
 */
export function createUnhcrSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  currentYear = () => new Date(now()).getUTCFullYear(),
} = {}) {
  let cached = null;
  return {
    label: 'UNHCR',
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      if (cached && now() - cached.at < DAY_MS) return cached.snapshot;
      let lastError = null;
      for (const year of [currentYear() - 1, currentYear() - 2]) {
        const response = await fetchImpl(pageUrl(year), { signal });
        if (!response.ok) {
          lastError = new Error(`UNHCR HTTP ${response.status}`);
          continue;
        }
        const normalized = normalizeUnhcrPopulation(await response.json());
        signal?.throwIfAborted();
        if (!normalized) {
          lastError = new Error('Malformed UNHCR response');
          continue;
        }
        if (normalized.records.length === 0) continue;
        const snapshot = {
          records: normalized.records,
          year: normalized.year ?? year,
          extra: { unknownByAsylum: normalized.unknownByAsylum },
        };
        cached = { at: now(), snapshot };
        return snapshot;
      }
      throw lastError || new Error('UNHCR has no recent population data');
    },
  };
}
