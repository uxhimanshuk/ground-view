import { inflateRawSync } from 'node:zlib';
import { createGdeltSlices } from './gdelt/slices.js';
import { fipsToIso3 } from '../../src/layers/newsTone/fips.js';

/**
 * Country news tone from the GDELT 2.0 event export (keyless).
 *
 * GDELT's DOC/GEO APIs are rate limited to one request per five seconds and
 * cannot return a per-country tone table, so this proxy aggregates the public
 * 15-minute event export files instead: for the last 24 hours it averages
 * AvgTone per event-location country, weighted by the number of mentions.
 * Only per-country aggregates leave this module; actor names and article URLs
 * are never read into the result.
 */

const STEP_MS = 15 * 60_000;
const WINDOW_FILES = 96;
const MIN_EVENTS = 10;
const UNZIPPED_CAP = 24 * 1024 * 1024;
const REFRESH_MS = 30 * 60_000;
const CONCURRENCY = 6;
const COL_MENTIONS = 31;
const COL_TONE = 34;
const COL_ACTION_COUNTRY = 53;

const pad = (n) => String(n).padStart(2, '0');

/** `YYYYMMDDHHMMSS` stamp (UTC) of a 15-minute slot. */
export function slotStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

/** The 96 slot stamps ending at the newest slot that is likely published. */
export function windowStamps(now, files = WINDOW_FILES) {
  return windowSlots(now, files).map(slotStamp);
}

/** The same window as epoch-ms slot starts, newest first. */
export function windowSlots(now, files = WINDOW_FILES) {
  const newest = Math.floor((now - STEP_MS) / STEP_MS) * STEP_MS;
  return Array.from({ length: files }, (_, i) => newest - i * STEP_MS);
}

/** Extract the first entry of a single-file zip archive (deflate or stored). */
export function unzipFirstEntry(buffer, { maxBytes = UNZIPPED_CAP } = {}) {
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65_557);
    i--
  ) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('news_tone_bad_zip');
  const cd = buffer.readUInt32LE(eocd + 16);
  if (buffer.readUInt32LE(cd) !== 0x02014b50)
    throw new Error('news_tone_bad_zip');
  const method = buffer.readUInt16LE(cd + 10);
  const compressed = buffer.readUInt32LE(cd + 20);
  const local = buffer.readUInt32LE(cd + 42);
  if (buffer.readUInt32LE(local) !== 0x04034b50)
    throw new Error('news_tone_bad_zip');
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + compressed);
  if (method === 0) return data;
  if (method !== 8) throw new Error('news_tone_bad_zip');
  return inflateRawSync(data, { maxOutputLength: maxBytes });
}

/**
 * Aggregate one export file into `Map<iso3, {weighted, mentions, events}>`.
 * Rows without a known action-location country, mentions, or tone are skipped.
 */
export function aggregateEvents(text) {
  const totals = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 54) continue;
    const iso3 = fipsToIso3(cols[COL_ACTION_COUNTRY]);
    if (!iso3) continue;
    const tone = Number(cols[COL_TONE]);
    const mentions = Number(cols[COL_MENTIONS]);
    if (!Number.isFinite(tone) || !Number.isFinite(mentions) || mentions <= 0)
      continue;
    if (Math.abs(tone) > 100) continue;
    let entry = totals.get(iso3);
    if (!entry) {
      entry = { weighted: 0, mentions: 0, events: 0 };
      totals.set(iso3, entry);
    }
    entry.weighted += tone * mentions;
    entry.mentions += mentions;
    entry.events += 1;
  }
  return totals;
}

/** Combine per-file aggregates into the country tone table. */
export function combineAggregates(aggregates, minEvents = MIN_EVENTS) {
  const sum = new Map();
  for (const totals of aggregates) {
    if (!totals) continue;
    for (const [iso3, t] of totals) {
      const entry = sum.get(iso3) || { weighted: 0, mentions: 0, events: 0 };
      entry.weighted += t.weighted;
      entry.mentions += t.mentions;
      entry.events += t.events;
      sum.set(iso3, entry);
    }
  }
  return [...sum.entries()]
    .filter(([, t]) => t.events >= minEvents && t.mentions > 0)
    .map(([iso3, t]) => ({
      iso3,
      tone: Math.round((t.weighted / t.mentions) * 100) / 100,
      events: t.events,
      mentions: t.mentions,
    }))
    .sort((a, b) => a.iso3.localeCompare(b.iso3));
}

/** Fixed-endpoint GDELT tone aggregator with a rolling per-file cache. */
export function newsToneProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 60_000,
  // Pass one shared hub to every GDELT proxy so a slice downloads once.
  gdelt = createGdeltSlices({ fetchImpl, now }),
} = {}) {
  gdelt.register('news-tone', (csv) => aggregateEvents(csv));
  /** Slot start (ms) -> time it was found unpublished. */
  const missingAt = new Map();
  let result = null;
  let operation = null;

  async function refresh(signal) {
    const current = now();
    const slots = windowSlots(current);
    gdelt.prune('news-tone', slots.at(-1));
    const todo = slots.filter((ts) => {
      if (gdelt.has('news-tone', ts)) return false;
      // Retry unpublished slots only occasionally.
      return !(missingAt.has(ts) && current - missingAt.get(ts) < 20 * 60_000);
    });
    let failures = 0;
    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      signal.throwIfAborted();
      await Promise.all(
        todo.slice(i, i + CONCURRENCY).map(async (ts) => {
          try {
            if ((await gdelt.load(ts)) === 'missing')
              missingAt.set(ts, current);
          } catch (error) {
            if (signal.aborted) throw error;
            failures++;
          }
        }),
      );
    }
    const loaded = slots.filter((ts) => gdelt.has('news-tone', ts));
    if (!loaded.length) throw new Error('news_tone_no_data');
    result = {
      schemaVersion: 1,
      source: 'GDELT 2.0 event export',
      attribution: 'The GDELT Project (gdeltproject.org)',
      method:
        'Mean event tone per location country, weighted by mentions, over the last 24 hours.',
      fetchedAt: new Date(current).toISOString(),
      windowStart: slotStamp(loaded.at(-1)),
      windowEnd: slotStamp(loaded[0]),
      files: loaded.length,
      failedFiles: failures,
      countries: combineAggregates(
        loaded.map((ts) => gdelt.get('news-tone', ts)),
      ),
    };
    return result;
  }

  async function acquire(signal) {
    if (result && now() - Date.parse(result.fetchedAt) < REFRESH_MS)
      return result;
    if (!operation) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs * 6);
      operation = refresh(controller.signal).finally(() => {
        clearTimeout(timer);
        operation = null;
      });
    }
    return Promise.race([
      operation,
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
  }

  async function handler(req, res) {
    const controller = new AbortController();
    res.once?.('close', () => controller.abort());
    const json = (status, value) => {
      if (controller.signal.aborted) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    if (req.url !== '/' && req.url !== '')
      return json(400, { error: 'invalid_news_tone_query' });
    try {
      json(200, await acquire(controller.signal));
    } catch {
      if (result) return json(200, { ...result, stale: true });
      json(502, { error: 'news_tone_unavailable' });
    }
  }

  return {
    name: 'news-tone',
    configureServer({ middlewares }) {
      middlewares.use('/api/news-tone', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/news-tone', handler);
    },
  };
}
