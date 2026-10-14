import { loadBundledJson } from '../../data/bundledJson.js';
import { decodeRing } from '../../data/adminBoundaries.js';

function packUrl() {
  return new URL(
    '../../data/local_data/natural_earth/countries.json',
    import.meta.url,
  );
}

/**
 * Decode the bundled Natural Earth admin-0 pack into country shapes keyed by
 * ISO3 (the pack already carries ADM0_A3-style codes, so France, Norway and
 * Kosovo join correctly). Constituent countries (England etc.) are skipped.
 * @param {object} pack Parsed countries.json.
 * @returns {Map<string, {iso3: string, name: string, polygons: number[][][][], anchor: {lon: number, lat: number}}>}
 */
export function decodeCountryPack(pack) {
  const shapes = new Map();
  const decimals = pack?.meta?.decimals ?? 3;
  for (const feature of pack?.features || []) {
    if (feature.type !== 'Country' || !/^[A-Z]{3}$/.test(feature.iso)) continue;
    const places = feature.d ?? decimals;
    const polygons = (feature.polygons || []).map((poly) =>
      poly.map((ring) => decodeRing(ring, places)),
    );
    if (!polygons.length) continue;
    shapes.set(feature.iso, {
      iso3: feature.iso,
      name: feature.name,
      polygons,
      anchor: anchorOf(feature, polygons),
    });
  }
  return shapes;
}

function anchorOf(feature, polygons) {
  if (Array.isArray(feature.label) && feature.label.length === 2)
    return { lon: feature.label[0], lat: feature.label[1] };
  let best = polygons[0][0];
  let bestSpan = -1;
  for (const [outer] of polygons) {
    const xs = outer.map((p) => p[0]);
    const ys = outer.map((p) => p[1]);
    const span =
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (span > bestSpan) {
      bestSpan = span;
      best = outer;
    }
  }
  const lon = best.reduce((sum, p) => sum + p[0], 0) / best.length;
  const lat = best.reduce((sum, p) => sum + p[1], 0) / best.length;
  return { lon, lat };
}

let cached = null;
/** Load (once) and decode the bundled country shapes. */
export function loadCountryShapes({ signal } = {}) {
  if (!cached) {
    cached = loadBundledJson(packUrl(), { signal })
      .then(decodeCountryPack)
      .catch((error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}
