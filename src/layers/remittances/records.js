/**
 * Bundled KNOMAD bilateral remittance table to country-pair flow records.
 * Pure. The table is keyed sending country then receiving country, in
 * millions of US dollars.
 */
export function normalizeRemittances(json) {
  if (!json?.flows || typeof json.flows !== 'object') return null;
  const year = Number.isFinite(json.meta?.year) ? json.meta.year : null;
  const records = [];
  for (const [originIso3, receivers] of Object.entries(json.flows)) {
    if (!receivers || typeof receivers !== 'object') return null;
    for (const [destIso3, value] of Object.entries(receivers)) {
      if (!Number.isFinite(value) || value <= 0) continue;
      records.push({ originIso3, destIso3, value, year });
    }
  }
  return { records, year, asOf: json.meta?.asOf ?? null };
}
