import { inflateRawSync } from 'node:zlib';

// Downloader for the GDELT 2.0 15-minute events export. Each slice is fetched
// and unzipped once; every registered parser runs over the CSV text and only
// the small parsed result is kept, never the raw export.
const EXPORT_BASE = 'https://data.gdeltproject.org/gdeltv2/';
const ZIP_CAP = 3 * 1024 * 1024;
const CSV_CAP = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
// Remember a 404 briefly so two consumers asking at once do not both probe it.
const MISSING_TTL_MS = 60_000;

/** Read a fetch Response body as bytes, enforcing a hard byte cap during the read. */
export async function readResponseBytesCapped(response, maxBytes, signal) {
  const tooLarge = () =>
    Object.assign(new Error('Upstream response too large'), {
      code: 'RESPONSE_TOO_LARGE',
    });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  signal?.throwIfAborted();
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw tooLarge();
    return bytes;
  }
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** `YYYYMMDDHHMMSS` stamp (UTC) of a slice start in epoch ms. */
export function formatSliceStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

/**
 * Return the decompressed bytes of the first entry of a ZIP archive. Reads the
 * central directory so a data-descriptor archive (sizes zero in the local
 * header) still works. Supports stored and deflate entries only.
 */
export function readFirstZipEntry(bytes, maxOutput = CSV_CAP) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let i = buf.length - 22;
    i >= Math.max(0, buf.length - 22 - 65535);
    i--
  ) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip_invalid');
  const entries = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (!entries || centralOffset + 46 > buf.length)
    throw new Error('zip_invalid');
  if (buf.readUInt32LE(centralOffset) !== 0x02014b50)
    throw new Error('zip_invalid');
  const method = buf.readUInt16LE(centralOffset + 10);
  const compressedSize = buf.readUInt32LE(centralOffset + 20);
  const uncompressedSize = buf.readUInt32LE(centralOffset + 24);
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  if (uncompressedSize > maxOutput) throw new Error('zip_too_large');
  if (
    localOffset + 30 > buf.length ||
    buf.readUInt32LE(localOffset) !== 0x04034b50
  )
    throw new Error('zip_invalid');
  const dataStart =
    localOffset +
    30 +
    buf.readUInt16LE(localOffset + 26) +
    buf.readUInt16LE(localOffset + 28);
  if (dataStart + compressedSize > buf.length) throw new Error('zip_invalid');
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data, { maxOutputLength: maxOutput });
  throw new Error('zip_unsupported');
}

/**
 * Create a slice hub.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createGdeltSlices({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, (csv: string) => any>} */
  const parsers = new Map();
  /** @type {Map<number, Map<string, any>>} slice start to parsed result per consumer */
  const results = new Map();
  /** @type {Map<number, Promise<'ok'|'missing'>>} */
  const inflight = new Map();
  /** @type {Map<number, number>} slice start to time it was found missing */
  const missing = new Map();
  const stats = { downloads: 0 };

  const complete = (ts) => {
    const have = results.get(ts);
    return Boolean(have) && [...parsers.keys()].every((name) => have.has(name));
  };

  async function download(ts) {
    const url = `${EXPORT_BASE}${formatSliceStamp(ts)}.export.CSV.zip`;
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    stats.downloads++;
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': 'Ground View (public GDELT aggregate)' },
    });
    if (response.status === 404) {
      await response.body?.cancel();
      missing.set(ts, now());
      return 'missing';
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('upstream_unavailable');
    }
    const zip = await readResponseBytesCapped(response, ZIP_CAP, signal);
    const text = Buffer.from(readFirstZipEntry(zip)).toString('utf8');
    const have = results.get(ts) || new Map();
    for (const [name, parse] of parsers)
      if (!have.has(name)) have.set(name, parse(text));
    results.set(ts, have);
    missing.delete(ts);
    return 'ok';
  }

  return {
    stats,
    /** Add a consumer. Register before the first load so each slice downloads once. */
    register(name, parse) {
      parsers.set(name, parse);
    },
    /** Ensure every registered consumer has this slice parsed; one download serves all. */
    async load(ts) {
      for (;;) {
        if (complete(ts)) return 'ok';
        const checked = missing.get(ts);
        if (checked != null && now() - checked < MISSING_TTL_MS)
          return 'missing';
        let pending = inflight.get(ts);
        if (!pending) {
          pending = download(ts).finally(() => inflight.delete(ts));
          inflight.set(ts, pending);
        }
        if ((await pending) === 'missing') return 'missing';
      }
    },
    has: (name, ts) => results.get(ts)?.has(name) ?? false,
    get: (name, ts) => results.get(ts)?.get(name),
    count: (name) =>
      [...results.values()].filter((have) => have.has(name)).length,
    /** Drop one consumer's results older than `oldestTs`. */
    prune(name, oldestTs) {
      for (const [ts, have] of results) {
        if (ts >= oldestTs) continue;
        have.delete(name);
        if (!have.size) results.delete(ts);
      }
    },
  };
}
