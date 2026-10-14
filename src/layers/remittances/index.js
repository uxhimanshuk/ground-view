import { createArcLayer } from '../arcs/index.js';
export { normalizeRemittances } from './records.js';
export { createBundledRemittanceSource } from './source.js';

export const REMITTANCES_LAYER_ID = 'remittances';
export const REMITTANCES_CAVEAT =
  'Estimated bilateral flows, modelled by the World Bank from migrant stocks and incomes.';

/** Format USD millions as $12.3B or $850M. */
export function formatUsdMillions(millions) {
  const v = Number(millions);
  if (!Number.isFinite(v)) return 'n/a';
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`;
}

/** Remittance arcs, sending country to receiving country. */
export function createRemittancesLayer(options) {
  return createArcLayer({
    id: REMITTANCES_LAYER_ID,
    name: 'Remittances (World Bank)',
    icon: '⤳',
    valueLabel: 'Remittances',
    unit: 'USD millions',
    formatValue: formatUsdMillions,
    caveat: REMITTANCES_CAVEAT,
    describeCountry: () => ['Totals cover the largest bundled pairs only'],
    colors: { origin: '#ffd35c', destination: '#5cff9d' },
    ...options,
  });
}
