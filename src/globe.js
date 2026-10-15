// Orthographic globe on a canvas. Needs d3 (d3-geo) and topojson globals.
const d3 = globalThis.d3;
const topojson = globalThis.topojson;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createGlobe(canvas, { land, onPinClick, onDotClick, onHover }) {
  const ctx = canvas.getContext('2d');
  const landFeature = topojson.feature(land, land.objects.land);
  const graticule = d3.geoGraticule10();
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const path = d3.geoPath(projection, ctx);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let w = 0, h = 0, dpr = 1;
  let rotation = [-20, -20];
  let pins = [];
  let dots = [];
  let highlight = new Set();
  let selected = null;
  let spinning = !reduced;
  let tween = null;
  let colors = null;
  let hoverCode = null;
  let raf = 0;

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    colors = {
      ocean: g('--ocean'), land: g('--land'), grid: g('--grid'), edge: g('--edge'),
      pin: g('--pin'), pinDim: g('--pin-dim'), pinStrong: g('--pin-strong'),
      ring: g('--ring'), dot: g('--dot'),
    };
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readColors();
    draw();
  });

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = Math.max(200, Math.floor(r.width));
    h = Math.max(200, Math.floor(r.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    projection.translate([w / 2, h / 2]).scale(Math.min(w, h) / 2 - 6);
    draw();
  }

  function visible(lon, lat) {
    return d3.geoDistance([lon, lat], [-rotation[0], -rotation[1]]) < Math.PI / 2 - 0.02;
  }

  function draw() {
    if (!colors) readColors();
    projection.rotate([rotation[0], rotation[1], 0]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.fillStyle = colors.ocean; ctx.fill();
    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); path(landFeature);
    ctx.fillStyle = colors.land; ctx.fill();
    ctx.beginPath(); path({ type: 'Sphere' });
    ctx.strokeStyle = colors.edge; ctx.lineWidth = 1; ctx.stroke();

    for (const d of dots) {
      if (!visible(d.lon, d.lat)) continue;
      const [x, y] = projection([d.lon, d.lat]);
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, 2 * Math.PI);
      ctx.fillStyle = colors.dot;
      ctx.fill();
    }
    const order = [...pins].sort((a, b) => rank(a) - rank(b));
    for (const p of order) {
      if (!visible(p.lon, p.lat)) continue;
      const [x, y] = projection([p.lon, p.lat]);
      const on = p.code === selected || highlight.has(p.code);
      ctx.beginPath();
      ctx.arc(x, y, p.r + (on ? 1.5 : 0), 0, 2 * Math.PI);
      ctx.fillStyle = p.pending ? colors.pinDim : on ? colors.pinStrong : colors.pin;
      ctx.fill();
      if (on || p.code === hoverCode) {
        ctx.beginPath();
        ctx.arc(x, y, p.r + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.ring;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  const rank = (p) => (p.code === selected ? 3 : highlight.has(p.code) ? 2 : p.pending ? 0 : 1);

  function hit(px, py) {
    let best = null, bd = Infinity;
    for (const p of pins) {
      if (!visible(p.lon, p.lat)) continue;
      const [x, y] = projection([p.lon, p.lat]);
      const d = Math.hypot(x - px, y - py);
      if (d <= Math.max(p.r + 5, 11) && d < bd) { best = { kind: 'pin', item: p }; bd = d; }
    }
    if (best) return best;
    for (const dt of dots) {
      if (!visible(dt.lon, dt.lat)) continue;
      const [x, y] = projection([dt.lon, dt.lat]);
      const d = Math.hypot(x - px, y - py);
      if (d <= Math.max(dt.r + 3, 8) && d < bd) { best = { kind: 'dot', item: dt }; bd = d; }
    }
    return best;
  }

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, rot: [...rotation], moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; stopSpin(); }
      if (drag.moved) {
        const k = 180 / (projection.scale() * Math.PI) * 1.6;
        rotation = [drag.rot[0] + dx * k, clamp(drag.rot[1] - dy * k, -90, 90)];
        draw();
      }
      return;
    }
    const [x, y] = pos(e);
    const hv = hit(x, y);
    const code = hv?.kind === 'pin' ? hv.item.code : null;
    canvas.style.cursor = hv ? 'pointer' : 'grab';
    if (code !== hoverCode) { hoverCode = code; draw(); }
    onHover?.(hv?.kind === 'pin' ? hv.item : null, e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    if (hoverCode) { hoverCode = null; draw(); }
    onHover?.(null);
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    stopSpin();
    const [x, y] = pos(e);
    const hv = hit(x, y);
    if (hv?.kind === 'pin') onPinClick?.(hv.item.code);
    else if (hv?.kind === 'dot') onDotClick?.(hv.item, e.clientX, e.clientY);
    else onDotClick?.(null);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  function stopSpin() { spinning = false; }

  let last = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, t - last); last = t;
    if (tween) {
      const k = clamp((t - tween.t0) / tween.dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      rotation = [tween.from[0] + tween.dd[0] * e, tween.from[1] + tween.dd[1] * e];
      if (k >= 1) tween = null;
      draw();
    } else if (spinning && !document.hidden) {
      rotation = [rotation[0] + dt * 0.006, rotation[1]];
      draw();
    }
  }
  raf = requestAnimationFrame(frame);

  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  return {
    setPins(list) { pins = list; draw(); },
    setDots(list) { dots = list; draw(); },
    setSelected(code) { selected = code; draw(); },
    setHighlight(codes) { highlight = new Set(codes); draw(); },
    rotateTo(lon, lat) {
      stopSpin();
      const to = [-lon, clamp(-lat, -60, 60)];
      let d0 = to[0] - rotation[0];
      d0 = ((d0 + 540) % 360) - 180;
      tween = {
        t0: performance.now(), dur: reduced ? 1 : 700,
        from: [...rotation], dd: [d0, to[1] - rotation[1]],
      };
    },
    stopSpin,
    redraw() { readColors(); draw(); },
    destroy() { cancelAnimationFrame(raf); },
  };
}
