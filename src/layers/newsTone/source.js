import { normalizeNewsToneSnapshot } from './records.js';

/** Read the server-side GDELT tone aggregate. */
export function createNewsToneSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/news-tone',
} = {}) {
  return {
    label: 'GDELT',
    async fetchData({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`News tone HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const snapshot = normalizeNewsToneSnapshot(payload);
      if (!snapshot) throw new Error('Malformed news tone response');
      return {
        rows: snapshot.rows,
        asOf: snapshot.asOf,
        note: snapshot.stale ? 'Cached tone, upstream unavailable' : null,
        stale: snapshot.stale,
      };
    },
  };
}
