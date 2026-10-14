import { normalizeUnrestSnapshot } from './records.js';
import { readResponseJsonCapped } from '../../sources/httpBody.js';

export const UNREST_RESPONSE_LIMIT = 1024 * 1024;

/** Request and validate one protest-cluster snapshot from the same-origin proxy. */
export function createUnrestSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = '/api/unrest',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`Unrest HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        UNREST_RESPONSE_LIMIT,
        signal,
      );
      const snapshot = normalizeUnrestSnapshot(payload);
      if (!snapshot) throw new Error('Malformed unrest response');
      return snapshot;
    },
  };
}
