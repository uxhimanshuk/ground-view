import { normalizeMigrantStock } from './records.js';

// Resolved when read, so importing this module never needs a module URL.
function dataUrl() {
  return new URL(
    '../../data/local_data/flows/migrant-stock-2024.json',
    import.meta.url,
  ).href;
}

/** Read the bundled UN DESA 2024 migrant-stock table. */
export function createBundledMigrantStockSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: 'UN DESA',
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(dataUrl(), {
        signal,
        cache: 'force-cache',
      });
      if (!response.ok)
        throw new Error(`Migrant stock HTTP ${response.status}`);
      const snapshot = normalizeMigrantStock(await response.json());
      signal?.throwIfAborted();
      if (!snapshot) throw new Error('Malformed migrant stock data');
      return snapshot;
    },
  };
}
