import { createPulseLayer } from '../pulse/layer.js';
import {
  buildUnrestCard,
  mapUnrestAnalystRecord,
  unrestLabel,
  unrestStats,
  unrestStyle,
} from './model.js';
export * from './model.js';
export { normalizeUnrestSnapshot } from './records.js';
export { createUnrestSource } from './source.js';

/** Own the protest and strike clusters display and its 15-minute refresh lifecycle. */
export function createUnrestLayer({ source, ...options } = {}) {
  return createPulseLayer({
    id: 'unrest',
    name: 'Unrest (24h)',
    icon: '✊',
    source: 'GDELT',
    updateInterval: 15 * 60_000,
    feed: source,
    spec: {
      style: unrestStyle,
      label: unrestLabel,
      card: buildUnrestCard,
      analyst: mapUnrestAnalystRecord,
      stats: unrestStats,
      labelCap: 24,
    },
    ...options,
  });
}
