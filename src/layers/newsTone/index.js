import { createChoroplethLayer } from '../choropleth/index.js';
import { NEWS_TONE_CAVEAT, formatTone } from './records.js';
export * from './records.js';
export { createNewsToneSource } from './source.js';

/** Average news tone per country over 24 hours, as a diverging choropleth. */
export function createNewsToneLayer({ source, ...host } = {}) {
  return createChoroplethLayer({
    id: 'news-tone',
    name: 'News Tone (24h)',
    icon: '◑',
    sourceTag: 'GDELT',
    sourceLabel: 'GDELT 2.0 events',
    updateInterval: 3600_000,
    cacheMs: 3000_000,
    source,
    legendTitle: 'Average news tone, last 24 h',
    unit: 'tone',
    formatValue: formatTone,
    caveat: NEWS_TONE_CAVEAT,
    scale: { kind: 'diverging', center: 0 },
    ...host,
  });
}
