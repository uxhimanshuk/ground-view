import * as Cesium from 'cesium';
import {
  NO_DATA_COLOR,
  buildAnalystRecords,
  buildScale,
  describeCountry,
  isFresh,
  joinRows,
  rankRows,
} from './model.js';
import { loadCountryShapes } from './shapes.js';
export * from './model.js';
export { decodeCountryPack, loadCountryShapes } from './shapes.js';

const FILL_ALPHA = 0.6;
const NO_DATA_ALPHA = 0.3;
const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

const cssColor = (css, alpha) =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);

/**
 * Shared choropleth layer: country polygons drawn flat on the ellipsoid and
 * coloured by one value per country. The caller supplies `fetchData` (rows of
 * `{ iso3, value, year? }`); this helper owns joins, scale, legend, hover and
 * click selection, the card, and the layer lifecycle.
 *
 * @param {object} config
 * @param {string} config.id Layer id.
 * @param {string} config.name Layer title.
 * @param {function({signal: AbortSignal, option: string|null}): Promise<{rows: object[], asOf?: string, placeholder?: boolean, note?: string}>} config.source.fetchData
 * @param {{kind?: 'sequential'|'diverging', center?: number}} [config.scale]
 * @param {string} config.legendTitle
 * @param {string} [config.unit]
 * @param {function(number): string} [config.formatValue]
 * @param {string} [config.caveat]
 * @param {string} [config.sourceLabel]
 * @param {{key: string, choices: Array<{id: string, label: string, unit?: string, legendTitle?: string, caveat?: string, formatValue?: function, kind?: string, center?: number}>, defaultValue: string}} [config.options]
 */
export function createChoroplethLayer({
  id,
  name,
  icon = '▦',
  source,
  sourceTag = '',
  updateInterval = 0,
  cacheMs = 3600_000,
  scale = {},
  legendTitle = '',
  unit = '',
  formatValue = (v) => String(Math.round(v * 10) / 10),
  caveat = '',
  sourceLabel = '',
  options = null,
  overlayHost = null,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  shapesLoader = loadCountryShapes,
} = {}) {
  if (typeof source?.fetchData !== 'function')
    throw new TypeError(`${id} requires a source with fetchData`);
  const PICK_PREFIX = `choropleth:${id}:`;
  let _viewer = null;
  let _dataSource = null;
  let _borders = null;
  let _enabled = false;
  let _request = null;
  let _shapes = null;
  let _parts = new Map(); // iso3 -> Cesium entities
  let _option = options ? options.defaultValue : null;
  /** @type {Map<string, {dataset: object, fetchedAt: number}>} */
  const _datasets = new Map();
  let _current = null; // {joined, ranks, total, scale, dataset, optionMeta}
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _selectedIso = null;
  let _hoverIso = null;
  let _clickHandler = null;
  let _moveHandler = null;
  let _listener = null;
  let _destroyed = false;

  const optionMeta = () => {
    const choice = options?.choices.find((c) => c.id === _option) || {};
    return {
      label: choice.label || name,
      unit: choice.unit ?? unit,
      legendTitle: choice.legendTitle || legendTitle,
      caveat: choice.caveat || caveat,
      formatValue: choice.formatValue || formatValue,
      kind: choice.kind || scale.kind || 'sequential',
      center: choice.center ?? scale.center ?? 0,
    };
  };
  const notify = () => {
    try {
      _listener?.();
    } catch {
      /* listener errors never break the layer */
    }
  };
  const render = () => _viewer?.scene?.requestRender?.();

  function colorFor(iso3, hover = false) {
    const row = _current?.joined.get(iso3);
    if (!row) return cssColor(NO_DATA_COLOR, NO_DATA_ALPHA);
    const color = cssColor(_current.scale.colorOf(row.value), FILL_ALPHA);
    return hover ? color.brighten(0.35, new Cesium.Color()) : color;
  }

  function recolor() {
    for (const [iso3, entities] of _parts) {
      const color = colorFor(iso3, iso3 === _hoverIso);
      for (const entity of entities)
        entity.polygon.material = new Cesium.ColorMaterialProperty(color);
    }
    render();
  }

  function buildGeometry() {
    if (!_shapes || !_dataSource) return;
    _dataSource.entities.removeAll();
    _parts = new Map();
    const borderInstances = [];
    for (const [iso3, shape] of _shapes) {
      const entities = [];
      shape.polygons.forEach((rings, part) => {
        const [outer, ...holes] = rings;
        if (!outer || outer.length < 3) return;
        const toPositions = (ring) =>
          Cesium.Cartesian3.fromDegreesArray(ring.flat());
        const entity = _dataSource.entities.add(
          new Cesium.Entity({
            id: `${PICK_PREFIX}${iso3}:${part}`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(
                toPositions(outer),
                holes
                  .filter((h) => h.length >= 3)
                  .map((h) => new Cesium.PolygonHierarchy(toPositions(h))),
              ),
              material: new Cesium.ColorMaterialProperty(colorFor(iso3)),
              arcType: Cesium.ArcType.GEODESIC,
            },
          }),
        );
        entities.push(entity);
        if (Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene)) {
          const loop = toPositions(outer);
          loop.push(loop[0]);
          borderInstances.push(
            new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions: loop,
                width: 1.2,
              }),
            }),
          );
        }
      });
      _parts.set(iso3, entities);
    }
    if (borderInstances.length) {
      _borders = new Cesium.GroundPolylinePrimitive({
        geometryInstances: borderInstances,
        appearance: new Cesium.PolylineMaterialAppearance({
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.WHITE.withAlpha(0.35),
          }),
        }),
        asynchronous: true,
      });
      _borders.show = _enabled;
      _viewer.scene.groundPrimitives.add(_borders);
    }
  }

  function legendEntries() {
    if (!_current) return [];
    return _current.scale.legend;
  }

  function cardEntry(iso3) {
    const shape = _shapes?.get(iso3);
    if (!shape || !_current) return null;
    const meta = optionMeta();
    const row = _current.joined.get(iso3);
    const { title, details } = describeCountry({
      name: shape.name,
      row,
      rank: _current.ranks.get(iso3),
      total: _current.total,
      formatValue: meta.formatValue,
      unit: meta.unit,
      sourceLabel,
      asOf: _current.dataset.asOf,
      caveat: meta.caveat,
      extra: [
        meta.label !== name ? meta.label : null,
        _current.dataset.placeholder ? 'PLACEHOLDER DATA' : null,
      ],
    });
    return {
      id: `${id}-card:${iso3}`,
      position: Cesium.Cartesian3.fromDegrees(
        shape.anchor.lon,
        shape.anchor.lat,
      ),
      selected: true,
      interactive: false,
      title: `${name.toUpperCase()} · ${title}`,
      details,
      accent: row ? _current.scale.colorOf(row.value) : NO_DATA_COLOR,
      priority: Number.MAX_SAFE_INTEGER,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    };
  }

  function publishCard() {
    if (!overlayHost) return;
    const entry = _selectedIso ? cardEntry(_selectedIso) : null;
    overlayHost.setEntries(id, entry ? [entry] : [], CARD_HOST_OPTIONS);
    render();
  }

  function isoFromPick(picked) {
    const pickId = picking?.resolvePickId
      ? picking.resolvePickId(picked)
      : typeof picked?.id?.id === 'string'
        ? picked.id.id
        : null;
    if (typeof pickId !== 'string' || !pickId.startsWith(PICK_PREFIX))
      return null;
    return pickId.slice(PICK_PREFIX.length).split(':')[0];
  }

  function installHandlers() {
    if (_clickHandler || !_viewer || !screenSpaceEventHandlerFactory) return;
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const iso3 = picked ? isoFromPick(picked) : null;
      if (iso3) {
        _selectedIso = iso3;
        publishCard();
        notify();
        return;
      }
      if (picked) return; // a sibling layer's object
      if (_selectedIso) {
        _selectedIso = null;
        publishCard();
        notify();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    _moveHandler = screenSpaceEventHandlerFactory(_viewer);
    let lastMove = 0;
    _moveHandler.setInputAction((move) => {
      if (pointer && !pointer.isPointerFree()) return;
      const now = Date.now();
      if (now - lastMove < 80) return;
      lastMove = now;
      const picked = _viewer.scene.pick(move.endPosition);
      const iso3 = picked ? isoFromPick(picked) : null;
      if (iso3 === _hoverIso) return;
      const previous = _hoverIso;
      _hoverIso = iso3;
      for (const code of [previous, iso3]) {
        if (!code) continue;
        for (const entity of _parts.get(code) || [])
          entity.polygon.material = new Cesium.ColorMaterialProperty(
            colorFor(code, code === _hoverIso),
          );
      }
      render();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  function removeHandlers() {
    _clickHandler?.destroy();
    _moveHandler?.destroy();
    _clickHandler = null;
    _moveHandler = null;
    _hoverIso = null;
  }

  function applyDataset(dataset) {
    const meta = optionMeta();
    const joined = joinRows(dataset.rows, _shapes.keys());
    const { ranks, total } = rankRows(joined);
    _current = {
      dataset,
      joined,
      ranks,
      total,
      scale: buildScale({
        kind: meta.kind,
        center: meta.center,
        values: [...joined.values()].map((r) => r.value),
        formatValue: meta.formatValue,
      }),
    };
    _count = joined.size;
    recolor();
    if (_selectedIso) publishCard();
    notify();
  }

  const layer = {
    id,
    name,
    icon,
    source: sourceTag,
    updateInterval,

    init(viewer) {
      if (_viewer) throw new Error(`${id} is already initialized`);
      _viewer = viewer;
      _destroyed = false;
      _dataSource = new Cesium.CustomDataSource(id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      overlayHost?.setVisible?.(id, false);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      if (_borders) _borders.show = true;
      overlayHost?.setVisible?.(id, true);
      installHandlers();
      notify();
    },

    disable() {
      _request?.abort();
      _request = null;
      _loading = false;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_borders) _borders.show = false;
      removeHandlers();
      _selectedIso = null;
      overlayHost?.clearSource?.(id);
      overlayHost?.setVisible?.(id, false);
      notify();
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      const cached = _datasets.get(_option);
      if (cached && _current && isFresh(cached.fetchedAt, cacheMs)) {
        if (_current.dataset !== cached.dataset) applyDataset(cached.dataset);
        return true;
      }
      _request?.abort();
      const request = new AbortController();
      _request = request;
      _loading = true;
      notify();
      const wanted = _option;
      try {
        const [shapes, dataset] = await Promise.all([
          _shapes ? _shapes : shapesLoader({ signal: request.signal }),
          source.fetchData({ signal: request.signal, option: wanted }),
        ]);
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        if (!Array.isArray(dataset?.rows)) throw new Error('Malformed dataset');
        if (!_shapes) {
          _shapes = shapes;
          buildGeometry();
        }
        _datasets.set(wanted, { dataset, fetchedAt: Date.now() });
        if (wanted === _option) applyDataset(dataset);
        _lastUpdate = Date.now();
        _lastError = dataset.placeholder
          ? dataset.note || 'Placeholder data, not real scores'
          : null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn(`[Data:${id}] fetch error:`, error);
        _lastError = error?.message || `${name} source unavailable`;
        return false;
      } finally {
        if (_request === request) {
          _request = null;
          _loading = false;
          notify();
        }
      }
    },

    setParams(params = {}) {
      if (!options || params[options.key] === undefined) return true;
      const next = params[options.key];
      if (!options.choices.some((c) => c.id === next)) return false;
      if (next === _option) return true;
      _option = next;
      const cached = _datasets.get(_option);
      if (cached && _shapes) applyDataset(cached.dataset);
      else {
        _current = null;
        if (_shapes) recolor();
        if (_enabled) void layer.update();
      }
      notify();
      return true;
    },

    getParams() {
      return options ? { [options.key]: _option } : {};
    },

    setRowControlsListener(listener) {
      _listener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const meta = optionMeta();
      const dataset = _current?.dataset;
      const status = _loading
        ? 'Loading…'
        : _lastError ||
          (dataset?.placeholder ? 'Placeholder data, not real scores' : null);
      return {
        chips: (options?.choices || []).map((choice) => ({
          id: `option-${choice.id}`,
          label: choice.label,
          active: choice.id === _option,
          params: { [options.key]: choice.id },
          title: choice.title || choice.label,
        })),
        legend: legendEntries(),
        info: [
          meta.legendTitle,
          meta.unit ? `(${meta.unit})` : null,
          dataset?.asOf ? `as of ${dataset.asOf}` : null,
          status,
        ]
          .filter(Boolean)
          .join(' · '),
        infoTitle: meta.caveat,
      };
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      removeHandlers();
      overlayHost?.clearSource?.(id);
      overlayHost?.setVisible?.(id, false);
      if (_borders && viewer && !viewer.isDestroyed?.()) {
        viewer.scene.groundPrimitives.remove(_borders);
      }
      _borders = null;
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _parts = new Map();
      _current = null;
      _datasets.clear();
      _viewer = null;
      _enabled = false;
      _destroyed = true;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 400) {
      if (!_enabled || !_current || !_shapes) return [];
      const meta = optionMeta();
      const names = new Map(
        [..._shapes].map(([iso3, shape]) => [iso3, shape.name]),
      );
      return buildAnalystRecords({
        joined: _current.joined,
        ranks: _current.ranks,
        names,
        indicator: meta.label,
        unit: meta.unit,
        sourceLabel,
        limit: Number.isFinite(maxCount)
          ? Math.max(1, Math.floor(maxCount))
          : 400,
      });
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        placeholder: _current?.dataset?.placeholder === true,
        noData: _shapes ? _shapes.size - _count : null,
      };
    },

    getLodDiagnostics() {
      return {
        countries: _shapes ? _shapes.size : 0,
        polygons: [..._parts.values()].reduce((n, list) => n + list.length, 0),
        destroyed: _destroyed,
      };
    },
  };
  return layer;
}
