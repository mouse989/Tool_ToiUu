/* Giao diện ứng dụng: bản đồ, nhập liệu, chạy tối ưu, mô phỏng hoạt ảnh, đối sánh A/B, báo cáo. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model, SG = TS.signal, MB = TS.maxband, SIM = TS.ctm, IO = TS.io, OPT = TS.optimizer;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const LS_KEY = 'tso.project.v1';

  const S = {
    project: null, band: null, scenario: 'base',
    net: null, netKey: '', ana: null, geo: null,
    sel: null, chain: [], poly: [], polyDone: false, tool: 'sel', pendingLinkFrom: null,
    colorBy: 'vc', tsd: null, dock: 'tsd', dockMin: false,
    sim: null, simGeo: null, playing: false, simSpeed: 20, simScenario: 'opt-rec', rec: null,
    ab: null, seriesMetric: 'bal', optRunning: false, zoneColor: null, hover: null,
  };

  /* ── tiện ích giao diện ── */
  function toast(msg, err) {
    const d = document.createElement('div');
    d.textContent = msg; if (err) d.className = 'err';
    $('toast').appendChild(d);
    setTimeout(() => d.remove(), err ? 6000 : 3200);
  }
  function modal(title, bodyHtml, buttons) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    const f = $('modalFoot'); f.innerHTML = '';
    for (const b of buttons || [{ label: 'Đóng' }]) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.textContent = b.label;
      el.onclick = () => { if (!b.onClick || b.onClick() !== false) closeModal(); };
      f.appendChild(el);
    }
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; }
  $('modalX').onclick = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); S.chain = []; S.pendingLinkFrom = null; updateChainInfo(); view.redraw(); } });

  const bandLabel = (id) => (S.project.bands.find(b => b.id === id) || { label: id }).label;
  const nodeById = (id) => S.project.nodes.find(n => n.id === id);
  const result = () => S.project && S.project.results && S.project.results[S.band];

  /* ── lưu tự động ── */
  let saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, IO.toJSON(S.project, true)); }
      catch { try { localStorage.setItem(LS_KEY, IO.toJSON(S.project, false)); } catch { /* bộ nhớ trình duyệt đầy: bỏ qua */ } }
    }, 600);
  }

  /* ── bộ nhớ đệm mạng & phân tích ── */
  let rev = 0;
  function invalidate(geoToo) {
    rev++; S.net = null; S.ana = null;
    if (geoToo) S.geo = null;
    autosave();
  }
  function getNet() {
    const key = S.band + '|' + rev;
    if (!S.net || S.netKey !== key) { S.net = M.buildNet(S.project, S.band); S.netKey = key; S.ana = null; }
    return S.net;
  }
  function getAna() {
    if (!S.ana) {
      const net = getNet();
      const a = SG.analyzeNetwork(net, S.scenario);
      const perLink = new Array(net.links.length).fill(null);
      a.nodes.forEach(nd => { if (nd) for (const l of nd.links) perLink[l.i] = l; });
      S.ana = { nodes: a.nodes, perLink, avgDelay: a.avgDelay, scenario: S.scenario };
    }
    if (S.ana.scenario !== S.scenario) { S.ana = null; return getAna(); }
    return S.ana;
  }
  function getGeo() {
    if (S.geo) return S.geo;
    const net = getNet();
    const nodes = S.project.nodes.map(n => U.project(n.lon, n.lat));
    const links = net.links.map(l => {
      const pts = l.geom.map(p => U.project(p[0], p[1]));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, twoWay: net.outL[l.v].some(j => net.links[j].v === l.u) };
    });
    S.geo = { nodes, links, rev };
    return S.geo;
  }

  /* ── màu ── */
  const STATUS = { good: '#0ca30c', warn: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
  function vcColor(x) { return x < 0.7 ? STATUS.good : x < 0.85 ? STATUS.warn : x < 1.0 ? STATUS.serious : STATUS.critical; }
  function losColor(los) { return { A: STATUS.good, B: STATUS.good, C: STATUS.warn, D: STATUS.warn, E: STATUS.serious, F: STATUS.critical }[los] || css('--idle'); }
  function delayColor(d) { return d < 20 ? STATUS.good : d < 35 ? STATUS.warn : d < 55 ? STATUS.serious : STATUS.critical; }
  const ZPAL = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(css);

  function zoneColors() {
    const r = result();
    if (!r) return null;
    if (S.zoneColor && S.zoneColor.r === r) return S.zoneColor;
    const net = getNet();
    const zOf = new Map(r.nodeIds.map((id, i) => [id, r.zoneOf[i]]));
    const adj = new Map();
    for (const l of net.links) {
      const a = zOf.get(net.nodes[l.u].id), b = zOf.get(net.nodes[l.v].id);
      if (a === undefined || b === undefined || a < 0 || b < 0 || a === b) continue;
      if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    }
    const col = new Map();
    for (const z of r.zones) {
      const used = new Set([...(adj.get(z.id) || [])].map(x => col.get(x)));
      let c = 0; while (used.has(c) && c < 7) c++;
      col.set(z.id, c);
    }
    S.zoneColor = { r, zOf, col };
    return S.zoneColor;
  }

  /* ════════════════ BẢN ĐỒ ════════════════ */
  const view = TS.MapView($('map'), { tileUrl: M.DEFAULT_PARAMS.tileUrl });

  function linkScreenPts(g, off) {
    const pts = g.pts.map(p => view.toScreen(p[0], p[1]));
    if (!off) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      out.push([pts[i][0] - dy / L * off, pts[i][1] + dx / L * off]);
    }
    return out;
  }
  function pointAt(pts, cum, f) {
    const tot = cum[cum.length - 1], s = f * tot;
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  function linkStaticColor(i) {
    const net = getNet(), l = net.links[i];
    const a = getAna().perLink[i];
    switch (S.colorBy) {
      case 'vc': return a ? vcColor(a.x) : css('--idle');
      case 'los': return a ? losColor(a.los) : css('--idle');
      case 'delay': return a ? delayColor(a.d) : css('--idle');
      case 'flow': return css('--s1');
      case 'src': return l.src === 'measured' ? css('--s1') : l.src === 'imputed' ? css('--s2') : css('--idle');
      case 'zone': {
        const zc = zoneColors(); if (!zc) return css('--idle');
        const zu = zc.zOf.get(net.nodes[l.u].id), zv = zc.zOf.get(net.nodes[l.v].id);
        return zu === zv && zu >= 0 ? ZPAL()[zc.col.get(zu) || 0] : css('--idle');
      }
    }
    return css('--idle');
  }

  view.onDraw = function (ctx) {
    if (!S.project) return;
    const net = getNet(), geo = getGeo();
    const z = view.z;
    const lw = U.clamp((z - 12) * 1.1, 1, 5);
    const off = z >= 14 ? U.clamp((z - 13) * 1.6, 1.5, 6) : 0;
    const W = view.w, H = view.h;
    const inView = (p) => p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60;
    // vùng (bao lồi)
    if (S.colorBy === 'zone' && zoneColors()) drawZones(ctx);
    // liên kết
    const simOn = !!S.sim;
    ctx.lineCap = 'round';
    if (!simOn) {
      const groups = new Map();
      for (let i = 0; i < net.links.length; i++) {
        const g = geo.links[i];
        const pts = linkScreenPts(g, g.twoWay ? off : 0);
        if (!inView(pts[0]) && !inView(pts[pts.length - 1])) continue;
        const col = linkStaticColor(i);
        let w = lw;
        if (S.colorBy === 'flow') w = U.clamp(net.links[i].q / 400, 0.6, 9) * (z >= 14 ? 1 : 0.6);
        const key = col + '|' + w.toFixed(1);
        if (!groups.has(key)) groups.set(key, new Path2D());
        const p = groups.get(key);
        p.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) p.lineTo(pts[k][0], pts[k][1]);
      }
      for (const [key, p] of groups) { const [col, w] = key.split('|'); ctx.strokeStyle = col; ctx.lineWidth = +w; ctx.stroke(p); }
    } else drawSimLinks(ctx, lw, off, inView);
    // vùng đa giác lấy OSM
    if (S.poly.length) {
      ctx.save();
      ctx.strokeStyle = css('--s2'); ctx.fillStyle = css('--s2'); ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      S.poly.forEach((q, k) => { const p = view.lonlatToScreen(q[0], q[1]); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      if (S.polyDone || S.poly.length > 2) ctx.closePath();
      ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); ctx.setLineDash([]);
      for (const q of S.poly) { const p = view.lonlatToScreen(q[0], q[1]); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    // nhánh vào của nút có đèn đang chọn: tô màu theo pha phục vụ
    if (S.sel && S.sel.type === 'node' && !simOn) {
      const nd = S.project.nodes[S.sel.n];
      if (nd && nd.signalized) {
        const pc = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'].map(css);
        ctx.font = '600 11px ' + css('--font');
        for (const i of net.inL[S.sel.n]) {
          const g = geo.links[i], pts = linkScreenPts(g, g.twoWay ? off : 0);
          const k = net.links[i].phases[0] || 0;
          ctx.strokeStyle = pc[k % pc.length]; ctx.lineWidth = lw + 4; ctx.globalAlpha = 0.85;
          ctx.beginPath(); pts.forEach((q, j) => j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.globalAlpha = 1;
          const m = pts[Math.max(0, pts.length - 2)], e = pts[pts.length - 1];
          const lx = e[0] + (m[0] - e[0]) * 0.35, ly = e[1] + (m[1] - e[1]) * 0.35;
          const label = 'P' + net.links[i].phases.map(x => x + 1).join('+');
          ctx.fillStyle = css('--surface'); ctx.fillRect(lx - 11, ly - 8, 24, 16);
          ctx.fillStyle = pc[k % pc.length]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + 1, ly);
        }
      }
    }
    // chuỗi hành lang tự chọn
    if (S.chain.length) {
      ctx.strokeStyle = css('--s7'); ctx.lineWidth = lw + 4; ctx.globalAlpha = 0.5; ctx.beginPath();
      S.chain.forEach((id, k) => { const n = S.project.nodes.findIndex(x => x.id === id); const p = view.toScreen(...geo.nodes[n]); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // hành lang TSD đang xem
    if (S.tsd) {
      ctx.strokeStyle = css('--s1'); ctx.lineWidth = lw + 5; ctx.globalAlpha = 0.35; ctx.beginPath();
      S.tsd.corr.seq.forEach((n, k) => { const p = view.toScreen(...geo.nodes[n]); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // nút
    const r = U.clamp((z - 11) * 1.3, 1.6, 7);
    const zc = S.colorBy === 'zone' ? zoneColors() : null;
    const ana = !simOn ? getAna() : null;
    const byCol = new Map();
    for (let n = 0; n < S.project.nodes.length; n++) {
      const node = S.project.nodes[n];
      const p = view.toScreen(...geo.nodes[n]);
      if (!inView(p)) continue;
      let col = css('--ink-2');
      if (!node.signalized) col = css('--idle');
      else if (zc) { const zi = zc.zOf.get(node.id); col = zi >= 0 ? ZPAL()[zc.col.get(zi) || 0] : css('--idle'); }
      else if (ana && ana.nodes[n] && (S.colorBy === 'los' || S.colorBy === 'delay' || S.colorBy === 'vc')) col = S.colorBy === 'vc' ? vcColor(ana.nodes[n].xmax) : S.colorBy === 'los' ? losColor(ana.nodes[n].los) : delayColor(ana.nodes[n].delay);
      if (!byCol.has(col)) byCol.set(col, new Path2D());
      const path = byCol.get(col);
      path.moveTo(p[0] + r, p[1]); path.arc(p[0], p[1], r, 0, Math.PI * 2);
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = css('--surface');
    for (const [col, path] of byCol) { ctx.fillStyle = col; ctx.fill(path); if (r > 3) ctx.stroke(path); }
    // chọn
    if (S.sel) {
      ctx.strokeStyle = css('--s1'); ctx.lineWidth = 3;
      if (S.sel.type === 'node') { const p = view.toScreen(...geo.nodes[S.sel.n]); ctx.beginPath(); ctx.arc(p[0], p[1], r + 5, 0, 7); ctx.stroke(); }
      if (S.sel.type === 'link' && geo.links[S.sel.i]) { const g = geo.links[S.sel.i]; const pts = linkScreenPts(g, g.twoWay ? off : 0); ctx.lineWidth = lw + 5; ctx.globalAlpha = 0.45; ctx.beginPath(); pts.forEach((q, k) => k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.globalAlpha = 1; }
      if (S.sel.type === 'zone') {
        const zc2 = zoneColors();
        if (zc2) { ctx.lineWidth = 2.5; for (let n = 0; n < S.project.nodes.length; n++) if (zc2.zOf.get(S.project.nodes[n].id) === S.sel.z) { const p = view.toScreen(...geo.nodes[n]); ctx.beginPath(); ctx.arc(p[0], p[1], r + 3, 0, 7); ctx.stroke(); } }
      }
    }
    if (S.pendingLinkFrom !== null) { const p = view.toScreen(...geo.nodes[S.pendingLinkFrom]); ctx.strokeStyle = css('--s2'); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], r + 6, 0, 7); ctx.stroke(); }
    // nhãn nút khi phóng to
    if (z >= 16.2) {
      ctx.font = '11px ' + css('--font'); ctx.fillStyle = css('--ink'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      for (let n = 0; n < S.project.nodes.length; n++) { const p = view.toScreen(...geo.nodes[n]); if (inView(p)) ctx.fillText(S.project.nodes[n].id, p[0] + r + 3, p[1] - 2); }
    }
  };

  function drawZones(ctx) {
    const zc = zoneColors(), r = result(), geo = getGeo();
    const pal = ZPAL();
    ctx.font = '600 12px ' + css('--font'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const z of r.zones) {
      const pts = z.ids.map(id => { const n = S.project.nodes.findIndex(x => x.id === id); return n >= 0 ? view.toScreen(...geo.nodes[n]) : null; }).filter(Boolean);
      if (!pts.length) continue;
      const hull = U.convexHull(pts);
      const col = pal[zc.col.get(z.id) || 0];
      if (hull.length >= 3) {
        ctx.beginPath(); hull.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
        ctx.fillStyle = col; ctx.globalAlpha = 0.08; ctx.fill(); ctx.globalAlpha = 0.6; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      }
      const cx = U.mean(pts, p => p[0]), cy = U.mean(pts, p => p[1]);
      if (view.z >= 13) {
        const label = 'V' + String(z.id + 1).padStart(2, '0') + ' · C' + z.C;
        ctx.fillStyle = css('--surface'); const tw = ctx.measureText(label).width + 10;
        ctx.globalAlpha = 0.85; ctx.fillRect(cx - tw / 2, cy - 9, tw, 18); ctx.globalAlpha = 1;
        ctx.fillStyle = css('--ink'); ctx.fillText(label, cx, cy);
      }
    }
  }

  /* Vẽ ô CTM: màu theo tỷ lệ mật độ / mật độ tới hạn; vạch tín hiệu tại vạch dừng. */
  function drawSimLinks(ctx, lw, off, inView) {
    const sim = S.sim, net = getNet(), geo = getGeo();
    const cols = [css('--idle'), css('--sig-green'), '#cfae00', '#e6a23c', '#e34948', '#7a1116'];
    const paths = cols.map(() => new Path2D());
    const bucket = (x) => {
      const r = sim.n[x] / Math.max(1e-6, sim.ncrit[x]);
      if (sim.n[x] < 0.02 * sim.Nmax[x] && r < 0.15) return 0;
      return r < 0.9 ? 1 : r < 1.6 ? 2 : r < 2.6 ? 3 : sim.n[x] / sim.Nmax[x] < 0.85 ? 4 : 5;
    };
    const sigPaths = [new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < net.links.length; i++) {
      const g = geo.links[i];
      const pts = linkScreenPts(g, g.twoWay ? off : 0);
      if (!inView(pts[0]) && !inView(pts[pts.length - 1])) continue;
      const scum = [0];
      for (let k = 1; k < pts.length; k++) scum.push(scum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const nc = sim.nc[i], c0 = sim.c0[i], pxLen = scum[scum.length - 1];
      if (pxLen / nc < 2.5) {
        let s = 0, m = 0; for (let k = 0; k < nc; k++) { s += sim.n[c0 + k]; m += sim.ncrit[c0 + k]; }
        const r = s / Math.max(1e-6, m);
        const b = s < 0.02 * m ? 0 : r < 0.9 ? 1 : r < 1.6 ? 2 : r < 2.6 ? 3 : 4;
        const p = paths[b]; p.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) p.lineTo(pts[k][0], pts[k][1]);
      } else {
        let prev = pts[0];
        for (let k = 0; k < nc; k++) {
          const nx = pointAt(pts, scum, (k + 1) / nc);
          const p = paths[bucket(c0 + k)];
          p.moveTo(prev[0], prev[1]); p.lineTo(nx[0], nx[1]);
          prev = nx;
        }
      }
      if (view.z >= 14.5 && net.nodes[net.links[i].v].signalized) {
        const e = pts[pts.length - 1], a = pointAt(pts, scum, Math.max(0, 1 - 9 / Math.max(9, pxLen)));
        const dx = e[0] - a[0], dy = e[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L * 4, ny = dx / L * 4;
        const sp = sigPaths[sim.sigState[i]];
        sp.moveTo(a[0] + nx, a[1] + ny); sp.lineTo(a[0] - nx, a[1] - ny);
      }
    }
    for (let b = 0; b < cols.length; b++) { ctx.strokeStyle = cols[b]; ctx.lineWidth = b === 0 ? Math.max(1, lw * 0.5) : lw + (b >= 4 ? 1 : 0); ctx.stroke(paths[b]); }
    const sc = [css('--sig-red'), css('--sig-green'), css('--sig-amber')];
    for (let s = 0; s < 3; s++) { ctx.strokeStyle = sc[s]; ctx.lineWidth = 3; ctx.stroke(sigPaths[s]); }
  }

  function legend() {
    const L = $('legend');
    const sw = (c, t, round) => `<span><i style="background:${c}${round ? ';height:8px;width:8px;border-radius:50%' : ''}"></i>${t}</span>`;
    if (S.sim) {
      L.innerHTML = '<b style="font-weight:600">Mô phỏng CTM</b>' + sw(css('--sig-green'), 'thông thoáng') + sw('#cfae00', 'giảm tốc') + sw('#e6a23c', 'dồn ứ') + sw('#e34948', 'hàng chờ') + sw('#7a1116', 'kẹt cứng/tràn') + sw(css('--idle'), 'trống');
      return;
    }
    const m = {
      vc: sw(STATUS.good, 'x < 0.70') + sw(STATUS.warn, '0.70–0.85') + sw(STATUS.serious, '0.85–1.00') + sw(STATUS.critical, '≥ 1.00 quá bão hoà'),
      los: sw(STATUS.good, 'LOS A–B') + sw(STATUS.warn, 'C–D') + sw(STATUS.serious, 'E') + sw(STATUS.critical, 'F'),
      delay: sw(STATUS.good, '< 20 s') + sw(STATUS.warn, '20–35 s') + sw(STATUS.serious, '35–55 s') + sw(STATUS.critical, '≥ 55 s'),
      flow: '<span>Độ dày nét ∝ lưu lượng q (pcu/h)</span>',
      src: sw(css('--s1'), 'đo đếm') + sw(css('--s2'), 'ước lượng / bù') + sw(css('--idle'), 'thiếu'),
      zone: result() ? '<span>Màu = vùng điều khiển (nhãn V·C trên bản đồ)</span>' : '<span>Chưa có kết quả phân vùng — chạy Tối ưu</span>',
    };
    L.innerHTML = `<b style="font-weight:600">${S.scenario === 'opt' ? 'Đề xuất' : 'Hiện trạng'}</b>` + (m[S.colorBy] || '');
  }

  /* ── chọn đối tượng trên bản đồ ── */
  function hitTest(px, py) {
    const geo = getGeo(), net = getNet();
    let best = null, bd = 10;
    for (let n = 0; n < S.project.nodes.length; n++) {
      const p = view.toScreen(...geo.nodes[n]);
      const d = Math.hypot(p[0] - px, p[1] - py);
      if (d < bd) { bd = d; best = { type: 'node', n }; }
    }
    if (best) return best;
    bd = 7;
    const off = view.z >= 14 ? U.clamp((view.z - 13) * 1.6, 1.5, 6) : 0;
    for (let i = 0; i < net.links.length; i++) {
      const g = geo.links[i];
      const pts = linkScreenPts(g, g.twoWay ? off : 0);
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
        const t = U.clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L2, 0, 1);
        const d = Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
        if (d < bd) { bd = d; best = { type: 'link', i }; }
      }
    }
    return best;
  }

  view.onClick = function (px, py, e) {
    if (!S.project) return;
    const hit = hitTest(px, py);
    if (S.tool === 'poly') {
      const [lon, lat] = U.unproject(...view.toMerc(px, py));
      if (S.polyDone) { S.poly = []; S.polyDone = false; }
      S.poly.push([lon, lat]); updatePolyInfo(); view.redraw();
      return;
    }
    if (S.tool === 'sig') {
      if (!hit || hit.type !== 'node') { toast('Nhấp vào một nút giao để gắn / gỡ đèn'); return; }
      toggleSignal(hit.n);
      return;
    }
    if (S.tool === 'addN') {
      const [mx, my] = view.toMerc(px, py);
      const [lon, lat] = U.unproject(mx, my);
      addNode(lon, lat);
      return;
    }
    if (S.tool === 'addL') {
      if (!hit || hit.type !== 'node') { toast('Nhấp vào một nút giao'); return; }
      if (S.pendingLinkFrom === null) { S.pendingLinkFrom = hit.n; view.redraw(); return; }
      if (S.pendingLinkFrom !== hit.n) addLink(S.pendingLinkFrom, hit.n, !e.shiftKey);
      S.pendingLinkFrom = null; view.redraw();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && hit && hit.type === 'node') {
      const id = S.project.nodes[hit.n].id;
      const k = S.chain.indexOf(id);
      if (k >= 0) S.chain.splice(k, 1); else S.chain.push(id);
      updateChainInfo(); view.redraw();
      return;
    }
    select(hit);
  };
  view.onHover = function (px, py) {
    const tip = $('tip');
    if (px < 0 || !S.project) { tip.hidden = true; return; }
    const hit = hitTest(px, py);
    if (!hit) { tip.hidden = true; return; }
    const net = getNet();
    let html = '';
    if (hit.type === 'node') {
      const node = S.project.nodes[hit.n];
      const pl = M.getPlan(node, S.band, S.scenario);
      const a = !S.sim && getAna().nodes[hit.n];
      html = `<b>${esc(node.id)}</b> · ${esc(node.name)}<br>C = <span class="mono">${pl ? M.cycleOf(pl) : '—'}</span> s · offset <span class="mono">${pl ? pl.offset : '—'}</span>` + (a ? `<br>trễ ${a.delay.toFixed(1)} s/pcu · LOS ${a.los} · x<sub>max</sub> ${a.xmax.toFixed(2)}` : '');
    } else {
      const l = net.links[hit.i];
      html = `<b>${esc(l.road || '(không tên)')}</b> ${esc(net.nodes[l.u].id)} → ${esc(net.nodes[l.v].id)}<br>q = <span class="mono">${Math.round(l.q)}</span> pcu/h · v = <span class="mono">${l.vkmh}</span> km/h · L = <span class="mono">${Math.round(l.len)}</span> m`;
      if (S.sim) html += `<br>hàng chờ ${Math.round(S.sim.queueLen(hit.i))} m · chiếm dụng ${(S.sim.linkOcc(hit.i) * 100).toFixed(0)}%`;
      else { const a = getAna().perLink[hit.i]; if (a) html += `<br>x = ${a.x.toFixed(2)} · trễ ${a.d.toFixed(1)} s · LOS ${a.los}`; }
    }
    tip.innerHTML = html; tip.hidden = false;
    tip.style.left = Math.min(px + 14, view.w - 300) + 'px'; tip.style.top = Math.min(py + 14, view.h - 80) + 'px';
  };
  view.dragHook = function (px, py) {
    if (S.tool !== 'move') return null;
    const hit = hitTest(px, py);
    if (!hit || hit.type !== 'node') return null;
    const node = S.project.nodes[hit.n];
    return {
      move(x, y) {
        const [lon, lat] = U.unproject(...view.toMerc(x, y));
        node.lon = U.round(lon, 6); node.lat = U.round(lat, 6);
        for (const l of S.project.links) {
          if (l.u === node.id && l.geom) { l.geom[0] = [node.lon, node.lat]; l.L = null; }
          if (l.v === node.id && l.geom) { l.geom[l.geom.length - 1] = [node.lon, node.lat]; l.L = null; }
        }
        S.geo = null; S.net = null; rev++; view.redraw();
      },
      end() { invalidate(true); select({ type: 'node', n: hit.n }); },
    };
  };

  function addNode(lon, lat) {
    const p = S.project;
    let k = p.nodes.length + 1, id;
    do { id = 'U' + String(k++).padStart(3, '0'); } while (nodeById(id));
    const node = { id, name: 'Nút mới ' + id, lat: U.round(lat, 6), lon: U.round(lon, 6), signalized: true, control: 'fixed', width: 20, plans: {}, opt: {} };
    for (const b of p.bands) node.plans[b.id] = M.defaultPlan(p.params, 2, 90);
    p.nodes.push(node);
    M.normalizeProject(p);
    invalidate(true);
    select({ type: 'node', n: p.nodes.length - 1 });
    toast(`Đã thêm nút ${id}. Dùng "+ Nhánh" để nối với nút lân cận.`);
  }
  function addLink(a, b, both) {
    const p = S.project, na = p.nodes[a], nb = p.nodes[b];
    const mk = (u, v) => {
      if (p.links.some(l => l.u === u.id && l.v === v.id)) return;
      const l = { u: u.id, v: v.id, road: '', lanes: 2, geom: [[u.lon, u.lat], [v.lon, v.lat]], data: {}, phases: [0] };
      const brg = U.bearing([u.lon, u.lat], [v.lon, v.lat]);
      const ns = U.angleDiff(brg, 0) < 45 || U.angleDiff(brg, 180) < 45;
      const nPh = v.plans[p.bands[0].id].phases.length;
      l.phases = [ns ? 0 : Math.min(1, nPh - 1)];
      p.links.push(l);
    };
    mk(na, nb); if (both) mk(nb, na);
    M.normalizeProject(p);
    invalidate(true);
    toast(`Đã thêm nhánh ${na.id} ↔ ${nb.id}. Nhập lưu lượng, vận tốc ở bảng bên phải.`);
    const net = getNet();
    const idx = net.links.findIndex(l => l.ref.u === na.id && l.ref.v === nb.id);
    if (idx >= 0) select({ type: 'link', i: idx });
  }

  /* ── Gắn đèn & nhận biết nhánh ↔ pha ── */
  function describeGroups(desc) {
    return desc.map(g => `Pha ${g.phase}: ${g.approaches.map(a => `${a.dir}${a.road ? ' (' + a.road + ')' : ''}`).join(', ')}`).join(' · ');
  }
  function toggleSignal(n) {
    const node = S.project.nodes[n];
    node.signalized = !node.signalized;
    if (node.signalized) {
      const desc = TS.osm.setupSignal(S.project, node);
      toast(`Đã gắn đèn tại ${node.id}. ${describeGroups(desc) || 'Chưa có nhánh vào.'}`);
    } else toast(`Đã gỡ đèn tại ${node.id} (nút không đèn: xe qua theo năng lực nhánh).`);
    invalidate(); select({ type: 'node', n });
  }
  /* ── Vùng đa giác OSM ── */
  function updatePolyInfo() {
    const el = $('polyInfo');
    if (S.tool !== 'poly' && !S.poly.length) { el.innerHTML = ''; return; }
    if (S.poly.length < 3) { el.innerHTML = `Vẽ vùng: nhấp các đỉnh trên bản đồ (${S.poly.length} đỉnh)${S.poly.length ? ' <button class="btn sm ghost" id="polyClr">Xoá</button>' : ''}`; }
    else {
      const a = TS.osm.polyAreaKm2(S.poly);
      el.innerHTML = `Vùng: <b>${S.poly.length}</b> đỉnh · <b>${a.toFixed(2)}</b> km² <button class="btn sm accent" id="polyGo">Tải mạng OSM…</button> <button class="btn sm ghost" id="polyUndo">↶ Bớt đỉnh</button> <button class="btn sm ghost" id="polyClr">Xoá</button>`;
      $('polyGo').onclick = () => { S.polyDone = true; view.redraw(); osmDialog(null); };
      $('polyUndo').onclick = () => { S.poly.pop(); S.polyDone = false; updatePolyInfo(); view.redraw(); };
    }
    if ($('polyClr')) $('polyClr').onclick = () => { S.poly = []; S.polyDone = false; updatePolyInfo(); view.redraw(); };
  }
  const osmOpts = { classes: TS.osm.DEFAULT_CLASSES.slice(), R: 30, keepMidSignals: false, defaultFlows: true, mode: 'new' };
  function osmDialog(fileData) {
    const src = fileData ? 'file OSM đã chọn' : `vùng vẽ ${S.poly.length} đỉnh (${TS.osm.polyAreaKm2(S.poly).toFixed(2)} km²)`;
    const cls = Object.entries(TS.osm.CLASSES).map(([k, c]) => `<label class="chk"><input type="checkbox" data-cls="${k}" ${osmOpts.classes.includes(k) ? 'checked' : ''}> ${c.label} <span class="note" style="margin:0">(${k})</span></label>`).join('');
    modal('Dựng mạng lưới từ OpenStreetMap', `
      <p>Nguồn: <b>${esc(src)}</b>${fileData ? (S.poly.length >= 3 ? ' — chỉ lấy phần trong vùng vẽ' : ' — lấy toàn bộ file') : ' — tải qua Overpass API (cần Internet)'}.</p>
      <div class="grid2" style="gap:14px"><div><h3 style="font-size:12px;color:var(--muted)">CẤP ĐƯỜNG ĐƯA VÀO MÔ HÌNH</h3>${cls}
        <p class="note">Nên chọn từ tertiary trở lên cho mô hình điều khiển tín hiệu; đường dân cư làm mạng rất dày.</p></div>
      <div><h3 style="font-size:12px;color:var(--muted)">XỬ LÝ HÌNH HỌC</h3>
        <label class="field">Bán kính gộp nút giao R (m)<input type="number" id="oR" value="${osmOpts.R}"></label>
        <p class="note">Gộp các điểm giao cách nhau &lt; R (đường đôi, dải phân cách, nút phức hợp) thành một nút. TP.HCM: 25–40 m.</p>
        <label class="chk"><input type="checkbox" id="oMid" ${osmOpts.keepMidSignals ? 'checked' : ''}> Giữ đèn giữa đoạn (đèn qua đường bộ hành) làm nút riêng</label>
        <label class="chk"><input type="checkbox" id="oFlow" ${osmOpts.defaultFlows ? 'checked' : ''}> Điền lưu lượng mặc định theo cấp đường (đánh dấu "ước lượng")</label>
        <h3 style="font-size:12px;color:var(--muted)">KẾT QUẢ</h3>
        <label class="chk"><input type="radio" name="oMode" value="new" ${osmOpts.mode === 'new' ? 'checked' : ''}> Tạo dự án mới</label>
        <label class="chk"><input type="radio" name="oMode" value="add" ${osmOpts.mode === 'add' ? 'checked' : ''}> Thêm vào dự án hiện tại</label></div></div>
      <p class="note">Đèn tín hiệu lấy từ thẻ OSM <code>highway=traffic_signals</code> (gán về nút giao gần nhất trong ~${Math.max(40, osmOpts.R + 15)} m). Nhánh vào nút có đèn được tự nhóm theo trục → pha 1 (trục chính), pha 2, pha 3. Sau khi dựng, dùng công cụ <b>🚦 Gắn đèn</b> để gắn / gỡ đèn và kiểm tra nhánh ↔ pha.</p>
      <div id="osmMsg" class="note"></div>`,
    [{ label: 'Huỷ' }, { label: 'Tải & dựng mạng', cls: 'accent', onClick: () => { runOsm(fileData); return false; } }]);
  }
  async function runOsm(fileData) {
    const body = $('modalBody');
    osmOpts.classes = [...body.querySelectorAll('[data-cls]')].filter(x => x.checked).map(x => x.dataset.cls);
    osmOpts.R = U.num($('oR').value, 30); osmOpts.keepMidSignals = $('oMid').checked; osmOpts.defaultFlows = $('oFlow').checked;
    osmOpts.mode = (body.querySelector('input[name="oMode"]:checked') || {}).value || 'new';
    const msg = (t, err) => { const m = $('osmMsg'); if (m) { m.innerHTML = t; m.className = err ? 'note bad' : 'note'; } };
    if (!osmOpts.classes.length) { msg('Chọn ít nhất một cấp đường', true); return; }
    try {
      let data = fileData;
      if (!data) {
        if (TS.osm.polyAreaKm2(S.poly) > 60 && !confirm('Vùng lớn hơn 60 km² — tải có thể chậm. Tiếp tục?')) return;
        data = await TS.osm.fetchOverpass(TS.osm.buildQuery(S.poly, osmOpts.classes), (t) => msg(t));
      }
      msg('Đang dựng mạng lưới…'); await U.sleep(20);
      const r = TS.osm.buildProject(data, Object.assign({}, osmOpts, { poly: S.poly.length >= 3 ? S.poly : null, name: 'Mạng OSM ' + new Date().toLocaleDateString('vi-VN') }));
      if (!r.project.nodes.length) { msg('Không có tuyến đường nào trong vùng với cấp đường đã chọn.', true); return; }
      if (osmOpts.mode === 'add' && S.project) mergeProject(r.project); else loadProject(r.project, true);
      S.poly = []; S.polyDone = false; setTool('sel'); updatePolyInfo();
      const s = r.stats;
      modal('Kết quả dựng mạng OSM', `<table class="cmp"><tbody>
        <tr><td>Tuyến OSM (way) đọc được</td><td>${U.fmt(s.ways)}</td></tr>
        <tr><td>Điểm giao thô → nút giao sau gộp & rút gọn</td><td>${U.fmt(s.junctions)} → <b>${U.fmt(s.clusters)}</b></td></tr>
        <tr><td>Nhánh có hướng (liên kết)</td><td><b>${U.fmt(s.links)}</b></td></tr>
        <tr><td>Đèn OSM → nút có đèn</td><td>${s.sigRaw} → <b>${s.signals}</b>${s.sigLost ? ` (${s.sigLost} đèn không gần nút nào)` : ''}</td></tr></tbody></table>
        <p class="note">Tiếp theo: kiểm tra đèn bằng công cụ <b>🚦 Gắn đèn</b> (nhấp nút đã có đèn để xem nhánh ↔ pha, tô màu trên bản đồ), nhập lưu lượng / vận tốc (thẻ Dữ liệu hoặc CSV), giản đồ pha hiện trạng, rồi chạy Tối ưu.${osmOpts.defaultFlows ? ' Lưu lượng hiện là giá trị mặc định theo cấp đường.' : ''}</p>`);
    } catch (e) { console.error(e); msg(esc(e.message), true); }
  }
  function mergeProject(q) {
    const p = S.project, ids = new Set(p.nodes.map(n => n.id));
    let k = 0; const ren = new Map();
    for (const n of q.nodes) { let id; do { id = 'O' + String(++k).padStart(4, '0'); } while (ids.has(id)); ids.add(id); ren.set(n.id, id); n.id = id; }
    for (const l of q.links) { l.u = ren.get(l.u); l.v = ren.get(l.v); delete l.id; }
    for (const n of q.nodes) { for (const b of p.bands) { if (!n.plans[b.id]) n.plans[b.id] = U.deepClone(n.plans[q.bands[0].id] || M.defaultPlan(p.params, 2)); } p.nodes.push(n); }
    for (const l of q.links) { for (const b of p.bands) if (!l.data[b.id]) l.data[b.id] = U.deepClone(l.data[q.bands[0].id] || {}); p.links.push(l); }
    M.normalizeProject(p); invalidate(true); renderAll(); fitAll();
  }

  function updateChainInfo() {
    const el = $('chainInfo');
    if (!S.chain.length) { el.innerHTML = ''; return; }
    el.innerHTML = `Chuỗi tự chọn: <b>${S.chain.length}</b> nút <button class="btn sm" id="chainTSD">Vẽ TSD</button> <button class="btn sm" id="chainSave">Lưu làm hành lang</button> <button class="btn sm ghost" id="chainClr">Xoá</button>`;
    $('chainTSD').onclick = () => openTSD(S.chain.map(id => getNet().nodeIdx.get(id)), 'Chuỗi tự chọn');
    $('chainSave').onclick = () => {
      const name = prompt('Tên hành lang:', 'Hành lang ' + (S.project.corridors.length + 1));
      if (!name) return;
      S.project.corridors.push({ name, nodes: S.chain.slice() });
      S.chain = []; updateChainInfo(); autosave(); renderOpt();
      toast('Đã lưu hành lang. Bộ tối ưu sẽ ưu tiên hành lang này khi chạy lại.');
    };
    $('chainClr').onclick = () => { S.chain = []; updateChainInfo(); view.redraw(); };
  }

  /* ════════════════ CHỌN & BẢNG THUỘC TÍNH ════════════════ */
  function select(sel) {
    S.sel = sel;
    renderInspector();
    view.redraw();
    if (sel && sel.type === 'zone') { setDock('curve'); }
  }

  function planEditor(node, which) {
    const pl = which === 'opt' ? node.opt[S.band] : node.plans[S.band];
    if (!pl) return `<div class="note">Chưa có giản đồ đề xuất cho khung giờ này. <button class="btn sm" data-act="mkopt">Tạo từ hiện trạng</button></div>`;
    const C = M.cycleOf(pl);
    const cols = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'].map(css);
    let ring = '<div class="ring">';
    pl.phases.forEach((ph, k) => {
      ring += `<i style="width:${ph.g / C * 100}%;background:${cols[k % cols.length]}" title="Pha ${k + 1}: xanh ${ph.g}s"></i><i style="width:${(ph.y + ph.ar) / C * 100}%;background:var(--sunk)" title="vàng ${ph.y}s + đỏ toàn phần ${ph.ar}s"></i>`;
    });
    ring += `</div><div class="ringl"><span>0</span><span>C = ${C} s${pl.half ? ' (½ chu kỳ vùng)' : ''}</span></div>`;
    let t = `<table class="ph-table" data-plan="${which}"><thead><tr><th>Pha</th><th>Xanh</th><th>Vàng</th><th>Đỏ TP</th><th>Xanh min</th></tr></thead><tbody>`;
    pl.phases.forEach((ph, k) => {
      t += `<tr><td><span class="swatch" style="background:${cols[k % cols.length]}"></span>${k + 1}</td>` +
        ['g', 'y', 'ar', 'minG'].map(f => `<td><input type="number" min="0" step="1" data-k="${k}" data-f="${f}" value="${ph[f] ?? ''}"></td>`).join('') + '</tr>';
    });
    t += `</tbody></table><div class="row"><label class="field" style="flex-direction:row;align-items:center;gap:6px">Offset θ <input type="number" data-f="offset" value="${pl.offset}" style="width:70px"></label>
      <button class="btn sm" data-act="addph" data-plan="${which}">+ Pha</button><button class="btn sm" data-act="delph" data-plan="${which}">− Pha</button></div>`;
    return ring + t;
  }

  /* ── Chỉ số đánh giá toàn mạng (luôn hiển thị ở khung phải) ── */
  let kpiCollapsed = false;
  function losStack(counts) {
    const L = ['A', 'B', 'C', 'D', 'E', 'F'], tot = L.reduce((a, k) => a + (counts[k] || 0), 0) || 1;
    return `<div class="losbar" title="Phân bố mức phục vụ các nút">${L.filter(k => counts[k]).map(k => `<i style="width:${(counts[k] / tot * 100).toFixed(1)}%;background:${losColor(k)}" title="LOS ${k}: ${counts[k]} nút"></i>`).join('')}</div>
      <div class="losl">${L.map(k => `<span>${k} ${counts[k] || 0}</span>`).join('')}</div>`;
  }
  function renderNetKpi() {
    const box = $('netKpi');
    if (!S.project) { box.innerHTML = ''; return; }
    const head = (title) => `<div class="hd"><b>${title}</b><button class="btn sm ghost" id="kpiTog" title="Thu gọn / mở rộng">${kpiCollapsed ? '▸' : '▾'}</button></div>`;
    const net = getNet();
    if (S.sim) {
      const m = S.sim.netMetrics();
      const last = S.sim.series[S.sim.series.length - 1];
      const t = m.t, clock = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      const stopR = m.arr > 1 ? m.stops / m.arr : null;
      const perVeh = m.entries > 1 ? m.delay / m.entries : null;
      // LOS theo trễ mô phỏng từng nút
      const cnt = {};
      for (let v = 0; v < net.N; v++) {
        if (!net.nodes[v].signalized || !net.inL[v].length) continue;
        let d = 0, o = 0; for (const i of net.inL[v]) { d += m.linkDelay[i]; o += S.sim.K.out[i]; }
        if (o < 1) continue;
        const los = SG.los(d / o, 0); cnt[los] = (cnt[los] || 0) + 1;
      }
      const ql = m.qmaxI >= 0 ? net.links[m.qmaxI] : null;
      box.innerHTML = head(`Chỉ số mạng lưới · mô phỏng ${clock}`) + (kpiCollapsed ? '' : `
        <div class="tiles">
          <div class="tile"><small>Thông suốt</small><b>${stopR === null ? '—' : Math.round((1 - stopR) * 100) + '%'}</b><small>pcu tới không phải dừng</small></div>
          <div class="tile"><small>Tỷ lệ dừng</small><b>${stopR === null ? '—' : Math.round(stopR * 100) + '%'}</b><small>${U.fmt(m.stops)} / ${U.fmt(m.arr)} pcu tới</small></div>
          <div class="tile"><small>Trễ TB</small><b>${perVeh === null ? '—' : Math.round(perVeh) + ' s'}</b><small>mỗi pcu vào mạng · ${U.fmt(m.delay / 3600)} xe·h</small></div>
          <div class="tile"><small>Vận tốc TB</small><b>${last ? last.speed.toFixed(1) : '—'}</b><small>km/h (phút gần nhất)</small></div>
          <div class="tile"><small>Đang xếp hàng</small><b>${U.fmt(m.queued)}</b><small>pcu${ql ? ` · dài nhất <span class="link" id="kpiQl" style="cursor:pointer;text-decoration:underline dotted">${esc(net.nodes[ql.v].id)}←${esc(net.nodes[ql.u].id)}</span> ${Math.round(m.qmaxM)} m` : ''}</small></div>
          <div class="tile"><small>Tràn ngược</small><b ${m.spill ? 'class="bad"' : ''}>${m.spill}</b><small>nhánh ≥ ${Math.round(S.project.params.spillThreshold * 100)}% chiều dài</small></div>
        </div>
        ${m.spill ? `<div class="row"><span class="badge bad">⚠ ${m.spill} nhánh đang tràn ngược — nguy cơ khoá nút</span></div>` : ''}
        <div class="flowl">đã vào <b class="num">${U.fmt(m.entries)}</b> · đang chạy <b class="num">${U.fmt(m.onroad)}</b> · chờ vào <b class="num">${U.fmt(m.bufNow)}</b> · đã ra <b class="num">${U.fmt(m.exits)}</b> pcu ${last ? balTag(last) : ''}</div>
        <div class="flowl" style="margin-top:8px">Mức phục vụ nút (trễ mô phỏng)</div>${losStack(cnt)}
        <canvas id="kpiSpark" aria-label="Tỷ lệ dừng theo phút"></canvas>`);
      if (!kpiCollapsed) {
        drawKpiSpark(S.sim.series);
        if ($('kpiQl')) $('kpiQl').onclick = () => select({ type: 'link', i: m.qmaxI });
      }
    } else {
      const ana = getAna();
      const cnt = {}; let over = 0, hi = 0, ef = 0, nN = 0;
      ana.nodes.forEach(a => { if (!a) return; nN++; cnt[a.los] = (cnt[a.los] || 0) + 1; if (a.los === 'E' || a.los === 'F') ef++; });
      ana.perLink.forEach(a => { if (!a) return; if (a.x >= 1) over++; else if (a.x >= 0.85) hi++; });
      const r = result();
      box.innerHTML = head(`Chỉ số mạng lưới · ${S.scenario === 'opt' ? 'đề xuất' : 'hiện trạng'} (HCM)`) + (kpiCollapsed ? '' : `
        <div class="tiles">
          <div class="tile"><small>Trễ TB mạng</small><b>${ana.avgDelay.toFixed(1)}</b><small>s/pcu · LOS ${SG.los(ana.avgDelay, 0)}</small></div>
          <div class="tile"><small>Nút LOS E–F</small><b ${ef ? 'class="bad"' : ''}>${ef}</b><small>/ ${nN} nút có đèn</small></div>
          <div class="tile"><small>Nhánh quá tải</small><b ${over ? 'class="bad"' : ''}>${over}</b><small>x ≥ 1 · ${hi} nhánh 0,85–1</small></div>
        </div>
        <div class="flowl" style="margin-top:8px">Mức phục vụ nút</div>${losStack(cnt)}
        ${r ? `<div class="flowl">Tối ưu (TRANSYT): trễ ${r.base.delay.toFixed(1)} → <b>${r.opt.delay.toFixed(1)}</b> s/pcu · dừng ${r.base.stops.toFixed(2)} → <b>${r.opt.stops.toFixed(2)}</b> · ${r.zones.length} vùng</div>` : ''}
        <div class="note" style="margin:6px 0 0">Chạy mô phỏng (thẻ Mô phỏng) để xem chỉ số động: thông suốt, dừng, hàng chờ, tràn ngược.</div>`);
    }
    if ($('kpiTog')) $('kpiTog').onclick = () => { kpiCollapsed = !kpiCollapsed; renderNetKpi(); };
  }
  function drawKpiSpark(series) {
    const cv = $('kpiSpark'); if (!cv) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, h = r.height, pts = series.slice(-40);
    ctx.clearRect(0, 0, w, h);
    const bw = w / 40;
    pts.forEach((p, k) => {
      const bh = Math.max(1, (p.stopRate || 0) * (h - 14));
      ctx.fillStyle = k === pts.length - 1 ? css('--s1') : css('--s8'); ctx.globalAlpha = k === pts.length - 1 ? 1 : 0.55;
      ctx.fillRect(k * bw + 1, h - 12 - bh, Math.max(1, bw - 2), bh);
    });
    ctx.globalAlpha = 1; ctx.fillStyle = css('--muted'); ctx.font = '10px ' + css('--font');
    ctx.fillText('tỷ lệ dừng theo phút (40 phút gần nhất)', 0, h - 2);
  }

  function renderInspector() {
    renderNetKpi();
    const el = $('insp');
    const sel = S.sel;
    if (!S.project) { el.innerHTML = ''; return; }
    if (!sel) {
      const st = M.stats(S.project);
      el.innerHTML = `<h2>${esc(S.project.name)}</h2><div class="sub">${st.nodes} nút · ${st.links} nhánh tiếp cận · ${S.project.bands.length} khung giờ</div>
      <div class="help"><p><b>Cách dùng nhanh</b></p><ol>
      <li><b>Dữ liệu</b>: nạp CSV hoặc vẽ nút/nhánh trên bản đồ; nhấp một nút để sửa chu kỳ, pha, lưu lượng từng hướng.</li>
      <li><b>Tối ưu</b>: chạy bộ tối ưu → phân vùng, chu kỳ vùng, sóng xanh, offset, khuyến nghị phương án.</li>
      <li><b>Mô phỏng</b>: xem dòng xe CTM (hàng chờ, tràn ngược), đối sánh A/B Hiện trạng ↔ Đề xuất ↔ Thích ứng.</li>
      <li><b>Báo cáo</b>: xuất phiếu cài đặt tủ và báo cáo phương án.</li></ol>
      <p><kbd>Ctrl</kbd>+nhấp các nút để tạo chuỗi hành lang tự chọn và vẽ biểu đồ thời gian – khoảng cách. <kbd>Esc</kbd> huỷ chọn.</p></div>`;
      return;
    }
    const net = getNet();
    if (sel.type === 'node') {
      const node = S.project.nodes[sel.n];
      const ana = getAna().nodes[sel.n];
      const r = result();
      let zoneTxt = '';
      if (r) { const i = r.nodeIds.indexOf(node.id); const zi = i >= 0 ? r.zoneOf[i] : -1; const z = r.zones.find(x => x.id === zi); if (z) zoneTxt = `<span class="badge info">Vùng V${String(z.id + 1).padStart(2, '0')} · C${z.C}</span> <span class="badge">${esc(OPT.STRATEGY_LABEL[z.strategy] || '')}</span>`; }
      const nd = r && r.nodeInfo && r.nodeInfo.find(x => x && x.id === node.id);
      let appr = `<table class="ph-table"><thead><tr><th>Hướng</th><th>q pcu/h</th><th>v km/h</th><th>Làn</th><th>Pha</th><th>x</th><th>trễ</th><th>LOS</th></tr></thead><tbody>`;
      for (const i of net.inL[sel.n]) {
        const l = net.links[i], a = getAna().perLink[i], d = l.ref.data[S.band] || {};
        appr += `<tr><td title="${esc(l.road)} từ ${esc(net.nodes[l.u].id)}"><span class="link" data-link="${i}" style="cursor:pointer;text-decoration:underline dotted">${U.approachName(l.brg)}</span></td>
          <td><input class="q" type="number" data-li="${i}" data-f="q" value="${d.q ?? ''}" ${d.src === 'imputed' ? 'style="font-style:italic;color:var(--muted)" title="giá trị bù/ước lượng"' : ''}></td>
          <td><input type="number" data-li="${i}" data-f="v" value="${d.v ?? ''}"></td>
          <td><input type="number" data-li="${i}" data-f="lanes" value="${l.lanes}" style="width:34px"></td>
          <td><input type="text" data-li="${i}" data-f="phases" value="${l.phases.map(k => k + 1).join(';')}" style="width:40px"></td>
          <td class="mono">${a ? a.x.toFixed(2) : '—'}</td><td class="mono">${a ? a.d.toFixed(0) : '—'}</td><td><span class="swatch" style="background:${a ? losColor(a.los) : 'transparent'}"></span>${a ? a.los : ''}</td></tr>`;
      }
      appr += '</tbody></table>';
      el.innerHTML = `<h2>${esc(node.name)}</h2><div class="sub mono">${esc(node.id)} · ${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}</div>
        <div class="row">${zoneTxt}</div>
        ${ana ? `<div class="tiles"><div class="tile"><small>Trễ TB (HCM)</small><b>${ana.delay.toFixed(1)}</b><small>s/pcu · LOS ${ana.los}</small></div><div class="tile"><small>x lớn nhất</small><b>${ana.xmax.toFixed(2)}</b><small>Y = ${ana.Y.toFixed(2)}</small></div><div class="tile"><small>C Webster</small><b>${ana.Cw}</b><small>L = ${ana.L.toFixed(0)} s${nd ? ' · C<sub>min</sub> ' + nd.Cx : ''}</small></div></div>` : ''}
        <h3>Thông tin nút</h3>
        <div class="grid2"><label class="field">Mã nút<input data-nf="id" value="${esc(node.id)}"></label><label class="field">Bề rộng nút (m)<input type="number" data-nf="width" value="${node.width}"></label></div>
        <label class="field">Tên nút<input data-nf="name" value="${esc(node.name)}"></label>
        <div class="grid2"><label class="field">Điều khiển<select data-nf="control">${Object.entries(SIM.MODES).map(([k, v]) => `<option value="${k}" ${node.control === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field">Khu vực xung quanh<select data-nf="landuse" title="Quyết định tỷ lệ xe kết thúc/bắt đầu chuyến tại khu vực nút">${Object.entries(M.LANDUSE).map(([k, v]) => `<option value="${k}" ${node.landuse === k ? 'selected' : ''}>${v.label} (${Math.round((v.r ?? S.project.params.exchangeRate) * 100)}%)</option>`).join('')}</select></label>
        <label class="field">Có đèn<select data-nf="signalized"><option value="1" ${node.signalized ? 'selected' : ''}>Có</option><option value="0" ${!node.signalized ? 'selected' : ''}>Không</option></select></label></div>
        <h3>Giản đồ pha hiện trạng · ${esc(bandLabel(S.band))}</h3>${planEditor(node, 'base')}
        <div class="row"><button class="btn sm" data-act="webster">Webster cho nút</button><button class="btn sm" data-act="ite">Vàng/đỏ theo ITE</button><button class="btn sm" data-act="copyband">Chép sang mọi khung giờ</button><button class="btn sm" data-act="axis" title="Nhóm nhánh vào theo trục đường → pha; tạo lại giản đồ mặc định">Gán pha theo trục</button></div>
        <h3>Giản đồ pha đề xuất</h3>${planEditor(node, 'opt')}
        ${node.opt[S.band] ? '<div class="row"><button class="btn sm" data-act="applyopt">Áp dụng đề xuất → hiện trạng</button></div>' : ''}
        <h3>Nhánh tiếp cận · ${esc(bandLabel(S.band))}</h3>${appr}
        <p class="note">Pha: số thứ tự pha của nút cho phép nhánh đi (nhiều pha: 1;3). x, trễ, LOS theo HCM với phương án đang xem (${S.scenario === 'opt' ? 'đề xuất' : 'hiện trạng'}).</p>
        <div class="row"><button class="btn sm danger" data-act="delnode">Xoá nút</button></div>`;
      bindInspectorNode(node, sel.n);
    } else if (sel.type === 'link') {
      const l = net.links[sel.i], ref = l.ref, a = getAna().perLink[sel.i];
      let rows = '';
      for (const b of S.project.bands) {
        const d = ref.data[b.id] || {};
        rows += `<tr><td style="text-align:left">${esc(b.label)}</td><td><input class="q" type="number" data-b="${b.id}" data-f="q" value="${d.q ?? ''}"></td><td><input type="number" data-b="${b.id}" data-f="v" value="${d.v ?? ''}"></td><td>${d.src === 'imputed' ? '<span class="badge">bù</span>' : d.src === 'measured' ? '<span class="badge ok">đo</span>' : '<span class="badge bad">thiếu</span>'}</td></tr>`;
      }
      el.innerHTML = `<h2>${esc(ref.road || 'Nhánh không tên')}</h2><div class="sub mono">${esc(ref.u)} → ${esc(ref.v)} · ${U.approachName(l.brg)} vào nút ${esc(ref.v)}</div>
        ${a ? `<div class="tiles"><div class="tile"><small>Độ bão hoà</small><b>${a.x.toFixed(2)}</b><small>c = ${Math.round(l.S * a.ge / M.cycleOf(M.getPlan(net.nodes[l.v], S.band, S.scenario)))} pcu/h</small></div><div class="tile"><small>Trễ HCM</small><b>${a.d.toFixed(1)}</b><small>LOS ${a.los}</small></div><div class="tile"><small>T hành trình</small><b>${l.T.toFixed(0)}</b><small>s tại ${l.vkmh} km/h</small></div></div>` : ''}
        <h3>Thuộc tính</h3>
        <label class="field">Tên đường<input data-lf="road" value="${esc(ref.road || '')}"></label>
        <div class="grid2"><label class="field">Chiều dài L (m) — trống = theo hình học<input type="number" data-lf="L" value="${ref.L ? U.round(ref.L, 1) : ''}" placeholder="${Math.round(l.len)}"></label>
        <label class="field">Số làn<input type="number" data-lf="lanes" value="${ref.lanes}"></label>
        <label class="field">Suất dòng bão hoà S (pcu/h) — trống = làn × ${S.project.params.satPerLane}<input type="number" data-lf="S" value="${ref.S || ''}" placeholder="${Math.round(l.S)}"></label>
        <label class="field">Pha phục vụ tại ${esc(ref.v)}<input data-lf="phases" value="${ref.phases.map(k => k + 1).join(';')}"></label></div>
        <h3>Lưu lượng & vận tốc theo khung giờ</h3>
        <table class="ph-table"><thead><tr><th style="text-align:left">Khung giờ</th><th>q pcu/h</th><th>v km/h</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <p class="note">Tỷ lệ rẽ ước lượng (Furness): ${l.turn.map(t => `${esc(net.nodes[net.links[t.j].v].id)} ${(t.p * (1 - l.exitFrac) * 100).toFixed(0)}%`).join(' · ') || '—'}${l.exitFrac > 0.01 ? ` · ra khỏi mạng ${(l.exitFrac * 100).toFixed(0)}%` : ''}</p>
        <div class="row"><button class="btn sm danger" data-act="dellink">Xoá nhánh</button></div>`;
      bindInspectorLink(ref);
    } else if (sel.type === 'zone') {
      const r = result(); const z = r && r.zones.find(x => x.id === sel.z);
      if (!z) { el.innerHTML = ''; return; }
      const corr = r.corridors.filter(c => c.zone === z.id);
      el.innerHTML = `<h2>Vùng V${String(z.id + 1).padStart(2, '0')}</h2><div class="sub">${z.ids.length} nút · ${esc(bandLabel(r.band))}</div>
        <div class="tiles"><div class="tile"><small>Chu kỳ vùng</small><b>${z.C}</b><small>s${z.nHalf ? ' · ' + z.nHalf + ' nút ½C' : ''}</small></div>
        <div class="tile"><small>Trễ TB</small><b>${z.opt ? z.opt.delay.toFixed(1) : '—'}</b><small>hiện trạng ${z.base ? z.base.delay.toFixed(1) : '—'}</small></div>
        <div class="tile"><small>Số lần dừng</small><b>${z.opt ? z.opt.stops.toFixed(2) : '—'}</b><small>hiện trạng ${z.base ? z.base.stops.toFixed(2) : '—'}</small></div></div>
        <h3>Phương án</h3><p>${esc((r.recs.find(x => x.kind === 'zone' && x.zone === z.id) || {}).text || '')}</p>
        ${S.sim ? zoneBalanceHtml(z) : '<p class="note">Chạy mô phỏng (thẻ Mô phỏng) để xem cân bằng xe vào/ra của vùng.</p>'}
        ${z.adaptiveGain !== undefined ? `<p class="note">Kiểm chứng CTM: trễ vùng cố định ${z.ctmFixedDelayH.toFixed(1)} xe·h → thích ứng ${z.ctmAdaptDelayH.toFixed(1)} xe·h.</p>` : ''}
        <h3>Hành lang trong vùng</h3>${corr.length ? corr.map(c => `<div class="rec ${c.gws.cls}" data-corr="${r.corridors.indexOf(c)}"><div class="t">${esc(c.road || '(không tên)')} <span class="badge">${c.ids.length} nút</span><span class="badge">GWS ${c.gws.gws.toFixed(0)}</span></div>dải ${c.after.bOut.toFixed(0)}s / ${c.after.bIn.toFixed(0)}s</div>`).join('') : '<p class="note">Không có hành lang đủ điều kiện.</p>'}
        <h3>Nút</h3><p class="mono" style="font-size:11.5px">${z.ids.map(esc).join(', ')}</p>`;
      el.querySelectorAll('[data-corr]').forEach(d => d.onclick = () => openResultCorridor(+d.dataset.corr));
    }
  }

  function zoneBalanceHtml(z) {
    const net = getNet();
    const set = new Set(z.ids.map(id => net.nodeIdx.get(id)).filter(x => x !== undefined));
    const b = S.sim.zoneBalance(set);
    const h = b.span / 3600;
    const vin = b.inB + b.src, vout = b.outB + b.sink;
    const r = (x) => U.fmt(x / h);
    return `<h3>Cân bằng xe của vùng (CTM, ${(b.span / 60).toFixed(0)} phút)</h3>
      <table class="cmp"><thead><tr><th></th><th>pcu</th><th>pcu/h</th></tr></thead><tbody>
      <tr><td>Vào qua biên vùng</td><td>${U.fmt(b.inB)}</td><td>${r(b.inB)}</td></tr>
      <tr><td>Phát sinh trong vùng (nhà, cơ quan, bãi đỗ, hẻm)</td><td>${U.fmt(b.src)}</td><td>${r(b.src)}</td></tr>
      <tr><td>Ra qua biên vùng</td><td>${U.fmt(b.outB)}</td><td>${r(b.outB)}</td></tr>
      <tr><td>Kết thúc chuyến trong vùng</td><td>${U.fmt(b.sink)}</td><td>${r(b.sink)}</td></tr>
      <tr><td><b>Tích luỹ (vào − ra)</b></td><td><b>${U.fmt(vin - vout)}</b></td><td></td></tr>
      <tr><td>Đang có trong vùng</td><td>${U.fmt(b.inside)}</td><td></td></tr></tbody></table>
      <p class="note">Tích luỹ tăng mãi nghĩa là vùng không thoát kịp (quá bão hoà / tràn ngược). Giai đoạn đầu mô phỏng mạng đang được lấp đầy nên luôn tích luỹ.</p>`;
  }
  function bindInspectorNode(node, n) {
    const el = $('insp');
    const P = S.project.params;
    el.querySelectorAll('table[data-plan] input').forEach(inp => {
      inp.onchange = () => {
        const which = inp.closest('table').dataset.plan;
        const pl = which === 'opt' ? node.opt[S.band] : node.plans[S.band];
        pl.phases[+inp.dataset.k][inp.dataset.f] = Math.max(0, U.num(inp.value, 0));
        invalidate(); renderInspector(); view.redraw(); refreshTSD();
      };
    });
    el.querySelectorAll('input[data-f="offset"]').forEach(inp => {
      inp.onchange = () => {
        const table = inp.closest('.row').previousElementSibling;
        const which = table && table.dataset.plan;
        const pl = which === 'opt' ? node.opt[S.band] : node.plans[S.band];
        pl.offset = U.mod(U.num(inp.value, 0), M.cycleOf(pl));
        invalidate(); renderInspector(); refreshTSD();
      };
    });
    el.querySelectorAll('[data-nf]').forEach(inp => {
      inp.onchange = () => {
        const f = inp.dataset.nf;
        if (f === 'id') {
          const nid = inp.value.trim();
          if (!nid || nodeById(nid)) { toast('Mã nút trống hoặc đã tồn tại', true); inp.value = node.id; return; }
          for (const l of S.project.links) { if (l.u === node.id) l.u = nid; if (l.v === node.id) l.v = nid; }
          for (const c of S.project.corridors) c.nodes = c.nodes.map(x => x === node.id ? nid : x);
          node.id = nid;
        } else if (f === 'signalized') {
          node.signalized = inp.value === '1';
          if (node.signalized) toast(describeGroups(TS.osm.setupSignal(S.project, node, true)) || 'Đã gắn đèn');
        }
        else if (f === 'width') node.width = U.num(inp.value, 20);
        else node[f] = inp.value;
        invalidate(true); renderInspector(); view.redraw();
      };
    });
    el.querySelectorAll('input[data-li]').forEach(inp => {
      inp.onchange = () => {
        const l = getNet().links[+inp.dataset.li].ref, f = inp.dataset.f;
        if (f === 'q' || f === 'v') { const d = l.data[S.band] = l.data[S.band] || {}; d[f] = U.num(inp.value, null); if (f === 'q') d.src = d.q === null ? 'missing' : 'measured'; }
        else if (f === 'lanes') l.lanes = U.num(inp.value, l.lanes);
        else if (f === 'phases') l.phases = inp.value.split(/[;,\s]+/).map(x => Number(x) - 1).filter(x => x >= 0);
        invalidate(); renderInspector(); view.redraw();
      };
    });
    el.querySelectorAll('[data-link]').forEach(s => s.onclick = () => select({ type: 'link', i: +s.dataset.link }));
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act, net = getNet();
      if (act === 'mkopt') node.opt[S.band] = U.deepClone(node.plans[S.band]);
      if (act === 'axis') { if (!confirm('Tạo lại giản đồ pha mặc định (mọi khung giờ) và gán pha nhánh vào theo trục?')) return; const desc = TS.osm.setupSignal(S.project, node); toast(describeGroups(desc)); }
      if (act === 'webster') { const r = SG.optimizeNode(net, n, node.plans[S.band]); node.opt[S.band] = Object.assign(r.plan, { offset: node.plans[S.band].offset }); toast(`Webster: C = ${r.C}s (Y = ${r.Y.toFixed(2)}) → ghi vào giản đồ đề xuất`); }
      if (act === 'ite') { SG.applyITE(net, n, node.plans[S.band]); toast('Đã tính vàng/đỏ toàn phần theo ITE cho hiện trạng'); }
      if (act === 'copyband') { for (const bb of S.project.bands) if (bb.id !== S.band) node.plans[bb.id] = U.deepClone(node.plans[S.band]); toast('Đã chép giản đồ sang mọi khung giờ'); }
      if (act === 'applyopt') { node.plans[S.band] = U.deepClone(node.opt[S.band]); delete node.plans[S.band].half; toast('Đã áp dụng đề xuất làm hiện trạng cho nút này'); }
      if (act === 'addph' || act === 'delph') {
        const pl = b.dataset.plan === 'opt' ? node.opt[S.band] : node.plans[S.band];
        if (act === 'addph') pl.phases.push({ g: P.minGreen, y: P.yellow, ar: P.allRed, minG: P.minGreen, maxG: P.maxGreen });
        else if (pl.phases.length > 1) pl.phases.pop();
        if (b.dataset.plan !== 'opt') for (const bb of S.project.bands) { const q = node.plans[bb.id]; if (q !== pl) { while (q.phases.length < pl.phases.length) q.phases.push(U.deepClone(pl.phases[pl.phases.length - 1])); while (q.phases.length > pl.phases.length) q.phases.pop(); } }
      }
      if (act === 'delnode') {
        if (!confirm(`Xoá nút ${node.id} và các nhánh nối với nút?`)) return;
        S.project.links = S.project.links.filter(l => l.u !== node.id && l.v !== node.id);
        S.project.nodes.splice(n, 1);
        S.sel = null; invalidate(true); renderInspector(); view.redraw(); return;
      }
      invalidate(); renderInspector(); view.redraw(); refreshTSD();
    });
  }

  function bindInspectorLink(ref) {
    const el = $('insp');
    el.querySelectorAll('[data-lf]').forEach(inp => {
      inp.onchange = () => {
        const f = inp.dataset.lf;
        if (f === 'road') ref.road = inp.value;
        else if (f === 'phases') ref.phases = inp.value.split(/[;,\s]+/).map(x => Number(x) - 1).filter(x => x >= 0);
        else ref[f] = U.num(inp.value, null);
        invalidate(); renderInspector(); view.redraw();
      };
    });
    el.querySelectorAll('input[data-b]').forEach(inp => {
      inp.onchange = () => {
        const d = ref.data[inp.dataset.b] = ref.data[inp.dataset.b] || {};
        d[inp.dataset.f] = U.num(inp.value, null);
        if (inp.dataset.f === 'q') d.src = d.q === null ? 'missing' : 'measured';
        invalidate(); renderInspector(); view.redraw();
      };
    });
    const del = el.querySelector('[data-act="dellink"]');
    if (del) del.onclick = () => { S.project.links.splice(S.project.links.indexOf(ref), 1); S.sel = null; invalidate(true); renderInspector(); view.redraw(); };
  }

  /* ════════════════ TAB DỮ LIỆU ════════════════ */
  function renderData() {
    const p = S.project, st = M.stats(p), P = p.params;
    const nb = p.bands.length;
    const pct = (x) => st.links ? (x / (st.links * nb) * 100).toFixed(0) + '%' : '—';
    $('pane-data').innerHTML = `
      <h3>Tổng quan mạng lưới</h3>
      <div class="tiles"><div class="tile"><small>Nút giao</small><b>${st.nodes}</b><small>${st.signalized} có đèn</small></div>
      <div class="tile"><small>Nhánh tiếp cận</small><b>${st.links}</b><small>liên kết có hướng</small></div>
      <div class="tile"><small>Số liệu đo</small><b>${pct(st.measured)}</b><small>bù ${pct(st.imputed)} · thiếu ${pct(st.missing)}</small></div></div>
      <h3>Bảng dữ liệu</h3>
      <div class="row"><button class="btn" id="dNodes">Bảng nút & giản đồ pha</button><button class="btn" id="dLinks">Bảng nhánh & lưu lượng</button></div>
      <div class="row"><button class="btn" id="dValidate">Kiểm tra dữ liệu</button><button class="btn" id="dImpute" title="Bù lưu lượng/vận tốc thiếu bằng trung bình cùng tuyến → trung vị toàn mạng">Bù dữ liệu thiếu</button></div>
      <div class="row"><button class="btn" id="dITE" title="Tính lại thời gian vàng & đỏ toàn phần cho mọi nút theo ITE">Vàng/đỏ ITE toàn mạng</button><button class="btn" id="dPhase" title="Gán pha phục vụ theo hướng tiếp cận (Bắc–Nam pha 1, Đông–Tây pha 2)">Gán pha theo hướng</button></div>
      <h3>Hiệu chỉnh hàng loạt (khung giờ hiện tại)</h3>
      <div class="row"><label class="field" style="flex:1">Nhân lưu lượng q ×<input type="number" id="kQ" value="1.1" step="0.05"></label><button class="btn" id="dMulQ" style="align-self:flex-end">Áp dụng</button></div>
      <div class="row"><label class="field" style="flex:1">Nhân suất dòng bão hoà S ×<input type="number" id="kS" value="1.1" step="0.05"></label><button class="btn" id="dMulS" style="align-self:flex-end">Áp dụng</button></div>
      <p class="note">Dùng để hiệu chỉnh mô hình theo quan sát hiện trường (khoảng xả hàng chờ đo từ camera) hoặc thử kịch bản tăng trưởng nhu cầu.</p>
      <h3>Tham số kỹ thuật</h3>
      <div class="grid2">
        ${pf('satPerLane', 'S cơ sở (pcu/h/làn)')}${pf('jamSpacing', 'Cự ly kẹt (m/pcu/làn)')}
        ${pf('minGreen', 'Xanh tối thiểu (s)')}${pf('maxGreen', 'Xanh tối đa (s)')}
        ${pf('yellow', 'Vàng mặc định (s)')}${pf('allRed', 'Đỏ toàn phần (s)')}
        ${pf('lostStart', 'Mất mát khởi động l₁ (s)')}${pf('greenExt', 'Tận dụng vàng e (s)')}
        ${pf('alpha', 'Phân tán Robertson α')}${pf('beta', 'Phân tán Robertson β')}
        ${pf('spillThreshold', 'Ngưỡng tràn ngược')}${pf('vDefault', 'v mặc định (km/h)')}
        ${pf('exchangeRate', 'Tỷ lệ xe ra/vào hẻm, công trình')}${pf('fifo', 'Mức FIFO nhánh ≥ 2 làn (0–1)')}
      </div>
      <label class="field" style="margin-top:6px">Nền bản đồ (URL ô XYZ)<select id="tileSel">
        <option value="https://tile.openstreetmap.org/{z}/{x}/{y}.png">OpenStreetMap (mặc định)</option>
        <option value="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png">CARTO Voyager (dự phòng khi OSM bị chặn)</option>
        <option value="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png">CARTO Positron (nhạt)</option>
        <option value="custom">Máy chủ GIS nội bộ (tự nhập)…</option></select></label>
      <h3>Khung giờ</h3>
      <div id="bandList">${p.bands.map((b, i) => `<div class="row"><input class="inp mono" value="${esc(b.id)}" style="width:70px" disabled><input class="inp" data-bl="${i}" value="${esc(b.label)}" style="flex:1"></div>`).join('')}</div>
      <div class="row"><button class="btn sm" id="bandAdd">+ Khung giờ (sao chép khung hiện tại)</button></div>`;
    $('dNodes').onclick = nodesTable; $('dLinks').onclick = linksTable;
    $('dValidate').onclick = validateDlg;
    $('dImpute').onclick = () => { const r = M.imputeMissing(p); invalidate(); renderData(); view.redraw(); toast(`Đã bù ${r.nq} giá trị lưu lượng, ${r.nv} giá trị vận tốc`); };
    $('dITE').onclick = () => { for (const b of p.bands) { const net = M.buildNet(p, b.id); for (let n = 0; n < net.N; n++) if (net.nodes[n].signalized) SG.applyITE(net, n, net.nodes[n].plans[b.id]); } invalidate(); toast('Đã tính vàng/đỏ toàn phần ITE cho hiện trạng mọi khung giờ'); renderInspector(); };
    $('dPhase').onclick = () => { if (!confirm('Gán lại pha phục vụ cho mọi nhánh theo hướng tiếp cận?')) return; M.autoAssignPhases(p); invalidate(); view.redraw(); toast('Đã gán pha theo hướng'); };
    $('dMulQ').onclick = () => { const k = U.num($('kQ').value, 1); for (const l of p.links) { const d = l.data[S.band]; if (d && d.q !== null) d.q = Math.round(d.q * k); } invalidate(); view.redraw(); renderInspector(); toast(`q × ${k} (${bandLabel(S.band)})`); };
    $('dMulS').onclick = () => { const k = U.num($('kS').value, 1); const net = getNet(); for (const l of net.links) l.ref.S = Math.round(l.S * k); invalidate(); view.redraw(); renderInspector(); toast(`S × ${k} cho mọi nhánh`); };
    $('pane-data').querySelectorAll('[data-pf]').forEach(inp => inp.onchange = () => { P[inp.dataset.pf] = U.num(inp.value, P[inp.dataset.pf]); invalidate(); view.redraw(); });
    const ts = $('tileSel');
    ts.value = [...ts.options].some(o => o.value === P.tileUrl) ? P.tileUrl : 'custom';
    ts.onchange = () => {
      let url = ts.value;
      if (url === 'custom') { url = prompt('URL mẫu ô bản đồ, ví dụ https://gis.local/tiles/{z}/{x}/{y}.png', P.tileUrl); if (!url) return; }
      P.tileUrl = url; setTiles(url); autosave();
    };
    $('pane-data').querySelectorAll('[data-bl]').forEach(inp => inp.onchange = () => { p.bands[+inp.dataset.bl].label = inp.value; fillBands(); autosave(); });
    $('bandAdd').onclick = () => {
      const id = prompt('Mã khung giờ mới (không dấu, ví dụ: sat_am):'); if (!id) return;
      const key = U.normKey(id); if (p.bands.find(b => b.id === key)) { toast('Mã đã tồn tại', true); return; }
      const label = prompt('Tên hiển thị:', id) || id;
      p.bands.push({ id: key, label });
      for (const n of p.nodes) n.plans[key] = U.deepClone(n.plans[S.band]);
      for (const l of p.links) l.data[key] = U.deepClone(l.data[S.band] || {});
      fillBands(); renderData(); autosave();
    };
  }
  const pf = (k, label) => `<label class="field">${label}<input type="number" step="any" data-pf="${k}" value="${S.project.params[k]}"></label>`;

  function nodesTable() {
    const p = S.project, b = S.band;
    const maxPh = Math.max(2, ...p.nodes.map(n => (n.plans[b] || { phases: [] }).phases.length));
    let h = `<p class="note">Khung giờ: <b>${esc(bandLabel(b))}</b> · giản đồ HIỆN TRẠNG. Sửa trực tiếp trong ô; chu kỳ tự tính = Σ(xanh + vàng + đỏ). Lọc: <input class="inp" id="fltN" placeholder="mã / tên"></p>
      <div class="tw" style="max-height:60vh"><table class="dtable"><thead><tr><th>Mã</th><th>Tên</th><th>Lat</th><th>Lon</th><th>Đèn</th><th>C</th><th>Offset</th>`;
    for (let k = 1; k <= maxPh; k++) h += `<th>Xanh ${k}</th><th>Vàng ${k}</th><th>Đỏ ${k}</th>`;
    h += '</tr></thead><tbody>';
    p.nodes.forEach((n, i) => {
      const pl = n.plans[b];
      h += `<tr data-row="${i}" data-key="${esc((n.id + ' ' + n.name).toLowerCase())}"><td class="mono">${esc(n.id)}</td><td><input class="w" data-i="${i}" data-f="name" value="${esc(n.name)}"></td><td><input data-i="${i}" data-f="lat" value="${n.lat}"></td><td><input data-i="${i}" data-f="lon" value="${n.lon}"></td><td>${n.signalized ? '●' : '○'}</td><td class="mono" data-c="${i}">${pl ? M.cycleOf(pl) : ''}</td><td><input data-i="${i}" data-f="offset" value="${pl ? pl.offset : ''}"></td>`;
      for (let k = 0; k < maxPh; k++) { const ph = pl && pl.phases[k]; for (const f of ['g', 'y', 'ar']) h += `<td><input style="width:44px" data-i="${i}" data-k="${k}" data-f="${f}" value="${ph ? ph[f] : ''}"></td>`; }
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    modal('Bảng nút giao & giản đồ pha', h, [{ label: 'Xuất CSV', onClick: () => { U.download('nut_giao.csv', IO.nodesCSV(p)); U.download('gian_do_pha.csv', IO.plansCSV(p, ['hien_trang', 'toi_uu'])); return false; } }, { label: 'Đóng', cls: 'primary' }]);
    const body = $('modalBody');
    body.querySelectorAll('input[data-i]').forEach(inp => inp.onchange = () => {
      const n = p.nodes[+inp.dataset.i], f = inp.dataset.f;
      if (f === 'name') n.name = inp.value;
      else if (f === 'lat' || f === 'lon') { n[f] = U.num(inp.value, n[f]); S.geo = null; }
      else {
        const pl = n.plans[b];
        if (f === 'offset') pl.offset = U.num(inp.value, 0);
        else { const k = +inp.dataset.k; if (!pl.phases[k]) { if (inp.value === '') return; while (pl.phases.length <= k) pl.phases.push({ g: p.params.minGreen, y: p.params.yellow, ar: p.params.allRed }); } pl.phases[k][f] = U.num(inp.value, 0); }
        body.querySelector(`[data-c="${inp.dataset.i}"]`).textContent = M.cycleOf(pl);
      }
      invalidate(f === 'lat' || f === 'lon'); view.redraw();
    });
    $('fltN').oninput = (e) => { const q = e.target.value.toLowerCase(); body.querySelectorAll('tr[data-row]').forEach(tr => { tr.hidden = q && !tr.dataset.key.includes(q); }); };
  }

  function linksTable() {
    const p = S.project;
    let h = `<p class="note">q (pcu/h) & v (km/h) theo khung giờ; ô nghiêng = giá trị bù/ước lượng. Lọc: <input class="inp" id="fltL" placeholder="tên đường / mã nút"></p>
      <div class="tw" style="max-height:60vh"><table class="dtable"><thead><tr><th>Từ</th><th>Đến</th><th>Tên đường</th><th>L (m)</th><th>Làn</th><th>S</th><th>Pha</th>`;
    for (const b of p.bands) h += `<th>q ${esc(b.id)}</th><th>v ${esc(b.id)}</th>`;
    h += '</tr></thead><tbody>';
    p.links.forEach((l, i) => {
      h += `<tr data-row="${i}" data-key="${esc((l.u + ' ' + l.v + ' ' + (l.road || '')).toLowerCase())}"><td class="mono">${esc(l.u)}</td><td class="mono">${esc(l.v)}</td><td><input class="w" data-i="${i}" data-f="road" value="${esc(l.road || '')}"></td><td><input data-i="${i}" data-f="L" value="${l.L ? U.round(l.L, 1) : ''}"></td><td><input style="width:36px" data-i="${i}" data-f="lanes" value="${l.lanes}"></td><td><input data-i="${i}" data-f="S" value="${l.S || ''}"></td><td><input style="width:44px" data-i="${i}" data-f="phases" value="${l.phases.map(k => k + 1).join(';')}"></td>`;
      for (const b of p.bands) { const d = l.data[b.id] || {}; h += `<td class="${d.src === 'imputed' ? 'imp' : ''}"><input data-i="${i}" data-b="${b.id}" data-f="q" value="${d.q ?? ''}"></td><td><input style="width:44px" data-i="${i}" data-b="${b.id}" data-f="v" value="${d.v ?? ''}"></td>`; }
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    modal('Bảng nhánh tiếp cận & lưu lượng', h, [{ label: 'Xuất CSV', onClick: () => { U.download('nhanh_luu_luong.csv', IO.linksCSV(p)); return false; } }, { label: 'Đóng', cls: 'primary' }]);
    const body = $('modalBody');
    body.querySelectorAll('input[data-i]').forEach(inp => inp.onchange = () => {
      const l = p.links[+inp.dataset.i], f = inp.dataset.f;
      if (inp.dataset.b) { const d = l.data[inp.dataset.b] = l.data[inp.dataset.b] || {}; d[f] = U.num(inp.value, null); if (f === 'q') { d.src = d.q === null ? 'missing' : 'measured'; inp.parentElement.className = ''; } }
      else if (f === 'road') l.road = inp.value;
      else if (f === 'phases') l.phases = inp.value.split(/[;,\s]+/).map(x => Number(x) - 1).filter(x => x >= 0);
      else l[f] = U.num(inp.value, null);
      invalidate(); view.redraw();
    });
    $('fltL').oninput = (e) => { const q = e.target.value.toLowerCase(); body.querySelectorAll('tr[data-row]').forEach(tr => { tr.hidden = q && !tr.dataset.key.includes(q); }); };
  }

  function validateDlg() {
    const is = M.validate(S.project);
    const cnt = (l) => is.filter(x => x.lvl === l).length;
    const infoN = cnt('info');
    const rows = is.filter(x => x.lvl !== 'info').slice(0, 400).map(x => `<tr><td>${x.lvl === 'err' ? '<span class="badge bad">Lỗi</span>' : '<span class="badge">Cảnh báo</span>'}</td><td class="mono">${esc(x.obj)}</td><td>${esc(x.msg)}</td></tr>`).join('');
    modal('Kiểm tra dữ liệu', `<p>${cnt('err')} lỗi · ${cnt('warn')} cảnh báo · ${infoN} ô lưu lượng thiếu${infoN ? ' (dùng "Bù dữ liệu thiếu")' : ''}.</p>` + (rows ? `<div class="tw" style="max-height:60vh"><table class="dtable"><tbody>${rows}</tbody></table></div>` : '<p class="good">Không phát hiện lỗi.</p>'));
  }

  /* ════════════════ TAB TỐI ƯU ════════════════ */
  const optOpts = Object.assign({}, OPT.DEFAULTS);
  function renderOpt() {
    const p = S.project, P = p.params, r = result();
    let h = `<h3>Thiết lập</h3>
      <div class="grid2">${pf('Cmin', 'Chu kỳ tối thiểu (s)')}${pf('Cmax', 'Chu kỳ tối đa (s)')}
      ${pf('stopK', 'Phạt dừng K (s/lần)')}${pf('maxZoneSize', 'Số nút tối đa/vùng')}
      ${pf('zoneResolution', 'Độ phân giải vùng γ')}${pf('gwMinFlow', 'q tối thiểu sóng xanh')}
      ${pf('gwsTwoWay', 'Ngưỡng GWS 2 chiều')}${pf('gwsOneWay', 'Ngưỡng GWS 1 chiều')}</div>
      <label class="chk"><input type="checkbox" id="oHalf" ${optOpts.halfCycle ? 'checked' : ''}> Cho phép nút nhỏ chạy ½ chu kỳ vùng</label>
      <label class="chk"><input type="checkbox" id="oSplit" ${optOpts.splitTuning ? 'checked' : ''}> Tinh chỉnh split trong TRANSYT</label>
      <label class="chk"><input type="checkbox" id="oCTM" ${optOpts.verifyCTM ? 'checked' : ''}> Kiểm chứng thích ứng bằng mô phỏng CTM</label>
      <label class="chk"><input type="checkbox" id="oSpeed" ${optOpts.speedFactors.length > 1 ? 'checked' : ''}> Đề xuất vận tốc sóng xanh (±10%)</label>
      <p class="note">${p.corridors.length} hành lang do người dùng khai báo được ưu tiên${p.corridors.length ? ` <button class="btn sm ghost" id="oClrCorr">xoá</button>` : ''}.</p>
      <div class="row"><button class="btn accent" id="oRun" ${S.optRunning ? 'disabled' : ''}>Tối ưu khung giờ này</button><button class="btn" id="oRunAll" ${S.optRunning ? 'disabled' : ''}>Tối ưu mọi khung giờ</button></div>
      <div id="oProg" ${S.optRunning ? '' : 'hidden'}><div class="progress"><i id="oBar"></i></div><div class="note" id="oMsg"></div></div>`;
    if (r) {
      const d = (a, b, inv) => { if (!isFinite(a) || !isFinite(b) || a === 0) return ''; const x = (b - a) / a; const good = inv ? x > 0 : x < 0; return `<span class="${good ? 'good' : x === 0 ? '' : 'bad'}">${U.pct(x, 0)}</span>`; };
      h += `<h3>Kết quả · ${esc(bandLabel(r.band))} <span class="note">(${(r.ms / 1000).toFixed(1)} s)</span></h3>
        <table class="cmp"><thead><tr><th>Chỉ tiêu (TRANSYT)</th><th>Hiện trạng</th><th>Đề xuất</th><th>Δ</th></tr></thead><tbody>
        <tr><td>Trễ TB (s/pcu)</td><td>${r.base.delay.toFixed(1)}</td><td>${r.opt.delay.toFixed(1)}</td><td>${d(r.base.delay, r.opt.delay)}</td></tr>
        <tr><td>Số lần dừng TB</td><td>${r.base.stops.toFixed(2)}</td><td>${r.opt.stops.toFixed(2)}</td><td>${d(r.base.stops, r.opt.stops)}</td></tr>
        <tr><td>Chỉ số PI</td><td>${U.fmt(r.base.PI)}</td><td>${U.fmt(r.opt.PI)}</td><td>${d(r.base.PI, r.opt.PI)}</td></tr>
        <tr><td>x lớn nhất</td><td>${r.base.xmax.toFixed(2)}</td><td>${r.opt.xmax.toFixed(2)}</td><td>${d(r.base.xmax, r.opt.xmax)}</td></tr>
        <tr><td>Nhánh nguy cơ tràn</td><td>${r.base.spill}</td><td>${r.opt.spill}</td><td></td></tr>
        <tr><td>Trễ HCM (s/pcu)</td><td>${r.hcmBase.toFixed(1)}</td><td>${r.hcmOpt.toFixed(1)}</td><td>${d(r.hcmBase, r.hcmOpt)}</td></tr>
        </tbody></table>
        <div class="row"><button class="btn sm" id="oApply">Áp dụng đề xuất → hiện trạng</button><button class="btn sm ghost" id="oClear">Xoá đề xuất</button></div>
        <h3>Vùng điều khiển (${r.zones.length})</h3>
        <div class="tw"><table class="cmp"><thead><tr><th>Vùng</th><th>Nút</th><th>C</th><th>Phương án</th><th>Δ trễ</th></tr></thead><tbody>
        ${r.zones.map(z => `<tr class="click ${S.sel && S.sel.type === 'zone' && S.sel.z === z.id ? 'sel' : ''}" data-z="${z.id}"><td><span class="swatch" style="background:${zoneColors() ? ZPAL()[zoneColors().col.get(z.id) || 0] : 'transparent'}"></span>V${String(z.id + 1).padStart(2, '0')}</td><td>${z.ids.length}</td><td>${z.C}${z.nHalf ? '·½' : ''}</td><td style="text-align:left">${esc(OPT.STRATEGY_LABEL[z.strategy] || '')}</td><td>${z.base ? d(z.base.delay, z.opt.delay) : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <h3>Hành lang sóng xanh (${r.corridors.length})</h3>
        <div class="tw"><table class="cmp"><thead><tr><th>Tuyến</th><th>Nút</th><th>GWS</th><th>Loại</th><th>Dải đi/về</th></tr></thead><tbody>
        ${r.corridors.map((c, i) => `<tr class="click" data-c="${i}"><td>${esc(c.road || '(không tên)')}</td><td>${c.ids.length}</td><td>${c.gws.gws.toFixed(0)}</td><td>${c.gws.cls === 'two' ? '<span class="badge ok">2 chiều</span>' : c.gws.cls === 'one' ? '<span class="badge">1 chiều</span>' : '<span class="badge bad">không</span>'}</td><td>${c.after.bOut.toFixed(0)}/${c.after.bIn.toFixed(0)}s</td></tr>`).join('')}
        </tbody></table></div>
        <h3>Khuyến nghị vận hành</h3>
        ${r.recs.map(x => `<div class="rec ${x.kind === 'corridor' ? x.strategy : (x.strategy || '').includes('adaptive') ? 'adapt' : ''}" ${x.kind === 'zone' ? `data-rz="${x.zone}"` : `data-rc="${esc(x.road)}|${x.zone}"`}><div class="t">${x.kind === 'zone' ? 'Vùng V' + String(x.zone + 1).padStart(2, '0') : 'Hành lang'} ${x.kind === 'zone' ? `<span class="badge">${esc(OPT.STRATEGY_LABEL[x.strategy] || '')}</span>` : ''}</div>${esc(x.text)}</div>`).join('')}
        ${r.ctm ? `<h3>Kiểm chứng CTM (toàn mạng)</h3><table class="cmp"><thead><tr><th></th><th>Cố định đề xuất</th><th>+ Thích ứng</th></tr></thead><tbody>
          <tr><td>Tổng trễ (xe·h)</td><td>${r.ctm.fixed.delayVehH.toFixed(0)}</td><td>${r.ctm.adaptive ? r.ctm.adaptive.delayVehH.toFixed(0) : '—'}</td></tr>
          <tr><td>Vận tốc TB (km/h)</td><td>${r.ctm.fixed.avgSpeed.toFixed(1)}</td><td>${r.ctm.adaptive ? r.ctm.adaptive.avgSpeed.toFixed(1) : '—'}</td></tr>
          <tr><td>Tràn ngược (nhánh·phút)</td><td>${r.ctm.fixed.spillLinkMin.toFixed(0)}</td><td>${r.ctm.adaptive ? r.ctm.adaptive.spillLinkMin.toFixed(0) : '—'}</td></tr></tbody></table>` : ''}`;
    } else h += `<p class="note" style="margin-top:14px">Chưa có kết quả cho khung giờ này. Bộ tối ưu gồm: Webster → nhận diện hành lang → phân vùng Louvain → quét chu kỳ vùng (TRANSYT PI) → MAXBAND sóng xanh → leo đồi offset/split → kiểm chứng CTM → khuyến nghị.</p>`;
    $('pane-opt').innerHTML = h;
    const q = (id) => $(id);
    $('pane-opt').querySelectorAll('[data-pf]').forEach(inp => inp.onchange = () => { P[inp.dataset.pf] = U.num(inp.value, P[inp.dataset.pf]); autosave(); });
    q('oHalf').onchange = (e) => { optOpts.halfCycle = e.target.checked; };
    q('oSplit').onchange = (e) => { optOpts.splitTuning = e.target.checked; };
    q('oCTM').onchange = (e) => { optOpts.verifyCTM = e.target.checked; };
    q('oSpeed').onchange = (e) => { optOpts.speedFactors = e.target.checked ? [0.9, 0.95, 1, 1.05, 1.1] : [1]; };
    if (q('oClrCorr')) q('oClrCorr').onclick = () => { p.corridors = []; autosave(); renderOpt(); };
    q('oRun').onclick = () => runOptimize([S.band]);
    q('oRunAll').onclick = () => runOptimize(p.bands.map(b => b.id));
    if (r) {
      q('oApply').onclick = () => {
        if (!confirm('Chép toàn bộ giản đồ đề xuất của khung giờ này sang hiện trạng? (Nên xuất phiếu cài đặt tủ trước.)')) return;
        for (const n of p.nodes) if (n.opt[S.band]) { n.plans[S.band] = U.deepClone(n.opt[S.band]); delete n.plans[S.band].half; }
        invalidate(); view.redraw(); toast('Đã áp dụng đề xuất làm hiện trạng');
      };
      q('oClear').onclick = () => { for (const n of p.nodes) delete n.opt[S.band]; delete p.results[S.band]; S.zoneColor = null; invalidate(); renderOpt(); view.redraw(); };
      $('pane-opt').querySelectorAll('tr[data-z],[data-rz]').forEach(tr => tr.onclick = () => { S.sel = { type: 'zone', z: +(tr.dataset.z ?? tr.dataset.rz) }; S.colorBy = 'zone'; $('colorBy').value = 'zone'; legend(); select(S.sel); renderOpt(); focusZone(S.sel.z); });
      $('pane-opt').querySelectorAll('tr[data-c]').forEach(tr => tr.onclick = () => openResultCorridor(+tr.dataset.c));
      $('pane-opt').querySelectorAll('[data-rc]').forEach(dv => dv.onclick = () => { const [road, zone] = dv.dataset.rc.split('|'); const i = r.corridors.findIndex(c => (c.road || '') === road && c.zone === +zone); if (i >= 0) openResultCorridor(i); });
    }
  }

  function focusZone(zid) {
    const r = result(); const z = r && r.zones.find(x => x.id === zid);
    if (!z) return;
    view.fit(z.ids.map(id => nodeById(id)).filter(Boolean).map(n => [n.lon, n.lat]), 80);
  }

  async function runOptimize(bands) {
    if (S.optRunning) return;
    stopSim();
    S.optRunning = true; renderOpt();
    const bar = () => $('oBar'), msg = () => $('oMsg');
    try {
      for (let bi = 0; bi < bands.length; bi++) {
        const b = bands[bi];
        await OPT.run(S.project, b, optOpts, (m, f) => {
          if (bar()) bar().style.width = ((bi + f) / bands.length * 100).toFixed(0) + '%';
          if (msg()) msg().textContent = `[${bandLabel(b)}] ${m}`;
        });
      }
      S.optRunning = false; S.zoneColor = null;
      S.scenario = 'opt'; setScenarioButtons();
      invalidate(); renderOpt(); renderSim(); renderRep(); renderInspector(); legend(); view.redraw(); drawDock();
      toast('Tối ưu hoàn tất. Đang hiển thị phương án Đề xuất.');
    } catch (e) {
      S.optRunning = false; renderOpt();
      console.error(e); toast('Lỗi tối ưu: ' + e.message, true);
    }
  }

  /* ════════════════ TSD ════════════════ */
  function openResultCorridor(i) {
    const r = result(); const c = r.corridors[i];
    const seq = c.ids.map(id => getNet().nodeIdx.get(id));
    if (S.scenario !== 'opt') { S.scenario = 'opt'; setScenarioButtons(); S.ana = null; }
    openTSD(seq, c.road || 'Hành lang', c);
    view.fit(c.ids.map(id => nodeById(id)).map(n => [n.lon, n.lat]), 120);
  }
  function openTSD(seq, name, info) {
    if (seq.some(x => x === undefined)) { toast('Chuỗi có nút không tồn tại', true); return; }
    const net = getNet();
    const corr = MB.buildCorridor(net, seq);
    if (!corr) { toast('Các nút liên tiếp trong chuỗi phải có nhánh nối trực tiếp', true); return; }
    S.tsd = { seq, corr, name, info };
    if (S.sim) attachRecorder();
    setDock('tsd');
    view.redraw();
  }
  function tsdPlan(n) {
    const node = getNet().nodes[n];
    if (S.scenario === 'opt' && !node.opt[S.band]) node.opt[S.band] = U.deepClone(node.plans[S.band]);
    return M.getPlan(node, S.band, S.scenario);
  }
  function refreshTSD() { if (S.dock === 'tsd') drawDock(); }

  function drawTSD() {
    const cv = $('dockCanvas'), empty = $('dockEmpty'), lg = $('dockLegend');
    if (!S.tsd) { empty.hidden = false; empty.innerHTML = 'Chọn một hành lang ở tab Tối ưu, hoặc <kbd>Ctrl</kbd>+nhấp các nút liên tiếp trên bản đồ rồi bấm "Vẽ TSD".'; cv.hidden = true; lg.innerHTML = ''; return; }
    empty.hidden = true; cv.hidden = false;
    const net = getNet();
    const corr = MB.buildCorridor(net, S.tsd.seq);
    if (!corr) return;
    S.tsd.corr = corr;
    const plans = corr.seq.map(tsdPlan);
    const Cs = [...new Set(plans.map(p => M.cycleOf(p)))];
    const C = Math.max(...Cs);
    const coherent = Cs.every(c => C % c === 0);
    const live = S.sim && S.rec && S.rec.count > 2;
    let bands = null, ev = null;
    if (coherent && !live) { ev = MB.evaluate(net, corr, tsdPlan, C); bands = ev; }
    CH().tsd(cv, {
      net, corr, planFn: tsdPlan, C, bands, tOut: ev && ev.tOut, tIn: ev && ev.tIn,
      rec: live ? S.rec : null, sim: S.sim, dt: S.sim ? S.sim.cfg.dt : 1,
      onDragOffset: S.sim ? null : (k, off, done) => {
        tsdPlan(corr.seq[k]).offset = off;
        if (done) { invalidate(); renderInspector(); }
        drawTSD();
      },
    });
    lg.innerHTML = `<span><b>${esc(S.tsd.name)}</b> · ${S.scenario === 'opt' ? 'đề xuất' : 'hiện trạng'} · C ${coherent ? C + ' s' : 'không đồng nhất: ' + Cs.join('/')}</span>` +
      (live ? '<span>nền = mật độ CTM, thanh = đèn thực tế (chiều đi)</span>' : bands ? `<span style="color:var(--s1)">▮ dải đi ${bands.bOut.toFixed(0)} s</span><span style="color:var(--s7)">▮ dải về ${bands.bIn.toFixed(0)} s</span><span>kéo thanh đèn để đổi offset</span>` : '');
  }
  const CH = () => TS.charts;

  /* ════════════════ DOCK ════════════════ */
  function setDock(which) {
    S.dock = which;
    document.querySelectorAll('.dock .tabs [data-dock]').forEach(b => b.setAttribute('aria-selected', b.dataset.dock === which ? 'true' : 'false'));
    if (S.dockMin) { S.dockMin = false; $('dock').classList.remove('min'); setTimeout(() => view.resize(), 0); }
    drawDock();
  }
  let seriesState = null;
  function drawDock() {
    if (S.dockMin) return;
    const cv = $('dockCanvas'), empty = $('dockEmpty'), lg = $('dockLegend');
    cv.onmousemove = cv.onmouseleave = null;
    if (S.dock === 'tsd') return drawTSD();
    cv.onpointerdown = cv.onpointermove = cv.onpointerup = null;
    if (S.dock === 'curve') {
      const r = result();
      const zid = S.sel && S.sel.type === 'zone' ? S.sel.z : null;
      const z = r && zid !== null ? r.zones.find(x => x.id === zid) : null;
      if (!z || !z.curve) { empty.hidden = false; empty.textContent = 'Chọn một vùng (bảng Vùng ở tab Tối ưu) để xem đường cong chỉ số PI theo chu kỳ.'; cv.hidden = true; lg.innerHTML = ''; return; }
      empty.hidden = true; cv.hidden = false;
      const series = [{ label: 'Trễ TB vùng (s/pcu)', color: css('--s1'), points: z.curve.map(c => [c.C, c.delay]) }];
      const geo = CH().line(cv, { series, xLabel: 'Chu kỳ C (s)', yLabel: 'Trễ TB (s/pcu) — mô hình TRANSYT', marker: { x: z.C, label: `chọn C = ${z.C}s` }, xFmt: v => Math.round(v), yFmt: v => (+v).toFixed(1) });
      lg.innerHTML = `<span>Vùng V${String(z.id + 1).padStart(2, '0')} · ${z.ids.length} nút · C chọn theo PI nhỏ nhất (trễ + K·dừng, phạt C > 90 s)</span>`;
      seriesState = { geo, series, xFmt: v => Math.round(v) + ' s', yFmt: v => (+v).toFixed(1) };
      CH().attachHover(cv, $('tip2'), () => seriesState);
      return;
    }
    // diễn biến mô phỏng
    const sets = [];
    if (S.ab) { sets.push({ label: S.ab.aLabel, color: css('--s2'), s: S.ab.a.series }, { label: S.ab.bLabel, color: css('--s1'), s: S.ab.b.series }); }
    else if (S.sim && S.sim.series.length) sets.push({ label: 'Mô phỏng hiện tại', color: css('--s1'), s: S.sim.series });
    if (!sets.length) { empty.hidden = false; empty.textContent = 'Chạy mô phỏng hoặc đối sánh A/B ở tab Mô phỏng để xem diễn biến.'; cv.hidden = true; lg.innerHTML = ''; return; }
    empty.hidden = true; cv.hidden = false;
    const MET = { bal: ['Cân bằng xe vào / ra mạng (pcu/h)', null, v => U.fmt(v)], veh: ['Xe trong mạng + chờ vào (pcu)', x => x.veh + x.buf, v => U.fmt(v)], speed: ['Vận tốc TB (km/h)', x => x.speed, v => (+v).toFixed(1)], thr: ['Thông lượng ra (pcu/h)', x => x.thr, v => U.fmt(v)], spill: ['Nhánh đang tràn ngược', x => x.spill, v => U.fmt(v)] };
    const m = MET[S.seriesMetric];
    const series = S.seriesMetric === 'bal'
      ? sets.flatMap(st => [{ label: st.label + ' · vào', color: st.color, points: st.s.map(x => [x.t / 60, x.inr || 0]) }, { label: st.label + ' · ra', color: st.color, dash: [6, 4], points: st.s.map(x => [x.t / 60, x.thr]) }])
      : sets.map(st => ({ label: st.label, color: st.color, points: st.s.map(x => [x.t / 60, m[1](x)]) }));
    const geo = CH().line(cv, { series, xLabel: 'Thời gian mô phỏng (phút)', yLabel: '', xFmt: v => Math.round(v), yFmt: m[2], y0: 0 });
    lg.innerHTML = `<span style="pointer-events:auto"><select class="sel" id="serMetric">${Object.entries(MET).map(([k, v]) => `<option value="${k}" ${k === S.seriesMetric ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></span>` + sets.map(st => `<span><span class="swatch" style="background:${st.color}"></span>${esc(st.label)}</span>`).join('') + (S.seriesMetric === 'bal' ? '<span>nét liền = vào (phát sinh), nét đứt = ra (kết thúc chuyến + ra biên)</span>' : '');
    lg.style.pointerEvents = 'auto';
    $('serMetric').onchange = (e) => { S.seriesMetric = e.target.value; drawDock(); };
    seriesState = { geo, series, xFmt: v => (+v).toFixed(0) + ' phút', yFmt: m[2] };
    CH().attachHover(cv, $('tip2'), () => seriesState);
  }

  /* ════════════════ MÔ PHỎNG ════════════════ */
  const SCN = {
    base: 'Hiện trạng (theo chế độ từng tủ)',
    opt: 'Đề xuất – cố định',
    'opt-rec': 'Đề xuất + thích ứng theo khuyến nghị',
    'opt-mp': 'Đề xuất – Max Pressure chu kỳ cố định toàn mạng',
    mp: 'Max Pressure không chu kỳ toàn mạng',
    act: 'Xe kích hoạt toàn mạng',
  };
  const SCN_DESC = {
    base: ['Giản đồ HIỆN TRẠNG (thẻ phải → "Giản đồ pha hiện trạng")', 'Mỗi tủ chạy theo chế độ khai báo ở ô "Điều khiển" của nút (mặc định: cố định)'],
    opt: ['Giản đồ ĐỀ XUẤT do bộ tối ưu tính (C vùng, split, offset sóng xanh)', 'Mọi tủ chạy cố định theo giản đồ'],
    'opt-rec': ['Giản đồ ĐỀ XUẤT', 'Cố định, riêng các vùng được khuyến nghị "thích ứng" chạy Max Pressure (vùng phối hợp: giữ C và offset, split đổi theo áp lực; nút độc lập: đổi pha tự do)'],
    'opt-mp': ['Giản đồ ĐỀ XUẤT (lấy C, offset, thứ tự pha)', 'Mọi tủ: Max Pressure chu kỳ cố định — split mỗi chu kỳ theo áp lực hàng chờ, ±4 s/chu kỳ'],
    mp: ['Giản đồ ĐỀ XUẤT nếu có, không thì HIỆN TRẠNG (chỉ lấy vàng, đỏ toàn phần, xanh min/max)', 'Mọi tủ: Max Pressure không chu kỳ — mỗi 3 s chọn pha có áp lực lớn nhất'],
    act: ['Giản đồ ĐỀ XUẤT nếu có, không thì HIỆN TRẠNG (lấy vàng, đỏ, xanh min/max)', 'Mọi tủ: xe kích hoạt — kéo dài xanh khi còn hàng chờ, tối đa xanh max'],
  };
  function scnInfo(key) {
    const d = SCN_DESC[key];
    let modes = '';
    try {
      const cfg = simConfigFor(key);
      const cnt = {};
      getNet().nodes.forEach((nd, i) => { if (!nd.signalized) return; const m = (cfg.modes && cfg.modes[i]) || cfg.mode || nd.control || 'fixed'; cnt[m] = (cnt[m] || 0) + 1; });
      modes = Object.entries(cnt).map(([m, c]) => `${c} tủ ${SIM.MODES[m]}`).join(' · ');
    } catch (e) { modes = '<span class="bad">' + esc(e.message) + '</span>'; }
    return `<div class="rec" style="cursor:default"><div class="t">Dữ liệu kịch bản sử dụng</div>
      <b>Nhu cầu:</b> lưu lượng q & vận tốc v từng nhánh của khung giờ <b>${esc(bandLabel(S.band))}</b> (thẻ Dữ liệu), tỷ lệ rẽ ước lượng Furness, × hệ số nhu cầu.<br>
      <b>Đèn:</b> ${esc(d[0])}.<br><b>Điều khiển:</b> ${esc(d[1])}.<br><span class="note">${modes}</span></div>`;
  }
  const simCfg = { dt: 2, warmup: 600, duration: 1800, demandMul: 1, noiseCV: 0, profile: 'flat' };

  function simConfigFor(key) {
    const net = getNet();
    const hasOpt = S.project.nodes.some(n => n.opt[S.band]);
    const base = Object.assign({}, simCfg);
    if (key === 'base') return Object.assign(base, { scenario: 'base' });
    if (!hasOpt && key !== 'mp' && key !== 'act') throw new Error('Chưa có giản đồ đề xuất — chạy Tối ưu trước');
    if (key === 'opt') return Object.assign(base, { scenario: 'opt', mode: 'fixed' });
    if (key === 'opt-mp') return Object.assign(base, { scenario: 'opt', mode: 'cmp' });
    if (key === 'mp') return Object.assign(base, { scenario: hasOpt ? 'opt' : 'base', mode: 'mp' });
    if (key === 'act') return Object.assign(base, { scenario: hasOpt ? 'opt' : 'base', mode: 'actuated' });
    const r = result(), modes = {};
    if (r) for (const z of r.zones) {
      const md = z.strategy === 'coord-adaptive' ? 'cmp' : z.strategy === 'isolated-adaptive' ? 'mp' : null;
      if (md) for (const id of z.ids) { const n = net.nodeIdx.get(id); if (n !== undefined) modes[n] = md; }
    }
    return Object.assign(base, { scenario: 'opt', mode: 'fixed', modes });
  }

  function renderSim() {
    const k = S.simScenario;
    $('pane-sim').innerHTML = `
      <h3>Kịch bản mô phỏng</h3>
      <select class="sel" id="sScn" style="width:100%">${Object.entries(SCN).map(([key, v]) => `<option value="${key}" ${key === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div id="sInfo">${scnInfo(k)}</div>
      <div class="grid2" style="margin-top:6px">
        <label class="field">Bước thời gian Δt (s)<select id="sDt"><option value="1" ${simCfg.dt === 1 ? 'selected' : ''}>1 (chi tiết)</option><option value="2" ${simCfg.dt === 2 ? 'selected' : ''}>2 (nhanh)</option></select></label>
        <label class="field">Khởi động (phút)<input type="number" id="sWarm" value="${simCfg.warmup / 60}"></label>
        <label class="field">Thời lượng đo (phút)<input type="number" id="sDur" value="${simCfg.duration / 60}"></label>
        <label class="field">Hệ số nhu cầu ×<input type="number" step="0.05" id="sMul" value="${simCfg.demandMul}"></label>
        <label class="field" style="grid-column:1/3">Hồ sơ nhu cầu theo thời gian<select id="sProf"><option value="flat" ${simCfg.profile === 'flat' ? 'selected' : ''}>Cố định = lưu lượng khung giờ (giờ cao điểm kéo dài)</option><option value="peak" ${simCfg.profile === 'peak' ? 'selected' : ''}>Dạng đỉnh: 70% → 100% → 70% (tăng – đỉnh – giảm)</option></select></label>
        <label class="field">Dao động nhu cầu CV<input type="number" step="0.05" id="sCV" value="${simCfg.noiseCV}" title="Nhiễu ngẫu nhiên lưu lượng vào mạng mỗi 5 phút (0 = ổn định)"></label>
        <label class="field">Tốc độ phát<select id="sSpd">${[1, 5, 10, 20, 40, 80].map(x => `<option value="${x}" ${x === S.simSpeed ? 'selected' : ''}>×${x}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="btn accent" id="sPlay">${S.playing ? '❚❚ Tạm dừng' : '▶ Chạy hoạt ảnh'}</button><button class="btn" id="sReset">⟲ Đặt lại</button><button class="btn" id="sStop" ${S.sim ? '' : 'disabled'}>■ Thoát mô phỏng</button></div>
      <div id="simKpi"></div>
      <h3>Đối sánh A/B (chạy nhanh, không hoạt ảnh)</h3>
      <div class="grid2"><label class="field">Phương án A<select id="abA">${Object.entries(SCN).map(([key, v]) => `<option value="${key}" ${key === 'base' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">Phương án B<select id="abB">${Object.entries(SCN).map(([key, v]) => `<option value="${key}" ${key === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="row"><button class="btn primary" id="abRun">Chạy đối sánh A/B</button></div>
      <div id="abProg" hidden><div class="progress"><i id="abBar"></i></div></div>
      <div id="abOut">${S.ab ? abTable(S.ab) : ''}</div>
      <p class="note">Mô hình CTM (Daganzo): hàng chờ có chiều dài vật lý, sóng dừng/xả lan truyền, nhánh đầy chặn nút thượng lưu (tràn ngược, khoá nút). Max Pressure: Varaiya (2013); chu kỳ cố định giữ offset phối hợp, split thay đổi ±4 s/chu kỳ.</p>`;
    $('sScn').onchange = (e) => { S.simScenario = e.target.value; $('sInfo').innerHTML = scnInfo(S.simScenario); if (S.sim) { stopSim(); startSim(); } };
    $('sDt').onchange = (e) => { simCfg.dt = +e.target.value; };
    $('sWarm').onchange = (e) => { simCfg.warmup = U.num(e.target.value, 10) * 60; };
    $('sDur').onchange = (e) => { simCfg.duration = U.num(e.target.value, 30) * 60; };
    $('sMul').onchange = (e) => { simCfg.demandMul = U.num(e.target.value, 1); };
    $('sProf').onchange = (e) => { simCfg.profile = e.target.value; };
    $('sCV').onchange = (e) => { simCfg.noiseCV = U.num(e.target.value, 0); };
    $('sSpd').onchange = (e) => { S.simSpeed = +e.target.value; };
    $('sPlay').onclick = () => { if (!S.sim) startSim(); else { S.playing = !S.playing; if (S.playing) loop(); renderSimButtons(); } };
    $('sReset').onclick = () => { stopSim(); startSim(); };
    $('sStop').onclick = () => { stopSim(); };
    $('abRun').onclick = () => runAB($('abA').value, $('abB').value);
    updateSimKpi();
  }
  function renderSimButtons() {
    if ($('sPlay')) $('sPlay').textContent = S.playing ? '❚❚ Tạm dừng' : '▶ Chạy hoạt ảnh';
    if ($('sStop')) $('sStop').disabled = !S.sim;
  }

  function startSim() {
    let cfg;
    try { cfg = simConfigFor(S.simScenario); } catch (e) { toast(e.message, true); return; }
    const net = getNet();
    cfg.total = cfg.warmup + cfg.duration; // cho hồ sơ nhu cầu dạng đỉnh
    cfg.warmup = 0; // hoạt ảnh: đo ngay từ đầu, mạng bắt đầu trống (khoảng 15–20 phút đầu là giai đoạn "lấp đầy")
    S.sim = SIM.create(net, cfg);
    S.ab = null;
    attachRecorder();
    S.playing = true;
    $('hud').hidden = false;
    legend(); renderSimButtons(); loop();
  }
  function attachRecorder() {
    if (!S.sim) return;
    S.sim.stopRecording(); S.rec = null;
    if (S.tsd && S.tsd.corr) {
      const C = Math.max(...S.tsd.corr.seq.map(n => M.cycleOf(tsdPlan(n))));
      S.rec = S.sim.record(S.tsd.corr.out, Math.max(240, 3 * C));
    }
  }
  function stopSim() {
    S.playing = false; S.sim = null; S.rec = null;
    if (!S.project) return;
    $('hud').hidden = true;
    legend(); renderSimButtons(); updateSimKpi(); view.redraw(); drawDock();
  }
  let lastFrame = 0, lastDockDraw = 0;
  function loop(ts) {
    if (!S.playing || !S.sim) return;
    const now = ts || performance.now();
    const dtReal = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    const target = S.sim.t + S.simSpeed * dtReal;
    const t0 = performance.now();
    while (S.sim.t < target && performance.now() - t0 < 28) S.sim.step();
    view.redraw();
    if (now - lastDockDraw > 400) { lastDockDraw = now; updateSimKpi(); if (S.sel && S.sel.type === 'zone') renderInspector(); if (S.dock !== 'curve') drawDock(); }
    requestAnimationFrame(loop);
  }
  function balTag(x) {
    if (!x.inr) return '';
    const d = (x.inr - x.thr) / x.inr;
    return Math.abs(d) < 0.05 ? '<span class="badge ok">cân bằng</span>' : d > 0 ? `<span class="badge bad">tích luỹ ${(d * 100).toFixed(0)}%</span>` : '<span class="badge info">đang thoát</span>';
  }
  function updateSimKpi() {
    const hud = $('hud'), box = $('simKpi');
    renderNetKpi();
    if (!S.sim) { if (box) box.innerHTML = ''; return; }
    const s = S.sim, last = s.series[s.series.length - 1] || { veh: 0, speed: 0, thr: 0, spill: 0, buf: 0 };
    const t = s.t, hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = Math.floor(t % 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    let spill = 0; for (let i = 0; i < s.spillNow.length; i++) spill += s.spillNow[i];
    hud.innerHTML = `<div style="color:var(--muted);font-size:11px">${esc(SCN[S.simScenario])}</div><b>${clock}</b> <span class="note">×${S.simSpeed}</span><br>${U.fmt(last.veh)} pcu trong mạng${last.buf > 1 ? ' + ' + U.fmt(last.buf) + ' chờ vào' : ''} · ${last.speed.toFixed(1)} km/h<br>vào ${U.fmt(last.inr || 0)} · ra ${U.fmt(last.thr)} pcu/h ${balTag(last)}<br>${spill} nhánh tràn ngược`;
    if (box) box.innerHTML = `<div class="tiles" style="margin-top:8px"><div class="tile"><small>Thời gian</small><b class="mono" style="font-size:15px">${clock}</b></div><div class="tile"><small>Vận tốc TB</small><b>${last.speed.toFixed(1)}</b><small>km/h (phút gần nhất)</small></div><div class="tile"><small>Tràn ngược</small><b>${spill}</b><small>nhánh</small></div></div>`;
  }

  async function runSimBatch(key, prog) {
    const cfg = simConfigFor(key);
    const sim = SIM.create(getNet(), cfg);
    const end = cfg.warmup + cfg.duration;
    while (sim.t < end) {
      const stop = Math.min(end, sim.t + 240);
      sim.run(stop);
      prog(sim.t / end);
      await U.sleep(0);
    }
    return { res: sim.results(), series: sim.series };
  }
  async function runAB(a, b) {
    stopSim();
    const pr = $('abProg'), bar = $('abBar');
    pr.hidden = false;
    try {
      const A = await runSimBatch(a, f => { bar.style.width = (f * 50).toFixed(0) + '%'; });
      const B = await runSimBatch(b, f => { bar.style.width = (50 + f * 50).toFixed(0) + '%'; });
      S.ab = { a: A, b: B, aLabel: SCN[a], bLabel: SCN[b] };
      $('abOut').innerHTML = abTable(S.ab);
      setDock('series');
    } catch (e) { toast(e.message, true); }
    pr.hidden = true;
  }
  function abTable(ab) {
    const A = ab.a.res, B = ab.b.res;
    const row = (label, a, b, dec, better) => {
      const x = a ? (b - a) / a : 0;
      const good = better === 'lo' ? x < 0 : x > 0;
      return `<tr><td>${label}</td><td>${(+a).toFixed(dec)}</td><td>${(+b).toFixed(dec)}</td><td class="${Math.abs(x) < 0.005 ? '' : good ? 'good' : 'bad'}">${U.pct(x, 0)}</td></tr>`;
    };
    return `<table class="cmp"><thead><tr><th>Chỉ tiêu (CTM)</th><th>A</th><th>B</th><th>Δ</th></tr></thead><tbody>
      ${row('Tổng trễ (xe·h)', A.delayVehH, B.delayVehH, 0, 'lo')}
      ${row('Trễ / km (s/pcu·km)', A.delayPerVehKm, B.delayPerVehKm, 1, 'lo')}
      ${row('Vận tốc TB (km/h)', A.avgSpeed, B.avgSpeed, 1, 'hi')}
      ${row('Tỷ lệ dừng (%)', A.stopRatio * 100, B.stopRatio * 100, 0, 'lo')}
      ${row('Dừng / km', A.stopsPerVehKm, B.stopsPerVehKm, 2, 'lo')}
      ${row('Thông lượng ra (pcu/h)', A.throughput, B.throughput, 0, 'hi')}
      ${row('Tràn ngược (nhánh·phút)', A.spillLinkMin, B.spillLinkMin, 0, 'lo')}
      ${row('Chờ vào mạng (xe·h)', A.bufWaitH, B.bufWaitH, 1, 'lo')}
      ${row('Xe vào mạng (pcu)', A.entries, B.entries, 0, 'hi')}
      ${row('Xe ra mạng (pcu)', A.exits, B.exits, 0, 'hi')}
      ${row('Tích luỹ trong mạng (pcu)', A.accum, B.accum, 0, 'lo')}
      </tbody></table><p class="note">A: ${esc(ab.aLabel)} · B: ${esc(ab.bLabel)}. Đo ${(A.span / 60).toFixed(0)} phút sau khởi động.</p>`;
  }

  /* ════════════════ BÁO CÁO ════════════════ */
  function renderRep() {
    const p = S.project;
    const done = p.bands.filter(b => p.results && p.results[b.id]);
    $('pane-rep').innerHTML = `<h3>Tình trạng</h3>
      <p>${done.length}/${p.bands.length} khung giờ đã có phương án tối ưu${done.length ? ': ' + done.map(b => esc(b.label)).join('; ') : ''}.</p>
      <h3>Xuất kết quả</h3>
      <div class="row"><button class="btn primary" id="rSheet">Phiếu cài đặt tủ (CSV)</button></div>
      <div class="row"><button class="btn" id="rHtml">Báo cáo phương án (HTML)</button></div>
      <div class="row"><button class="btn" id="rJson">Lưu dự án kèm kết quả (.json)</button></div>
      <p class="note">Phiếu cài đặt tủ gồm chu kỳ, offset, thời lượng xanh từng pha hiện trạng → đề xuất theo từng khung giờ, vùng và phương án vận hành — dùng để lập lệnh nạp tủ hoặc trình duyệt phương án. Trước khi nạp hiện trường cần kiểm tra an toàn: xanh tối thiểu bộ hành, khoảng chuyển tiếp, xung đột pha theo thiết kế tổ chức giao thông của nút.</p>`;
    $('rSheet').onclick = () => exportAct('sheet');
    $('rHtml').onclick = () => exportAct('report');
    $('rJson').onclick = saveProject;
  }

  function reportHTML() {
    const p = S.project;
    const e = esc;
    let h = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo phương án tín hiệu</title><style>
      body{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:13px;color:#14181b;max-width:1100px;margin:24px auto;padding:0 20px;line-height:1.5}
      h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px} h3{font-size:14px;margin:16px 0 6px}
      table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0 12px} th,td{border:1px solid #d5d8d3;padding:3px 6px;text-align:right} th{background:#eef0ec} td:first-child,th:first-child{text-align:left}
      .l{text-align:left} .muted{color:#6d757b} ul{margin:4px 0}</style></head><body>
      <h1>BÁO CÁO PHƯƠNG ÁN ĐIỀU KHIỂN TÍN HIỆU GIAO THÔNG</h1><div class="muted">Dự án: ${e(p.name)} · ${p.nodes.length} nút · ${p.links.length} nhánh tiếp cận · lập ngày ${new Date().toLocaleDateString('vi-VN')}</div>
      <h2>1. Phương pháp</h2><ul>
      <li>Tối ưu nút: chu kỳ Webster, phân bổ xanh cân bằng độ bão hoà; khoảng chuyển tiếp vàng/đỏ toàn phần theo ITE.</li>
      <li>Phân vùng điều khiển: thuật toán Louvain trên đồ thị ghép nối (lưu lượng hai chiều / khoảng cách, tương đồng chu kỳ tự nhiên).</li>
      <li>Chu kỳ vùng: quét C, chọn theo chỉ số hiệu suất PI = Σ q·(d + K·h) của mô hình biểu đồ dòng chu kỳ (TRANSYT, phân tán Robertson).</li>
      <li>Sóng xanh: chấm điểm khả thi GWS; offset tối đa hoá dải thông hành hai chiều (mục tiêu MAXBAND); vận tốc khuyến nghị.</li>
      <li>Offset vùng: leo đồi kiểu TRANSYT, nhóm sóng xanh dịch cùng nhau; tinh chỉnh split ±2 s.</li>
      <li>Kiểm chứng: mô phỏng truyền ô (CTM) có hàng chờ vật lý và tràn ngược; so sánh điều khiển cố định với thích ứng Max Pressure.</li></ul>`;
    for (const b of p.bands) {
      const r = p.results && p.results[b.id];
      if (!r) continue;
      h += `<h2>2. Kết quả khung giờ: ${e(b.label)}</h2>
        <table><tr><th>Chỉ tiêu</th><th>Hiện trạng</th><th>Đề xuất</th><th>Thay đổi</th></tr>
        <tr><td>Độ trễ trung bình (s/pcu)</td><td>${r.base.delay.toFixed(1)}</td><td>${r.opt.delay.toFixed(1)}</td><td>${U.pct((r.opt.delay - r.base.delay) / r.base.delay)}</td></tr>
        <tr><td>Số lần dừng trung bình</td><td>${r.base.stops.toFixed(2)}</td><td>${r.opt.stops.toFixed(2)}</td><td>${U.pct((r.opt.stops - r.base.stops) / r.base.stops)}</td></tr>
        <tr><td>Độ bão hoà lớn nhất</td><td>${r.base.xmax.toFixed(2)}</td><td>${r.opt.xmax.toFixed(2)}</td><td></td></tr></table>
        ${r.ctm ? `<p>Kiểm chứng CTM (${(r.ctm.fixed.span / 60).toFixed(0)} phút): tổng trễ phương án cố định ${r.ctm.fixed.delayVehH.toFixed(0)} xe·h, vận tốc TB ${r.ctm.fixed.avgSpeed.toFixed(1)} km/h${r.ctm.adaptive ? `; khi áp dụng thích ứng tại vùng khuyến nghị: ${r.ctm.adaptive.delayVehH.toFixed(0)} xe·h, ${r.ctm.adaptive.avgSpeed.toFixed(1)} km/h` : ''}.</p>` : ''}
        <h3>Vùng điều khiển</h3><table><tr><th>Vùng</th><th>Số nút</th><th>C (s)</th><th>Nút ½C</th><th class="l">Phương án</th><th>Trễ HT</th><th>Trễ ĐX</th></tr>
        ${r.zones.map(z => `<tr><td>V${String(z.id + 1).padStart(2, '0')}</td><td>${z.ids.length}</td><td>${z.C}</td><td>${z.nHalf || 0}</td><td class="l">${e(OPT.STRATEGY_LABEL[z.strategy] || '')}</td><td>${z.base ? z.base.delay.toFixed(1) : ''}</td><td>${z.opt ? z.opt.delay.toFixed(1) : ''}</td></tr>`).join('')}</table>
        <h3>Hành lang sóng xanh</h3><table><tr><th>Tuyến</th><th>Số nút</th><th>Dài (m)</th><th>GWS</th><th class="l">Loại</th><th>Dải đi (s)</th><th>Dải về (s)</th><th>v khuyến nghị</th></tr>
        ${r.corridors.map(c => `<tr><td>${e(c.road || '(không tên)')}</td><td>${c.ids.length}</td><td>${Math.round(c.len)}</td><td>${c.gws.gws.toFixed(0)}</td><td class="l">${c.gws.cls === 'two' ? '2 chiều' : c.gws.cls === 'one' ? '1 chiều' : 'không khả thi'}</td><td>${c.after.bOut.toFixed(0)}</td><td>${c.after.bIn.toFixed(0)}</td><td>${c.vAdvice || ''}</td></tr>`).join('')}</table>
        <h3>Khuyến nghị vận hành</h3><ul>${r.recs.map(x => `<li>${x.kind === 'zone' ? '<b>Vùng V' + String(x.zone + 1).padStart(2, '0') + ':</b> ' : ''}${e(x.text)}</li>`).join('')}</ul>
        <h3>Giản đồ pha đề xuất</h3><table><tr><th>Mã nút</th><th class="l">Tên nút</th><th>C HT</th><th>C ĐX</th><th>Offset</th><th class="l">Xanh các pha HT → ĐX (s)</th></tr>
        ${p.nodes.filter(n => n.opt[b.id]).map(n => { const a = n.plans[b.id], o = n.opt[b.id]; return `<tr><td>${e(n.id)}</td><td class="l">${e(n.name)}</td><td>${M.cycleOf(a)}</td><td>${M.cycleOf(o)}${o.half ? ' (½)' : ''}</td><td>${o.offset}</td><td class="l">${a.phases.map(x => x.g).join('/')} → ${o.phases.map(x => x.g).join('/')}</td></tr>`; }).join('')}</table>`;
    }
    h += `<p class="muted">Kết quả là đề xuất kỹ thuật dựa trên mô hình; cần khảo sát hiệu chỉnh và kiểm tra an toàn trước khi nạp xuống tủ điều khiển.</p></body></html>`;
    return h;
  }

  /* ════════════════ NHẬP / XUẤT ════════════════ */
  function pickFile(accept) {
    return new Promise((res) => {
      const inp = $('fileInput');
      inp.accept = accept || '';
      inp.value = '';
      inp.multiple = true;
      inp.onchange = () => res([...inp.files]);
      inp.click();
    });
  }
  async function openProject() {
    const files = await pickFile('.json,.html,.htm');
    if (!files.length) return;
    try {
      const text = await U.readFile(files[0]);
      const p = /\.html?$/i.test(files[0].name) ? IO.fromGreenZone(IO.extractGreenZoneData(text)) : IO.fromJSON(text);
      loadProject(p, true);
      toast(`Đã mở: ${p.nodes.length} nút, ${p.links.length} nhánh`);
    } catch (e) { toast('Không đọc được file: ' + e.message, true); }
  }
  async function importCSV() {
    const files = await pickFile('.csv,.txt');
    if (!files.length) return;
    const msgs = [];
    // thứ tự: nút → pha → nhánh → hướng
    const items = [];
    for (const f of files) { const t = await U.readFile(f); items.push({ f, t, kind: IO.detectCSV(t) }); }
    const order = { nodes: 0, plans: 1, links: 2, approach: 3 };
    items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    for (const it of items) {
      try {
        if (it.kind === 'nodes') { const r = IO.importNodesCSV(S.project, it.t); msgs.push(`${it.f.name}: +${r.add} nút, cập nhật ${r.upd}`); }
        else if (it.kind === 'plans') { const r = IO.importPlansCSV(S.project, it.t); msgs.push(`${it.f.name}: ${r.ok} giản đồ pha${r.miss ? `, ${r.miss} dòng không khớp mã nút` : ''}${r.warn.length ? `, ${r.warn.length} cảnh báo chu kỳ` : ''}`); }
        else if (it.kind === 'links') { const r = IO.importLinksCSV(S.project, it.t); msgs.push(`${it.f.name}: +${r.add} nhánh, cập nhật ${r.upd}${r.miss ? `, ${r.miss} dòng thiếu nút` : ''}`); }
        else if (it.kind === 'approach') { const r = IO.importApproachCSV(S.project, it.t); msgs.push(`${it.f.name}: ${r.ok} hướng tiếp cận${r.warn.length ? `, ${r.warn.length} cảnh báo` : ''}`); }
        else msgs.push(`${it.f.name}: không nhận dạng được loại CSV (xem mẫu)`);
      } catch (e) { msgs.push(`${it.f.name}: lỗi ${e.message}`); }
    }
    invalidate(true); fillBands(); renderAll();
    if (S.project.nodes.length) fitAll();
    modal('Kết quả nhập CSV', '<ul>' + msgs.map(m => `<li>${esc(m)}</li>`).join('') + '</ul>');
  }
  function saveProject() {
    const name = (S.project.name || 'du_an').replace(/[^\p{L}\p{N}_-]+/gu, '_');
    U.download(name + '.json', IO.toJSON(S.project, true), 'application/json');
  }
  function exportAct(act) {
    const p = S.project;
    if (act === 'sheet') U.download('phieu_cai_dat_tu.csv', IO.timingSheetCSV(p, p.results));
    if (act === 'report') { const h = reportHTML(); U.download('bao_cao_phuong_an.html', h, 'text/html;charset=utf-8'); const w = window.open(); if (w) { w.document.write(h); w.document.close(); } }
    if (act === 'x-nodes') U.download('nut_giao.csv', IO.nodesCSV(p));
    if (act === 'x-plans') U.download('gian_do_pha.csv', IO.plansCSV(p, ['hien_trang', 'toi_uu']));
    if (act === 'x-links') U.download('nhanh_luu_luong.csv', IO.linksCSV(p));
    if (act === 'tpl-nodes') U.download('mau_nut_giao.csv', U.toCSV(['ma_nut', 'ten_nut', 'lat', 'lon', 'be_rong_m', 'co_den', 'dieu_khien', 'su_dung_dat'], [['2013-1', 'Võ Thị Sáu × Nam Kỳ Khởi Nghĩa', 10.78502, 106.68912, 22, 1, 'fixed', 'van_phong']]));
    if (act === 'tpl-plans') U.download('mau_gian_do_pha.csv', U.toCSV(['ma_nut', 'khung_gio', 'phuong_an', 'chu_ky', 'offset', 'xanh_1', 'vang_1', 'do_1', 'xanh_2', 'vang_2', 'do_2', 'xanh_3', 'vang_3', 'do_3'], p.bands.map(b => ['2013-1', b.id, 'hien_trang', 80, 0, 35, 3, 2, 35, 3, 2, '', '', ''])));
    if (act === 'tpl-links') U.download('mau_nhanh_luu_luong.csv', U.toCSV(['tu_nut', 'den_nut', 'ten_duong', 'chieu_dai_m', 'so_lan', 's_pcu_h', 'pha', ...p.bands.flatMap(b => ['q_' + b.id, 'v_' + b.id])], [['3012-1', '2013-1', 'Nam Kỳ Khởi Nghĩa', 520, 3, '', 1, ...p.bands.flatMap(() => [1500, 28])]]));
    if (act === 'tpl-appr') U.download('mau_huong_tiep_can.csv', IO.approachCSVTemplate(p));
  }
  function bindMenu(btnId, handler) {
    const btn = $(btnId), list = btn.nextElementSibling;
    list.dataset.for = btnId;
    document.body.appendChild(list); // đưa menu ra ngoài thanh trên để không bị khung nào che/cắt
    btn.onclick = (e) => { e.stopPropagation(); document.querySelectorAll('.menu-list').forEach(m => { if (m !== list) m.hidden = true; }); list.hidden = !list.hidden;
      if (!list.hidden) { const r = btn.getBoundingClientRect(); list.style.top = (r.bottom + 4) + 'px'; list.style.right = Math.max(8, window.innerWidth - r.right) + 'px'; list.style.left = 'auto'; } };
    list.querySelectorAll('button').forEach(b => b.onclick = () => { list.hidden = true; handler(b.dataset.act); });
  }
  document.addEventListener('click', () => document.querySelectorAll('.menu-list').forEach(m => { m.hidden = true; }));
  bindMenu('mNew', (act) => {
    if (S.project && S.project.nodes.length && !confirm('Thay dự án hiện tại? (Hãy Lưu trước nếu cần.)')) return;
    if (act === 'demo500') loadProject(TS.demo.generate(), true);
    if (act === 'demo150') loadProject(TS.demo.generate({ rows: 10, cols: 15, seed: 7 }), true);
    if (act === 'blank') { loadProject(M.newProject('Dự án mới'), false); view.cx = U.project(106.7, 10.776)[0]; view.cy = U.project(106.7, 10.776)[1]; view.z = 14; view.redraw(); setTool('addN'); toast('Chọn "+ Nút" và nhấp lên bản đồ để thêm nút giao'); }
  });
  bindMenu('mImport', (act) => {
    if (act === 'csv') importCSV();
    else if (act === 'gz') openProject();
    else if (act === 'osmpoly') setTool('poly');
    else if (act === 'osmfile') (async () => {
      const files = await pickFile('.osm,.xml,.json');
      if (!files.length) return;
      try { const data = TS.osm.parseFile(await U.readFile(files[0])); osmDialog(data); }
      catch (e) { toast('Không đọc được file OSM: ' + e.message, true); }
    })();
    else exportAct(act);
  });
  bindMenu('mExport', exportAct);
  $('bOpen').onclick = openProject;
  $('bSave').onclick = saveProject;

  /* ════════════════ KHUNG ỨNG DỤNG ════════════════ */
  function fillBands() {
    const sel = $('band');
    sel.innerHTML = S.project.bands.map(b => `<option value="${esc(b.id)}">${esc(b.label)}</option>`).join('');
    if (!S.project.bands.find(b => b.id === S.band)) S.band = S.project.bands[0].id;
    sel.value = S.band;
  }
  $('band').onchange = (e) => { S.band = e.target.value; S.zoneColor = null; stopSim(); S.ab = null; invalidate(); renderAll(); };
  function setScenarioButtons() { $('scBase').setAttribute('aria-pressed', S.scenario === 'base'); $('scOpt').setAttribute('aria-pressed', S.scenario === 'opt'); }
  $('scBase').onclick = () => { S.scenario = 'base'; setScenarioButtons(); S.ana = null; legend(); renderInspector(); view.redraw(); refreshTSD(); };
  $('scOpt').onclick = () => { S.scenario = 'opt'; setScenarioButtons(); S.ana = null; legend(); renderInspector(); view.redraw(); refreshTSD(); };
  $('pname').onchange = (e) => { S.project.name = e.target.value; autosave(); };
  $('colorBy').onchange = (e) => { S.colorBy = e.target.value; legend(); view.redraw(); };
  $('basemap').onchange = (e) => { view.tiles = e.target.checked; view.redraw(); };
  $('fit').onclick = () => fitAll();
  $('search').onchange = (e) => {
    const q = e.target.value.trim().toLowerCase(); if (!q) return;
    const n = S.project.nodes.findIndex(x => x.id.toLowerCase() === q) >= 0 ? S.project.nodes.findIndex(x => x.id.toLowerCase() === q) : S.project.nodes.findIndex(x => (x.id + ' ' + x.name).toLowerCase().includes(q));
    if (n >= 0) { const node = S.project.nodes[n]; const m = U.project(node.lon, node.lat); view.cx = m[0]; view.cy = m[1]; view.z = Math.max(view.z, 16); select({ type: 'node', n }); return; }
    const net = getNet(); const i = net.links.findIndex(l => (l.road || '').toLowerCase().includes(q));
    if (i >= 0) { const g = getGeo().links[i].pts[0]; view.cx = g[0]; view.cy = g[1]; view.z = Math.max(view.z, 15.5); select({ type: 'link', i }); return; }
    toast('Không tìm thấy');
  };
  function setTool(t) {
    S.tool = t; S.pendingLinkFrom = null;
    const map = { sel: 'tSel', addN: 'tAddN', addL: 'tAddL', move: 'tMove', sig: 'tSig', poly: 'tPoly' };
    for (const [k, id] of Object.entries(map)) $(id).setAttribute('aria-pressed', k === t);
    $('mapwrap').classList.toggle('edit-add', t === 'addN' || t === 'addL' || t === 'poly' || t === 'sig');
    updatePolyInfo();
    if (t === 'poly') toast('Nhấp các đỉnh của vùng cần lấy dữ liệu OSM, sau đó bấm "Tải mạng OSM…"');
    if (t === 'sig') toast('Nhấp vào nút giao để gắn / gỡ đèn. Nhánh vào được tô màu theo pha phục vụ.');
    view.redraw();
  }
  $('tSel').onclick = () => setTool('sel'); $('tAddN').onclick = () => setTool('addN'); $('tAddL').onclick = () => setTool('addL'); $('tMove').onclick = () => setTool('move');
  $('tSig').onclick = () => setTool('sig'); $('tPoly').onclick = () => setTool('poly');
  document.querySelectorAll('.left .tabs [data-tab]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.left .tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
    for (const k of ['data', 'opt', 'sim', 'rep']) $('pane-' + k).hidden = k !== b.dataset.tab;
  });
  document.querySelectorAll('.dock .tabs [data-dock]').forEach(b => b.onclick = () => setDock(b.dataset.dock));
  $('dockMin').onclick = () => { S.dockMin = !S.dockMin; $('dock').classList.toggle('min', S.dockMin); $('dockMin').textContent = S.dockMin ? '▴' : '▾'; setTimeout(() => { view.resize(); drawDock(); }, 0); };
  window.addEventListener('resize', () => drawDock());
  // chú thích nổi cho dock
  const tip2 = document.createElement('div'); tip2.className = 'tip'; tip2.id = 'tip2'; tip2.hidden = true; $('dockBody').appendChild(tip2);

  // giao diện sáng/tối
  const THEMES = ['auto', 'light', 'dark'];
  let theme = 'auto';
  try { theme = localStorage.getItem('tso.theme') || 'auto'; } catch { /* bỏ qua */ }
  function applyTheme() {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
    $('theme').textContent = theme === 'auto' ? '◐ Hệ thống' : theme === 'light' ? '☀ Sáng' : '☾ Tối';
    view.redraw(); drawDock();
  }
  $('theme').onclick = () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; try { localStorage.setItem('tso.theme', theme); } catch { /* bỏ qua */ } applyTheme(); };

  function fitAll() { view.fit(S.project.nodes.map(n => [n.lon, n.lat]), 40); }
  function setTiles(url) {
    view.tileUrl = url; view.redraw();
    $('attrib').textContent = /openstreetmap/.test(url) ? '© OpenStreetMap contributors' : /carto/.test(url) ? '© OpenStreetMap contributors © CARTO' : 'Nền bản đồ nội bộ';
  }
  function renderAll() {
    $('pname').value = S.project.name;
    renderData(); renderOpt(); renderSim(); renderRep(); renderInspector(); legend(); drawDock(); view.redraw();
  }
  function loadProject(p, fit) {
    stopSim();
    S.project = M.normalizeProject(p);
    S.band = S.project.bands[0].id;
    S.sel = null; S.tsd = null; S.chain = []; S.ab = null; S.zoneColor = null;
    S.scenario = S.project.nodes.some(n => n.opt && n.opt[S.band]) && S.project.results && S.project.results[S.band] ? 'opt' : 'base';
    setScenarioButtons();
    // dự án lưu từ bản trước (mặc định CARTO Voyager) → trở lại nền OSM mặc định
    if (/rastertiles\/voyager/.test(S.project.params.tileUrl)) S.project.params.tileUrl = M.DEFAULT_PARAMS.tileUrl;
    if (/tile\.openstreetmap\.org/.test(S.project.params.tileUrl) && window.location.protocol === 'file:' && !S.osmWarned) {
      S.osmWarned = true;
      setTimeout(() => toast('Nền OSM có thể hiện "403 Access blocked" khi mở trực tiếp index.html. Hãy chạy chay_ung_dung.bat (http://localhost:8080) hoặc chọn nền CARTO ở thẻ Dữ liệu.'), 1500);
    }
    setTiles(S.project.params.tileUrl);
    invalidate(true); fillBands(); updateChainInfo(); setTool('sel');
    if (fit) fitAll();
    renderAll();
  }

  // khởi động
  view.resize();
  let initial = null;
  try { const t = localStorage.getItem(LS_KEY); if (t) initial = IO.fromJSON(t); } catch { initial = null; }
  loadProject(initial || TS.demo.generate(), true);
  if (!initial) toast('Đang dùng mạng mẫu 500 nút giả lập. Vào Tối ưu → "Tối ưu khung giờ này" để chạy thử.');
  applyTheme();
  TS.app = S; TS.__view = view; // phục vụ gỡ lỗi / kiểm thử
})(window.TS);
