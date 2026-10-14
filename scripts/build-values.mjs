#!/usr/bin/env node
// Build src/data/local_data/values/values.json from the WVS Wave 1 to 6 Key
// Aggregates, via the plain CSV that scripts/wvs-sav-to-csv.py dumps from the
// .sav. Never invents data: a country with no usable latest-wave row is
// reported and left out, and the "No data" state covers it on the map.
//
// Usage: node scripts/build-values.mjs wvs-raw.csv
//
// Documented quirks of the file, all handled here and printed when they fire:
//  - 22 wave 6 rows have a blank ISO3 code. It is filled from other rows with
//    the same WVS country number (ctrnum). Where no row of that country ever
//    carries one, the standard ISO 3166-1 alpha-3 code below is used and listed.
//  - Germany is split into West (ctrnum 66) and East (ctrnum 64). DEU takes the
//    West sample, flagged on the card; East is dropped.
//  - Northern Ireland (ctrnum 83) is a part of GBR, which has its own rows.
//  - Several rows can be flagged latest; the newest year per ISO3 wins, and rows
//    with both scores null are ignored.
import { readFileSync, writeFileSync } from 'node:fs';

const WEST_GERMANY = '66';
const EAST_GERMANY = '64';
const SUBNATIONAL = new Set(['83']); // N. Ireland, covered by GBR
// Standard ISO 3166-1 alpha-3 codes for countries whose rows never carry one.
// Keyed by the WVS short name, so a renamed country fails loudly instead of
// being matched by accident.
const ISO_BY_WVS_NAME = {
  Bahrain: 'BHR',
  Ecuador: 'ECU',
  Ethiopia: 'ETH',
  Kuwait: 'KWT',
  Lebanon: 'LBN',
  Libya: 'LBY',
  Tunisia: 'TUN',
  Vietnam: 'VNM',
  Yemen: 'YEM',
  Serbia: 'SRB',
  Montenegro: 'MNE',
  Palestine: 'PSE',
  'Hong Kong': 'HKG',
};

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/build-values.mjs wvs-raw.csv');
  process.exit(1);
}

const lines = readFileSync(csvPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim());
const header = lines.shift().split(',');
for (const key of [
  'ctrnum',
  'country',
  'ccodealp',
  'year',
  'wave',
  'latest',
  'SVI_culmap',
  'EVI_culmap',
]) {
  if (!header.includes(key)) {
    console.error(`CSV is missing column: ${key}`);
    process.exit(1);
  }
}
const num = (v) =>
  v === '' || v === undefined || !Number.isFinite(+v) ? null : +v;
const rows = lines.map((line) => {
  const cells = line.split(',');
  if (cells.length !== header.length)
    throw new Error(`Unexpected cell count in: ${line}`);
  const r = Object.fromEntries(header.map((h, i) => [h, cells[i].trim()]));
  return {
    ctrnum: String(Math.round(+r.ctrnum)),
    country: r.country,
    iso3: /^[A-Z]{3}$/.test(r.ccodealp) ? r.ccodealp : null,
    year: num(r.year),
    wave: num(r.wave),
    latest: num(r.latest) === 1,
    tradSecular: num(r.SVI_culmap),
    survSelfExpr: num(r.EVI_culmap),
  };
});

// ctrnum -> ISO3 from any row that carries one.
const isoByCtr = new Map();
for (const r of rows) {
  if (!r.iso3) continue;
  const known = isoByCtr.get(r.ctrnum);
  if (known && known !== r.iso3)
    throw new Error(`ctrnum ${r.ctrnum} maps to both ${known} and ${r.iso3}`);
  isoByCtr.set(r.ctrnum, r.iso3);
}
const log = { filled: [], fallback: [], dropped: [], unmapped: [] };
const nameOf = new Map(rows.map((r) => [r.ctrnum, r.country]));
for (const [ctr, name] of nameOf) {
  if (isoByCtr.has(ctr) || ctr === EAST_GERMANY || SUBNATIONAL.has(ctr))
    continue;
  if (ISO_BY_WVS_NAME[name]) {
    isoByCtr.set(ctr, ISO_BY_WVS_NAME[name]);
    log.fallback.push(`${name} ${ISO_BY_WVS_NAME[name]}`);
  } else {
    log.unmapped.push(name);
  }
}
for (const ctr of [EAST_GERMANY, ...SUBNATIONAL])
  log.dropped.push(nameOf.get(ctr));
log.filled = rows.filter(
  (r) => !r.iso3 && r.latest && isoByCtr.has(r.ctrnum),
).length;

const best = new Map();
for (const r of rows) {
  if (!r.latest || r.ctrnum === EAST_GERMANY || SUBNATIONAL.has(r.ctrnum))
    continue;
  if (r.tradSecular === null && r.survSelfExpr === null) continue;
  const iso3 = isoByCtr.get(r.ctrnum);
  if (!iso3) continue;
  const prior = best.get(iso3);
  if (!prior || r.year > prior.year) best.set(iso3, { ...r, iso3 });
}
for (const [ctr, name] of nameOf) {
  const iso3 = isoByCtr.get(ctr);
  if (iso3 && !best.has(iso3))
    log.unmapped.push(`${name} (no latest row with scores)`);
}

const round = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
const countries = [...best.values()]
  .sort((a, b) => a.iso3.localeCompare(b.iso3))
  .map((r) => ({
    iso3: r.iso3,
    name: r.ctrnum === WEST_GERMANY ? 'Germany' : r.country,
    year: r.year,
    wave: r.wave,
    tradSecular: round(r.tradSecular),
    survSelfExpr: round(r.survSelfExpr),
    ...(r.ctrnum === WEST_GERMANY ? { note: 'West German sample' } : {}),
  }));

const out = new URL(
  '../src/data/local_data/values/values.json',
  import.meta.url,
);
writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        placeholder: false,
        title: 'Inglehart-Welzel cultural map country scores',
        source:
          'World Values Survey Association, WVS Wave 1 to 6 Key Aggregates (2019), developed by Christian Welzel. https://www.worldvaluessurvey.org/WVSContents.jsp',
        wave: 'latest available WVS wave per country',
        retrieved: new Date().toISOString().slice(0, 10),
        dimensions: {
          tradSecular:
            'SVI_culmap: traditional (negative) to secular-rational (positive)',
          survSelfExpr:
            'EVI_culmap: survival (negative) to self-expression (positive)',
        },
      },
      countries,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Wrote ${countries.length} countries to ${out.pathname}`);
console.log(
  `Blank ISO3 filled from other rows of the same country: ${log.filled} latest rows`,
);
console.log(
  `ISO3 from the standard-code fallback (never present in the file): ${log.fallback.join(', ') || 'none'}`,
);
console.log(`Dropped on purpose: ${log.dropped.join(', ')}`);
console.log(`Unmapped or without scores: ${log.unmapped.join(', ') || 'none'}`);
const years = countries.map((c) => c.year);
console.log(
  `Survey years ${Math.min(...years)} to ${Math.max(...years)}; waves ${[...new Set(countries.map((c) => c.wave))].sort().join(', ')}`,
);
