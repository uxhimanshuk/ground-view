import { startApplicationChrome } from '../app/startupChrome.js';
import { applyGroundViewDefaults } from '../app/groundViewDefaults.js';
import { initKeySetup } from '../keySetup.js';
import { STATIC_MODE } from '../sources/snapshots.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    // The static demo has no server to hold keys, so no POWER UP panel.
    initializeSettings: STATIC_MODE ? undefined : initKeySetup,
    applyDefaults: applyGroundViewDefaults,
    ...options,
  });
}
