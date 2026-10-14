import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createArcLayer, createCentroidTable } from './index.js';

const table = createCentroidTable(
  JSON.parse(
    readFileSync(
      new URL(
        '../../data/local_data/flows/country-centroids.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);

function harness({ records, getSnapshot } = {}) {
  const primitives = [];
  const calls = { entries: [], visible: [], cleared: 0, renders: 0 };
  const handlers = [];
  const viewer = {
    scene: {
      canvas: {},
      primitives: {
        add: (p) => primitives.push(p),
        remove: (p) => {
          const i = primitives.indexOf(p);
          if (i >= 0) primitives.splice(i, 1);
          return i >= 0;
        },
      },
      requestRender: () => {
        calls.renders++;
      },
    },
  };
  const layer = createArcLayer({
    id: 'test-flows',
    name: 'Test flows',
    source: {
      label: 'Fixture',
      getSnapshot:
        getSnapshot ||
        (async () => ({
          records,
          year: 2025,
          extra: {},
        })),
    },
    centroidSource: { load: async () => table },
    overlayHost: {
      setEntries: (...args) => calls.entries.push(args),
      setVisible: (...args) => calls.visible.push(args),
      clearSource: () => {
        calls.cleared++;
      },
    },
    screenSpaceEventHandlerFactory: () => {
      const h = {
        destroyed: false,
        setInputAction() {},
        destroy() {
          h.destroyed = true;
        },
      };
      handlers.push(h);
      return h;
    },
    valueLabel: 'Refugees',
    unit: 'people',
    caveat: 'Fixture caveat for the card.',
    maxArcs: 2,
  });
  return { layer, viewer, primitives, calls, handlers };
}

const records = [
  { originIso3: 'SYR', destIso3: 'TUR', value: 3_000_000, year: 2025 },
  { originIso3: 'SYR', destIso3: 'DEU', value: 700_000, year: 2025 },
  { originIso3: 'AFG', destIso3: 'DEU', value: 200_000, year: 2025 },
  { originIso3: 'UKR', destIso3: 'POL', value: 900_000, year: 2025 },
];

test('layer exposes the full layer contract', () => {
  const { layer } = harness({ records });
  for (const m of [
    'init',
    'enable',
    'disable',
    'update',
    'destroy',
    'getStats',
    'getLodDiagnostics',
    'getAnalystRecords',
  ]) {
    assert.equal(typeof layer[m], 'function', m);
  }
  assert.equal(layer.id, 'test-flows');
  assert.equal(layer.source, 'Fixture');
});

test('only the top N arcs are drawn, but analyst records cover every arc', async () => {
  const { layer, viewer, primitives } = harness({ records });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(
    primitives.length,
    2,
    'one arc primitive and one node collection',
  );
  assert.deepEqual(layer.getLodDiagnostics(), {
    arcsLoaded: 4,
    arcsShown: 2,
    maxArcs: 2,
    isolated: null,
    skipped: { invalid: 0, self: 0, noCentroid: 0 },
  });
  const rows = layer.getAnalystRecords();
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.filter((r) => r.destinationIso3 === 'DEU').map((r) => r.originIso3),
    ['SYR', 'AFG'],
  );
  assert.equal(layer.getStats().count, 4);
  assert.equal(layer.getStats().shown, 2);
  assert.equal(layer.getStats().year, 2025);
});

test('country isolation shows only that country and publishes a card', async () => {
  const { layer, viewer, calls } = harness({ records });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  layer.isolateCountry('DEU');
  assert.equal(layer.getLodDiagnostics().arcsShown, 2);
  assert.equal(layer.getSelection().isolated, 'DEU');
  const [id, entries] = calls.entries.at(-1);
  assert.equal(id, 'test-flows');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].variant, 'card');
  assert.match(entries[0].title, /Germany/);
  const text = entries[0].details.join(' | ');
  assert.match(text, /Source: Fixture · as of 2025/);
  assert.match(text, /Fixture caveat/);
  assert.match(text, /Inbound refugees: 900k people/);
  assert.ok(!text.includes('—'));
  layer.isolateCountry(null);
  assert.equal(layer.getSelection().isolated, null);
  assert.equal(layer.getLodDiagnostics().arcsShown, 2);
});

test('an isolation asked for before the data loads applies once it has', async () => {
  const { layer, viewer } = harness({ records });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(layer.setParams({ isolated: 'deu' }), true);
  assert.deepEqual(layer.getParams(), { isolated: 'DEU' });
  await layer.update(viewer);
  assert.equal(layer.getSelection().isolated, 'DEU');
  assert.equal(layer.setParams({ isolated: 'not-a-code' }), false);
  layer.setParams({ isolated: null });
  assert.deepEqual(layer.getParams(), { isolated: null });
});

test('disable keeps loaded data, hides, and a later update redraws', async () => {
  const { layer, viewer, primitives } = harness({ records });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  layer.disable(viewer);
  assert.ok(primitives.every((p) => p.show === false));
  assert.equal(layer.getStats().count, 4, 'data stays loaded');
  assert.deepEqual(
    layer.getAnalystRecords(),
    [],
    'but is not queryable while off',
  );
  layer.enable(viewer);
  assert.ok(primitives.every((p) => p.show === true));
  assert.equal(layer.getAnalystRecords().length, 4);
});

test('destroy aborts the fetch and removes every primitive, card and handler', async () => {
  let signal;
  let release;
  const { layer, viewer, primitives, calls, handlers } = harness({
    getSnapshot: ({ signal: s }) => {
      signal = s;
      return new Promise((resolve) => {
        release = () => resolve({ records, year: 2025 });
      });
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  const pending = layer.update(viewer);
  await new Promise((r) => setTimeout(r, 0));
  layer.destroy();
  assert.equal(signal.aborted, true);
  release();
  assert.equal(await pending, false);
  assert.equal(primitives.length, 0);
  assert.ok(calls.cleared >= 1);
  assert.ok(handlers.every((h) => h.destroyed));
  assert.deepEqual(layer.getAnalystRecords(), []);
});

test('a late refresh after disable cannot draw', async () => {
  let release;
  const { layer, viewer, primitives } = harness({
    getSnapshot: () =>
      new Promise((resolve) => {
        release = () => resolve({ records, year: 2025 });
      }),
  });
  layer.init(viewer);
  layer.enable(viewer);
  const pending = layer.update(viewer);
  layer.disable(viewer);
  release();
  assert.equal(await pending, false);
  assert.equal(primitives.length, 0);
});

test('a source failure rejects the update and surfaces in stats', async () => {
  const { layer, viewer } = harness({
    getSnapshot: async () => {
      throw new Error('source down');
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  await assert.rejects(() => layer.update(viewer), /source down/);
  assert.equal(layer.getStats().error, 'source down');
});

test('setMaxArcs changes the drawn cohort', async () => {
  const { layer, viewer } = harness({ records });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  layer.setMaxArcs(4);
  assert.equal(layer.getLodDiagnostics().arcsShown, 4);
});
