import { normalizeNewsToneSnapshot } from './records.js';
import {
  STATIC_MODE,
  snapshotAgeText,
  snapshotUrl,
  withSnapshotAge,
} from '../../sources/snapshots.js';

/** Read the GDELT tone aggregate: the server proxy, or the static demo's snapshot file. */
export function createNewsToneSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  useSnapshot = STATIC_MODE,
  url = useSnapshot ? snapshotUrl('news-tone.json') : '/api/news-tone',
  now = () => Date.now(),
} = {}) {
  return {
    label: 'GDELT',
    async fetchData({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`News tone HTTP ${response.status}`);
      const raw = await response.json();
      signal?.throwIfAborted();
      const payload = useSnapshot ? withSnapshotAge(raw, now()) : raw;
      const parsed = normalizeNewsToneSnapshot(payload);
      if (!parsed) throw new Error('Malformed news tone response');
      return {
        rows: parsed.rows,
        asOf: parsed.asOf,
        note: parsed.stale
          ? useSnapshot
            ? `Snapshot is old (${snapshotAgeText(parsed.updatedAt, now())})`
            : 'Cached tone, upstream unavailable'
          : null,
        stale: parsed.stale,
        updatedAt: parsed.updatedAt,
      };
    },
  };
}
