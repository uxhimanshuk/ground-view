import { createPulseLayer } from '../pulse/layer.js';
import {
  attentionLabel,
  attentionStats,
  attentionStyle,
  buildAttentionCard,
  mapAttentionAnalystRecord,
} from './model.js';
export * from './model.js';
export * from './heartlands.js';
export { normalizeTopArticles } from './records.js';
export { createWikimediaAttentionSource } from './source.js';

/** Own the per-language reading display and its daily refresh lifecycle. */
export function createAttentionLayer({ source, ...options } = {}) {
  return createPulseLayer({
    id: 'attention',
    name: 'Attention (reading)',
    icon: '📖',
    source: 'Wikimedia',
    // The source caches per UTC day, so a few checks a day cost one request set.
    updateInterval: 6 * 3_600_000,
    feed: source,
    spec: {
      style: attentionStyle,
      label: attentionLabel,
      card: buildAttentionCard,
      analyst: mapAttentionAnalystRecord,
      stats: attentionStats,
      labelCap: 24,
    },
    ...options,
  });
}
