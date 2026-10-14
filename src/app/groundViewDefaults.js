/** Ground View's first-visit layers: protests, attention and displacement. */
export const GROUND_VIEW_DEFAULT_LAYER_IDS = Object.freeze([
  'unrest',
  'attention',
  'refugees',
]);

const LAYER_STATE_KEY = 'gev:layer-state:v2';

function hasStoredLayerState() {
  try {
    return globalThis.localStorage?.getItem(LAYER_STATE_KEY) != null;
  } catch {
    return true;
  }
}

/**
 * Turn on the default Ground View layers for a fresh visitor only: no share
 * link, no durable layer choices. The origin is not an explicit one, so this
 * never writes a preference the visitor did not make.
 */
export async function applyGroundViewDefaults({
  styleManager,
  dataManager,
  hasStored = hasStoredLayerState,
}) {
  if (!dataManager?.setEnabled || styleManager?.hasShareState || hasStored())
    return [];
  const outcomes = await Promise.allSettled(
    GROUND_VIEW_DEFAULT_LAYER_IDS.map((id) =>
      dataManager.setEnabled(id, true, { origin: 'default' }),
    ),
  );
  return outcomes.map((o) => o.status === 'fulfilled' && o.value !== false);
}
