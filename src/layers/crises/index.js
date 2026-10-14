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

/** Own the humanitarian situations display and its six-hour refresh lifecycle. */
export function createCrisesLayer({ source, ...options } = {}) {
  return createPulseLayer({
    id: 'crises',
    name: 'Crises (ReliefWeb)',
    icon: '🆘',
    source: 'ReliefWeb',
    updateInterval: 6 * 3_600_000,
    requiresKeyId: 'reliefweb',
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
