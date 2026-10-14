/**
 * Pure helpers for turning GDELT 2.0 event exports into anonymous protest
 * clusters. No DOM, no Node builtins: the server proxy owns download and
 * unzip, this module owns the meaning of the columns.
 *
 * Aggregate-only: actor columns are never read. A row contributes a place, a
 * report count, a timestamp and (at most) a news-source URL.
 */

/** Zero-based columns of the tab-separated GDELT 2.0 events export (61 columns). */
export const GDELT_COLUMN = Object.freeze({
  eventId: 0,
  rootCode: 28,
  numArticles: 33,
  geoType: 51,
  geoName: 52,
  lat: 56,
  lon: 57,
  dateAdded: 59,
  url: 60,
});
export const GDELT_COLUMN_COUNT = 61;
/** EventRootCode 14 is PROTEST, which includes strikes and boycotts. */
export const PROTEST_ROOT_CODE = '14';
/** ActionGeo types kept: 3 US city, 4 world city, 5 world ADM1. Country and US-state centroids are too coarse. */
export const PRECISE_GEO_TYPES = Object.freeze(new Set(['3', '4', '5']));
export const CLUSTER_CELL_DEGREES = 0.5;
export const MAX_SAMPLE_URLS = 3;

const URL_MAX_LENGTH = 512;

/** GDELT DATEADDED (YYYYMMDDHHMMSS, UTC) to epoch milliseconds, or null. */
export function parseGdeltTimestamp(value) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(value ?? ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(ms) ? ms : null;
}

/** Epoch milliseconds to the GDELT YYYYMMDDHHMMSS stamp. */
export function formatGdeltTimestamp(ms) {
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Keep only plain http(s) links a card may safely render. */
export function safeNewsUrl(value) {
  if (typeof value !== 'string' || value.length > URL_MAX_LENGTH) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Country is the last comma-separated part of a GDELT place name. */
export function countryFromPlaceName(name) {
  const parts = String(name ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

const LANDMARK_WORDS =
  /\b(square|plaza|park|stadium|airport|station|bridge|palace|monument|market|university|college|hospital|avenue|street|road|building|embassy|mosque|cathedral|church|temple|parliament|court|gate|barracks|roundabout|junction|mall|port|harbou?r|dam|tower|memorial|secretariat|ministry|prison|camp)\b/i;

/** City names that GDELT spells as "City, City, Country" in this batch. */
function confirmedCityNames(events) {
  const names = new Set();
  for (const { place } of events) {
    const parts = place.split(',').map((part) => part.trim());
    if (parts.length === 3 && parts[0] && parts[0] === parts[1])
      names.add(parts[0]);
  }
  return names;
}

/**
 * Label a cluster by its city, not by a landmark inside it. GDELT geocodes some
 * events to a feature such as "Tinubu Square, Lagos, Nigeria"; a feature is
 * recognised by a landmark word, by four or more name parts, or by a second
 * part that the same batch also spells as a city. The place stays the same, only
 * the label moves up to the city and country.
 * @param {string} place GDELT ActionGeo FullName.
 * @param {Set<string>} [cityNames]
 * @returns {string}
 */
export function cityLabel(place, cityNames = new Set()) {
  const parts = String(place ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return place;
  const feature =
    parts.length >= 4 ||
    LANDMARK_WORDS.test(parts[0]) ||
    (parts[0] !== parts[1] && cityNames.has(parts[1]));
  return feature ? parts.slice(1).join(', ') : place;
}

/**
 * Parse one export (tab-separated text) into protest events. Actor columns are
 * never read. Rows that are not protests, lack a precise location, or are
 * malformed are skipped.
 * @param {string} text Decoded export CSV.
 * @returns {Array<{id: string, lat: number, lon: number, place: string,
 *   articles: number, addedMs: number, url: ?string}>}
 */
export function parseProtestEvents(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line) continue;
    const cols = line.replace(/\r$/, '').split('\t');
    if (cols.length < GDELT_COLUMN_COUNT) continue;
    if (cols[GDELT_COLUMN.rootCode] !== PROTEST_ROOT_CODE) continue;
    if (!PRECISE_GEO_TYPES.has(cols[GDELT_COLUMN.geoType])) continue;
    const lat = Number(cols[GDELT_COLUMN.lat]);
    const lon = Number(cols[GDELT_COLUMN.lon]);
    if (
      cols[GDELT_COLUMN.lat] === '' ||
      cols[GDELT_COLUMN.lon] === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0)
    )
      continue;
    const place = cols[GDELT_COLUMN.geoName].trim();
    const addedMs = parseGdeltTimestamp(cols[GDELT_COLUMN.dateAdded]);
    if (!place || addedMs == null) continue;
    const articles = Math.max(
      1,
      Math.floor(Number(cols[GDELT_COLUMN.numArticles])) || 1,
    );
    events.push({
      id: cols[GDELT_COLUMN.eventId],
      lat,
      lon,
      place,
      articles,
      addedMs,
      url: safeNewsUrl(cols[GDELT_COLUMN.url]),
    });
  }
  return events;
}

/**
 * Cluster protest events by rounded location (about 0.5 degrees).
 * @param {Array} events Output of parseProtestEvents, any number of slices.
 * @returns {Array<{stableId: string, lon: number, lat: number,
 *   placeName: string, country: ?string, count: number, events: number,
 *   sampleUrls: string[], updatedAt: string}>} Sorted by count, then id.
 */
export function clusterProtestEvents(events) {
  const cells = new Map();
  const cityNames = confirmedCityNames(events);
  for (const event of events) {
    const cellLat = Math.round(event.lat / CLUSTER_CELL_DEGREES);
    const cellLon = Math.round(event.lon / CLUSTER_CELL_DEGREES);
    const key = `${cellLat}:${cellLon}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        key,
        latSum: 0,
        lonSum: 0,
        weight: 0,
        count: 0,
        events: 0,
        updatedMs: 0,
        places: new Map(),
        urls: new Map(),
      };
      cells.set(key, cell);
    }
    cell.latSum += event.lat * event.articles;
    cell.lonSum += event.lon * event.articles;
    cell.weight += event.articles;
    cell.count += event.articles;
    cell.events += 1;
    cell.updatedMs = Math.max(cell.updatedMs, event.addedMs);
    const label = cityLabel(event.place, cityNames);
    cell.places.set(label, (cell.places.get(label) || 0) + event.articles);
    if (event.url) {
      const known = cell.urls.get(event.url);
      cell.urls.set(event.url, {
        articles: (known?.articles || 0) + event.articles,
        addedMs: Math.max(known?.addedMs || 0, event.addedMs),
      });
    }
  }
  const clusters = [];
  for (const cell of cells.values()) {
    const [placeName] = [...cell.places.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    const sampleUrls = [...cell.urls.entries()]
      .sort(
        (a, b) =>
          b[1].articles - a[1].articles ||
          b[1].addedMs - a[1].addedMs ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, MAX_SAMPLE_URLS)
      .map(([url]) => url);
    clusters.push({
      stableId: `unrest:${cell.key}`,
      lon: Math.round((cell.lonSum / cell.weight) * 1e4) / 1e4,
      lat: Math.round((cell.latSum / cell.weight) * 1e4) / 1e4,
      placeName,
      country: countryFromPlaceName(placeName),
      count: cell.count,
      events: cell.events,
      sampleUrls,
      updatedAt: new Date(cell.updatedMs).toISOString(),
    });
  }
  return clusters.sort(
    (a, b) => b.count - a.count || a.stableId.localeCompare(b.stableId),
  );
}
