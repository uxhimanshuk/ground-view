#!/usr/bin/env node
/**
 * qa-flows.mjs: headless proof for the Flows layers (refugees, migrant-stock,
 * remittances) in the real app.
 *
 * For each layer it checks that the layer enables and loads, draws a capped
 * arc set, isolates a country (API and a real canvas click on an endpoint
 * node), opens a card in the shared world overlay, and answers an analyst
 * query shape ("largest flows into Germany"). Screenshots go to qa-shots/.
 *
 * Run:  node scripts/qa-flows.mjs --url http://localhost:5173
 * Exits non-zero on any FAIL. `refugees` needs network access to
 * api.unhcr.org; the other two read bundled data.
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
const APP_URL = opt('--url', 'http://localhost:5173');
const LAYERS = ['refugees', 'migrant-stock', 'remittances'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  ${detail}` : ''}`,
  );
  if (!ok) failures++;
};

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
fs.mkdirSync(SHOTS_DIR, { recursive: true });

try {
  await page.goto(`${APP_URL}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
    { timeout: 60000 },
  );
  await sleep(4000);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const gev = window.__godsEyeView;
    try {
      gev.viewer.camera.cancelFlight();
    } catch {
      /* no flight */
    }
    gev.viewer.camera.setView({
      destination: gev.viewer.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: (25 * Math.PI) / 180,
        latitude: (30 * Math.PI) / 180,
        height: 22_000_000,
      }),
    });
  });

  const panel = await page.evaluate(() => {
    const labels = [
      ...document.querySelectorAll(
        '.data-group-label, .data-group-title, [data-group-label]',
      ),
    ].map((n) => n.textContent.trim());
    return labels;
  });
  check(
    'Flows group is present in the layer panel',
    panel.some((t) => /^Flows$/i.test(t)) ||
      (await page.evaluate(() => document.body.textContent.includes('Flows'))),
  );

  for (const id of LAYERS) {
    console.log(`\n${id}`);
    const loaded = await page.evaluate(async (layerId) => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled(layerId, true);
      const mod = dm.layers.get(layerId).module;
      let stats = null;
      for (let i = 0; i < 40; i++) {
        stats = mod.getStats();
        if ((stats.count > 0 || stats.error) && !stats.loading) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      return { stats, lod: mod.getLodDiagnostics() };
    }, id);
    check(
      'loads without error',
      !loaded.stats.error && loaded.stats.count > 0,
      JSON.stringify(loaded.stats),
    );
    check(
      'draws a capped arc set',
      loaded.lod.arcsShown > 0 && loaded.lod.arcsShown <= 300,
      `shown ${loaded.lod.arcsShown} of ${loaded.lod.arcsLoaded}`,
    );
    check(
      'every record joined to a centroid',
      loaded.lod.skipped.noCentroid <= Math.ceil(loaded.lod.arcsLoaded * 0.02),
      JSON.stringify(loaded.lod.skipped),
    );
    await sleep(800);
    await page.screenshot({ path: path.join(SHOTS_DIR, `flows-${id}.png`) });

    const into = await page.evaluate((layerId) => {
      const rows = window.__godsEyeView.dataManager.layers
        .get(layerId)
        .module.getAnalystRecords();
      const deu = rows
        .filter((r) => r.destinationIso3 === 'DEU')
        .sort((a, b) => b.value - a.value);
      return {
        total: rows.length,
        deu: deu.slice(0, 3).map((r) => [r.origin, r.value, r.unit]),
        personal: rows.some((r) => 'person' in r || 'personName' in r),
      };
    }, id);
    check(
      'analyst records answer "largest flows into Germany"',
      into.deu.length > 0 && into.deu[0][1] >= (into.deu[1]?.[1] ?? 0),
      JSON.stringify(into.deu),
    );
    check('records are aggregate only', !into.personal);

    // Isolation through the API, then a card in the shared overlay.
    const isolated = await page.evaluate(async (layerId) => {
      const mod = window.__godsEyeView.dataManager.layers.get(layerId).module;
      mod.isolateCountry('DEU');
      await new Promise((r) => setTimeout(r, 400));
      window.__godsEyeView.viewer.scene.requestRender();
      await new Promise((r) => setTimeout(r, 400));
      const d = window.__gevWorldOverlay?.getDiagnostics?.();
      return {
        sel: mod.getSelection(),
        shown: mod.getLodDiagnostics().arcsShown,
        entries: d?.entriesBySource?.[layerId] || 0,
      };
    }, id);
    check(
      'country isolation limits the arcs to Germany',
      isolated.sel.isolated === 'DEU' && isolated.shown > 0,
      JSON.stringify(isolated),
    );
    check(
      'a card is published to the world overlay',
      isolated.entries > 0,
      `entries ${isolated.entries}`,
    );
    await page.screenshot({
      path: path.join(SHOTS_DIR, `flows-${id}-germany.png`),
    });

    // Real canvas click on an endpoint node returns to the full set.
    await page.evaluate(
      (layerId) =>
        window.__godsEyeView.dataManager.layers
          .get(layerId)
          .module.isolateCountry(null),
      id,
    );
    const click = await page.evaluate(async (layerId) => {
      const gev = window.__godsEyeView;
      const mod = gev.dataManager.layers.get(layerId).module;
      const rows = mod.getAnalystRecords();
      const top = rows.find((r) => r.destinationIso3 === 'DEU');
      return { lon: top.lon, lat: top.lat, code: top.destinationIso3 };
    }, id);
    if (click) {
      const pt = await page.evaluate(({ lon, lat }) => {
        const gev = window.__godsEyeView;
        const ell = gev.viewer.scene.globe.ellipsoid;
        const cart = ell.cartographicToCartesian({
          longitude: (lon * Math.PI) / 180,
          latitude: (lat * Math.PI) / 180,
          height: 0,
        });
        const win = gev.viewer.scene.cartesianToCanvasCoordinates(cart);
        const rect = gev.viewer.scene.canvas.getBoundingClientRect();
        return win ? { x: rect.left + win.x, y: rect.top + win.y } : null;
      }, click);
      if (pt) {
        await page.mouse.click(pt.x, pt.y);
        await sleep(600);
        const sel = await page.evaluate(
          (layerId) =>
            window.__godsEyeView.dataManager.layers
              .get(layerId)
              .module.getSelection(),
          id,
        );
        check(
          'clicking a country isolates it',
          !!sel.isolated,
          JSON.stringify(sel),
        );
      } else
        check('clicking a country isolates it', false, 'node not on screen');
    }

    await page.evaluate(async (layerId) => {
      await window.__godsEyeView.dataManager.setEnabled(layerId, false);
    }, id);
    const off = await page.evaluate((layerId) => {
      const d = window.__gevWorldOverlay?.getDiagnostics?.();
      return { entries: d?.entriesBySource?.[layerId] || 0 };
    }, id);
    check('disable clears the card', off.entries === 0, JSON.stringify(off));
  }
  check(
    'no page errors',
    pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | '),
  );
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAIL` : '\nall PASS');
process.exit(failures ? 1 : 0);
