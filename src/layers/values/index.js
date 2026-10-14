import { createChoroplethLayer } from '../choropleth/index.js';
import { DEFAULT_DIMENSION, VALUE_DIMENSIONS, formatScore } from './records.js';
export * from './records.js';
export { createBundledValuesSource } from './bundledSource.js';

/** Inglehart-Welzel value dimensions, one dimension at a time. */
export function createValuesLayer({ source, ...host } = {}) {
  return createChoroplethLayer({
    id: 'values',
    name: 'Values (Inglehart-Welzel)',
    icon: '◐',
    sourceTag: 'World Values Survey',
    sourceLabel: 'World Values Survey',
    updateInterval: 0,
    cacheMs: Number.POSITIVE_INFINITY,
    source,
    legendTitle: 'Cultural values',
    formatValue: formatScore,
    caveat:
      'Survey-based country averages on a relative scale. Not a ranking of better or worse.',
    scale: { kind: 'diverging', center: 0 },
    options: {
      key: 'dimension',
      defaultValue: DEFAULT_DIMENSION,
      choices: VALUE_DIMENSIONS.map((item) => ({
        id: item.id,
        label: item.label,
        title: item.title,
        legendTitle: item.title,
        unit: 'score',
        formatValue: formatScore,
        kind: 'diverging',
        center: 0,
      })),
    },
    ...host,
  });
}
