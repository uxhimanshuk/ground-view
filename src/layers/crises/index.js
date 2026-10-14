import { createPulseLayer } from '../pulse/layer.js';
import {
  buildCrisisCard,
  crisesStats,
  crisisLabel,
  crisisStyle,
  mapCrisisAnalystRecord,
} from './model.js';
export * from './model.js';
export * from './records.js';
export { createCrisesSource } from './source.js';

/** Own the GDACS disaster alerts display and its fifteen-minute refresh lifecycle. */
export function createCrisesLayer({ source, ...options } = {}) {
  return createPulseLayer({
    id: 'crises',
    name: 'Disaster alerts (GDACS)',
    icon: '🌪️',
    source: 'GDACS',
    updateInterval: 15 * 60_000,
    feed: source,
    spec: {
      style: crisisStyle,
      label: crisisLabel,
      card: buildCrisisCard,
      analyst: mapCrisisAnalystRecord,
      stats: crisesStats,
      labelCap: 16,
    },
    ...options,
  });
}
