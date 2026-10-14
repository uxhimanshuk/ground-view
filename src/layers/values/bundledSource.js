import { loadBundledJson } from '../../data/bundledJson.js';
import { normalizeValuesTable, rowsForDimension } from './records.js';

function dataUrl() {
  return new URL('../../data/local_data/values/values.json', import.meta.url);
}

/** Bundled country-level values scores (see values.LICENSE.md). */
export function createBundledValuesSource({ load = loadBundledJson } = {}) {
  let table = null;
  return {
    label: 'World Values Survey',
    async fetchData({ signal, option } = {}) {
      if (!table) {
        const parsed = normalizeValuesTable(await load(dataUrl(), { signal }));
        if (!parsed) throw new Error('Malformed values table');
        table = parsed;
      }
      return {
        rows: rowsForDimension(table, option),
        asOf: table.wave ? `WVS wave ${table.wave}` : null,
        placeholder: table.placeholder,
        note: table.placeholder
          ? 'Placeholder: no real scores bundled yet'
          : null,
      };
    },
  };
}
