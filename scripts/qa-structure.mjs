#!/usr/bin/env node
/**
 * qa-structure.mjs: headless proof for the Structure layers
 * (indicators, values, languages, news-tone).
 *
 * Drives the real app in headless Chromium against a running dev server
 * (default http://localhost:4430). For each layer it enables the layer, waits
 * for stats, checks the data loaded (or, for values, that real WVS aggregates
 * are loaded), clicks the screen centre over Germany to open a card, and saves a
 * screenshot to qa-shots/ (gitignored). News tone needs the dev server's
 * /api/news-tone proxy and live GDELT access.
 *
 * Run:  node scripts/qa-structure.mjs --url http://localhost:4430
 * Exits non-zero on any FAIL.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const APP_URL = opt('--url', 'http://localhost:4430');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  ${detail}` : ''}`,
  );
};

async function executable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    await puppeteer.executablePath().catch(() => null),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c));
}

async function setView(page, lon, lat, height) {
  await page.evaluate(
    (lo, la, h) => {
      const gev = window.__godsEyeView;
      const d2r = Math.PI / 180;
      try {
        gev.viewer.camera.cancelFlight();
      } catch {
        /* none */
      }
      gev.viewer.camera.setView({
        destination: gev.viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: lo * d2r,
          latitude: la * d2r,
          height: h,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      gev.viewer.scene.requestRender?.();
    },
    lon,
    lat,
    height,
  );
}

async function enable(page, id, timeoutS = 60) {
  return page.evaluate(
    async (layerId, tS) => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled(layerId, true);
      const mod = dm.layers.get(layerId).module;
      let stats = null;
      for (let i = 0; i < tS; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        stats = mod.getStats();
        if (stats.count > 0 || stats.error) break;
      }
      return stats;
    },
    id,
    timeoutS,
  );
}

async function overlayEntries(page, id) {
  return page.evaluate(
    (layerId) =>
      window.__gevWorldOverlay?.getDiagnostics?.()?.entriesBySource?.[
        layerId
      ] || 0,
    id,
  );
}

async function main() {
  const res = await fetch(APP_URL).catch(() => null);
  if (!res?.ok) {
    console.error(`Dev server not reachable at ${APP_URL}`);
    process.exit(2);
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    ...((await executable()) ? { executablePath: await executable() } : {}),
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-dev-shm-usage',
      '--window-size=1440,900',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000 },
    );
    await sleep(5000);
    await page.keyboard.press('Escape');
    // A fresh visit starts with the Ground View defaults on; their markers sit
    // over the click point, so clear them to test each Structure layer alone.
    await page.evaluate(async () => {
      for (const id of ['unrest', 'attention', 'refugees'])
        await window.__godsEyeView.dataManager.setEnabled(id, false);
    });

    for (const id of ['indicators', 'values', 'news-tone']) {
      console.log(`\n${id}`);
      await setView(page, 10, 51, 3_500_000);
      const stats = await enable(page, id);
      record(
        `${id} loaded countries`,
        stats?.count > 50 && !stats.error && stats.placeholder !== true,
        JSON.stringify(stats),
      );
      // The country shapes build after the rows arrive; retry the click until
      // they exist rather than assuming a fixed delay is enough.
      let cards = 0;
      for (let attempt = 0; attempt < 5 && cards < 1; attempt++) {
        await sleep(2500);
        await page.mouse.move(700, 440);
        await sleep(300);
        await page.mouse.click(720, 450);
        await sleep(1500);
        cards = await overlayEntries(page, id);
      }
      record(`${id} click opens a card`, cards >= 1, `entries=${cards}`);
      const records = await page.evaluate(
        (layerId) =>
          window.__godsEyeView.dataManager.layers
            .get(layerId)
            .module.getAnalystRecords(5),
        id,
      );
      record(
        `${id} analyst records`,
        records.length > 0 && records[0].kind === 'country',
      );
      await page.screenshot({
        path: path.join(SHOTS_DIR, `structure-${id}.png`),
      });
      await page.evaluate(
        (layerId) =>
          window.__godsEyeView.dataManager.setEnabled(layerId, false),
        id,
      );
    }

    console.log('\nlanguages');
    await setView(page, 10, 46, 1_500_000);
    const stats = await enable(page, 'languages');
    record(
      'languages loaded points',
      stats?.count > 8000 && !stats.error,
      JSON.stringify(stats),
    );
    await sleep(2500);
    const labels = await overlayEntries(page, 'languages');
    record('languages labels at close zoom', labels > 0, `entries=${labels}`);
    await page.screenshot({
      path: path.join(SHOTS_DIR, 'structure-languages.png'),
    });
    const rec = await page.evaluate(() =>
      window.__godsEyeView.dataManager.layers
        .get('languages')
        .module.getAnalystRecords(3),
    );
    record(
      'languages analyst records',
      rec.length === 3 && rec[0].kind === 'language',
    );
    await page.evaluate(() =>
      window.__godsEyeView.dataManager.setEnabled('languages', false),
    );
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
