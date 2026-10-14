/**
 * Live "beats" for scene recipes: at playback time a shot can wait for its
 * layers' data, choose its own camera pose and caption from that data, or be
 * skipped when a feed is down. The saved project is never edited: every
 * result is a copy of the shot for this run only.
 */
import { BEAT_RESOLVERS } from './dayOnEarth.js';

const POLL_MS = 300;
const STATIC_WAIT_MS = 5000;
const RESOLVE_WAIT_MS = 12000;
const SKIPPED_SEC = 0.2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Place the caption inside the viewer container, announced politely. */
function createCaption(container, documentRef = globalThis.document) {
  if (!container || !documentRef?.createElement) return null;
  const node = documentRef.createElement('div');
  node.className = 'gv-scene-caption';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.dataset.visible = 'false';
  container.append(node);
  return {
    show(text) {
      node.textContent = text;
      node.dataset.visible = 'true';
    },
    hide() {
      node.dataset.visible = 'false';
    },
    destroy() {
      node.remove();
    },
  };
}

/**
 * @param {object} options
 * @param {object} options.viewer Cesium viewer (container and camera).
 * @param {object} options.dataManager
 * @param {(recipeId: string) => ?object} options.recipeForShot
 * @param {object} [options.resolvers]
 */
export function createSceneBeats({
  viewer,
  dataManager,
  recipeForShot,
  resolvers = BEAT_RESOLVERS,
  caption = createCaption(viewer?.container),
}) {
  const module = (id) => dataManager?.layers?.get?.(id)?.module ?? null;
  const stats = (id) => {
    try {
      return module(id)?.getStats?.() ?? null;
    } catch {
      return null;
    }
  };
  const records = (id) => {
    try {
      return module(id)?.getAnalystRecords?.(50000) ?? [];
    } catch {
      return [];
    }
  };

  /** 'ready' | 'unavailable' | 'timeout' | 'cancelled' */
  async function waitForData(layerIds, token, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (token?.cancelled) return 'cancelled';
      let pending = false;
      for (const id of layerIds) {
        if (!module(id)) return 'unavailable';
        const s = stats(id);
        const count = Number(s?.count) || 0;
        if (count > 0) continue;
        if (s?.keyRequired || s?.unavailable || s?.error) return 'unavailable';
        pending = true;
      }
      if (!pending) return 'ready';
      if (Date.now() >= deadline) return 'timeout';
      await sleep(POLL_MS);
    }
  }

  function currentPose() {
    const camera = viewer?.camera;
    const carto = camera?.positionCartographic;
    if (!carto) return null;
    const deg = (rad) => (rad * 180) / Math.PI;
    return {
      lat: deg(carto.latitude),
      lon: deg(carto.longitude),
      alt: carto.height,
      heading: deg(camera.heading ?? 0),
      pitch: deg(camera.pitch ?? -Math.PI / 2),
      roll: deg(camera.roll ?? 0),
    };
  }

  return {
    /**
     * Prepare one shot for a run. Returns the shot to play (a copy when the
     * beat changed it) and shows or hides the caption.
     */
    async prepare(scene, shot, token) {
      const recipe = recipeForShot?.(shot);
      const beat = recipe?.liveBeats?.[shot.title];
      if (!beat) {
        caption?.hide();
        return shot;
      }
      const resolver = beat.resolve ? resolvers[beat.resolve] : null;
      const required = beat.requires || [];
      const status = required.length
        ? await waitForData(
            required,
            token,
            resolver ? RESOLVE_WAIT_MS : STATIC_WAIT_MS,
          )
        : 'ready';
      if (status === 'cancelled') return shot;
      const skip = () => {
        caption?.hide();
        return {
          ...shot,
          camera: currentPose() || shot.camera,
          durationSec: SKIPPED_SEC,
          holdSec: 0,
          skipped: true,
        };
      };
      if (status !== 'ready') return skip();

      const patch = resolver
        ? await resolver(
            {
              records,
              stats,
              setParams: (id, params) =>
                dataManager.setLayerParams?.(id, params, { origin: 'scene' }),
              enable: (id) =>
                dataManager.setEnabled?.(id, true, { origin: 'scene' }),
            },
            beat,
          )
        : {};
      if (patch.skip) return skip();
      if (token?.cancelled) return shot;
      try {
        await patch.after?.();
      } catch {
        /* an optional extra layer must never stall the scene */
      }
      const text = patch.caption ?? beat.caption;
      if (text) caption?.show(text);
      else caption?.hide();
      return patch.camera
        ? { ...shot, camera: { ...shot.camera, ...patch.camera } }
        : shot;
    },

    clear() {
      caption?.hide();
    },

    destroy() {
      caption?.destroy();
    },
  };
}
