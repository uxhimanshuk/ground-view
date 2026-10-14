import { createCentroidTable } from './model.js';

// Resolved when read, so importing this module never needs a module URL.
function centroidUrl() {
  return new URL(
    '../../data/local_data/flows/country-centroids.json',
    import.meta.url,
  ).href;
}

/** Load the bundled Natural Earth label-point table once per source. */
export function createBundledCentroidSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let cached = null;
  return {
    async load(signal) {
      signal?.throwIfAborted();
      if (cached) return cached;
      const response = await fetchImpl(centroidUrl(), {
        signal,
        cache: 'force-cache',
      });
      if (!response.ok) throw new Error(`Centroids HTTP ${response.status}`);
      const json = await response.json();
      signal?.throwIfAborted();
      cached = createCentroidTable(json);
      return cached;
    },
  };
}
