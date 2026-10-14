/** Pure validation of the /api/news-tone aggregate. Country level only. */

/**
 * @returns {{rows: Array<{iso3: string, value: number, events: number}>,
 *   asOf: string|null, stale: boolean, files: number}|null}
 */
export function normalizeNewsToneSnapshot(payload) {
  if (!payload || payload.schemaVersion !== 1) return null;
  if (!Array.isArray(payload.countries)) return null;
  const rows = [];
  for (const row of payload.countries) {
    if (typeof row?.iso3 !== 'string' || !/^[A-Z]{3}$/.test(row.iso3)) continue;
    if (!Number.isFinite(row.tone) || Math.abs(row.tone) > 100) continue;
    rows.push({
      iso3: row.iso3,
      value: row.tone,
      events: Number.isFinite(row.events) ? row.events : null,
    });
  }
  const fetched = Date.parse(payload.fetchedAt);
  return {
    rows,
    asOf: Number.isFinite(fetched)
      ? new Date(fetched).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : null,
    stale: payload.stale === true,
    files: Number.isFinite(payload.files) ? payload.files : 0,
  };
}

export const formatTone = (value) =>
  Number.isFinite(value) ? (value > 0 ? '+' : '') + value.toFixed(1) : '';

export const NEWS_TONE_CAVEAT =
  'Tone of news coverage about a place, machine-scored. Not how people there feel.';
