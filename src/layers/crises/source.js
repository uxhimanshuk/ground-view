import { normalizeCrisesSnapshot } from './records.js';
import { readResponseJsonCapped } from '../../sources/httpBody.js';

export const CRISES_RESPONSE_LIMIT = 4 * 1024 * 1024;

/** Request and validate the GDACS alerts snapshot from the same-origin proxy. */
export function createCrisesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/crises',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`Crises HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        CRISES_RESPONSE_LIMIT,
        signal,
      );
      const snapshot = normalizeCrisesSnapshot(payload);
      if (!snapshot) throw new Error('Malformed crises response');
      return snapshot;
    },
  };
}
