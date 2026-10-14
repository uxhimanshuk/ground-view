import * as Cesium from 'cesium';
import {
  DEFAULT_LANGUAGE_COLOR,
  MACROAREA_COLORS,
  describeLanguage,
  glottologUrl,
  lodStepForHeight,
  mapAnalystRecord,
  selectLabelCohort,
} from './records.js';
export * from './records.js';
export { createBundledLanguageSource } from './bundledSource.js';

const LAYER_ID = 'languages';
const LABEL_SOURCE_ID = 'languages';
const LABEL_MAX_HEIGHT_M = 3_000_000;
const LABEL_LIMIT = 48;
const HOST_OPTIONS = Object.freeze({
  cohortLimit: 64,
  collisionCapacity: 48,
  moving: false,
});

/** Glottolog languages as small points with close-zoom labels and a click card. */
export function createLanguagesLayer({
  source,
  overlayHost = null,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  openExternal = null,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Languages require a snapshot source');
  let _viewer = null;
  let _enabled = false;
  let _request = null;
  let _languages = [];
  let _byCode = new Map();
  let _points = null;
  let _pointByCode = new Map();
  let _removeMoveEnd = null;
  let _clickHandler = null;
  let _selected = null;
  let _selectedCardId = null;
  let _asOf = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _lastStep = 0;

  const render = () => _viewer?.scene?.requestRender?.();
  const pointId = (code) => `language:${code}`;

  function viewRect() {
    const rect = _viewer.camera.computeViewRectangle?.(
      _viewer.scene.globe.ellipsoid,
    );
    if (!rect) return null;
    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north),
    };
  }

  function applyLod() {
    if (!_viewer || !_points) return;
    const height = _viewer.camera.positionCartographic?.height;
    const step = lodStepForHeight(height);
    if (step !== _lastStep) {
      _lastStep = step;
      _languages.forEach((language, index) => {
        const point = _pointByCode.get(language.glottocode);
        if (point) point.show = _enabled && index % step === 0;
      });
    }
    publishOverlay(height);
    render();
  }

  function labelEntry(language, selected) {
    return {
      id: `${LAYER_ID}:${language.glottocode}`,
      position: Cesium.Cartesian3.fromDegrees(language.lon, language.lat),
      variant: selected ? 'card' : 'label',
      title: language.name,
      accent: MACROAREA_COLORS[language.macroarea] || DEFAULT_LANGUAGE_COLOR,
      priority: (language.aes || 0) * 100,
      collisionGroup: 'ambient-label',
      paintLane: selected ? undefined : 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 12,
      verticalOnly: true,
      placement: 'above',
    };
  }

  function cardEntry(language) {
    const { title, details } = describeLanguage(language);
    const link = glottologUrl(language.glottocode);
    const card = {
      id: `${LAYER_ID}-card:${language.glottocode}`,
      position: Cesium.Cartesian3.fromDegrees(language.lon, language.lat),
      selected: true,
      interactive: Boolean(openExternal),
      title: `LANGUAGE · ${title}`,
      details: [
        ...details,
        openExternal ? 'Glottolog page · click card' : link,
      ],
      accent: MACROAREA_COLORS[language.macroarea] || DEFAULT_LANGUAGE_COLOR,
      priority: Number.MAX_SAFE_INTEGER,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    };
    if (openExternal) {
      card.accessibilityLabel = `Open ${language.name} on Glottolog`;
      card.activate = () => {
        openExternal(link);
        return true;
      };
    }
    return card;
  }

  function publishOverlay(
    height = _viewer?.camera.positionCartographic?.height,
  ) {
    if (!overlayHost || !_enabled) return;
    const entries = [];
    if (height <= LABEL_MAX_HEIGHT_M) {
      for (const language of selectLabelCohort(
        _languages,
        viewRect(),
        LABEL_LIMIT,
      )) {
        if (language.glottocode === _selected) continue;
        entries.push(labelEntry(language, false));
      }
    }
    _selectedCardId = null;
    const selected = _selected ? _byCode.get(_selected) : null;
    if (selected) {
      const card = cardEntry(selected);
      _selectedCardId = card.id;
      entries.push(card);
    }
    overlayHost.setEntries(LABEL_SOURCE_ID, entries, HOST_OPTIONS);
  }

  function codeFromPick(picked) {
    const id = picking?.resolvePickId
      ? picking.resolvePickId(picked)
      : picked?.id;
    if (typeof id !== 'string' || !id.startsWith('language:')) return null;
    return id.slice('language:'.length);
  }

  function installClick() {
    if (_clickHandler || !_viewer || !screenSpaceEventHandlerFactory) return;
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const hit = overlayHost?.hitTest?.(click.position?.x, click.position?.y, {
        sourceId: LABEL_SOURCE_ID,
      });
      if (hit && hit.entryId === _selectedCardId && _selected) {
        openExternal?.(glottologUrl(_selected));
        return;
      }
      const picked = _viewer.scene.pick(click.position);
      const code = picked ? codeFromPick(picked) : null;
      if (code && _byCode.has(code)) {
        _selected = code;
        publishOverlay();
        render();
        return;
      }
      if (picked) return;
      if (_selected) {
        _selected = null;
        publishOverlay();
        render();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClick() {
    _clickHandler?.destroy();
    _clickHandler = null;
  }

  function buildPoints() {
    if (!_viewer || _points) return;
    _points = new Cesium.PointPrimitiveCollection();
    _pointByCode = new Map();
    for (const language of _languages) {
      const point = _points.add({
        id: pointId(language.glottocode),
        position: Cesium.Cartesian3.fromDegrees(language.lon, language.lat),
        pixelSize: language.aes >= 4 ? 5 : 4,
        color: Cesium.Color.fromCssColorString(
          MACROAREA_COLORS[language.macroarea] || DEFAULT_LANGUAGE_COLOR,
        ).withAlpha(0.9),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.4, 2.5e7, 0.6),
        show: false,
      });
      _pointByCode.set(language.glottocode, point);
    }
    _viewer.scene.primitives.add(_points);
    _lastStep = 0;
  }

  const layer = {
    id: LAYER_ID,
    name: 'Languages (Glottolog)',
    icon: 'Aa',
    source: 'Glottolog',
    updateInterval: 0,

    init(viewer) {
      if (_viewer) throw new Error('Languages layer is already initialized');
      _viewer = viewer;
      _enabled = false;
      overlayHost?.setVisible?.(LABEL_SOURCE_ID, false);
    },

    enable() {
      _enabled = true;
      overlayHost?.setVisible?.(LABEL_SOURCE_ID, true);
      installClick();
      if (_points) {
        _lastStep = 0;
        applyLod();
      }
      _removeMoveEnd ||= _viewer.camera.moveEnd.addEventListener(applyLod);
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      for (const point of _pointByCode.values()) point.show = false;
      _lastStep = 0;
      _removeMoveEnd?.();
      _removeMoveEnd = null;
      removeClick();
      _selected = null;
      overlayHost?.clearSource?.(LABEL_SOURCE_ID);
      overlayHost?.setVisible?.(LABEL_SOURCE_ID, false);
      render();
    },

    async update() {
      if (!_enabled) return false;
      if (_points) return true;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _languages = snapshot.languages;
        _byCode = new Map(_languages.map((l) => [l.glottocode, l]));
        _asOf = snapshot.asOf;
        buildPoints();
        _lastUpdate = Date.now();
        _lastError = null;
        applyLod();
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Languages] load error:', error);
        _lastError = error?.message || 'Language data unavailable';
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_languages.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 500;
      // Most endangered first, so "which languages are nearly extinct" works.
      return _languages
        .slice()
        .sort((a, b) => b.aes - a.aes || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(mapAnalystRecord);
    },

    getStats() {
      return {
        count: _languages.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        asOf: _asOf,
      };
    },

    getLodDiagnostics() {
      return {
        total: _languages.length,
        step: _lastStep,
        drawn: _lastStep ? Math.ceil(_languages.length / _lastStep) : 0,
      };
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _removeMoveEnd?.();
      _removeMoveEnd = null;
      removeClick();
      overlayHost?.clearSource?.(LABEL_SOURCE_ID);
      overlayHost?.setVisible?.(LABEL_SOURCE_ID, false);
      if (_points && viewer && !viewer.isDestroyed?.())
        viewer.scene.primitives.remove(_points);
      _points = null;
      _pointByCode = new Map();
      _languages = [];
      _byCode = new Map();
      _selected = null;
      _viewer = null;
      _enabled = false;
      _lastUpdate = null;
      _lastError = null;
    },
  };
  return layer;
}
