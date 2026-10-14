import assert from 'node:assert/strict';
import test from 'node:test';
import { guardApiFetch } from './staticDemo.js';

const ORIGIN = 'https://himanshukalra.com/groundview/';

test('same-origin /api/ requests are answered locally with a 404', async () => {
  const calls = [];
  const guarded = guardApiFetch(async (url) => {
    calls.push(url);
    return new Response('ok');
  }, ORIGIN);
  for (const url of ['/api/geocode?q=x', 'api/setup/status', '/groundview/api/x']) {
    const response = await guarded(url);
    assert.equal(response.status, 404, url);
  }
  assert.deepEqual(calls, []);
});

test('other requests pass through untouched', async () => {
  const calls = [];
  const guarded = guardApiFetch(async (url) => {
    calls.push(url);
    return new Response('ok');
  }, ORIGIN);
  const snapshot = 'https://raw.githubusercontent.com/u/r/snapshots/unrest.json';
  const external = 'https://photon.komoot.io/api/?q=x';
  await guarded(snapshot);
  await guarded(external);
  await guarded('./assets/data.json');
  assert.deepEqual(calls, [snapshot, external, './assets/data.json']);
});
