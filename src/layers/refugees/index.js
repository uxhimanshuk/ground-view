import { createArcLayer, formatCount } from '../arcs/index.js';
export { normalizeUnhcrPopulation } from './records.js';
export { createUnhcrSource } from './source.js';

export const REFUGEES_LAYER_ID = 'refugees';
export const REFUGEES_CAVEAT =
  'Refugees and asylum-seekers under UNHCR mandate, by country of origin and asylum. Excludes Palestine refugees under UNRWA.';

/** Refugee and asylum-seeker arcs, origin to country of asylum. */
export function createRefugeesLayer(options) {
  return createArcLayer({
    id: REFUGEES_LAYER_ID,
    name: 'Refugees (UNHCR)',
    icon: '⤳',
    valueLabel: 'Refugees and asylum-seekers',
    unit: 'people',
    caveat: REFUGEES_CAVEAT,
    updateInterval: 6 * 3600_000,
    colors: { origin: '#ff8a5c', destination: '#5cd6ff' },
    describeCountry: (iso3, extra) => {
      const unknown = extra?.unknownByAsylum?.[iso3];
      return unknown
        ? [`Unknown or stateless origin: ${formatCount(unknown)} people`]
        : null;
    },
    ...options,
  });
}
