import test from 'node:test';
import assert from 'node:assert/strict';
import { composeGroundViewCounts } from './hudGroundViewCounts.js';

const row = (id, count, enabled = true, shown) => ({
  id,
  enabled,
  stats: { count, ...(shown === undefined ? {} : { shown }) },
});

test('counts come from enabled layers only and flows are summed', () => {
  const text = composeGroundViewCounts([
    row('unrest', 412),
    row('languages', 22),
    row('refugees', 200),
    row('migrant-stock', 100),
    row('attention', 50, false),
    row('crises', 0),
  ]);
  assert.equal(text, 'UNREST CLUSTERS 412 · LANGUAGES 22 · FLOWS 300');
  assert.doesNotMatch(text, /—/);
});

test('flows say how many are drawn out of the loaded pairs', () => {
  assert.equal(
    composeGroundViewCounts([row('refugees', 5906, true, 300)]),
    'FLOWS 300 OF 5,906',
  );
  assert.equal(
    composeGroundViewCounts([
      row('refugees', 5000, true, 300),
      row('migrant-stock', 906, true, 0),
    ]),
    'FLOWS 300 OF 5,906',
  );
  assert.equal(
    composeGroundViewCounts([row('refugees', 120, true, 120)]),
    'FLOWS 120',
  );
});

test('no enabled Ground View layers gives an empty string', () => {
  assert.equal(composeGroundViewCounts([row('flights', 9)]), '');
  assert.equal(composeGroundViewCounts(), '');
});
