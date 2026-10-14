import { startApplicationChrome } from '../app/startupChrome.js';
import { applyGroundViewDefaults } from '../app/groundViewDefaults.js';
import { initKeySetup } from '../keySetup.js';
export function startStandaloneChrome(options) {
  return startApplicationChrome({
    initializeSettings: initKeySetup,
    applyDefaults: applyGroundViewDefaults,
    ...options,
  });
}
