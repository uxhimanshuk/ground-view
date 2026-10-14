/**
 * Bundled UN DESA migrant-stock table to country-pair flow records.
 * Pure. The table is keyed destination then origin.
 */
export function normalizeMigrantStock(json) {
  if (!json?.flows || typeof json.flows !== 'object') return null;
  const year = Number.isFinite(json.meta?.year) ? json.meta.year : null;
  const records = [];
  for (const [destIso3, origins] of Object.entries(json.flows)) {
    if (!origins || typeof origins !== 'object') return null;
    for (const [originIso3, value] of Object.entries(origins)) {
      if (!Number.isFinite(value) || value <= 0) continue;
      records.push({ originIso3, destIso3, value, year });
    }
  }
  return { records, year, asOf: json.meta?.asOf ?? null };
}
