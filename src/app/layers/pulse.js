import * as Cesium from 'cesium';
import { createUnrestLayer } from '../../layers/unrest/index.js';
import { createAttentionLayer } from '../../layers/attention/index.js';
import { createCrisesLayer } from '../../layers/crises/index.js';
import * as picking from '../../data/pickRegistry.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { overlayHost } from './overlayHost.js';

/** Application wiring shared by the Pulse layers: overlay host, picking and pointer ownership. */
const pulseWiring = () => ({
  overlayHost,
  picking,
  pointer: { isPointerFree },
  screenSpaceEventHandlerFactory: (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
});

/** Wire GDELT protest clusters to the application. */
export function createApplicationUnrest(options) {
  return createUnrestLayer({ ...pulseWiring(), ...options });
}

/** Wire Wikipedia per-language reading to the application. */
export function createApplicationAttention(options) {
  return createAttentionLayer({ ...pulseWiring(), ...options });
}

/** Wire ReliefWeb situations to the application. */
export function createApplicationCrises(options) {
  return createCrisesLayer({ ...pulseWiring(), ...options });
}
