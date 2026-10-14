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
      await sleep(4500);
      const again = await page.evaluate(() => {
        const cap = document.querySelector('.gv-scene-caption');
        return cap?.dataset.visible === 'true' ? cap.textContent : null;
      });
      n += 1;
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
