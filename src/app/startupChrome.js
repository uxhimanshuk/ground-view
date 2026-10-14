import { initFirstRunExperience } from '../firstRunExperience.js';

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

/** Reveal welcome controls only after restoration and the loading transition. */
export function startApplicationChrome({
  loadingScreen,
  styleManager,
  dataManager,
  signal,
  initializeWelcome = initFirstRunExperience,
  initializeSettings,
}) {
  let disposed = false;
  let firstRun;
  let revealTimer;
  let resolveDelay;
  const minimumDelay = new Promise((resolve) => {
    resolveDelay = resolve;
  });
  const delayTimer = setTimeout(resolveDelay, 1000);
  const revealFirstRun = () => {
    if (disposed || signal.aborted || firstRun) return;
    firstRun = initializeWelcome?.({ styleManager, dataManager });
    clearTimeout(revealTimer);
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
  };
  void Promise.all([styleManager.initialRestorePromise, minimumDelay])
    .catch(() => {
      /* Restoration reports its own outcome through the controls. */
    })
    .then(() => {
      if (disposed || signal.aborted) return;
      void applyGroundViewDefaults({ styleManager, dataManager }).catch(
        () => {},
      );
      loadingScreen.classList.add('hidden');
      loadingScreen.addEventListener('transitionend', revealFirstRun, {
        once: true,
      });
      revealTimer = setTimeout(revealFirstRun, 900);
    });
  const keySetup = Promise.resolve(
    signal.aborted ? null : initializeSettings?.({ signal }),
  );
  // Own the pending initializer too; it must not reveal a dialog after abort.
  void keySetup.catch(() =>
    console.error('Provider settings initialization failed'),
  );
  return async () => {
    disposed = true;
    clearTimeout(delayTimer);
    clearTimeout(revealTimer);
    resolveDelay();
    loadingScreen.removeEventListener('transitionend', revealFirstRun);
    firstRun?.destroy();
    (await keySetup.catch(() => null))?.destroy();
  };
}
