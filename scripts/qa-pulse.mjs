#!/usr/bin/env node
/**
 * qa-pulse.mjs: headless proof for the Pulse layers (unrest, attention, crises).
 *
 * Drives the real app in headless Chromium against a running dev server
 * (default :4577), using live data:
 *
 *   (i)   UNREST    loads protest clusters from /api/unrest, no error,
 *                   feed state reads ON (the GDELT export files are the normal source).
 *   (ii)  ATTENTION loads per-language top articles straight from Wikimedia.
 *   (iii) CRISES    loads GDACS disaster alerts (keyless)
 *                   on the server, otherwise reports keyRequired honestly.
 *   (iv)  CARDS     a real click on a rendered marker opens the Pulse card with
 *                   source, as-of date, caveat and http(s) links.
 *   (v)   PANEL     the layer panel shows a "Pulse" group listing all three.
 *
 * Screenshots go to qa-shots/ (gitignored).
 *
 * Run:  node scripts/qa-pulse.mjs --url http://localhost:4577
 * Exits non-zero on any FAIL.
 */

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(REPO_ROOT, 'qa-shots');
const argv = process.argv.slice(2);
const getOpt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const APP_URL = getOpt('--url', 'http://localhost:4577');
const HEADFUL = argv.includes('--headful');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${detail ? `  ${detail}` : ''}`);
}

async function enableAndSettle(page, id, timeoutS = 60) {
  return page.evaluate(
    async (layerId, seconds) => {
      const dm = window.__godsEyeView.dataManager;
      await dm.setEnabled(layerId, true);
      const mod = dm.layers.get(layerId).module;
      let stats = null;
      for (let i = 0; i < seconds; i++) {
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

async function clickFirstMarker(page, id) {
  const target = await page.evaluate(async (layerId) => {
    const gev = window.__godsEyeView;
    const mod = gev.dataManager.layers.get(layerId).module;
    const record = mod.getAnalystRecords(1)[0];
    if (!record) return null;
    const ell = gev.viewer.scene.globe.ellipsoid;
    const d2r = Math.PI / 180;
    try {
      gev.viewer.camera.cancelFlight();
    } catch {
      /* no flight active */
    }
    gev.viewer.camera.setView({
      destination: ell.cartographicToCartesian({
        longitude: record.lon * d2r,
        latitude: record.lat * d2r,
        height: 2_500_000,
      }),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    for (let i = 0; i < 10; i++) {
      gev.viewer.scene.requestRender();
      await new Promise((r) => setTimeout(r, 200));
    }
    const position = ell.cartographicToCartesian({
      longitude: record.lon * d2r,
      latitude: record.lat * d2r,
      height: 0,
    });
    const px = gev.viewer.scene.cartesianToCanvasCoordinates(position);
    const rect = gev.viewer.scene.canvas.getBoundingClientRect();
    return px ? { x: rect.left + px.x, y: rect.top + px.y, name: record.name } : null;
  }, id);
  if (!target) return null;
  await page.mouse.click(target.x, target.y);
  await sleep(600);
  return page.evaluate(() => {
    const card = document.getElementById('pulse-card');
    if (!card || card.hidden) return null;
    return {
      text: card.textContent,
      links: [...card.querySelectorAll('a')].map((a) => a.href),
    };
  });
}

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: !HEADFUL,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    defaultViewport: { width: 1400, height: 900 },
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
      { timeout: 60000 },
    );
    await sleep(5000);
    await page.keyboard.press('Escape');

    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && el.textContent.trim() === 'Pulse')
        .map((el) => el.textContent.trim()),
    );
    record('(v) panel shows a Pulse group', groups.length > 0);

    const unrest = await enableAndSettle(page, 'unrest');
    record('(i) unrest loads clusters', unrest?.count > 0 && !unrest.error, JSON.stringify(unrest));
    record('(i) unrest feed state is not FALLBACK (export files are the normal source)', unrest?.fallback === false);
    const unrestCard = await clickFirstMarker(page, 'unrest');
    record(
      '(iv) unrest marker click opens a card with caveat and http(s) links',
      !!unrestCard &&
        /Machine-coded from news reports/.test(unrestCard.text) &&
        /Source: GDELT/.test(unrestCard.text) &&
        unrestCard.links.length > 0 &&
        unrestCard.links.every((l) => /^https?:/.test(l)),
      unrestCard ? unrestCard.text.slice(0, 120) : 'no card',
    );
    await page.screenshot({ path: path.join(SHOTS_DIR, 'pulse-unrest.png') });

    const attention = await enableAndSettle(page, 'attention');
    record('(ii) attention loads language editions', attention?.count >= 15 && !attention.error, JSON.stringify(attention));
    const attentionCard = await clickFirstMarker(page, 'attention');
    record(
      '(iv) attention marker click opens a card with five linked titles',
      !!attentionCard &&
        /Pageviews include some automated traffic/.test(attentionCard.text) &&
        attentionCard.links.length === 5 &&
        attentionCard.links.every((l) => /^https:\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(l)),
      attentionCard ? attentionCard.text.slice(0, 120) : 'no card',
    );
    await page.screenshot({ path: path.join(SHOTS_DIR, 'pulse-attention.png') });

    const crises = await enableAndSettle(page, 'crises');
    record('(iii) crises loads GDACS alerts', crises?.count > 0 && !crises.error, JSON.stringify(crises));
    const crisisCard = await clickFirstMarker(page, 'crises');
    record(
      '(iv) alert marker click opens a card with the GDACS caveat',
      !!crisisCard && /Conflicts and epidemics are not covered/.test(crisisCard.text),
      crisisCard ? crisisCard.text.slice(0, 120) : 'no card',
    );
    await page.screenshot({ path: path.join(SHOTS_DIR, 'pulse-crises.png') });
    record('no uncaught page errors', errors.length === 0, errors.join(' | '));
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
