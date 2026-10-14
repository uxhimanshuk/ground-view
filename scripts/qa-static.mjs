#!/usr/bin/env node
/**
 * qa-static.mjs: headless QA of the static demo build, served under a path
 * prefix the way himanshukalra.com/groundview proxies it, with the snapshot
 * files read from a local folder.
 *
 *   GV_STATIC_OUT_DIR=dist-qa VITE_SNAPSHOT_BASE=http://127.0.0.1:4631/__snapshots__/ \
 *     npx vite build --config server/standalone/vite.static.config.js
 *   node scripts/build-snapshots.mjs /tmp/snap --previous-base none
 *   node scripts/qa-static.mjs --dist dist-qa --snapshots /tmp/snap [--port 4631] \
 *     [--prefix /groundview] [--shot .ground-view-reports/static-home.png] [--skip-scene]
 *
 * Checks: the eight Ground View layers each render rows, no request goes to
 * /api/, no console or page errors, no feed shows STALE, and the "A day on
 * Earth" scene plays to the end. Exits non-zero on any failure.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve-static.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const DIST = path.resolve(ROOT, arg('--dist', 'dist-static'));
const SNAPSHOTS = path.resolve(ROOT, arg('--snapshots', 'out'));
const PORT = Number(arg('--port', 4631));
const PREFIX = arg('--prefix', '/groundview');
const SHOT = path.resolve(
  ROOT,
  arg('--shot', '.ground-view-reports/static-home.png'),
);
const SKIP_SCENE = argv.includes('--skip-scene');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? `  ${detail}` : ''}`,
  );
};

const LAYERS = [
  'unrest',
  'attention',
  'crises',
  'news-tone',
  'refugees',
  'indicators',
  'values',
  'languages',
];

const server = createStaticServer({
  root: DIST,
  prefix: PREFIX,
  snapshots: SNAPSHOTS,
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${PORT}`;
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 180000,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
  defaultViewport: { width: 1280, height: 800 },
});
try {
  const page = await browser.newPage();
  const apiRequests = [];
  const errors = [];
  const snapshotRequests = new Set();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === origin && /(^|\/)api\//.test(u.pathname))
      apiRequests.push(r.url());
    if (u.pathname.startsWith('/__snapshots__/'))
      snapshotRequests.add(u.pathname.split('/').pop());
  });
  page.on('pageerror', (e) => errors.push(`pageerror ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(`${origin}${PREFIX}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${origin}${PREFIX}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__godsEyeView?.dataManager, {
    timeout: 60000,
  });
  await sleep(3000);

  const ui = await page.evaluate(() => ({
    note: document.getElementById('gv-static-note')?.textContent ?? null,
    noteLink: document.querySelector('#gv-static-note a')?.href ?? null,
    voice: Boolean(document.getElementById('gev-voice-control')),
    powerUp: (() => {
      const chip = document.getElementById('key-setup-chip');
      return Boolean(chip && !chip.hidden && chip.offsetParent);
    })(),
    legacy: Boolean(document.querySelector('.data-layer-legacy')),
  }));
  check(
    'about line shows with a repo link',
    /Live demo\. Feeds refresh every 30 minutes\./.test(ui.note || '') &&
      /github\.com\/uxhimanshuk\/ground-view/.test(ui.noteLink || ''),
    ui.note,
  );
  check('no voice control', !ui.voice);
  check('no POWER UP chip', !ui.powerUp);
  check('no God’s Eye View layer section', !ui.legacy);
  check(
    'about line has no em-dash',
    !(ui.note || '').includes('—'),
  );

  for (const id of LAYERS) {
    const result = await page.evaluate(async (layerId) => {
      const dm = window.__godsEyeView.dataManager;
      if (!dm.isEnabled(layerId)) await dm.setEnabled(layerId, true);
      const layer = dm.layers.get(layerId)?.module;
      for (let i = 0; i < 80; i += 1) {
        const stats = layer?.getStats?.() ?? {};
        if (stats.count > 0 || stats.error) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const stats = layer?.getStats?.() ?? {};
      return {
        count: stats.count ?? 0,
        error: stats.error ?? null,
        stale: stats.stale === true,
        lastUpdate: stats.lastUpdate ?? null,
        analyst: layer?.getAnalystRecords?.().length ?? null,
      };
    }, id);
    check(
      `${id} renders rows`,
      result.count > 0 && !result.error,
      `count=${result.count} analyst=${result.analyst} error=${result.error}`,
    );
    if (['unrest', 'attention', 'crises', 'news-tone'].includes(id))
      check(
        `${id} reports a real snapshot time, not STALE`,
        result.lastUpdate != null &&
          result.lastUpdate < Date.now() &&
          result.stale === false,
        `age ${Math.round((Date.now() - result.lastUpdate) / 60000)} min`,
      );
  }
  check(
    'all four snapshot files were requested',
    ['unrest.json', 'attention.json', 'crises.json', 'news-tone.json'].every(
      (f) => snapshotRequests.has(f),
    ),
    [...snapshotRequests].join(','),
  );

  // Show the home globe: the three first-visit layers on, the rest off.
  await page.evaluate(async () => {
    const dm = window.__godsEyeView.dataManager;
    for (const id of [
      'crises',
      'news-tone',
      'indicators',
      'values',
      'languages',
    ])
      if (dm.isEnabled(id)) await dm.setEnabled(id, false);
  });
  await sleep(4000);
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  await page.screenshot({ path: SHOT });
  console.log(`  screenshot -> ${path.relative(ROOT, SHOT)}`);

  if (!SKIP_SCENE) {
    await page.waitForFunction(() => window.__godsEyeView?.sceneDirector, {
      timeout: 60000,
    });
    // Do not await the run itself: startScene resolves when the scene ends.
    await page.evaluate(() => {
      window.__godsEyeView.sceneDirector.startScene('a-day-on-earth', {
        single: true,
      });
    });
    const seen = new Set();
    const started = Date.now();
    let done = false;
    let began = false;
    while (Date.now() - started < 720000) {
      await sleep(1000);
      const s = await page.evaluate(() => {
        const d = window.__godsEyeView.sceneDirector;
        const shot = d._project.scenes
          .find((x) => x.id === 'a-day-on-earth')
          .shots.find((x) => x.id === d._selectedShotId);
        return { running: d._running, title: shot?.title ?? null };
      });
      if (s.running) began = true;
      if (s.title) seen.add(s.title);
      if (began && !s.running) {
        done = true;
        break;
      }
    }
    check(
      'the A day on Earth scene plays to the end',
      done && seen.size === 10,
      `${seen.size} beats in ${Math.round((Date.now() - started) / 1000)} s`,
    );
  }

  check(
    'no request went to /api/',
    apiRequests.length === 0,
    apiRequests.slice(0, 3).join(' '),
  );
  check(
    'no console or page errors',
    errors.length === 0,
    errors.slice(0, 3).join(' | '),
  );
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `FAILED ${failed}` : 'ALL PASS');
process.exit(failed ? 1 : 0);
