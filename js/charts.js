/* Biểu đồ canvas nhỏ gọn: đường (có con trỏ dọc + chú giải khi rê chuột), và biểu đồ thời gian – khoảng cách
 * (TSD) có dải sóng xanh, thanh xanh/đỏ từng nút, nền mật độ mô phỏng, kéo thả offset trực tiếp. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const CH = TS.charts = {};
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function prep(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = css('--chart'); ctx.fillRect(0, 0, r.width, r.height);
    return { ctx, w: r.width, h: r.height };
  }

  function niceTicks(lo, hi, n) {
    if (hi <= lo) hi = lo + 1;
    const span = hi - lo, step0 = span / (n || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  /* opts: {series:[{label, color, points:[[x,y]], dash}], xLabel, yLabel, xFmt, yFmt, marker:{x,label}, y0} */
  CH.line = function (canvas, opts) {
    const { ctx, w, h } = prep(canvas);
    const m = { l: 56, r: 16, t: 40, b: 34 };
    const all = opts.series.flatMap(s => s.points);
    if (!all.length) return null;
    let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    let y0 = opts.y0 !== undefined ? opts.y0 : Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
    if (y1 === y0) y1 = y0 + 1;
    const yt = niceTicks(y0, y1 + (y1 - y0) * 0.05, 4);
    y0 = Math.min(y0, yt[0]); y1 = yt[yt.length - 1];
    const X = (x) => m.l + (x - x0) / (x1 - x0 || 1) * (w - m.l - m.r);
    const Y = (y) => h - m.b - (y - y0) / (y1 - y0) * (h - m.t - m.b);
    ctx.font = '11px ' + css('--font');
    ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of yt) { ctx.beginPath(); ctx.moveTo(m.l, Y(v) + .5); ctx.lineTo(w - m.r, Y(v) + .5); ctx.stroke(); ctx.fillText((opts.yFmt || String)(v), m.l - 6, Y(v)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of niceTicks(x0, x1, 7)) ctx.fillText((opts.xFmt || String)(v), X(v), h - m.b + 6);
    ctx.strokeStyle = css('--axis'); ctx.beginPath(); ctx.moveTo(m.l, h - m.b + .5); ctx.lineTo(w - m.r, h - m.b + .5); ctx.stroke();
    ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (opts.yLabel) ctx.fillText(opts.yLabel, 8, 12);
    if (opts.xLabel) { ctx.textAlign = 'right'; ctx.fillText(opts.xLabel, w - m.r, h - 14); }
    if (opts.marker) {
      ctx.strokeStyle = css('--ink-2'); ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(opts.marker.x), m.t); ctx.lineTo(X(opts.marker.x), h - m.b); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css('--ink'); ctx.textAlign = 'left'; ctx.fillText(opts.marker.label, X(opts.marker.x) + 4, m.t);
    }
    for (const s of opts.series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.points.forEach((p, i) => { i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])); });
      ctx.stroke(); ctx.setLineDash([]);
      if (s.points.length <= 40) for (const p of s.points) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 2.5, 0, 7); ctx.fill(); }
    }
    return { X, Y, x0, x1, m, w, h };
  };

  /* Gắn lớp rê chuột: con trỏ dọc + bảng giá trị tại x gần nhất. */
  CH.attachHover = function (canvas, tipEl, getState) {
    canvas.onmousemove = (e) => {
      const st = getState(); if (!st || !st.geo) { tipEl.hidden = true; return; }
      const r = canvas.getBoundingClientRect(), px = e.clientX - r.left;
      const g = st.geo;
      if (px < g.m.l || px > g.w - g.m.r) { tipEl.hidden = true; return; }
      const x = g.x0 + (px - g.m.l) / (g.w - g.m.l - g.m.r) * (g.x1 - g.x0);
      const rows = st.series.map(s => {
        let best = null, bd = Infinity;
        for (const p of s.points) { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = p; } }
        return best ? `<div><span class="swatch" style="background:${s.color}"></span>${s.label}: <b class="mono">${(st.yFmt || String)(best[1])}</b></div>` : '';
      }).join('');
      tipEl.innerHTML = `<div class="mono" style="color:var(--muted)">${(st.xFmt || String)(x)}</div>` + rows;
      tipEl.hidden = false;
      tipEl.style.left = Math.min(px + 14, r.width - 220) + 'px'; tipEl.style.top = '30px';
    };
    canvas.onmouseleave = () => { tipEl.hidden = true; };
  };

  /* ── Biểu đồ thời gian – khoảng cách ──
   * cfg: {net, corr (MB.buildCorridor), planFn, C, bands:{bOut,bOutStart,bIn,bInStart}, tOut, tIn,
   *       rec (bản ghi CTM, tuỳ chọn), sim, onDragOffset(k, newOffset)} */
  CH.tsd = function (canvas, cfg) {
    const { ctx, w, h } = prep(canvas);
    const { net, corr } = cfg;
    const n = corr.seq.length;
    const m = { l: 210, r: 14, t: 34, b: 28 };
    const Dmax = corr.dist[n - 1] || 1;
    const live = cfg.rec && cfg.rec.count > 2;
    const T0 = live ? cfg.rec.tLast - Math.min(cfg.rec.count, cfg.rec.H) * cfg.dt : 0;
    const T1 = live ? cfg.rec.tLast : Math.max(cfg.C * 3, 60);
    const X = (t) => m.l + (t - T0) / (T1 - T0) * (w - m.l - m.r);
    const Y = (d) => h - m.b - d / Dmax * (h - m.t - m.b);
    ctx.font = '11px ' + css('--font');
    // nền mật độ mô phỏng
    if (live) {
      const rec = cfg.rec, H = rec.H, nCell = rec.cells.length;
      const rows = Math.min(rec.count, H);
      const colW = (w - m.l - m.r) / rows;
      let cellIdx = 0;
      for (let li = 0; li < rec.linkIdxs.length; li++) {
        const L = rec.linkIdxs[li];
        const k = corr.out.indexOf(L);
        const nc = cfg.sim.nc[L];
        const d0 = corr.dist[k], cl = net.links[L].len / nc;
        for (let c = 0; c < nc; c++, cellIdx++) {
          const yA = Y(d0 + c * cl), yB = Y(d0 + (c + 1) * cl);
          for (let r = 0; r < rows; r++) {
            const row = (rec.count - rows + r) % H;
            const v = rec.data[row * nCell + cellIdx];
            if (v < 0.04) continue;
            ctx.fillStyle = densColor(v);
            ctx.fillRect(m.l + r * colW, yB, Math.ceil(colW) + 0.5, Math.max(1, yA - yB));
          }
        }
      }
    }
    // lưới & nhãn nút
    ctx.strokeStyle = css('--grid'); ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let k = 0; k < n; k++) {
      const node = net.nodes[corr.seq[k]];
      const y = Y(corr.dist[k]);
      ctx.beginPath(); ctx.moveTo(m.l, y + .5); ctx.lineTo(w - m.r, y + .5); ctx.stroke();
      const label = node.id + ' · ' + node.name;
      ctx.fillText(label.length > 32 ? label.slice(0, 31) + '…' : label, m.l - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = css('--muted');
    for (const v of niceTicks(T0, T1, 8)) ctx.fillText(Math.round(v) + 's', X(v), h - m.b + 8);
    // thanh tín hiệu: nửa trên chiều đi, nửa dưới chiều về
    const barH = 7;
    const colG = css('--sig-green'), colY = css('--sig-amber'), colR = css('--sig-red');
    for (let k = 0; k < n; k++) {
      const y = Y(corr.dist[k]);
      const pl = cfg.planFn(corr.seq[k]);
      const drawRow = (phs, yy, recRow) => {
        const step = live ? cfg.dt : 1;
        for (let t = T0; t < T1; t += step) {
          let s;
          if (live) {
            const rows = Math.min(cfg.rec.count, cfg.rec.H);
            const r = Math.floor((t - T0) / cfg.dt);
            const row = (cfg.rec.count - rows + r) % cfg.rec.H;
            const li = recRow;
            s = li >= 0 ? cfg.rec.sig[row * cfg.rec.linkIdxs.length + li] : null;
            s = s === 1 ? 'G' : s === 2 ? 'Y' : 'R';
            if (li < 0) s = M.signalState(pl, phs, t);
          } else s = M.signalState(pl, phs, t);
          ctx.fillStyle = s === 'G' ? colG : s === 'Y' ? colY : colR;
          ctx.fillRect(X(t), yy, X(t + step) - X(t) + 0.3, barH / 2);
        }
      };
      const recOut = live && k > 0 ? cfg.rec.linkIdxs.indexOf(corr.out[k - 1]) : -1;
      drawRow(corr.phOut[k], y - barH / 2, recOut);
      drawRow(corr.phIn[k], y, -1);
    }
    // dải sóng xanh lý thuyết (tĩnh)
    if (!live && cfg.bands) {
      ctx.save(); ctx.beginPath(); ctx.rect(m.l, 0, w - m.l - m.r, h - m.b + 4); ctx.clip();
      const drawBand = (start, b, times, dir, color) => {
        if (b <= 0) return;
        ctx.fillStyle = color; ctx.globalAlpha = 0.18;
        for (let cyc = -2; cyc < 6; cyc++) {
          const s0 = start + cyc * cfg.C;
          ctx.beginPath();
          const pts = [];
          for (let k = 0; k < n; k++) pts.push([X(s0 + times[k]), Y(corr.dist[k])]);
          const pts2 = pts.map(([x, y]) => [x + (X(b) - X(0)), y]);
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
          for (const p of pts2.reverse()) ctx.lineTo(p[0], p[1]);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
        void dir;
      };
      drawBand(cfg.bands.bOutStart, cfg.bands.bOut, cfg.tOut, 1, css('--s1'));
      drawBand(cfg.bands.bInStart, cfg.bands.bIn, cfg.tIn, -1, css('--s7'));
      ctx.restore();
    }
    ctx.strokeStyle = css('--axis'); ctx.beginPath(); ctx.moveTo(m.l + .5, m.t); ctx.lineTo(m.l + .5, h - m.b); ctx.stroke();
    // kéo offset
    if (!live && cfg.onDragOffset) {
      let drag = null;
      canvas.onpointerdown = (e) => {
        const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
        let best = -1, bd = 14;
        for (let k = 0; k < n; k++) { const d = Math.abs(py - Y(corr.dist[k])); if (d < bd && px > m.l) { bd = d; best = k; } }
        if (best < 0) return;
        canvas.setPointerCapture(e.pointerId);
        drag = { k: best, x: px, off: cfg.planFn(corr.seq[best]).offset };
        canvas.style.cursor = 'ew-resize';
      };
      canvas.onpointermove = (e) => {
        if (!drag) return;
        const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left;
        const dt = (px - drag.x) / (w - m.l - m.r) * (T1 - T0);
        const pl = cfg.planFn(corr.seq[drag.k]);
        cfg.onDragOffset(drag.k, Math.round(U.mod(drag.off + dt, M.cycleOf(pl))), false);
      };
      canvas.onpointerup = () => { if (drag) { cfg.onDragOffset(drag.k, cfg.planFn(corr.seq[drag.k]).offset, true); } drag = null; canvas.style.cursor = ''; };
    } else { canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = null; }
    return { X, Y };
  };

  /* Dải màu mật độ (tỷ lệ chiếm dụng 0..1): thưa → dày; một sắc độ ấm tăng dần. */
  function densColor(v) {
    const stops = [[0.05, [214, 192, 74]], [0.25, [232, 131, 74]], [0.5, [214, 72, 60]], [0.8, [122, 17, 22]]];
    let c = stops[stops.length - 1][1];
    for (let i = 0; i < stops.length - 1; i++) if (v < stops[i + 1][0]) {
      const a = stops[i], b = stops[i + 1], f = U.clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
      c = a[1].map((x, j) => Math.round(x + (b[1][j] - x) * f)); break;
    }
    return `rgba(${c[0]},${c[1]},${c[2]},${0.35 + 0.5 * Math.min(1, v)})`;
  }
  CH.densColor = densColor;
})(window.TS);
