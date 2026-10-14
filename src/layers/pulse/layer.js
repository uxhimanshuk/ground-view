import * as Cesium from 'cesium';
import { showPulseCard, hidePulseCard } from './card.js';

const LABEL_COHORT_LIMIT = 48;
const LABEL_COLLISION_CAPACITY = 32;
const DEFAULT_LABEL_CAP = 24;

/**
 * Shared engine for the Pulse layers: a polled feed of anonymous aggregate
 * records drawn as ground-clamped points, optional ambient labels on the
 * world-overlay host, and one clickable DOM card per record.
 *
 * A layer supplies a `spec`:
 *  - `style(row, nowMs)` -> `{pixelSize, color, outline?, ring?: {pixelSize, color}}` (CSS colours)
 *  - `label(row, meta)` -> `{title, priority, accent}` or null
 *  - `card(row, meta, nowMs)` -> card model (see card.js)
 *  - `analyst(row, meta)` -> JSON-safe record with at least `id`, `lat`, `lon`
 *  - `stats(meta, rows)` -> extra feed-state fields (`stale`, `fallback`, ...)
 *  - `labelCap` (optional) number of labels to show
 *
 * The feed returns `{rows, meta}`. A snapshot whose `meta.unavailable` is true
 * never replaces displayed rows: the layer keeps its last good data and reports
 * the reason through `getStats().error`.
 */
export function createPulseLayer({
  id,
  name,
  icon,
  source,
  updateInterval,
  requiresKeyId,
  feed,
  overlayHost,
  spec,
  screenSpaceEventHandlerFactory = null,
  picking = null,
  pointer = null,
  card = { show: showPulseCard, hide: hidePulseCard },
  now = () => Date.now(),
} = {}) {
  if (typeof feed?.getSnapshot !== 'function')
    throw new TypeError(`${name} requires a snapshot source`);
  if (!overlayHost) throw new TypeError(`${name} requires an overlay host`);
  const entityPrefix = `pulse:${id}:`;
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _enabled = false;
  let _clickHandler = null;
  let _selectedId = null;
  let _rows = [];
  let _meta = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _keyRequired = false;
  /** @type {Map<string, object>} */
  const _rowById = new Map();

  const colour = (css, alpha) =>
    Cesium.Color.fromCssColorString(css).withAlpha(alpha ?? 1);

  function clearCard() {
    _selectedId = null;
    card?.hide?.(id);
  }

  function publishLabels() {
    if (!_enabled) return;
    const entries = [];
    for (const row of _rows) {
      const label = spec.label?.(row, _meta);
      if (!label) continue;
      entries.push({
        id: String(row.stableId),
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
        variant: 'label',
        title: label.title,
        accent: label.accent,
        priority: label.priority,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 15,
        verticalOnly: true,
        placement: 'above',
      });
    }
    const cap = Math.min(
      LABEL_COHORT_LIMIT,
      spec.labelCap ?? DEFAULT_LABEL_CAP,
    );
    const cohort = entries
      .sort(
        (a, b) =>
          b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, cap);
    overlayHost.setEntries(id, cohort, {
      cohortLimit: LABEL_COHORT_LIMIT,
      collisionCapacity: LABEL_COLLISION_CAPACITY,
      moving: false,
    });
  }

  function buildEntities(rows) {
    const nowMs = now();
    const entities = [];
    for (const row of rows) {
      const style = spec.style(row, nowMs);
      const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
      if (style.ring) {
        // A static halo, never animated: zero per-frame cost under request-render mode.
        entities.push(
          new Cesium.Entity({
            id: `${entityPrefix}ring:${row.stableId}`,
            position,
            point: {
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              pixelSize: style.ring.pixelSize,
              color: colour(style.ring.color, 0.22),
              outlineColor: colour(style.ring.color, 0.55),
              outlineWidth: 1,
            },
          }),
        );
      }
      entities.push(
        new Cesium.Entity({
          id: `${entityPrefix}${row.stableId}`,
          position,
          point: {
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            pixelSize: style.pixelSize,
            color: colour(style.color, 0.82),
            outlineColor: colour(style.outline || '#000000', 0.9),
            outlineWidth: 1.5,
          },
        }),
      );
    }
    return entities;
  }

  function showSelectedCard() {
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    if (!row) return clearCard();
    card?.show?.(id, spec.card(row, _meta, now()), {
      onClose: () => {
        _selectedId = null;
      },
    });
  }

  function pickedRowId(picked) {
    const pickId = picking?.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(entityPrefix))
      return null;
    let rest = pickId.slice(entityPrefix.length);
    if (rest.startsWith('ring:')) rest = rest.slice('ring:'.length);
    return _rowById.has(rest) ? rest : null;
  }

  function installClickHandler() {
    if (
      _clickHandler ||
      !_viewer ||
      !screenSpaceEventHandlerFactory ||
      !picking
    )
      return;
    picking.registerPickOwner?.(id, (pickId) =>
      pickId.startsWith(entityPrefix),
    );
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const picked = _viewer.scene.pick(click.position);
      const rowId = picked ? pickedRowId(picked) : null;
      if (rowId) {
        _selectedId = rowId;
        showSelectedCard();
        return;
      }
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer(id, pickId)) return;
      }
      if (_selectedId) clearCard();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    picking?.unregisterPickOwner?.(id);
  }

  const layer = {
    id,
    name,
    icon,
    source,
    updateInterval,
    ...(requiresKeyId ? { requiresKeyId } : {}),

    init(viewer) {
      if (_viewer) throw new Error(`${name} layer is already initialized`);
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _meta = null;
      _rowById.clear();
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
      _enabled = false;
      overlayHost.setVisible(id, false);
      console.log(`[Data:${name}] Initialized`);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(id, true);
      publishLabels();
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClickHandler();
      clearCard();
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await feed.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const { rows, meta } = snapshot;
        _meta = meta;
        _keyRequired = meta?.keyRequired === true;
        if (meta?.unavailable) {
          // Never replace good data with an empty unavailable snapshot.
          _lastError = meta.reason || `${name} source unavailable`;
          return false;
        }
        const entities = buildEntities(rows);
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        _rows = rows;
        _rowById.clear();
        for (const row of rows) _rowById.set(row.stableId, row);
        publishLabels();
        if (_selectedId) showSelectedCard();
        // A snapshot reports when it was generated, so its age is honest.
        _lastUpdate = Number.isFinite(meta?.generatedAt)
          ? meta.generatedAt
          : now();
        _lastError = null;
        console.log(`[Data:${name}] Updated: ${rows.length} records`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn(`[Data:${name}] Fetch error:`, error);
        _lastError = error?.message || `${name} source unavailable`;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      removeClickHandler();
      clearCard();
      overlayHost.clearSource(id);
      overlayHost.setVisible(id, false);
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer?.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _meta = null;
      _rowById.clear();
      _lastUpdate = null;
      _lastError = null;
      _keyRequired = false;
    },

    /** Records for the analyst query engine; empty while the layer is off. */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show || !_rows.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _rows.slice(0, limit).map((row) => spec.analyst(row, _meta));
    },

    /** These layers have no level-of-detail tiers; every record is always drawn. */
    getLodDiagnostics() {
      return { total: _rows.length, active: _rows.length };
    },

    getStats() {
      return {
        count: _rows.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        ...(_keyRequired ? { keyRequired: true } : {}),
        ...(_meta ? spec.stats?.(_meta, _rows) : {}),
      };
    },
  };
  return layer;
}
