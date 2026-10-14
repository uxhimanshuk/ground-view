/** Pure text helpers shared by the Pulse cards. No DOM, no Cesium. */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const two = (n) => String(n).padStart(2, '0');

/** "14 Oct 2026 05:00 UTC", or null for an unusable time. */
export function formatUtcDateTime(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** "12 Oct 2026", or null. */
export function formatUtcDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compact age such as "12m", "5h" or "3d"; null when the time is in the future or unusable. */
export function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  const hours = Math.floor(deltaMs / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(deltaMs / 60_000))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Thousands-separated integer, or null. */
export function formatCount(value) {
  return Number.isFinite(value)
    ? Math.round(value).toLocaleString('en-US')
    : null;
}

/** Host of a URL without "www.", for link text; the full URL when it cannot be parsed. */
export function hostLabel(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return String(href);
  }
}

/** First comma-separated part of a place name. */
export function shortPlace(name) {
  return String(name ?? '')
    .split(',')[0]
    .trim();
}
