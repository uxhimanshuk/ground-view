import { createChoroplethLayer } from '../choropleth/index.js';
import {
  DEFAULT_INDICATOR,
  INDICATORS,
  indicatorFormatter,
} from './records.js';
export * from './records.js';
export { createWorldBankIndicatorSource } from './source.js';

/** Country indicators from the World Bank as a choropleth with an indicator picker. */
export function createIndicatorsLayer({ source, ...host } = {}) {
  return createChoroplethLayer({
    id: 'indicators',
    name: 'Indicators (World Bank)',
    icon: '▦',
    sourceTag: 'World Bank',
    sourceLabel: 'World Bank Open Data',
    updateInterval: 24 * 3600_000,
    cacheMs: 24 * 3600_000,
    source,
    legendTitle: 'Country indicator',
    caveat:
      'Latest value per country; reference years differ between countries.',
    options: {
      key: 'indicator',
      defaultValue: DEFAULT_INDICATOR,
      choices: INDICATORS.map((item) => ({
        id: item.id,
        label: item.label,
        title: item.title,
        legendTitle: item.title,
        unit: item.unit,
        formatValue: indicatorFormatter(item.decimals),
      })),
    },
    ...host,
  });
}
