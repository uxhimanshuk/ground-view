import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_RESOLVERS,
  DAY_ON_EARTH_RECIPE,
  lookAtPose,
  peopleText,
  pickTopAsylum,
  pickUnrestHotspot,
} from './dayOnEarth.js';
import { createSceneBeats } from './beats.js';
import { SCENE_RECIPES } from './recipes.js';
import { createDefaultProject } from './project.js';

const unrest = (name, lat, lon, value) => ({ name, lat, lon, value });

test('the densest unrest region wins on its neighbourhood, not its single biggest dot', () => {
  const hot = pickUnrestHotspot([
    unrest('Big City, Elsewhere', 0, 100, 500),
    unrest('Paris, France', 48.85, 2.35, 300),
    unrest('Lille, France', 50.63, 3.06, 280),
    unrest('Brussels, Belgium', 50.85, 4.35, 260),
  ]);
  assert.match(hot.place, /Paris/);
  assert.equal(hot.reports, 840);
  assert.equal(hot.clusters, 3);
  assert.ok(hot.lat > 48 && hot.lat < 51);
  assert.equal(pickUnrestHotspot([]), null);
  assert.equal(pickUnrestHotspot(null), null);
});

const flow = (dest, iso, origin, value, year = 2024) => ({
  destination: dest,
  destinationIso3: iso,
  originIso3: origin,
  value,
  year,
  lat: 10,
  lon: 20,
});

test('the top asylum country is chosen from the latest year only', () => {
  const top = pickTopAsylum([
    flow('Oldland', 'OLD', 'AAA', 9_000_000, 2023),
    flow('Turkey', 'TUR', 'SYR', 2_000_000),
    flow('Turkey', 'TUR', 'AFG', 400_000),
    flow('Germany', 'DEU', 'SYR', 1_000_000),
  ]);
  assert.equal(top.iso3, 'TUR');
  assert.equal(top.people, 2_400_000);
  assert.equal(top.origins, 2);
  assert.equal(top.year, 2024);
  assert.equal(pickTopAsylum([]), null);
});

test('people read as words in a caption', () => {
  assert.equal(peopleText(3_100_000), '3.1 million');
  assert.equal(peopleText(2_000_000), '2 million');
  assert.equal(peopleText(48_200), '48 thousand');
  assert.equal(peopleText(950), '950');
});

test('A day on Earth leads the bundled scenes and runs about 60 to 90 seconds', () => {
  assert.equal(SCENE_RECIPES[0].id, 'a-day-on-earth');
  assert.equal(createDefaultProject().scenes[0].id, 'a-day-on-earth');
  const total = DAY_ON_EARTH_RECIPE.cameraPath.reduce(
    (sum, shot) => sum + shot.duration + shot.hold,
    0,
  );
  assert.ok(total >= 60 && total <= 90, `scene runs ${total} s`);
});

test('every shot has a beat, and every caption is plain and free of em-dashes', () => {
  const titles = DAY_ON_EARTH_RECIPE.cameraPath.map((shot) => shot.title);
  assert.deepEqual(Object.keys(DAY_ON_EARTH_RECIPE.liveBeats), titles);
  for (const beat of Object.values(DAY_ON_EARTH_RECIPE.liveBeats)) {
    assert.ok(beat.caption || beat.resolve);
    if (beat.caption) assert.doesNotMatch(beat.caption, /—|–/);
  }
  const cites = /\d/;
  const ctx = {
    records: (id) =>
      id === 'unrest'
        ? [unrest('Lagos, Nigeria', 6.5, 3.4, 400)]
        : [flow('Turkey', 'TUR', 'SYR', 3_000_000)],
    stats: () => ({ count: 22 }),
    setParams: () => {},
    enable: () => {},
  };
  for (const key of ['unrest-hotspot', 'top-asylum', 'attention-caption']) {
    const { caption } = BEAT_RESOLVERS[key](ctx, {});
    assert.doesNotMatch(caption, /—|–/);
    if (cites.test(caption))
      assert.match(caption, /Source: (GDELT|UNHCR|Wikimedia)/);
  }
});

test('the scene leaves each layer set the way the spec stages it', () => {
  const byTitle = Object.fromEntries(
    DAY_ON_EARTH_RECIPE.cameraPath.map((shot) => [shot.title, shot.layers]),
  );
  const on = (title) =>
    Object.entries(byTitle[title])
      .filter(([, state]) => state.enabled)
      .map(([id]) => id)
      .sort();
  assert.deepEqual(on('The whole globe'), ['unrest']);
  assert.deepEqual(on('South Asia reads'), ['attention', 'unrest']);
  assert.deepEqual(on('Top asylum country'), ['refugees']);
  assert.deepEqual(on('Inequality in Africa'), ['indicators']);
  assert.equal(
    byTitle['Inequality in Africa'].indicators.params.indicator,
    'SI.POV.GINI',
  );
  assert.deepEqual(on('Back to the globe'), [
    'attention',
    'migrant-stock',
    'refugees',
    'unrest',
  ]);
});

function fakeWorld(layers) {
  const calls = { params: [], enabled: [] };
  const dataManager = {
    layers: new Map(
      Object.entries(layers).map(([id, spec]) => [
        id,
        {
          module: {
            getStats: () => spec.stats,
            getAnalystRecords: () => spec.records || [],
          },
        },
      ]),
    ),
    setLayerParams: (id, params) => calls.params.push([id, params]),
    setEnabled: (id) => calls.enabled.push(id),
  };
  const captions = [];
  const caption = {
    show: (text) => captions.push(text),
    hide: () => captions.push(null),
    destroy() {},
  };
  const viewer = { camera: { positionCartographic: null } };
  const beats = createSceneBeats({
    viewer,
    dataManager,
    recipeForShot: () => DAY_ON_EARTH_RECIPE,
    caption,
  });
  return { beats, calls, captions };
}

const shot = (title) => ({
  id: title,
  title,
  durationSec: 6,
  holdSec: 6,
  camera: { lat: 0, lon: 0, alt: 1e7 },
});

test('a runtime beat picks its own camera and caption without editing the saved shot', async () => {
  const { beats, calls, captions } = fakeWorld({
    refugees: {
      stats: { count: 3 },
      records: [flow('Turkey', 'TUR', 'SYR', 3_000_000)],
    },
  });
  const saved = shot('Top asylum country');
  const played = await beats.prepare({}, saved, { cancelled: false });
  assert.ok(played.camera.lat < 10, 'the camera stands back from its target');
  assert.deepEqual(beats.getTarget(), { lat: 10, lon: 20 });
  assert.equal(saved.camera.lat, 0, 'the saved shot is untouched');
  assert.match(captions.at(-1), /Turkey took in the most refugees/);
  assert.deepEqual(calls.params, [['refugees', { isolated: 'TUR' }]]);
});

test('a beat whose feed is down is skipped almost instantly and shows no caption', async () => {
  const { beats, captions } = fakeWorld({
    unrest: { stats: { count: 0, error: 'GDELT unavailable' } },
  });
  const played = await beats.prepare({}, shot('Densest unrest'), {
    cancelled: false,
  });
  assert.equal(played.skipped, true);
  assert.ok(played.durationSec <= 0.5);
  assert.equal(played.holdSec, 0);
  assert.equal(captions.at(-1), null);
});

test('a key-gated feed is skipped, and a cancelled run returns at once', async () => {
  const { beats } = fakeWorld({
    attention: { stats: { count: 0, keyRequired: true } },
    refugees: { stats: { count: 0 } },
  });
  const gated = await beats.prepare({}, shot('South Asia reads'), {
    cancelled: false,
  });
  assert.equal(gated.skipped, true);
  const cancelled = await beats.prepare({}, shot('People on the move'), {
    cancelled: true,
  });
  assert.equal(cancelled.skipped, undefined);
});

/** Where does the line of sight of a pose meet a spherical Earth? (lat, lon) */
function groundHit({ lat, lon, alt, heading, pitch }) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const up = (la, lo) => [
    Math.cos(la * rad) * Math.cos(lo * rad),
    Math.cos(la * rad) * Math.sin(lo * rad),
    Math.sin(la * rad),
  ];
  const east = [-Math.sin(lon * rad), Math.cos(lon * rad), 0];
  const north = [
    -Math.sin(lat * rad) * Math.cos(lon * rad),
    -Math.sin(lat * rad) * Math.sin(lon * rad),
    Math.cos(lat * rad),
  ];
  const u = up(lat, lon);
  const p = pitch * rad;
  const h = heading * rad;
  const dir = [0, 1, 2].map(
    (i) =>
      Math.cos(p) * (Math.sin(h) * east[i] + Math.cos(h) * north[i]) +
      Math.sin(p) * u[i],
  );
  const o = u.map((c) => c * (R + alt));
  const b = o.reduce((a, c, i) => a + c * dir[i], 0);
  const c = o.reduce((a, v) => a + v * v, 0) - R * R;
  const t = -b - Math.sqrt(b * b - c);
  const hit = o.map((v, i) => v + t * dir[i]);
  const norm = Math.hypot(...hit);
  return {
    lat: Math.asin(hit[2] / norm) / rad,
    lon: Math.atan2(hit[1], hit[0]) / rad,
  };
}

test('lookAtPose aims the line of sight at the target for every tilted beat', () => {
  for (const [lat, lon, alt, pitch, heading] of [
    [50, 12, 4_200_000, -70, 0],
    [23, 80, 4_800_000, -70, 0],
    [20, 20, 2_800_000, -60, 0],
    [30, 30, 3_800_000, -70, 0],
    [51, 10, 3_000_000, -55, 135],
    [-30, 170, 3_000_000, -65, 270],
  ]) {
    const camera = lookAtPose(lat, lon, alt, { pitch, heading });
    assert.equal(camera.alt, alt);
    assert.equal(camera.pitch, pitch);
    const hit = groundHit(camera);
    assert.ok(Math.abs(hit.lat - lat) < 0.05, `lat ${hit.lat} vs ${lat}`);
    assert.ok(Math.abs(hit.lon - lon) < 0.05, `lon ${hit.lon} vs ${lon}`);
  }
  // A straight-down pose needs no offset.
  const down = lookAtPose(5, -80, 11_000_000);
  assert.deepEqual([down.lat, down.lon], [5, -80]);
});

test('the tilted beats look at their targets, and the asylum beat hides the card under its caption', async () => {
  const shots = new Map(
    DAY_ON_EARTH_RECIPE.cameraPath.map((s) => [s.title, s]),
  );
  for (const [title, target] of [
    ['Europe reads', DAY_ON_EARTH_RECIPE.liveBeats['Europe reads'].target],
    [
      'South Asia reads',
      DAY_ON_EARTH_RECIPE.liveBeats['South Asia reads'].target,
    ],
  ]) {
    const hit = groundHit(shots.get(title));
    assert.ok(Math.abs(hit.lat - target.lat) < 0.05, title);
    assert.ok(Math.abs(hit.lon - target.lon) < 0.05, title);
  }
  const calls = [];
  const patch = BEAT_RESOLVERS['top-asylum']({
    records: () => [flow('Germany', 'DEU', 'SYR', 1_000_000)],
    setParams: (id, params) => calls.push(['params', id, params]),
    suppressCards: (id, on) => calls.push(['cards', id, on]),
  });
  assert.deepEqual(patch.target, { lat: 10, lon: 20 });
  assert.deepEqual(calls, [
    ['params', 'refugees', { isolated: 'DEU' }],
    ['cards', 'refugees', true],
  ]);
  const hit = groundHit(patch.camera);
  assert.ok(Math.abs(hit.lat - 10) < 0.05 && Math.abs(hit.lon - 20) < 0.05);
});
