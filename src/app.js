import { LANGUAGE_HEARTLANDS } from './heartlands.js';
import {
  createAttention, sumViews, articleUrl, yesterdayUtc, shiftDay,
} from './attention.js';
import { resolveTitles, groupAcross } from './across.js';
import { loadUnrest } from './unrest.js';
import { createGlobe } from './globe.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const MIN_DAY = '2016-01-01';
const BY_CODE = new Map(LANGUAGE_HEARTLANDS.map((h) => [h.code, h]));
const TOTAL = LANGUAGE_HEARTLANDS.length;

/** Tiny DOM helper: all text goes through textContent. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

const attention = createAttention();
const state = {
  day: yesterdayUtc(),
  selected: null,
  editions: new Map(), // code -> {status, data?}
  resolving: 0,
  highlightKey: null,
  unrest: { on: false, status: 'idle', data: null },
  dotInfo: null,
  gen: 0,
};

let globe;

// ---------- hash ----------
function parseHash(hash) {
  const m = /^#(\d{4}-\d\d-\d\d)(?:-([a-z]{2,3}))?$/.exec(hash);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return { day: m[1], code: m[2] && BY_CODE.has(m[2]) ? m[2] : null };
}
// The newest day with published figures. Wikimedia publishes yesterday's top
// lists some hours after UTC midnight, so boot probes English once and moves
// this back a day if needed, rather than letting every edition 404.
let latestDay = yesterdayUtc();
const clampDay = (d) => (d > latestDay ? latestDay : d < MIN_DAY ? MIN_DAY : d);

function writeHash() {
  const token = `#${state.day}${state.selected ? `-${state.selected}` : ''}`;
  if (location.hash !== token) history.replaceState(null, '', token);
}

// ---------- loading ----------
function startLoad() {
  const gen = ++state.gen;
  state.editions = new Map(LANGUAGE_HEARTLANDS.map((x) => [x.code, { status: 'pending' }]));
  state.highlightKey = null;
  globe.setHighlight([]);
  refreshPins();
  renderAll();
  for (const hl of LANGUAGE_HEARTLANDS) {
    attention.loadEdition(hl, state.day).then(
      (data) => {
        if (gen !== state.gen) return;
        state.editions.set(hl.code, { status: 'ok', data });
        refreshPins();
        scheduleRender();
        state.resolving++;
        resolveTitles(hl.code, data.items.map((i) => i.title), { limit: attention.limit })
          .then((map) => {
            if (gen !== state.gen) return;
            for (const it of data.items) {
              const r = map.get(it.title);
              if (r) { it.qid = r.qid; it.en = r.en; }
            }
            data.resolved = true;
          })
          .finally(() => {
            if (gen !== state.gen) return;
            state.resolving--;
            data.resolved = true;
            scheduleRender();
          });
      },
      (error) => {
        if (gen !== state.gen) return;
        state.editions.set(hl.code, { status: 'fail', error: String(error.message ?? error) });
        refreshPins();
        scheduleRender();
      },
    );
  }
}

function pinRadius(data) {
  const s = Math.max(1, sumViews(data.items, 10));
  return Math.min(10, Math.max(3.5, 3.5 + (Math.log10(s) - 4.5) * 2.4));
}

function refreshPins() {
  globe.setPins(
    LANGUAGE_HEARTLANDS.map((hl) => {
      const e = state.editions.get(hl.code);
      const ok = e?.status === 'ok';
      return {
        code: hl.code, lon: hl.lon, lat: hl.lat, name: hl.languageName,
        pending: e?.status !== 'ok', failed: e?.status === 'fail',
        r: ok ? pinRadius(e.data) : 3,
      };
    }),
  );
}

// ---------- rendering ----------
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function renderAll() {
  renderHeader();
  renderStatus();
  renderPanel();
}

function renderHeader() {
  $('day').textContent = state.day;
  $('day').setAttribute('datetime', state.day);
  $('next').disabled = state.day >= latestDay;
  $('prev').disabled = state.day <= MIN_DAY;
}

function renderStatus() {
  const vals = [...state.editions.entries()];
  const ok = vals.filter(([, e]) => e.status === 'ok').length;
  const failed = vals.filter(([, e]) => e.status === 'fail').map(([c]) => BY_CODE.get(c).languageName);
  let text = `${ok} of ${TOTAL} languages loaded`;
  if (failed.length) text += `. Failed: ${failed.join(', ')}`;
  $('status').textContent = text;
}

function editionSummaries() {
  return LANGUAGE_HEARTLANDS.filter((hl) => state.editions.get(hl.code)?.status === 'ok')
    .map((hl) => ({
      code: hl.code, languageName: hl.languageName,
      items: state.editions.get(hl.code).data.items,
    }));
}

function renderPanel() {
  const panel = $('panel-body');
  const scroll = panel.scrollTop;
  panel.replaceChildren(
    ...[
      langButtons(),
      state.selected ? editionView(state.selected) : acrossView(),
      unrestNote(),
    ].filter(Boolean),
  );
  panel.scrollTop = scroll;
}

function langButtons() {
  return h('ul', { class: 'sr-only', 'aria-label': 'Languages' },
    LANGUAGE_HEARTLANDS.map((hl) =>
      h('li', null, h('button', { type: 'button', onclick: () => select(hl.code) },
        `${hl.languageName}, ${state.editions.get(hl.code)?.status ?? 'pending'}`))));
}

function acrossView() {
  const eds = editionSummaries();
  const loading = [...state.editions.values()].some((e) => e.status === 'pending');
  const done = !loading && state.resolving === 0;
  const { shared, only } = groupAcross(eds);
  const wrap = h('div', null, h('h2', null, 'Read across languages'));
  if (!eds.length) {
    wrap.append(h('p', { class: 'muted' }, loading ? 'Loading the most-read articles.' : 'No language loaded for this day.'));
    return wrap;
  }
  if (!done) wrap.append(h('p', { class: 'muted' }, 'Matching articles across languages, the list will fill in.'));
  wrap.append(h('h3', null, 'Read in several languages'));
  if (!shared.length) {
    wrap.append(h('p', { class: 'muted' }, done ? 'No article reached the top 25 of two or more languages.' : 'Nothing matched yet.'));
  } else {
    wrap.append(h('ol', { class: 'list shared' }, shared.slice(0, 40).map((g) => {
      const on = state.highlightKey === g.key;
      return h('li', null, h('button', {
        type: 'button', class: 'item', 'aria-pressed': on ? 'true' : 'false',
        onclick: () => highlightGroup(g),
      },
      h('span', { class: 'item-title' }, g.title),
      h('span', { class: 'item-meta' }, `${g.count} languages · ${g.languages.join(', ')}`),
      h('span', { class: 'num' }, fmt.format(g.views))));
    })));
  }
  wrap.append(h('h3', null, 'Only here'));
  wrap.append(h('p', { class: 'muted small' }, 'Each language’s top article that no other language had in its top 25.'));
  wrap.append(h('ul', { class: 'list only' }, only.map((o) =>
    h('li', null, h('button', { type: 'button', class: 'item', onclick: () => select(o.code) },
      h('span', { class: 'item-title' }, o.title,
        o.en ? h('span', { class: 'gloss' }, ` ${o.en}`) : null),
      h('span', { class: 'item-meta' }, o.languageName),
      h('span', { class: 'num' }, fmt.format(o.views)))))));
  return wrap;
}

function editionView(code) {
  const hl = BY_CODE.get(code);
  const e = state.editions.get(code);
  const wrap = h('div', null,
    h('button', { type: 'button', class: 'back', onclick: () => select(null) }, '← Back to all languages'),
    h('h2', null, `Reading in ${hl.languageName}`),
    h('p', { class: 'muted small' }, `Anchored on ${hl.anchor}. Pins mark where a language is dominant, not everyone who reads it.`));
  if (!e || e.status === 'pending') { wrap.append(h('p', { class: 'muted' }, 'Loading.')); return wrap; }
  if (e.status === 'fail') { wrap.append(h('p', { class: 'muted' }, `Could not load this edition (${e.error}).`)); return wrap; }
  const d = e.data;
  if (d.fellBack) {
    wrap.append(h('p', { class: 'note' }, `No data for ${d.requested} yet in this edition, showing ${d.date}.`));
  }
  wrap.append(h('ol', { class: 'list toplist' }, d.items.slice(0, 10).map((it) => {
    const gloss = it.en && it.en !== it.title ? it.en : null;
    return h('li', null, h('span', { class: 'rank' }, it.rank),
      h('span', { class: 'item-body' },
        h('a', { href: articleUrl(code, it.slug), target: '_blank', rel: 'noopener' }, it.title),
        gloss ? h('span', { class: 'gloss' }, gloss) : null),
      h('span', { class: 'num' }, fmt.format(it.views)));
  })));
  return wrap;
}

function unrestNote() {
  const u = state.unrest;
  if (!u.on) return null;
  const box = h('div', { class: 'unrest-note' });
  if (u.status === 'loading') box.append(h('p', { class: 'muted small' }, 'Loading protest reports.'));
  else if (u.status === 'fail') box.append(h('p', { class: 'note' }, 'Protest reports could not be loaded.'));
  else if (u.data) {
    const age = u.data.ageHours;
    if (u.data.stale) box.append(h('p', { class: 'note' }, `Data from ${Math.round(age)} hours ago.`));
    box.append(h('p', { class: 'muted small' },
      'Machine-coded from news reports. Places can be wrong and events duplicated. These dots always cover the last 24 hours, not the day chosen above.'));
  }
  if (state.dotInfo) {
    box.append(h('p', { class: 'dotinfo' }, `${state.dotInfo.placeName}: ${fmt.format(state.dotInfo.count)} ${state.dotInfo.count === 1 ? 'event' : 'events'}`));
  }
  return box;
}

// ---------- actions ----------
function select(code) {
  state.selected = code && BY_CODE.has(code) ? code : null;
  state.highlightKey = null;
  state.dotInfo = null;
  globe.setHighlight([]);
  globe.setSelected(state.selected);
  if (state.selected) {
    const hl = BY_CODE.get(state.selected);
    globe.rotateTo(hl.lon, hl.lat);
  }
  writeHash();
  renderAll();
  if (state.selected) $('panel-body').scrollTop = 0;
}

function highlightGroup(g) {
  if (state.highlightKey === g.key) {
    state.highlightKey = null;
    globe.setHighlight([]);
  } else {
    state.highlightKey = g.key;
    globe.setHighlight(g.codes);
    const hl = BY_CODE.get(g.codes[0]);
    globe.rotateTo(hl.lon, hl.lat);
  }
  renderPanel();
}

function setDay(day, keepSelection = true) {
  const d = clampDay(day);
  const changed = d !== state.day;
  state.day = d;
  if (!keepSelection) state.selected = null;
  globe.setSelected(state.selected);
  writeHash();
  if (changed) startLoad();
  else renderAll();
}

async function setUnrest(on) {
  state.unrest.on = on;
  state.dotInfo = null;
  if (!on) { globe.setDots([]); renderPanel(); return; }
  if (state.unrest.data) { drawDots(); renderPanel(); return; }
  state.unrest.status = 'loading';
  renderPanel();
  try {
    state.unrest.data = await loadUnrest();
    state.unrest.status = 'ok';
  } catch {
    state.unrest.status = 'fail';
  }
  if (state.unrest.on) drawDots();
  renderPanel();
}

function drawDots() {
  const data = state.unrest.data;
  globe.setDots(data ? data.clusters.map((c) => ({ ...c, r: 1.5 + Math.sqrt(c.count) * 0.7 })) : []);
}

// ---------- boot ----------
async function boot() {
  const land = await (await fetch('data/land-110m.json')).json();
  const tip = $('tip');
  globe = createGlobe($('globe'), {
    land,
    onPinClick: (code) => select(code),
    onDotClick: (dot) => {
      state.dotInfo = dot ? { placeName: dot.placeName, count: dot.count } : null;
      renderPanel();
    },
    onHover: (pin, x, y) => {
      if (!pin) { tip.hidden = true; return; }
      tip.textContent = pin.name;
      tip.style.left = `${x + 12}px`;
      tip.style.top = `${y + 12}px`;
      tip.hidden = false;
    },
  });

  try {
    const probe = await attention.loadEdition(BY_CODE.get('en'), latestDay);
    latestDay = probe.date;
  } catch {
    // Leave latestDay as yesterday; editions fall back one day on their own.
  }
  state.day = latestDay;

  const init = parseHash(location.hash);
  if (init) { state.day = clampDay(init.day); state.selected = init.code; }
  globe.setSelected(state.selected);
  if (state.selected) {
    const hl = BY_CODE.get(state.selected);
    globe.rotateTo(hl.lon, hl.lat);
  }

  $('prev').addEventListener('click', () => setDay(shiftDay(state.day, -1)));
  $('next').addEventListener('click', () => setDay(shiftDay(state.day, 1)));
  $('unrest').addEventListener('change', (e) => setUnrest(e.target.checked));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected) select(null);
  });
  window.addEventListener('hashchange', () => {
    const p = parseHash(location.hash);
    if (!p) return;
    const day = clampDay(p.day);
    const dayChanged = day !== state.day;
    state.day = day;
    if (p.code !== state.selected) {
      state.selected = p.code;
      globe.setSelected(p.code);
      if (p.code) globe.rotateTo(BY_CODE.get(p.code).lon, BY_CODE.get(p.code).lat);
    }
    if (dayChanged) startLoad(); else renderAll();
  });

  writeHash();
  startLoad();
}

boot().catch((err) => {
  $('status').textContent = `Could not start: ${err.message}`;
});
