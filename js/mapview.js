/* Bản đồ trượt (slippy map) nhẹ, không phụ thuộc thư viện: nền ô bản đồ XYZ (OSM hoặc máy chủ GIS nội bộ),
 * kéo để di chuyển, cuộn để thu phóng quanh con trỏ; lớp vẽ dữ liệu do app cung cấp qua onDraw(ctx, view).
 * Khi không có mạng Internet, nền ô bị bỏ qua và bản đồ vẫn vẽ lưới + dữ liệu bình thường. */
(function (TS) {
  'use strict';
  const U = TS.util;
  const WORLD = 2 * Math.PI * U.R_EARTH;

  TS.MapView = function (canvas, opts) {
    const o = Object.assign({ tileUrl: '', minZoom: 3, maxZoom: 20 }, opts || {});
    const ctx = canvas.getContext('2d');
    const view = { cx: 0, cy: 0, z: 14, w: 0, h: 0, dpr: 1, tiles: true, tileUrl: o.tileUrl, onDraw: null, onClick: null, onHover: null, dragHook: null };
    const cache = new Map();
    let pending = false;

    view.res = () => WORLD / (256 * Math.pow(2, view.z));
    view.toScreen = (mx, my) => { const r = view.res(); return [(mx - view.cx) / r + view.w / 2, (view.cy - my) / r + view.h / 2]; };
    view.toMerc = (px, py) => { const r = view.res(); return [view.cx + (px - view.w / 2) * r, view.cy - (py - view.h / 2) * r]; };
    view.lonlatToScreen = (lon, lat) => { const m = U.project(lon, lat); return view.toScreen(m[0], m[1]); };

    view.resize = function () {
      const r = canvas.getBoundingClientRect();
      view.dpr = window.devicePixelRatio || 1;
      view.w = Math.max(1, r.width); view.h = Math.max(1, r.height);
      canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
      view.redraw();
    };

    view.fit = function (lonlats, pad) {
      if (!lonlats.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [lon, lat] of lonlats) { const [x, y] = U.project(lon, lat); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
      const p = pad || 40;
      const rx = (x1 - x0) / Math.max(50, view.w - 2 * p), ry = (y1 - y0) / Math.max(50, view.h - 2 * p);
      const r = Math.max(rx, ry, 0.05);
      view.z = U.clamp(Math.log2(WORLD / (256 * r)), o.minZoom, o.maxZoom);
      view.redraw();
    };

    function drawTiles() {
      if (!view.tiles || !view.tileUrl) return;
      const zt = U.clamp(Math.round(view.z), 0, 19);
      const n = Math.pow(2, zt);
      const tsz = 256 * Math.pow(2, view.z - zt);
      const [mx0, my0] = view.toMerc(0, 0), [mx1, my1] = view.toMerc(view.w, view.h);
      const tx0 = Math.floor((mx0 + WORLD / 2) / WORLD * n), tx1 = Math.floor((mx1 + WORLD / 2) / WORLD * n);
      const ty0 = Math.floor((WORLD / 2 - my0) / WORLD * n), ty1 = Math.floor((WORLD / 2 - my1) / WORLD * n);
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 120) return;
      ctx.save();
      const filt = getComputedStyle(document.documentElement).getPropertyValue('--tile-filter').trim();
      if (filt && filt !== 'none') ctx.filter = filt;
      for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        const xw = U.mod(tx, n);
        const key = zt + '/' + xw + '/' + ty;
        let img = cache.get(key);
        if (!img) {
          img = new Image();
          img.onload = () => view.redraw();
          img.onerror = () => { img.failed = true; };
          img.src = view.tileUrl.replace('{z}', zt).replace('{x}', xw).replace('{y}', ty).replace('{s}', 'abc'[(xw + ty) % 3]);
          cache.set(key, img);
          if (cache.size > 600) cache.delete(cache.keys().next().value);
        }
        if (img.complete && !img.failed && img.naturalWidth) {
          const mxT = tx / n * WORLD - WORLD / 2, myT = WORLD / 2 - ty / n * WORLD;
          const [sx, sy] = view.toScreen(mxT, myT);
          ctx.drawImage(img, Math.floor(sx), Math.floor(sy), Math.ceil(tsz) + 1, Math.ceil(tsz) + 1);
        }
      }
      ctx.restore();
    }

    view.draw = function () {
      pending = false;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      const cs = getComputedStyle(document.documentElement);
      ctx.fillStyle = cs.getPropertyValue('--sunk').trim() || '#e4e7e2';
      ctx.fillRect(0, 0, view.w, view.h);
      drawTiles();
      if (view.onDraw) view.onDraw(ctx, view);
    };
    view.redraw = function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(view.draw);
    };

    // ── tương tác ──
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false, px, py, hook: null };
      if (view.dragHook) drag.hook = view.dragHook(px, py, e);
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (!drag) { if (view.onHover) view.onHover(px, py, e); return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.hook) { drag.hook.move(px, py); return; }
      const res = view.res();
      view.cx = drag.cx - dx * res; view.cy = drag.cy + dy * res;
      view.redraw();
    });
    const end = (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (drag.hook) drag.hook.end(px, py, drag.moved);
      else if (!drag.moved && view.onClick) view.onClick(px, py, e);
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (view.onHover && !drag) view.onHover(-1, -1); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const before = view.toMerc(px, py);
      const dz = -Math.sign(e.deltaY) * Math.min(0.6, Math.abs(e.deltaY) / 200 + 0.15);
      view.z = U.clamp(view.z + dz, o.minZoom, o.maxZoom);
      const after = view.toMerc(px, py);
      view.cx += before[0] - after[0]; view.cy += before[1] - after[1];
      view.redraw();
    }, { passive: false });
    window.addEventListener('resize', () => view.resize());
    return view;
  };
})(window.TS);
