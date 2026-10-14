/** Pure normalisation and selection for the bundled Glottolog language table. */

export const AES_LABELS = Object.freeze({
  0: 'unknown',
  1: 'not endangered',
  2: 'threatened',
  3: 'shifting',
  4: 'moribund',
  5: 'nearly extinct',
  6: 'extinct',
});

/** Okabe-Ito colour-blind-safe palette by macroarea. */
export const MACROAREA_COLORS = Object.freeze({
  Africa: '#e69f00',
  Eurasia: '#56b4e9',
  'North America': '#009e73',
  'South America': '#f0e442',
  Papunesia: '#cc79a7',
  Australia: '#d55e00',
});
export const DEFAULT_LANGUAGE_COLOR = '#bbbbbb';

export const glottologUrl = (glottocode) =>
  `https://glottolog.org/resource/languoid/id/${glottocode}`;

/**
 * Validate the compact table `{meta: {columns}, rows: [[...]]}`.
 * @returns {Array<{glottocode: string, name: string, iso: string|null,
 *   macroarea: string|null, lat: number, lon: number, aes: number}>|null}
 */
export function normalizeLanguageTable(payload) {
  const rows = payload?.rows;
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [glottocode, name, iso, macroarea, lat, lon, aes] = row;
    if (!/^[a-z0-9]{4}[0-9]{4}$/.test(String(glottocode))) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      glottocode,
      name: String(name || glottocode),
      iso: /^[a-z]{3}$/.test(String(iso)) ? iso : null,
      macroarea: macroarea ? String(macroarea) : null,
      lat,
      lon,
      aes: Number.isInteger(aes) && aes >= 0 && aes <= 6 ? aes : 0,
    });
  }
  return out;
}

/** Card lines for one language. Aggregate only: a language, never a person. */
export function describeLanguage(language) {
  const codes = [
    language.glottocode,
    language.iso && `ISO 639-3 ${language.iso}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const details = [codes];
  details.push(
    [language.macroarea, language.aes ? AES_LABELS[language.aes] : null]
      .filter(Boolean)
      .join(' · '),
  );
  details.push('Glottolog 5.3 · CC BY 4.0');
  details.push('Point is a nominal location, not a border of use.');
  return { title: language.name, details: details.filter(Boolean) };
}

/** Analyst record for one language. */
export function mapAnalystRecord(language) {
  return {
    kind: 'language',
    name: language.name,
    country: null,
    value: language.aes || null,
    unit: 'AES endangerment code (1 safe to 6 extinct)',
    glottocode: language.glottocode,
    iso639_3: language.iso,
    macroarea: language.macroarea,
    endangerment: AES_LABELS[language.aes] || 'unknown',
    lat: language.lat,
    lon: language.lon,
  };
}

/**
 * Wrap-safe containment of a point in a view rectangle (degrees).
 * `rect` is `{west, south, east, north}`; west > east means it crosses the
 * antimeridian.
 */
export function inRect(rect, lat, lon) {
  if (!rect) return true;
  if (lat < rect.south || lat > rect.north) return false;
  return rect.west <= rect.east
    ? lon >= rect.west && lon <= rect.east
    : lon >= rect.west || lon <= rect.east;
}

/**
 * Pick up to `limit` languages in view to label, most endangered first, then
 * by name for a stable order.
 */
export function selectLabelCohort(languages, rect, limit = 48) {
  const cap = Math.max(0, Math.floor(limit));
  return languages
    .filter((l) => inRect(rect, l.lat, l.lon))
    .sort(
      (a, b) =>
        (b.aes || 0) - (a.aes || 0) || a.name.localeCompare(b.name) || 0,
    )
    .slice(0, cap);
}

/**
 * Deterministic thinning so a whole-globe view stays legible: at high altitude
 * only every `step`-th language (by stable index) is drawn.
 */
export function lodStepForHeight(heightM) {
  if (!Number.isFinite(heightM)) return 1;
  if (heightM > 12_000_000) return 6;
  if (heightM > 6_000_000) return 3;
  if (heightM > 2_500_000) return 2;
  return 1;
}
