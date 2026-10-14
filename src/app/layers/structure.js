import * as Cesium from 'cesium';
import { createIndicatorsLayer } from '../../layers/indicators/index.js';
import { createValuesLayer } from '../../layers/values/index.js';
import { createLanguagesLayer } from '../../layers/languages/index.js';
import { createNewsToneLayer } from '../../layers/newsTone/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';
import { isPointerFree } from '../../data/inputOwnership.js';

const host = () => ({
  overlayHost: {
    setEntries: overlays.setOverlayEntries,
    setVisible: overlays.setOverlaySourceVisible,
    clearSource: overlays.clearOverlaySource,
    hitTest: overlays.hitTestWorldOverlay,
  },
  screenSpaceEventHandlerFactory: (viewer) =>
    new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
  picking,
  pointer: { isPointerFree },
});

/** Wire the Structure layers to the application overlay host and pointer. */
export const createApplicationIndicators = (options) =>
  createIndicatorsLayer({ ...host(), ...options });
export const createApplicationValues = (options) =>
  createValuesLayer({ ...host(), ...options });
export const createApplicationNewsTone = (options) =>
  createNewsToneLayer({ ...host(), ...options });
export const createApplicationLanguages = (options) =>
  createLanguagesLayer({
    ...host(),
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    ...options,
  });
