import { createArcLayer } from '../arcs/index.js';
export { normalizeMigrantStock } from './records.js';
export { createBundledMigrantStockSource } from './source.js';

export const MIGRANT_STOCK_LAYER_ID = 'migrant-stock';
export const MIGRANT_STOCK_CAVEAT =
  'People living outside their country of birth, 2024 estimates. Stocks, not yearly movement.';

/** Migrant-stock arcs, country of birth to country of residence. */
export function createMigrantStockLayer(options) {
  return createArcLayer({
    id: MIGRANT_STOCK_LAYER_ID,
    name: 'Migrant Stock (UN DESA)',
    icon: '⤳',
    valueLabel: 'Migrants',
    unit: 'people',
    caveat: MIGRANT_STOCK_CAVEAT,
    describeCountry: () => ['Totals cover the largest bundled pairs only'],
    colors: { origin: '#c79bff', destination: '#6df0c2' },
    ...options,
  });
}
