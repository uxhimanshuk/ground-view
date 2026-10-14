import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  DEFAULT_MAX_ARCS,
  arcAnalystRecords,
  buildArcs,
  formatCount,
  nearestCountry,
  selectArcs,
  summarizeCountry,
} from './model.js';
import { createArcRenderer } from './render.js';
export * from './model.js';
export * from './geo.js';
export { createBundledCentroidSource } from './bundledCentroids.js';

const CARD_LINE_CHARS = 46;

/** Word-wrap one caveat sentence into short card lines. */
export function wrapCardLines(text, width = CARD_LINE_CHARS) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '')
    .split(/\s+/)
    .filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Create one flow layer: top-N great-circle arcs between countries with a
 * log-scaled width, country isolation on click and a source card.
 *
 * `source.getSnapshot({signal})` must resolve to
 * `{ records: [{originIso3, destIso3, value, year}], year, asOf?, extra? }`.
 * `centroidSource.load(signal)` resolves to a centroid table.
 */
export function createArcLayer({
  id,
  name,
  icon = '⤳',
  source,
  centroidSource,
  overlayHost,
  screenSpaceEventHandlerFactory,
  valueLabel,
  unit,
  caveat,
  maxArcs = DEFAULT_MAX_ARCS,
  updateInterval = 0,
  colors = { origin: '#ffb35c', destination: '#4fd1ff' },
  formatValue = null,
  describeCountry = null,
}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Arc layers require a snapshot source');
  if (typeof centroidSource?.load !== 'function')
    throw new TypeError('Arc layers require a centroid source');
  if (!overlayHost) throw new TypeError('Arc layers require an overlay host');
  const renderer = createArcRenderer({
    origin: colors.origin,
    destination: colors.destination,
  });
  let viewer = null;
  let enabled = false;
  let request = null;
  let handler = null;
  let table = null;
  let arcs = [];
  let meta = { year: null, asOf: null, extra: null };
  let skipped = { invalid: 0, self: 0, noCentroid: 0 };
  let isolated = null;
  let selectedArcId = null;
  let shown = [];
  let lastUpdate = null;
  let lastError = null;
  let loading = false;
  let cap = Math.max(1, Math.floor(maxArcs));

  const show = (v) =>
    formatValue ? formatValue(v) : `${formatCount(v)} ${unit}`;
  const arcById = () => new Map(shown.map((a) => [a.id, a]));

  function sourceLines(extra = []) {
    const asOf = meta.asOf || (meta.year ? String(meta.year) : 'unknown');
    return [
      ...extra,
      `Source: ${source.label} · as of ${asOf}`,
      ...wrapCardLines(caveat),
    ];
  }

  function clearCard() {
    overlayHost.clearSource(id);
  }

  function publishCard(entry) {
    overlayHost.setEntries(id, entry ? [entry] : [], {
      cohortLimit: 4,
      collisionCapacity: 4,
      moving: false,
    });
    viewer?.scene?.requestRender?.();
  }

  function cardEntry(key, position, title, details) {
    return {
      id: key,
      position,
      variant: 'card',
      title,
      details,
      accent: colors.destination,
      selected: true,
      protected: true,
      priority: 1000,
      collisionGroup: 'ambient-card',
      zIndex: 40,
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      placement: 'above',
    };
  }

  function showArcCard(arc) {
    selectedArcId = arc.id;
    const position = renderer.midpoint(arc.id);
    if (!position) return;
    publishCard(
      cardEntry(
        `arc:${arc.id}`,
        position,
        `${arc.originName} to ${arc.destName}`,
        sourceLines([
          `${valueLabel}: ${show(arc.value)}`,
          `Year: ${arc.year ?? meta.year ?? 'n/a'}`,
        ]),
      ),
    );
  }

  function showCountryCard(iso3) {
    const c = table?.get(iso3);
    if (!c) return;
    const s = summarizeCountry(arcs, iso3);
    const extra = [
      `Outbound ${valueLabel.toLowerCase()}: ${show(s.outbound)}`,
      `Inbound ${valueLabel.toLowerCase()}: ${show(s.inbound)}`,
    ];
    if (s.topOut) extra.push(`Top destination: ${s.topOut.destName}`);
    if (s.topIn) extra.push(`Top origin: ${s.topIn.originName}`);
    const more = describeCountry?.(iso3, meta.extra);
    if (Array.isArray(more)) extra.push(...more);
    publishCard(
      cardEntry(
        `country:${iso3}`,
        Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 4500),
        c.name,
        sourceLines(extra),
      ),
    );
  }

  function redraw() {
    shown = selectArcs(arcs, { maxArcs: cap, country: isolated });
    renderer.draw(shown, { highlightIso3: isolated, show: enabled });
  }

  function isolate(iso3) {
    const code = iso3 ? String(iso3).toUpperCase() : null;
    isolated = code && table?.has(code) ? table.resolve({ iso3: code }) : null;
    selectedArcId = null;
    redraw();
    if (isolated) showCountryCard(isolated);
    else clearCard();
  }

  function onClick(click) {
    if (!isPointerFree() || !enabled || !viewer) return;
    // Endpoint nodes sit where arcs converge, so prefer the node over the arc.
    const node = renderer.nearestNode(click.position);
    if (node) {
      isolate(node === isolated ? null : node);
      return;
    }
    const picked = viewer.scene.pick(click.position);
    const arc = renderer.isArcPick(picked) && arcById().get(picked.id);
    if (arc) {
      showArcCard(arc);
      return;
    }
    const ray = viewer.camera.getPickRay(click.position);
    const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
    const carto = hit && Cesium.Cartographic.fromCartesian(hit);
    const near =
      carto && table
        ? nearestCountry(
            table,
            Cesium.Math.toDegrees(carto.longitude),
            Cesium.Math.toDegrees(carto.latitude),
          )
        : null;
    const hasFlows =
      near && arcs.some((a) => a.originIso3 === near || a.destIso3 === near);
    if (hasFlows && near !== isolated) isolate(near);
    else if (isolated || selectedArcId) isolate(null);
  }

  const layer = {
    id,
    name,
    icon,
    source: source.label,
    updateInterval,
    statsRefreshInterval: 1000,

    init(nextViewer) {
      if (viewer) throw new Error(`${id} is already initialized`);
      viewer = nextViewer;
      renderer.attach(viewer);
      overlayHost.setVisible(id, false);
      if (!handler && screenSpaceEventHandlerFactory) {
        handler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
        handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
    },

    enable() {
      enabled = true;
      renderer.setVisible(true);
      overlayHost.setVisible(id, true);
    },

    disable() {
      request?.abort();
      request = null;
      loading = false;
      enabled = false;
      renderer.setVisible(false);
      clearCard();
      overlayHost.setVisible(id, false);
    },

    async update() {
      if (!enabled) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      loading = true;
      try {
        const [nextTable, snapshot] = await Promise.all([
          centroidSource.load(controller.signal),
          source.getSnapshot({ signal: controller.signal }),
        ]);
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        table = nextTable;
        const built = buildArcs(snapshot.records, table);
        arcs = built.arcs;
        skipped = built.skipped;
        meta = {
          year: snapshot.year ?? null,
          asOf: snapshot.asOf ?? null,
          extra: snapshot.extra ?? null,
        };
        if (isolated && !table.has(isolated)) isolated = null;
        redraw();
        if (isolated) showCountryCard(isolated);
        lastUpdate = Date.now();
        lastError = null;
        return true;
      } catch (error) {
        if (controller.signal.aborted || request !== controller || !enabled)
          return false;
        lastError = error?.message || `${name} source unavailable`;
        throw error;
      } finally {
        if (request === controller) {
          request = null;
          loading = false;
        }
      }
    },

    destroy() {
      request?.abort();
      request = null;
      enabled = false;
      handler?.destroy?.();
      handler = null;
      renderer.destroy();
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
      viewer = null;
      arcs = [];
      shown = [];
      isolated = null;
      selectedArcId = null;
      lastUpdate = null;
      lastError = null;
      loading = false;
    },

    /** Isolate one country's flows (ISO3), or pass null to show the top set. */
    isolateCountry(iso3) {
      if (enabled) isolate(iso3);
    },

    /** Change the arc cap and redraw. */
    setMaxArcs(next) {
      cap = Math.max(1, Math.floor(Number(next) || DEFAULT_MAX_ARCS));
      if (enabled) redraw();
    },

    getSelection() {
      return { isolated, arcId: selectedArcId };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled) return [];
      return arcAnalystRecords(arcs, { unit, source: source.label, maxCount });
    },

    getLodDiagnostics() {
      return {
        arcsLoaded: arcs.length,
        arcsShown: shown.length,
        maxArcs: cap,
        isolated,
        skipped,
      };
    },

    getStats() {
      return {
        count: arcs.length,
        shown: shown.length,
        year: meta.year,
        isolated,
        lastUpdate,
        loading,
        error: lastError,
      };
    },
  };
  return layer;
}
