import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arcPeakHeightM,
  arcPositions,
  arcStyle,
  greatCirclePoints,
  haversineM,
  logScale,
  segmentsForDistance,
} from './geo.js';

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('haversine matches known distances', () => {
  near(haversineM({ lon: 0, lat: 0 }, { lon: 0, lat: 0 }), 0);
  // A quarter of the equator is a quarter of the circumference.
  near(
    haversineM({ lon: 0, lat: 0 }, { lon: 90, lat: 0 }) / 1000,
    10007.54,
    0.5,
  );
  // London to New York is about 5,570 km.
  const km =
    haversineM({ lon: -0.1, lat: 51.5 }, { lon: -74, lat: 40.7 }) / 1000;
  assert.ok(km > 5500 && km < 5650, `${km}`);
});

test('great circle keeps both endpoints and stays on the shortest path', () => {
  const a = { lon: 10, lat: 50 };
  const b = { lon: 100, lat: 20 };
  const points = greatCirclePoints(a, b, 16);
  assert.equal(points.length, 17);
  near(points[0].lon, a.lon);
  near(points[0].lat, a.lat);
  near(points[16].lon, b.lon, 1e-9);
  near(points[16].lat, b.lat, 1e-9);
  // Every point splits the full distance in proportion to t.
  const total = haversineM(a, b);
  for (const p of points) near(haversineM(a, p) / total, p.t, 1e-6);
});

test('great circle midpoint on the equator is the longitude average', () => {
  const [, mid] = greatCirclePoints({ lon: 0, lat: 0 }, { lon: 60, lat: 0 }, 2);
  near(mid.lon, 30);
  near(mid.lat, 0);
});

test('great circle crosses the antimeridian without a long way round', () => {
  const points = greatCirclePoints(
    { lon: 170, lat: 0 },
    { lon: -170, lat: 0 },
    4,
  );
  for (const p of points) assert.ok(Math.abs(p.lon) >= 170, `${p.lon}`);
});

test('degenerate great circles do not produce NaN', () => {
  for (const [a, b] of [
    [
      { lon: 5, lat: 5 },
      { lon: 5, lat: 5 },
    ],
    [
      { lon: 0, lat: 0 },
      { lon: 180, lat: 0 },
    ],
  ]) {
    for (const p of greatCirclePoints(a, b, 6)) {
      assert.ok(Number.isFinite(p.lon) && Number.isFinite(p.lat));
    }
  }
});

test('arc height is proportional to distance and capped', () => {
  near(arcPeakHeightM(1_000_000), 200_000);
  near(arcPeakHeightM(2_000_000), 400_000);
  near(arcPeakHeightM(100_000_000), 3_000_000);
  assert.equal(arcPeakHeightM(0), 0);
  assert.equal(arcPeakHeightM(NaN), 0);
});

test('arc positions rise to the peak at the midpoint and land on the ground', () => {
  const { positions, distanceM, peakM } = arcPositions(
    { lon: 0, lat: 0 },
    { lon: 40, lat: 0 },
  );
  assert.equal(positions.length % 3, 0);
  near(positions[2], 0, 1e-9);
  near(positions[positions.length - 1], 0, 1e-6);
  const heights = positions.filter((_, i) => i % 3 === 2);
  const max = Math.max(...heights);
  // The odd segment count has no vertex exactly at t = 0.5, so allow 1%.
  assert.ok(max <= peakM && max > peakM * 0.99, `${max} vs ${peakM}`);
  assert.ok(Math.abs(heights.indexOf(max) - (heights.length - 1) / 2) <= 1);
  near(peakM, distanceM * 0.2, 1);
});

test('segment count scales with distance within bounds', () => {
  assert.equal(segmentsForDistance(10_000), 8);
  assert.equal(segmentsForDistance(6_000_000), 20);
  assert.equal(segmentsForDistance(40_000_000), 64);
});

test('log scale maps decades evenly and clamps', () => {
  near(logScale(1000, 1000, 1_000_000, 0, 1), 0);
  near(logScale(1_000_000, 1000, 1_000_000, 0, 1), 1);
  near(logScale(5623.4132, 1000, 1_000_000, 0, 1), 0.25, 1e-4);
  near(logScale(10, 1000, 1_000_000, 2, 8), 2);
  near(logScale(1e9, 1000, 1_000_000, 2, 8), 8);
  assert.equal(logScale(0, 1, 100, 3, 9), 3);
  assert.equal(logScale(5, 10, 10, 2, 4), 3);
});

test('arc style grows with value on a log scale', () => {
  const range = { min: 1000, max: 1_000_000 };
  const small = arcStyle(1000, range);
  const mid = arcStyle(31_623, range);
  const big = arcStyle(1_000_000, range);
  assert.ok(small.width < mid.width && mid.width < big.width);
  assert.ok(small.alpha < mid.alpha && mid.alpha < big.alpha);
  near(small.width, 1.2);
  near(big.width, 6);
  assert.ok(big.alpha <= 1);
});
