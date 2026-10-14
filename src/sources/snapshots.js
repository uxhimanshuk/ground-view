/**
 * Static-demo mode: the four server-backed feeds (unrest, news tone,
 * attention, crises) read JSON snapshots written every 30 minutes by
 * scripts/build-snapshots.mjs instead of the local `/api/...` proxies.
 */

export const STATIC_MODE = import.meta.env?.VITE_GROUND_VIEW_STATIC === '1';

export const DEFAULT_SNAPSHOT_BASE =
  'https://raw.githubusercontent.com/uxhimanshuk/ground-view/snapshots/';

/** Build-time constant `VITE_SNAPSHOT_BASE`, so the host can move without a code change. */
export const SNAPSHOT_BASE =
  import.meta.env?.VITE_SNAPSHOT_BASE || DEFAULT_SNAPSHOT_BASE;

/** A snapshot older than this is shown as STALE. */
export const SNAPSHOT_STALE_MS = 2 * 60 * 60_000;

/** Absolute URL of one snapshot file. */
export function snapshotUrl(file, base = SNAPSHOT_BASE) {
  return new URL(file, base.endsWith('/') ? base : `${base}/`).href;
}

/** Whether a snapshot generated at `generatedAt` (epoch ms) is too old to call current. */
export function isSnapshotStale(generatedAt, nowMs = Date.now()) {
  return (
    !Number.isFinite(generatedAt) || nowMs - generatedAt > SNAPSHOT_STALE_MS
  );
}

/** Honest age text such as "updated 18 min ago". */
export function snapshotAgeText(generatedAt, nowMs = Date.now()) {
  if (!Number.isFinite(generatedAt)) return 'update time unknown';
  const minutes = Math.max(0, Math.floor((nowMs - generatedAt) / 60_000));
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `updated ${hours} h ago`;
  return `updated ${Math.floor(hours / 24)} d ago`;
}

/**
 * Fold a snapshot's age into the payload fields the layers already honour:
 * `stale` (also true when the producer kept a previous file) and `fetchedAt`.
 */
export function withSnapshotAge(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    stale:
      payload.stale === true || isSnapshotStale(payload.generatedAt, nowMs),
  };
}
