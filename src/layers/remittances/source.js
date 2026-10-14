import { normalizeRemittances } from './records.js';

// Resolved when read, so importing this module never needs a module URL.
function dataUrl() {
  return new URL(
    '../../data/local_data/flows/remittances-2021.json',
    import.meta.url,
  ).href;
}

/** Read the bundled World Bank / KNOMAD 2021 bilateral remittance table. */
export function createBundledRemittanceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    label: 'World Bank / KNOMAD',
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(dataUrl(), {
        signal,
        cache: 'force-cache',
      });
      if (!response.ok) throw new Error(`Remittances HTTP ${response.status}`);
      const snapshot = normalizeRemittances(await response.json());
      signal?.throwIfAborted();
      if (!snapshot) throw new Error('Malformed remittance data');
      return snapshot;
    },
  };
}
