import * as Cesium from 'cesium';
import { arcPositions, arcStyle } from './geo.js';
import { valueRange } from './model.js';

/**
 * Arcs and endpoint nodes sit this far above the ellipsoid so terrain at a
 * country's label point cannot bury them (the Andes and Tibet reach 4 km).
 */
const ANCHOR_HEIGHT_M = 4500;

/**
 * One batched Primitive of vertex-coloured polylines plus one point
 * collection for the endpoint countries. Rebuilt only when the shown set
 * changes (data, cap or isolation), never per frame.
 */
export function createArcRenderer({ origin, destination }) {
  const originColor = Cesium.Color.fromCssColorString(origin);
  const destColor = Cesium.Color.fromCssColorString(destination);
  let viewer = null;
  let primitive = null;
  let nodes = null;
  let midpoints = new Map();
  let nodePositions = new Map();

  function clear() {
    if (viewer && primitive) {
      try {
        viewer.scene.primitives.remove(primitive);
      } catch {
        /* already gone */
      }
    }
    if (viewer && nodes) {
      try {
        viewer.scene.primitives.remove(nodes);
      } catch {
        /* already gone */
      }
    }
    primitive = null;
    nodes = null;
    midpoints = new Map();
    nodePositions = new Map();
  }

  function arcColors(count, alpha) {
    const colors = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      // Fade in from the origin so the tail reads as the start of the flow.
      colors.push(
        Cesium.Color.lerp(
          originColor,
          destColor,
          t,
          new Cesium.Color(),
        ).withAlpha(alpha * (0.3 + 0.7 * t)),
      );
    }
    return colors;
  }

  return {
    attach(nextViewer) {
      viewer = nextViewer;
    },
    /** Replace the drawn set. `highlightIso3` brightens one country's node. */
    draw(arcs, { highlightIso3 = null, show = true } = {}) {
      clear();
      if (!viewer || arcs.length === 0) {
        viewer?.scene?.requestRender?.();
        return;
      }
      const range = valueRange(arcs);
      const instances = [];
      const nodeCodes = new Map();
      for (const arc of arcs) {
        const { positions } = arcPositions(arc.from, arc.to, {
          baseM: ANCHOR_HEIGHT_M,
        });
        const style = arcStyle(arc.value, range);
        const cartesians = Cesium.Cartesian3.fromDegreesArrayHeights(positions);
        midpoints.set(arc.id, cartesians[Math.floor(cartesians.length / 2)]);
        instances.push(
          new Cesium.GeometryInstance({
            id: arc.id,
            geometry: new Cesium.PolylineGeometry({
              positions: cartesians,
              width: style.width,
              colors: arcColors(cartesians.length, style.alpha),
              colorsPerVertex: true,
              arcType: Cesium.ArcType.NONE,
              vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            }),
          }),
        );
        nodeCodes.set(arc.originIso3, arc.from);
        nodeCodes.set(arc.destIso3, arc.to);
      }
      primitive = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        releaseGeometryInstances: true,
        allowPicking: true,
      });
      primitive.show = show;
      viewer.scene.primitives.add(primitive);
      nodes = new Cesium.PointPrimitiveCollection();
      for (const [iso3, p] of nodeCodes) {
        const active = iso3 === highlightIso3;
        const position = Cesium.Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          ANCHOR_HEIGHT_M,
        );
        nodePositions.set(iso3, position);
        nodes.add({
          id: `node:${iso3}`,
          position,
          pixelSize: active ? 9 : 5,
          color: (active ? Cesium.Color.WHITE : destColor).withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: 0,
        });
      }
      nodes.show = show;
      viewer.scene.primitives.add(nodes);
      viewer.scene.requestRender?.();
    },
    setVisible(show) {
      if (primitive) primitive.show = show;
      if (nodes) nodes.show = show;
      viewer?.scene?.requestRender?.();
    },
    isArcPick(picked) {
      return (
        !!picked &&
        picked.primitive === primitive &&
        typeof picked.id === 'string'
      );
    },
    /**
     * The visible endpoint node closest to a screen position, within
     * `radiusPx`. Arcs converge on nodes, so a pick alone can be crowded out.
     */
    nearestNode(screenPosition, radiusPx = 14) {
      if (!viewer || !nodePositions.size) return null;
      const occluder = new Cesium.EllipsoidalOccluder(
        Cesium.Ellipsoid.WGS84,
        viewer.camera.positionWC,
      );
      let best = null;
      let bestPx = radiusPx;
      const scratch = new Cesium.Cartesian2();
      for (const [iso3, position] of nodePositions) {
        if (!occluder.isPointVisible(position)) continue;
        const win = viewer.scene.cartesianToCanvasCoordinates(
          position,
          scratch,
        );
        if (!win) continue;
        const d = Cesium.Cartesian2.distance(win, screenPosition);
        if (d < bestPx) {
          bestPx = d;
          best = iso3;
        }
      }
      return best;
    },
    midpoint(arcId) {
      return midpoints.get(arcId) || null;
    },
    destroy() {
      clear();
      viewer = null;
    },
  };
}
