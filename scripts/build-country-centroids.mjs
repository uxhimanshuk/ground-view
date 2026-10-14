#!/usr/bin/env node
/**
 * Build the bundled country label-point table the Flows arc layers join on.
 *
 *   src/data/local_data/flows/country-centroids.json
 *
 * Source: Natural Earth 10m admin-0 countries (public domain), the LABEL_X /
 * LABEL_Y label points, pinned to the same commit and SHA-256 as
 * `build-admin-packs.mjs`. Label points sit inside the main landmass, which
 * reads better as an arc anchor than an area centroid (USA, Russia, France).
 *
 * Usage: node scripts/build-country-centroids.mjs [--file <local geojson>]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NE_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
export const SOURCE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/ne_10m_admin_0_countries.geojson`;
const SOURCE_SHA256 =
  '239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255';
const OUT = path.join(ROOT, 'src/data/local_data/flows/country-centroids.json');

const valid3 = (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const validNum = (v) => Number.isInteger(v) && v > 0;
const r2 = (n) => Math.round(n * 100) / 100;

/** Pure: Natural Earth admin-0 GeoJSON to the compact centroid table. */
export function buildCentroidTable(geojson) {
  const countries = {};
  for (const feature of geojson.features) {
    const p = feature.properties;
    // Natural Earth stores -99 for France and Norway and for dependencies that
    // share a sovereign's code; only the sovereign feature owns an ISO3.
    const iso3 = valid3(p.ISO_A3)
      ? p.ISO_A3
      : valid3(p.ISO_A3_EH) && p.ADM0_A3 === p.ISO_A3_EH
        ? p.ISO_A3_EH
        : p.ADM0_A3 === 'KOS'
          ? 'XKX' // user-assigned code used by the UN and World Bank
          : null;
    if (!iso3 || !Number.isFinite(p.LABEL_X) || !Number.isFinite(p.LABEL_Y))
      continue;
    const m49 = [p.ISO_N3, p.ISO_N3_EH, p.UN_A3]
      .map((v) => Number.parseInt(v, 10))
      .find(validNum);
    const names = [
      p.NAME,
      p.NAME_LONG,
      p.NAME_EN,
      p.BRK_NAME,
      p.FORMAL_EN,
      p.NAME_SORT,
      p.NAME_ALT,
    ].filter((v) => typeof v === 'string' && v.trim());
    const [name, ...rest] = [...new Set(names.map((v) => v.trim()))];
    countries[iso3] = {
      name,
      lat: r2(p.LABEL_Y),
      lon: r2(p.LABEL_X),
      ...(m49 ? { m49 } : {}),
      ...(rest.length ? { alt: rest } : {}),
    };
  }
  return countries;
}

async function main() {
  const fileArg = process.argv.indexOf('--file');
  let bytes;
  if (fileArg > 0) bytes = await readFile(process.argv[fileArg + 1]);
  else {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SOURCE_SHA256)
    console.warn(`SHA-256 differs from the pinned value: ${sha}`);
  const countries = buildCentroidTable(JSON.parse(bytes.toString('utf8')));
  const out = {
    meta: {
      title: 'Country label points for Ground View flow arcs',
      source: 'Natural Earth 10m admin-0 countries (LABEL_X, LABEL_Y)',
      url: SOURCE_URL,
      licence: 'Public domain (naturalearthdata.com/about/terms-of-use)',
      sourceSha256: sha,
      retrieved: new Date().toISOString().slice(0, 10),
      count: Object.keys(countries).length,
    },
    countries,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${OUT} (${out.meta.count} countries)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
