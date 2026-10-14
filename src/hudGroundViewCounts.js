/**
 * Live Ground View counts for the HUD corner readout, read from the enabled
 * layers' getStats() (surfaced by the layer manager as `stats`). Pure.
 */
const COUNT_GROUPS = Object.freeze([
  { label: 'UNREST CLUSTERS', ids: ['unrest'] },
  { label: 'ATTENTION', ids: ['attention'] },
  { label: 'CRISES', ids: ['crises'] },
  { label: 'LANGUAGES', ids: ['languages'] },
  {
    label: 'FLOWS',
    ids: ['refugees', 'migrant-stock', 'remittances'],
    drawn: true,
  },
]);

const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * @param {Array<{id: string, enabled?: boolean, stats?: {count?: number}}>} layers
 * @returns {string} e.g. `UNREST CLUSTERS 412 · FLOWS 300 OF 5,906`, or '' if none.
 */
export function composeGroundViewCounts(layers = []) {
  const byId = new Map(layers.map((layer) => [layer?.id, layer]));
  const parts = [];
  for (const group of COUNT_GROUPS) {
    let total = 0;
    let drawn = 0;
    let seen = false;
    for (const id of group.ids) {
      const layer = byId.get(id);
      const count = Number(layer?.stats?.count);
      if (layer?.enabled && Number.isFinite(count) && count > 0) {
        total += count;
        const shown = Number(layer.stats.shown);
        drawn += Number.isFinite(shown) ? Math.min(shown, count) : count;
        seen = true;
      }
    }
    if (!seen) continue;
    // Flow layers load thousands of pairs but draw a capped set; say which.
    parts.push(
      group.drawn && drawn < total
        ? `${group.label} ${fmt(drawn)} OF ${fmt(total)}`
        : `${group.label} ${group.drawn ? fmt(total) : total}`,
    );
  }
  return parts.join(' · ');
}
