/**
 * "A day on Earth": the bundled Ground View director scene.
 *
 * The recipe is static data. Its shots are matched by title to the `liveBeats` map, and the resolvers below turn live layer records into the
 * camera pose and caption for that shot at playback time. Everything here is
 * aggregate: clusters, countries and totals, never a person.
 */

const EARTH_RADIUS_KM = 6371;
const HOTSPOT_RADIUS_KM = 600;

const TRIM = (value) => String(value ?? '').trim();
const countText = (n) => Math.round(n).toLocaleString('en-US');

/** "3.1 million" for big counts so a caption reads like a sentence. */
export function peopleText(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} thousand`;
  return countText(n);
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Delhi, India" from "Delhi, Delhi, India": first part plus the country. */
function placeLabel(row) {
  const parts = TRIM(row.name)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return TRIM(row.country) || 'one region';
  const country = TRIM(row.country) || parts[parts.length - 1];
  return parts[0] === country ? parts[0] : `${parts[0]}, ${country}`;
}

/**
 * The densest unrest region: the cluster whose neighbourhood (within
 * HOTSPOT_RADIUS_KM) carries the most reports. Centred on the weighted mean of
 * that neighbourhood and named for its busiest cluster.
 * @param {Array<{kind?: string, name?: string, country?: string, value: number, lat: number, lon: number}>} records
 * @returns {?{lat: number, lon: number, place: string, reports: number, clusters: number}}
 */
export function pickUnrestHotspot(records) {
  const rows = (records || []).filter(
    (r) =>
      Number.isFinite(r?.lat) &&
      Number.isFinite(r?.lon) &&
      Number.isFinite(r?.value) &&
      r.value > 0,
  );
  if (!rows.length) return null;
  let best = null;
  for (const centre of rows) {
    let total = 0;
    let clusters = 0;
    let latSum = 0;
    let lonSum = 0;
    let busiest = centre;
    for (const row of rows) {
      if (haversineKm(centre, row) > HOTSPOT_RADIUS_KM) continue;
      total += row.value;
      clusters += 1;
      latSum += row.lat * row.value;
      lonSum += row.lon * row.value;
      if (row.value > busiest.value) busiest = row;
    }
    if (!best || total > best.reports) {
      best = {
        lat: latSum / total,
        lon: lonSum / total,
        place: placeLabel(busiest),
        reports: total,
        clusters,
      };
    }
  }
  return best;
}

/**
 * The country that took in the most refugees and asylum-seekers in the latest
 * year present in the flow records.
 * @param {Array<{destination?: string, destinationIso3?: string, originIso3?: string, value: number, year?: number, lat: number, lon: number}>} records
 * @returns {?{iso3: string, name: string, lat: number, lon: number, people: number, origins: number, year: ?number}}
 */
export function pickTopAsylum(records) {
  const rows = (records || []).filter(
    (r) => r?.destinationIso3 && Number.isFinite(r.value) && r.value > 0,
  );
  if (!rows.length) return null;
  const years = rows.map((r) => Number(r.year)).filter(Number.isFinite);
  const latest = years.length ? Math.max(...years) : null;
  const byCountry = new Map();
  for (const row of rows) {
    if (latest !== null && Number(row.year) !== latest) continue;
    const entry = byCountry.get(row.destinationIso3) || {
      iso3: row.destinationIso3,
      name: TRIM(row.destination) || row.destinationIso3,
      lat: row.lat,
      lon: row.lon,
      people: 0,
      origins: new Set(),
      year: latest,
    };
    entry.people += row.value;
    if (row.originIso3) entry.origins.add(row.originIso3);
    byCountry.set(row.destinationIso3, entry);
  }
  let top = null;
  for (const entry of byCountry.values())
    if (!top || entry.people > top.people) top = entry;
  return top && Number.isFinite(top.lat) && Number.isFinite(top.lon)
    ? { ...top, origins: top.origins.size }
    : null;
}

const GLOBE_ALT_M = 21_000_000;

const OFF = { enabled: false };
const ON = { enabled: true };
const stage = (on, extra = {}) => {
  const layers = {
    unrest: OFF,
    attention: OFF,
    crises: OFF,
    refugees: OFF,
    'migrant-stock': OFF,
    indicators: OFF,
  };
  for (const id of on) layers[id] = ON;
  return { ...layers, ...extra };
};
const GINI = {
  indicators: { enabled: true, params: { indicator: 'SI.POV.GINI' } },
};

const pose = (lat, lon, alt, extra = {}) => ({
  lat,
  lon,
  alt,
  heading: 0,
  pitch: -90,
  roll: 0,
  ...extra,
});

/** The recipe, in the same shape as every other entry in recipes.js. */
export const DAY_ON_EARTH_RECIPE = Object.freeze({
  id: 'a-day-on-earth',
  version: 1,
  title: 'A day on Earth',
  style: 'normal',
  installFirst: true,
  ui: { hidePanels: false, hudMode: 'full', safeFrame: '16:9' },
  post: { bloom: 0, sharpen: true, detectionMode: 'OFF' },
  layers: {},
  releaseLayerIds: [
    'unrest',
    'attention',
    'crises',
    'refugees',
    'migrant-stock',
    'indicators',
  ],
  liveBeats: {
    'The whole globe': {
      requires: ['unrest'],
      caption:
        'Orange dots are places where news outlets reported protests or strikes in the last 24 hours. Source: GDELT.',
    },
    'Slow orbit': {
      requires: ['unrest'],
      caption:
        'Counts reflect how much coverage a place gets, not how large a crowd was.',
    },
    'Densest unrest': {
      requires: ['unrest'],
      resolve: 'unrest-hotspot',
    },
    'Europe reads': {
      requires: ['attention'],
      resolve: 'attention-caption',
    },
    'South Asia reads': {
      requires: ['attention'],
      caption:
        'South Asia reads in many languages at once, and each pin shows a different front page. Source: Wikimedia pageviews.',
    },
    'People on the move': {
      requires: ['refugees'],
      caption:
        'Now people on the move. Arcs run from the country people left to the country that took them in. Source: UNHCR.',
    },
    'Top asylum country': {
      requires: ['refugees'],
      resolve: 'top-asylum',
    },
    'Inequality in the Americas': {
      requires: ['indicators'],
      caption:
        'Inequality, by country. Colour shows the Gini index of income, latest year per country. Source: World Bank.',
    },
    'Inequality in Africa': {
      requires: ['indicators'],
      caption:
        'Reference years differ between countries, and some have no recent survey at all. Source: World Bank.',
    },
    'Back to the globe': {
      resolve: 'finale',
      caption:
        'One day, four lenses: unrest, attention, movement and structure. All counted by country and region, never by person.',
    },
  },
  cameraPath: [
    {
      title: 'The whole globe',
      ...pose(15, -30, GLOBE_ALT_M),
      duration: 3,
      hold: 4,
      layers: stage(['unrest']),
    },
    {
      title: 'Slow orbit',
      ...pose(15, 110, GLOBE_ALT_M),
      duration: 8,
      hold: 0,
      layers: stage(['unrest']),
    },
    {
      title: 'Densest unrest',
      ...pose(20, 20, 3_000_000, { pitch: -60 }),
      duration: 6,
      hold: 5,
      layers: stage(['unrest']),
    },
    {
      title: 'Europe reads',
      ...pose(50, 12, 4_200_000, { pitch: -70 }),
      duration: 5,
      hold: 3,
      layers: stage(['unrest', 'attention']),
    },
    {
      title: 'South Asia reads',
      ...pose(23, 80, 4_800_000, { pitch: -70 }),
      duration: 5,
      hold: 3,
      layers: stage(['unrest', 'attention']),
    },
    {
      title: 'People on the move',
      ...pose(25, 20, 14_000_000),
      duration: 5,
      hold: 2,
      layers: stage(['refugees']),
    },
    {
      title: 'Top asylum country',
      ...pose(30, 30, 4_000_000, { pitch: -70 }),
      duration: 5,
      hold: 5,
      layers: stage(['refugees']),
    },
    {
      title: 'Inequality in the Americas',
      ...pose(5, -80, 11_000_000),
      duration: 5,
      hold: 3,
      layers: stage([], GINI),
    },
    {
      title: 'Inequality in Africa',
      ...pose(2, 20, 11_000_000),
      duration: 5,
      hold: 3,
      layers: stage([], GINI),
    },
    {
      title: 'Back to the globe',
      ...pose(15, 0, GLOBE_ALT_M),
      duration: 5,
      hold: 3,
      layers: stage(['unrest', 'attention', 'refugees', 'migrant-stock']),
    },
  ],
});

/**
 * Resolvers turn live records into a shot patch:
 * `{ camera?, caption?, skip?: boolean, after?: async () => void }`.
 * `ctx.records(layerId)` returns analyst records, `ctx.stats(layerId)` the
 * layer stats, `ctx.setParams(layerId, params)` pushes layer params.
 */
export const BEAT_RESOLVERS = Object.freeze({
  'unrest-hotspot'(ctx) {
    const hot = pickUnrestHotspot(ctx.records('unrest'));
    if (!hot) return { skip: true };
    return {
      camera: pose(hot.lat, hot.lon, 2_800_000, { pitch: -60 }),
      caption: `The densest region right now is around ${hot.place}: ${countText(hot.reports)} protest and strike reports within ${HOTSPOT_RADIUS_KM} km in 24 hours. Source: GDELT.`,
    };
  },
  'top-asylum'(ctx) {
    const top = pickTopAsylum(ctx.records('refugees'));
    if (!top) return { skip: true };
    ctx.setParams('refugees', { isolated: top.iso3 });
    const when = top.year ? `, ${top.year}` : '';
    return {
      camera: pose(top.lat, top.lon, 3_800_000, { pitch: -70 }),
      caption: `${top.name} took in the most refugees and asylum-seekers in this data: ${peopleText(top.people)} people from ${top.origins} countries${when}. Source: UNHCR.`,
    };
  },
  'attention-caption'(ctx) {
    const count = Number(ctx.stats('attention')?.count);
    const subject =
      count > 0
        ? `${count} Wikipedia language editions, each`
        : 'Each Wikipedia language edition is';
    return {
      caption: `Attention next. ${subject} pinned where it is spoken, with yesterday's most-read article. Here, Europe. Source: Wikimedia pageviews.`,
    };
  },
  async finale(ctx, beat) {
    // Crises needs an approved key on some servers. Use it only when it is
    // there, so the last view never carries a layer that cannot load.
    const crises = ctx.stats('crises');
    const usable = crises && !crises.keyRequired && !crises.unavailable;
    return {
      caption: beat.caption,
      after: usable ? () => ctx.enable('crises') : null,
    };
  },
});
