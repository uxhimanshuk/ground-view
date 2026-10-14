import { loadBundledJson } from '../../data/bundledJson.js';
import { normalizeLanguageTable } from './records.js';

function dataUrl() {
  return new URL(
    '../../data/local_data/languages/languages.json',
    import.meta.url,
  );
}

/** Bundled Glottolog language points (see scripts/build-languages.mjs). */
export function createBundledLanguageSource({ load = loadBundledJson } = {}) {
  let cache = null;
  return {
    label: 'Glottolog',
    async getSnapshot({ signal } = {}) {
      if (cache) return cache;
      const payload = await load(dataUrl(), { signal });
      const languages = normalizeLanguageTable(payload);
      if (!languages) throw new Error('Malformed language table');
      cache = {
        languages,
        asOf: payload?.meta?.retrieved || null,
      };
      return cache;
    },
  };
}
