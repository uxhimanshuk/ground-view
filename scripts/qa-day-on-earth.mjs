#!/usr/bin/env node
/**
 * qa-day-on-earth.mjs: plays the bundled "A day on Earth" scene headless and
 * saves one screenshot per beat to .ground-view-reports/scene/.
 *
 * Run:  node scripts/qa-day-on-earth.mjs --url http://localhost:4620
 * Exits non-zero if the scene is not listed first, does not finish, or a shot
 * that should have a caption shows none (skipped beats are reported, not failed).
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.ground-view-reports', 'scene');
const argv = process.argv.slice(2);
const i = argv.indexOf('--url');
const APP_URL = i >= 0 ? argv[i + 1] : 'http://localhost:4620';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  ${detail}` : ''}`,
  );
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 180000,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1100, height: 700 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${APP_URL}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${APP_URL}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__godsEyeView?.sceneDirector, {
    timeout: 60000,
  });
  await sleep(4000);

  const first = await page.evaluate(
    () => window.__godsEyeView.sceneDirector._project.scenes[0].id,
  );
  check('A day on Earth is listed first', first === 'a-day-on-earth', first);

  await page.evaluate(() => {
    window.__godsEyeView.sceneDirector.startScene('a-day-on-earth', {
      single: true,
    });
  });
  const seen = new Set();
  let n = 0;
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 720000) {
    await sleep(700);
    const s = await page.evaluate(() => {
      const d = window.__godsEyeView.sceneDirector;
      const shot = d._project.scenes
        .find((x) => x.id === 'a-day-on-earth')
        .shots.find((x) => x.id === d._selectedShotId);
      const cap = document.querySelector('.gv-scene-caption');
      const dm = window.__godsEyeView.dataManager;
      const on = [
        'unrest',
        'attention',
        'refugees',
        'migrant-stock',
        'indicators',
        'crises',
      ].filter((id) => dm.isEnabled(id));
      return {
        running: d._running,
        title: shot?.title ?? null,
        caption: cap?.dataset.visible === 'true' ? cap.textContent : null,
        on,
      };
    });
    if (s.title && !seen.has(s.title)) {
      seen.add(s.title);
      const beatTarget = await page.evaluate(
        () => window.__godsEyeView.sceneDirector._beats?.getTarget?.() ?? null,
      );
      await sleep(4500);
      const again = await page.evaluate(() => {
        const cap = document.querySelector('.gv-scene-caption');
        return cap?.dataset.visible === 'true' ? cap.textContent : null;
      });
      n += 1;
      // Framing: the ground point a beat frames must land in the middle 40% of
      // the canvas, both ways. Projected with the scene's own transform.
      // Let a long flight land first: wait for the camera to stop moving.
      if (beatTarget)
        await page.evaluate(async () => {
          const cam = window.__godsEyeView.viewer.camera;
          const key = () => cam.positionWC.toString();
          for (let k = 0, last = '', still = 0; k < 40 && still < 3; k += 1) {
            await new Promise((r) => setTimeout(r, 300));
            const now = key();
            still = now === last ? still + 1 : 0;
            last = now;
          }
        });
      const framing = await page.evaluate((target) => {
        const g = window.__godsEyeView;
        if (!target) return null;
        const { viewer } = g;
        const a = 6378137;
        const f = 1 / 298.257223563;
        const e2 = f * (2 - f);
        const lat = (target.lat * Math.PI) / 180;
        const lon = (target.lon * Math.PI) / 180;
        const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        const Cartesian3 = viewer.camera.positionWC.constructor;
        const ground = new Cartesian3(
          nu * Math.cos(lat) * Math.cos(lon),
          nu * Math.cos(lat) * Math.sin(lon),
          nu * (1 - e2) * Math.sin(lat),
        );
        const p = viewer.scene.cartesianToCanvasCoordinates(ground);
        const c = viewer.scene.canvas;
        if (!p) return { target, offscreen: true };
        return {
          target,
          x: p.x / c.clientWidth,
          y: p.y / c.clientHeight,
        };
      }, beatTarget);
      if (framing) {
        const inMiddle =
          !framing.offscreen &&
          framing.x >= 0.3 &&
          framing.x <= 0.7 &&
          framing.y >= 0.3 &&
          framing.y <= 0.7;
        check(
          `beat ${n} "${s.title}" target is in the middle 40% of the frame`,
          inMiddle,
          framing.offscreen
            ? 'off screen'
            : `x=${framing.x.toFixed(2)} y=${framing.y.toFixed(2)}`,
        );
      }
      const overlap = await page.evaluate(() => {
        const cap = document.querySelector('.gv-scene-caption');
        if (!cap || cap.dataset.visible !== 'true') return null;
        const r = cap.getBoundingClientRect();
        const hits = [
          ...document.querySelectorAll(
            '.world-overlay-card, [data-overlay-variant="card"]',
          ),
        ].filter((el) => {
          const b = el.getBoundingClientRect();
          return (
            b.width > 0 &&
            b.height > 0 &&
            b.left < r.right &&
            b.right > r.left &&
            b.top < r.bottom &&
            b.bottom > r.top
          );
        });
        return hits.length;
      });
      if (overlap !== null)
        check(
          `beat ${n} caption overlaps no card element`,
          overlap === 0,
          `${overlap}`,
        );
      const file = `${String(n).padStart(2, '0')}-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      await page.screenshot({ path: path.join(OUT, file) });
      console.log(
        `  beat ${n} "${s.title}" layers=[${s.on.join(',')}] caption=${again ? JSON.stringify(again) : 'none (skipped or fading)'}  -> ${file}`,
      );
      check(`no em-dash in beat ${n} caption`, !(again || '').includes('—'));
    }
    last = s.running ? '' : 'done';
    if (!s.running && seen.size) break;
  }
  check(
    'the scene ran to the end',
    last === 'done',
    `${seen.size} beats in ${Math.round((Date.now() - started) / 1000)} s`,
  );
  check('all ten beats played', seen.size === 10, `${seen.size}`);
  check(
    'no uncaught page errors',
    errors.length === 0,
    errors.slice(0, 2).join(' | '),
  );
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
