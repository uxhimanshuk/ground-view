import * as Cesium from 'cesium';
import { createBundledCentroidSource } from '../../layers/arcs/index.js';
import { createRefugeesLayer } from '../../layers/refugees/index.js';
import { createMigrantStockLayer } from '../../layers/migrantStock/index.js';
import { createRemittancesLayer } from '../../layers/remittances/index.js';
import { overlayHost } from './overlayHost.js';

const centroidSource = createBundledCentroidSource();

function wiring() {
  return {
    overlayHost,
    centroidSource,
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
  };
}

/** Wire the Flows family (country-to-country arcs) to the application host. */
export function createApplicationRefugees(options) {
  return createRefugeesLayer({ ...wiring(), ...options });
}

export function createApplicationMigrantStock(options) {
  return createMigrantStockLayer({ ...wiring(), ...options });
}

export function createApplicationRemittances(options) {
  return createRemittancesLayer({ ...wiring(), ...options });
}
