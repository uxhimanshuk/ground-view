import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import {
  aggregateEvents,
  combineAggregates,
  newsToneProxy,
  slotStamp,
  unzipFirstEntry,
  windowStamps,
} from './newsTone.js';

const sample = readFileSync(
  new URL('../../src/data/fixtures/gdelt-events-sample.tsv', import.meta.url),
  'utf8',
);

/** Build a single-entry zip (deflate) around `text`. */
function zip(text, method = 8) {
  const raw = Buffer.from(text);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const name = Buffer.from('x.CSV');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const cdOffset = local.length + name.length + data.length;
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

const row = (country, tone, mentions) => {
  const cols = new Array(61).fill('');
  cols[31] = String(mentions);
  cols[34] = String(tone);
  cols[53] = country;
  return cols.join('\t');
};

test('slot stamps are UTC 15-minute slots and the window is 96 long', () => {
  assert.equal(slotStamp(Date.UTC(2026, 9, 14, 5, 0)), '20261014050000');
  const stamps = windowStamps(Date.UTC(2026, 9, 14, 5, 7));
  assert.equal(stamps.length, 96);
  assert.equal(stamps[0], '20261014044500');
  assert.equal(new Set(stamps).size, 96);
});

test('unzip reads deflated and stored entries', () => {
  assert.equal(unzipFirstEntry(zip('hello\n')).toString(), 'hello\n');
  assert.equal(unzipFirstEntry(zip('stored\n', 0)).toString(), 'stored\n');
  assert.throws(() => unzipFirstEntry(Buffer.from('not a zip at all, sorry')));
});

test('aggregation weights tone by mentions and maps FIPS to ISO3', () => {
  const text = [
    row('GM', -2, 1),
    row('GM', 4, 3),
    row('UK', 1, 2),
    row('ZZ', 5, 5), // unknown code
    row('GM', 'x', 1), // bad tone
    row('GM', 3, 0), // no mentions
  ].join('\n');
  const totals = aggregateEvents(text);
  assert.deepEqual([...totals.keys()].sort(), ['DEU', 'GBR']);
  const [de] = combineAggregates([totals], 1).filter((c) => c.iso3 === 'DEU');
  assert.equal(de.tone, 2.5);
  assert.equal(de.events, 2);
  assert.equal(de.mentions, 4);
});

test('countries under the event threshold are withheld', () => {
  const totals = aggregateEvents([row('GM', 1, 1), row('FR', 1, 1)].join('\n'));
  assert.equal(combineAggregates([totals], 2).length, 0);
  assert.equal(combineAggregates([totals, totals], 2).length, 2);
});

test('the captured export sample aggregates without actor or url fields', () => {
  const totals = aggregateEvents(sample);
  assert.ok(totals.size > 3);
  assert.ok(totals.has('AUS'));
  const out = JSON.stringify(combineAggregates([totals], 1));
  assert.ok(!/http/.test(out));
});

test('proxy fetches the window once, tolerates 404 slots and serves aggregates', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length % 4 === 0)
      return { ok: false, status: 404, body: { cancel: async () => {} } };
    const body = zip([row('GM', 2, 1), row('GM', 2, 1)].join('\n'));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  const proxy = newsToneProxy({
    fetchImpl,
    now: () => Date.UTC(2026, 9, 14, 5, 7),
  });
  const middlewares = new Map();
  proxy.configureServer({
    middlewares: { use: (p, h) => middlewares.set(p, h) },
  });
  const handler = middlewares.get('/api/news-tone');
  const respond = () =>
    new Promise((resolve) => {
      const res = {
        status: 0,
        writeHead(status) {
          this.status = status;
        },
        end(text) {
          resolve({ status: this.status, body: JSON.parse(text) });
        },
        once() {},
      };
      handler({ method: 'GET', url: '/' }, res);
    });
  const { status, body } = await respond();
  assert.equal(status, 200);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.countries[0].iso3, 'DEU');
  assert.equal(body.countries[0].tone, 2);
  assert.ok(body.files > 60 && body.files < 96);
  const before = calls.length;
  await respond();
  assert.equal(calls.length, before, 'second request served from cache');
  const bad = await new Promise((resolve) => {
    const res = {
      writeHead(status) {
        this.status = status;
      },
      end() {
        resolve(this.status);
      },
      once() {},
    };
    handler({ method: 'GET', url: '/?x=1' }, res);
  });
  assert.equal(bad, 400);
});
