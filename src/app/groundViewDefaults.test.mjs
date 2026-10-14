import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUND_VIEW_DEFAULT_LAYER_IDS,
  applyGroundViewDefaults,
} from './groundViewDefaults.js';

function managerSpy() {
  const calls = [];
  return {
    calls,
    setEnabled: async (id, enabled, options) => {
      calls.push([id, enabled, options]);
      return true;
    },
  };
}

test('a fresh visitor starts with unrest, attention and refugees, nothing original', async () => {
  assert.deepEqual(
    [...GROUND_VIEW_DEFAULT_LAYER_IDS],
    ['unrest', 'attention', 'refugees'],
  );
  const dataManager = managerSpy();
  await applyGroundViewDefaults({
    styleManager: { hasShareState: false },
    dataManager,
    hasStored: () => false,
  });
  assert.deepEqual(
    dataManager.calls.map(([id]) => id),
    ['unrest', 'attention', 'refugees'],
  );
  for (const [, enabled, options] of dataManager.calls) {
    assert.equal(enabled, true);
    assert.equal(options.origin, 'default', 'a default must never persist');
  }
});

test('share links and returning visitors keep their own state', async () => {
  for (const [styleManager, hasStored] of [
    [{ hasShareState: true }, () => false],
    [{ hasShareState: false }, () => true],
  ]) {
    const dataManager = managerSpy();
    await applyGroundViewDefaults({ styleManager, dataManager, hasStored });
    assert.deepEqual(dataManager.calls, []);
  }
});
