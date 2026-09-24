/* Nhập / xuất dữ liệu: dự án JSON, 4 mẫu CSV (nút, pha đèn, nhánh-lưu lượng, hướng tiếp cận),
 * nhập trực tiếp từ Green Zone Player (index.html / data.json của MVP1) và xuất phiếu cài đặt tủ. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const IO = TS.io = {};
  const MAXPH = 8;

  /* ── JSON dự án ── */
  IO.toJSON = function (project, withResults) {
    const p = Object.assign({}, project);
    if (!withResults) delete p.results;
    return JSON.stringify(p);
  };
  IO.fromJSON = function (text) {
    const p = JSON.parse(text);
    if (p.format === 'tsopt-project') return M.normalizeProject(p);
    if (p.nodes && p.links && (p.meta || p.zones)) return IO.fromGreenZone(p);
    throw new Error('Không nhận dạng được định dạng JSON');
  };

  /* ── Green Zone Player (MVP1) ── */
  IO.extractGreenZoneData = function (text) {
    const i = text.indexOf('const DATA = ');
    if (i < 0) return JSON.parse(text);
    const start = i + 'const DATA = '.length;
    const endMark = text.indexOf(', META = DATA.meta', start);
    const lineEnd = text.indexOf('\n', start);
    let raw = text.slice(start, endMark > 0 ? endMark : lineEnd).trim();
    if (raw.endsWith(';')) raw = raw.slice(0, -1);
    return JSON.parse(raw);
  };

  IO.fromGreenZone = function (D) {
    const meta = D.meta || {};
    const p = M.newProject('Nhập từ Green Zone Player' + (meta.city_label ? ' — ' + meta.city_label : ''));
    const order = ['am', 'mid', 'pm', 'night'];
    const ids = Object.keys(meta.bands || {});
    ids.sort((a, b) => order.findIndex(o => a.startsWith(o)) - order.findIndex(o => b.startsWith(o)));
    if (ids.length) p.bands = ids.map(id => ({ id, label: meta.bands[id] }));
    const pcuPerQ = U.num(meta.pcu_per_q, 0.001);           // q × pcu_per_q = pcu/s
    const Sph = U.num(meta.sat_pcu_s, 1.2) * 3600;           // pcu/h mỗi nhánh
    const v0 = U.num(meta.v_kmh, 30);
    const split = (ig) => { const y = Math.min(3, Math.max(0, ig)); return { y, ar: Math.max(0, ig - y) }; };
    for (const [code, n] of Object.entries(D.nodes || {})) {
      const node = { id: code, name: [n.s1, n.s2].filter(Boolean).join(' × ') || code, lat: n.lat, lon: n.lon, signalized: !n.flash, control: 'fixed', width: 20, plans: {}, opt: {} };
      for (const b of p.bands) {
        const bd = (n.bands || {})[b.id];
        if (!bd) continue;
        const ig = bd.ig || (bd.g || []).map(() => 5);
        const gOld = bd.g_old || bd.g || [];
        node.plans[b.id] = { offset: 0, phases: gOld.map((g, k) => Object.assign({ g }, split(ig[k] ?? 5))) };
        if (bd.g) node.opt[b.id] = { offset: U.num(bd.theta, 0), phases: bd.g.map((g, k) => Object.assign({ g }, split(ig[k] ?? 5))) };
      }
      p.nodes.push(node);
    }
    const addLink = (u, v, road, L, geom, bands) => {
      const l = { u, v, road: road || '', L, geom, lanes: 2, S: Sph, phases: [0], data: {} };
      for (const b of p.bands) {
        const bd = (bands || {})[b.id];
        if (!bd) continue;
        if (bd.pv) l.phases = [bd.pv - 1];
        l.data[b.id] = { q: bd.q === null || bd.q === undefined ? null : Math.round(bd.q * pcuPerQ * 3600), v: v0, src: bd.qm === 'du_same_road' ? 'measured' : 'imputed' };
      }
      p.links.push(l);
    };
    const seen = new Set();
    for (const l of D.links || []) { seen.add(l.u + '>' + l.v); addLink(l.u, l.v, l.road, l.L, l.geom, l.bands); }
    for (const b of D.boundary || []) { if (!seen.has(b[0] + '>' + b[1])) { seen.add(b[0] + '>' + b[1]); addLink(b[0], b[1], '', b[3], b[2], b[4]); } }
    for (const c of Object.values(D.corridors || {})) {
      if (c.codes && c.codes.length >= 2) p.corridors.push({ name: c.name, nodes: c.codes });
      // bổ sung liên kết hành lang còn thiếu (hops)
      for (const h of c.hops || []) {
        if (!seen.has(h.u + '>' + h.v) && D.nodes[h.u] && D.nodes[h.v]) { seen.add(h.u + '>' + h.v); addLink(h.u, h.v, h.road, null, h.geom, null); }
      }
    }
    M.normalizeProject(p);
    M.imputeMissing(p);
    return p;
  };

  /* ── CSV: xuất ── */
  IO.nodesCSV = function (p) {
    return U.toCSV(['ma_nut', 'ten_nut', 'lat', 'lon', 'be_rong_m', 'co_den', 'dieu_khien', 'su_dung_dat'],
      p.nodes.map(n => [n.id, n.name, n.lat, n.lon, n.width, n.signalized ? 1 : 0, n.control, n.landuse || 'thuong']));
  };

  IO.plansCSV = function (p, which) {
    const h = ['ma_nut', 'khung_gio', 'phuong_an', 'chu_ky', 'offset'];
    for (let k = 1; k <= MAXPH; k++) h.push('xanh_' + k, 'vang_' + k, 'do_' + k);
    const rows = [];
    for (const n of p.nodes) for (const b of p.bands) {
      for (const sc of (which || ['hien_trang'])) {
        const pl = sc === 'toi_uu' ? (n.opt && n.opt[b.id]) : n.plans[b.id];
        if (!pl) continue;
        const r = [n.id, b.id, sc, M.cycleOf(pl), pl.offset];
        for (let k = 0; k < MAXPH; k++) { const ph = pl.phases[k]; r.push(ph ? ph.g : '', ph ? ph.y : '', ph ? ph.ar : ''); }
        rows.push(r);
      }
    }
    return U.toCSV(h, rows);
  };

  IO.linksCSV = function (p) {
    const h = ['tu_nut', 'den_nut', 'ten_duong', 'chieu_dai_m', 'so_lan', 's_pcu_h', 'pha'];
    for (const b of p.bands) h.push('q_' + b.id, 'v_' + b.id);
    return U.toCSV(h, p.links.map(l => {
      const r = [l.u, l.v, l.road || '', l.L ? U.round(l.L, 1) : '', l.lanes, l.S || '', l.phases.map(k => k + 1).join(';')];
      for (const b of p.bands) { const d = l.data[b.id] || {}; r.push(d.q ?? '', d.v ?? ''); }
      return r;
    }));
  };

  IO.approachCSVTemplate = function (p) {
    const h = ['ma_nut', 'huong', 'khung_gio', 'q_pcu_h', 'v_kmh', 'so_lan', 'pha', 'xe_may', 'o_to', 'xe_tai', 'xe_buyt'];
    const rows = [];
    const ex = p.nodes[0];
    if (ex) rows.push([ex.id, 'Bắc', p.bands[0].id, 1200, 28, 3, 1, '', '', '', ''], [ex.id, 'Đông', p.bands[0].id, '', 26, 2, 2, 2400, 380, 20, 12]);
    return U.toCSV(h, rows);
  };

  /* Phiếu cài đặt tủ: mỗi nút × khung giờ, hiện trạng vs đề xuất. */
  IO.timingSheetCSV = function (p, res) {
    const h = ['ma_nut', 'ten_nut', 'khung_gio', 'vung', 'chien_luoc', 'C_hien_trang', 'C_de_xuat', 'offset_de_xuat', 'chay_nua_chu_ky'];
    for (let k = 1; k <= 6; k++) h.push('xanh_' + k + '_ht', 'xanh_' + k + '_dx', 'vang_' + k, 'do_' + k);
    const rows = [];
    for (const n of p.nodes) for (const b of p.bands) {
      const pl = n.plans[b.id], po = n.opt && n.opt[b.id];
      if (!pl) continue;
      const r = res && res[b.id];
      let zone = '', strat = '';
      if (r) {
        const idx = r.nodeIds.indexOf(n.id);
        const zi = idx >= 0 ? r.zoneOf[idx] : -1;
        const z = r.zones.find(x => x.id === zi);
        if (z) { zone = 'V' + String(z.id + 1).padStart(2, '0'); strat = (TS.optimizer.STRATEGY_LABEL[z.strategy] || z.strategy || ''); }
      }
      const row = [n.id, n.name, b.id, zone, strat, M.cycleOf(pl), po ? M.cycleOf(po) : '', po ? po.offset : '', po && po.half ? 'có' : ''];
      for (let k = 0; k < 6; k++) {
        const a = pl.phases[k], o = po && po.phases[k];
        row.push(a ? a.g : '', o ? o.g : '', (o || a) ? (o || a).y : '', (o || a) ? (o || a).ar : '');
      }
      rows.push(row);
    }
    return U.toCSV(h, rows);
  };

  /* ── CSV: nhập ── */
  const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return undefined; };

  IO.importNodesCSV = function (p, text) {
    const { rows } = U.parseCSV(text);
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    let add = 0, upd = 0;
    for (const r of rows) {
      const id = pick(r, 'ma_nut', 'id', 'ma', 'code');
      if (!id) continue;
      let n = byId.get(id);
      if (!n) { n = { id, plans: {}, opt: {} }; p.nodes.push(n); byId.set(id, n); add++; } else upd++;
      n.name = pick(r, 'ten_nut', 'ten', 'name') || n.name || id;
      n.lat = U.num(pick(r, 'lat', 'vi_do'), n.lat);
      n.lon = U.num(pick(r, 'lon', 'lng', 'kinh_do'), n.lon);
      n.width = U.num(pick(r, 'be_rong_m', 'be_rong', 'width'), n.width || 20);
      const cd = pick(r, 'co_den', 'signalized');
      if (cd !== undefined) n.signalized = !['0', 'khong', 'false', 'no'].includes(U.normKey(cd));
      const dk = pick(r, 'dieu_khien', 'control');
      if (dk) n.control = ['fixed', 'actuated', 'mp', 'cmp'].includes(dk) ? dk : n.control;
      const lu = U.normKey(pick(r, 'su_dung_dat', 'landuse') || '');
      if (lu && TS.model.LANDUSE[lu]) n.landuse = lu;
    }
    M.normalizeProject(p);
    return { add, upd };
  };

  IO.importPlansCSV = function (p, text) {
    const { rows } = U.parseCSV(text);
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    let ok = 0, miss = 0, warn = [];
    for (const r of rows) {
      const n = byId.get(pick(r, 'ma_nut', 'id'));
      if (!n) { miss++; continue; }
      const bands = (() => { const b = pick(r, 'khung_gio', 'band'); return b ? [b] : p.bands.map(x => x.id); })();
      const phases = [];
      for (let k = 1; k <= MAXPH; k++) {
        const g = U.num(pick(r, 'xanh_' + k, 'g' + k, 'green_' + k), null);
        if (g === null) continue;
        phases.push({ g, y: U.num(pick(r, 'vang_' + k, 'y' + k), p.params.yellow), ar: U.num(pick(r, 'do_' + k, 'do_toan_phan_' + k, 'ar' + k), p.params.allRed) });
      }
      if (!phases.length) continue;
      const plan = { offset: U.num(pick(r, 'offset', 'lech_pha'), 0), phases };
      M.normalizePlan(plan, p.params);
      const C = U.num(pick(r, 'chu_ky', 'c'), null);
      if (C !== null && Math.abs(C - M.cycleOf(plan)) > 0.5) warn.push(`${n.id}: chu kỳ khai báo ${C}s ≠ tổng pha ${M.cycleOf(plan)}s`);
      const sc = U.normKey(pick(r, 'phuong_an') || 'hien_trang');
      for (const b of bands) {
        if (!p.bands.find(x => x.id === b)) p.bands.push({ id: b, label: b });
        if (sc === 'toi_uu' || sc === 'de_xuat') n.opt[b] = U.deepClone(plan); else n.plans[b] = U.deepClone(plan);
      }
      ok++;
    }
    M.normalizeProject(p);
    return { ok, miss, warn };
  };

  function qFromRow(p, r) {
    let q = U.num(pick(r, 'q', 'q_pcu_h', 'luu_luong', 'luu_luong_pcu_h'), null);
    const cls = p.params.pcu;
    const parts = ['xe_may', 'o_to', 'xe_tai', 'xe_buyt'].map(k => [k, U.num(r[k], null)]).filter(x => x[1] !== null);
    if (q === null && parts.length) {
      const dur = U.num(pick(r, 'thoi_gian_dem_phut', 'phut'), 60);
      q = U.sum(parts, ([k, v]) => v * (cls[k] || 1)) * 60 / dur;
    }
    return q;
  }

  IO.importLinksCSV = function (p, text) {
    const { header, rows } = U.parseCSV(text);
    const key = (l) => l.u + '>' + l.v;
    const map = new Map(p.links.map(l => [key(l), l]));
    const nodeIds = new Set(p.nodes.map(n => n.id));
    let add = 0, upd = 0, miss = 0;
    const longFmt = header.includes('khung_gio');
    for (const r of rows) {
      const u = pick(r, 'tu_nut', 'from', 'u'), v = pick(r, 'den_nut', 'to', 'v');
      if (!u || !v) continue;
      if (!nodeIds.has(u) || !nodeIds.has(v)) { miss++; continue; }
      let l = map.get(u + '>' + v);
      if (!l) { l = { u, v, data: {}, phases: [0], lanes: 2 }; p.links.push(l); map.set(u + '>' + v, l); add++; } else upd++;
      l.road = pick(r, 'ten_duong', 'road') ?? l.road;
      l.L = U.num(pick(r, 'chieu_dai_m', 'l', 'length'), l.L);
      l.lanes = U.num(pick(r, 'so_lan', 'lanes'), l.lanes);
      l.S = U.num(pick(r, 's_pcu_h', 's', 'suat_dong_bao_hoa'), l.S);
      const ph = pick(r, 'pha', 'phase', 'pha_phuc_vu');
      if (ph) { l.phases = String(ph).split(/[;|/ ]+/).map(x => Number(x) - 1).filter(x => x >= 0); l._phaseSet = true; }
      if (longFmt) {
        const b = r.khung_gio;
        if (!p.bands.find(x => x.id === b)) p.bands.push({ id: b, label: b });
        const d = l.data[b] = l.data[b] || {};
        const q = qFromRow(p, r); if (q !== null) { d.q = Math.round(q); d.src = 'measured'; }
        const vv = U.num(pick(r, 'v', 'v_kmh', 'van_toc'), null); if (vv !== null) d.v = vv;
      } else {
        for (const b of p.bands) {
          const d = l.data[b.id] = l.data[b.id] || {};
          const q = U.num(r['q_' + U.normKey(b.id)], null); if (q !== null) { d.q = q; d.src = 'measured'; }
          const vv = U.num(r['v_' + U.normKey(b.id)], null); if (vv !== null) d.v = vv;
        }
      }
    }
    M.normalizeProject(p);
    return { add, upd, miss };
  };

  const DIR = { bac: 'N', b: 'N', n: 'N', north: 'N', nam: 'S', s: 'S', south: 'S', dong: 'E', d: 'E', e: 'E', east: 'E', tay: 'W', t: 'W', w: 'W', west: 'W',
    dong_bac: 'NE', ne: 'NE', dong_nam: 'SE', se: 'SE', tay_bac: 'NW', nw: 'NW', tay_nam: 'SW', sw: 'SW' };
  const ANG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  /* Nhập theo hướng tiếp cận của nút: tự tìm nhánh vào nút có hướng đến khớp nhất. */
  IO.importApproachCSV = function (p, text) {
    const { rows } = U.parseCSV(text);
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    let ok = 0; const warn = [];
    for (const r of rows) {
      const n = byId.get(pick(r, 'ma_nut', 'id'));
      if (!n) { warn.push('Không có nút ' + pick(r, 'ma_nut')); continue; }
      const dir = DIR[U.normKey(pick(r, 'huong', 'direction') || '')];
      if (!dir) { warn.push(`${n.id}: hướng không hợp lệ "${pick(r, 'huong')}"`); continue; }
      let best = null, bd = 1e9;
      for (const l of p.links) {
        if (l.v !== n.id) continue;
        const u = byId.get(l.u); if (!u) continue;
        const from = (U.bearing([u.lon, u.lat], [n.lon, n.lat]) + 180) % 360;
        const d = U.angleDiff(from, ANG[dir]);
        if (d < bd) { bd = d; best = l; }
      }
      if (!best || bd > 50) { warn.push(`${n.id}: không có nhánh vào từ hướng ${dir}`); continue; }
      const bands = pick(r, 'khung_gio') ? [r.khung_gio] : p.bands.map(b => b.id);
      for (const b of bands) {
        const d = best.data[b] = best.data[b] || {};
        const q = qFromRow(p, r); if (q !== null) { d.q = Math.round(q); d.src = 'measured'; }
        const vv = U.num(pick(r, 'v_kmh', 'v'), null); if (vv !== null) d.v = vv;
      }
      const ln = U.num(pick(r, 'so_lan'), null); if (ln) best.lanes = ln;
      const ph = pick(r, 'pha'); if (ph) best.phases = String(ph).split(/[;|/ ]+/).map(x => Number(x) - 1).filter(x => x >= 0);
      ok++;
    }
    M.normalizeProject(p);
    return { ok, warn };
  };

  /* Nhận dạng loại CSV theo tiêu đề cột. */
  IO.detectCSV = function (text) {
    const { header } = U.parseCSV(text.split(/\r?\n/).slice(0, 2).join('\n'));
    const has = (k) => header.includes(k);
    if (has('huong')) return 'approach';
    if (has('tu_nut') || has('den_nut')) return 'links';
    if (header.some(h => /^xanh_\d/.test(h))) return 'plans';
    if (has('lat') || has('lon')) return 'nodes';
    return null;
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
