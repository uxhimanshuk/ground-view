import test from 'node:test';
import assert from 'node:assert/strict';
import { composeGroundViewCounts } from './hudGroundViewCounts.js';

const row = (id, count, enabled = true) => ({ id, enabled, stats: { count } });

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

test('no enabled Ground View layers gives an empty string', () => {
  assert.equal(composeGroundViewCounts([row('flights', 9)]), '');
  assert.equal(composeGroundViewCounts(), '');
});
