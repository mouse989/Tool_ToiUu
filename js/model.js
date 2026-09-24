/* Mô hình dữ liệu dự án: nút giao (tủ tín hiệu), liên kết có hướng (nhánh tiếp cận), giản đồ pha theo khung giờ.
 *
 * Quy ước quan trọng:
 *  - Mỗi liên kết u→v là một NHÁNH TIẾP CẬN của nút v. q (pcu/h) và v (km/h) đo trên nhánh đó.
 *  - link.phases = danh sách chỉ số pha (0-based) của nút v cho phép nhánh này đi.
 *  - Giản đồ pha: phases[k] = {g, y, ar, minG, maxG}; chu kỳ C = Σ(g + y + ar) (luôn suy ra, không lưu riêng).
 *  - offset θ: thời điểm bắt đầu xanh pha 1 so với mốc 0 của đồng hồ vùng.
 *  - Xanh hiệu dụng của pha = [bắt đầu + l1, bắt đầu + g + e] với l1 = mất mát khởi động, e = kéo dài sang vàng (HCM).
 */
(function (TS) {
  'use strict';
  const U = TS.util;
  const M = TS.model = {};

  M.DEFAULT_BANDS = [
    { id: 'am', label: 'Cao điểm sáng 06:30–09:00' },
    { id: 'mid', label: 'Giữa ngày 09:00–16:00' },
    { id: 'pm', label: 'Cao điểm chiều 16:00–19:00' },
    { id: 'night', label: 'Thấp điểm đêm 22:00–05:00' },
  ];

  M.DEFAULT_PARAMS = {
    satPerLane: 1800,     // pcu/h/làn — suất dòng bão hoà cơ sở khi nhánh chưa khai báo S
    jamSpacing: 7.0,      // m/pcu/làn — cự ly chiếm dụng khi kẹt (≈3.5 m/pcu cho cả mặt cắt 2 làn hỗn hợp)
    lostStart: 2,         // s — mất mát khởi động đầu xanh (l1)
    greenExt: 2,          // s — phần vàng vẫn được dùng để xả (e)
    minGreen: 15,         // s — sàn xanh tối thiểu (bộ hành, khu trung tâm)
    maxGreen: 90,         // s
    yellow: 3,            // s
    allRed: 2,            // s
    Cmin: 50, Cmax: 150, cycleStep: 2,
    vcTarget: 0.9,        // độ bão hoà mục tiêu khi chọn chu kỳ tối thiểu khả thi
    alpha: 0.35, beta: 0.8, // hệ số phân tán đoàn xe Robertson (TRANSYT)
    stopK: 20,            // s/lần dừng — trọng số phạt số lần dừng trong PI
    spillThreshold: 0.8,  // tỷ lệ chiếm dụng liên kết coi là tràn ngược
    maxZoneSize: 35, minZoneSize: 5, zoneResolution: 0.25, maxCouplingDist: 900, zoneCycleTol: 25,
    gwsTwoWay: 80, gwsOneWay: 55, gwMinFlow: 1000, // pcu/h (tổng 2 chiều) tối thiểu để xét sóng xanh
    couplingHigh: 1.6, couplingLow: 0.9, // chỉ số ghép nối q_2chiều(pcu/h)/L(m): ≥ cao → phối hợp; < thấp → độc lập
    vDefault: 30,         // km/h khi thiếu số liệu vận tốc
    pcu: { xe_may: 0.3, o_to: 1.0, xe_tai: 2.0, xe_buyt: 2.5 },
    tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', // CARTO Voyager: chạy được cả khi mở file:// (OSM chặn yêu cầu không có Referer)
  };

  M.newProject = function (name) {
    return {
      format: 'tsopt-project', version: 1,
      name: name || 'Dự án mới',
      created: new Date().toISOString(),
      bands: U.deepClone(M.DEFAULT_BANDS),
      params: U.deepClone(M.DEFAULT_PARAMS),
      nodes: [], links: [], corridors: [],
      results: null,
    };
  };

  M.normalizeProject = function (p) {
    p.params = Object.assign(U.deepClone(M.DEFAULT_PARAMS), p.params || {});
    p.params.pcu = Object.assign(U.deepClone(M.DEFAULT_PARAMS.pcu), (p.params && p.params.pcu) || {});
    if (!p.bands || !p.bands.length) p.bands = U.deepClone(M.DEFAULT_BANDS);
    p.nodes = p.nodes || []; p.links = p.links || []; p.corridors = p.corridors || [];
    for (const n of p.nodes) {
      n.id = String(n.id);
      n.name = n.name || n.id;
      n.signalized = n.signalized !== false;
      n.control = n.control || 'fixed';
      n.width = U.num(n.width, 20);
      n.plans = n.plans || {};
      n.opt = n.opt || {};
      for (const b of p.bands) {
        if (!n.plans[b.id]) n.plans[b.id] = M.defaultPlan(p.params, 2);
        M.normalizePlan(n.plans[b.id], p.params);
        if (n.opt[b.id]) M.normalizePlan(n.opt[b.id], p.params);
      }
    }
    let k = 0;
    for (const l of p.links) {
      l.u = String(l.u); l.v = String(l.v);
      l.id = l.id || ('L' + (++k) + '_' + l.u + '_' + l.v);
      l.lanes = U.num(l.lanes, 2);
      l.phases = Array.isArray(l.phases) && l.phases.length ? l.phases.map(Number) : [0];
      l.data = l.data || {};
      for (const b of p.bands) {
        const d = l.data[b.id] = l.data[b.id] || {};
        d.q = U.num(d.q, null);
        d.v = U.num(d.v, null);
        if (!d.src) d.src = d.q === null ? 'missing' : (d.src || 'measured');
      }
    }
    return p;
  };

  M.defaultPlan = function (P, nPh, C) {
    nPh = nPh || 2;
    const y = P.yellow, ar = P.allRed;
    const Ct = C || 90;
    const g = Math.max(P.minGreen, Math.round((Ct - nPh * (y + ar)) / nPh));
    const phases = [];
    for (let i = 0; i < nPh; i++) phases.push({ g, y, ar });
    return { offset: 0, phases };
  };

  M.normalizePlan = function (plan, P) {
    plan.offset = U.num(plan.offset, 0);
    plan.phases = (plan.phases || []).map(ph => ({
      g: Math.max(1, U.num(ph.g, P.minGreen)), y: U.num(ph.y, P.yellow), ar: U.num(ph.ar, P.allRed),
      minG: U.num(ph.minG, P.minGreen), maxG: U.num(ph.maxG, P.maxGreen), name: ph.name || '',
    }));
    if (!plan.phases.length) plan.phases = M.defaultPlan(P, 2).phases;
    if (plan.half) plan.half = true;
    return plan;
  };

  /* ── Giản đồ pha ─────────────────────────────────────── */
  M.cycleOf = (plan) => U.sum(plan.phases, ph => ph.g + ph.y + ph.ar);
  M.lostTime = (plan) => U.sum(plan.phases, ph => ph.y + ph.ar);

  /* Thời điểm bắt đầu xanh của từng pha trong chu kỳ (pha 1 bắt đầu tại 0). */
  M.phaseStarts = function (plan) {
    const s = []; let t = 0;
    for (const ph of plan.phases) { s.push(t); t += ph.g + ph.y + ph.ar; }
    return s;
  };

  /* Cửa sổ xanh hiệu dụng [a, b) (tương đối đầu chu kỳ) cho tập pha. */
  M.effWindows = function (plan, phaseIdx, P) {
    const st = M.phaseStarts(plan), out = [];
    for (const k of phaseIdx) {
      const ph = plan.phases[k]; if (!ph) continue;
      const a = st[k] + P.lostStart, b = st[k] + ph.g + Math.min(P.greenExt, ph.y);
      if (b > a) out.push([a, b]);
    }
    return out;
  };

  M.effGreen = function (plan, phaseIdx, P) {
    return U.sum(M.effWindows(plan, phaseIdx, P), w => w[1] - w[0]);
  };

  /* Trạng thái hiển thị tại thời điểm t cho tập pha: 'G' | 'Y' | 'R'. */
  M.signalState = function (plan, phaseIdx, t) {
    const C = M.cycleOf(plan);
    const tc = U.mod(t - plan.offset, C);
    const st = M.phaseStarts(plan);
    for (const k of phaseIdx) {
      const ph = plan.phases[k]; if (!ph) continue;
      const a = st[k];
      if (tc >= a && tc < a + ph.g) return 'G';
      if (tc >= a + ph.g && tc < a + ph.g + ph.y) return 'Y';
    }
    return 'R';
  };

  /* Pha đang chạy tại thời điểm t: {k, part: 'g'|'y'|'ar', rem}. */
  M.phaseAt = function (plan, t) {
    const C = M.cycleOf(plan);
    let tc = U.mod(t - plan.offset, C);
    for (let k = 0; k < plan.phases.length; k++) {
      const ph = plan.phases[k];
      if (tc < ph.g) return { k, part: 'g', rem: ph.g - tc };
      tc -= ph.g;
      if (tc < ph.y) return { k, part: 'y', rem: ph.y - tc };
      tc -= ph.y;
      if (tc < ph.ar) return { k, part: 'ar', rem: ph.ar - tc };
      tc -= ph.ar;
    }
    return { k: 0, part: 'g', rem: 0 };
  };

  M.getPlan = function (node, band, scenario) {
    if (scenario === 'opt' && node.opt && node.opt[band]) return node.opt[band];
    return node.plans[band];
  };

  /* ── Mạng lưới dẫn xuất (chỉ mục, suất dòng, tỷ lệ rẽ) ── */
  M.buildNet = function (project, band) {
    const P = project.params;
    const nodes = project.nodes, links = project.links;
    const nodeIdx = new Map();
    nodes.forEach((n, i) => nodeIdx.set(n.id, i));
    const N = nodes.length;
    const inL = Array.from({ length: N }, () => []);
    const outL = Array.from({ length: N }, () => []);
    const L = [];
    links.forEach((l) => {
      const ui = nodeIdx.get(l.u), vi = nodeIdx.get(l.v);
      if (ui === undefined || vi === undefined || ui === vi) return;
      const d = (l.data && l.data[band]) || {};
      const nu = nodes[ui], nv = nodes[vi];
      const geom = (l.geom && l.geom.length >= 2) ? l.geom : [[nu.lon, nu.lat], [nv.lon, nv.lat]];
      const len = U.num(l.L, 0) > 0 ? l.L : Math.max(30, U.polylineLength(geom));
      const S = U.num(l.S, 0) > 0 ? l.S : l.lanes * P.satPerLane;
      const vk = U.num(d.v, null) || P.vDefault;
      const q = Math.max(0, U.num(d.q, 0));
      const idx = L.length;
      L.push({
        idx, ref: l, id: l.id, u: ui, v: vi, road: l.road || '',
        len, lanes: l.lanes, S, q, vkmh: vk, vms: vk / 3.6, T: len / (vk / 3.6),
        phases: l.phases, geom, brg: U.bearing([nu.lon, nu.lat], [nv.lon, nv.lat]),
        src: d.src || 'measured',
      });
      outL[ui].push(idx); inL[vi].push(idx);
    });
    const net = { project, band, P, nodes, nodeIdx, N, links: L, inL, outL };
    M.estimateTurning(net);
    return net;
  };

  /* Ước lượng ma trận rẽ tại nút từ lưu lượng nhánh (khi chưa có số đếm hướng rẽ) bằng cân bằng
   * Furness / IPF: hàng = nhánh vào (tổng = q_i), cột = nhánh ra (tổng = q_j), thêm hàng "nguồn giữa đoạn"
   * và cột "ra khỏi mạng" để hấp thụ chênh lệch. Trọng số mồi: đi thẳng 1.0, rẽ 0.35, quay đầu 0.
   * Kết quả bảo đảm lưu lượng mô phỏng trên mỗi nhánh khớp số đo đếm khi mạng chưa quá bão hoà. */
  M.estimateTurning = function (net, opts) {
    const o = Object.assign({ wThrough: 1.0, wTurn: 0.35, slack: 0.08, iters: 40 }, opts || {});
    const { links, inL, outL, N } = net;
    for (const l of links) { l.turn = []; l.exitFrac = 0; l.supply = 0; l.srcRate = 0; }
    for (let n = 0; n < N; n++) {
      const ins = inL[n], outs = outL[n];
      const qin = U.sum(ins, i => links[i].q), qout = U.sum(outs, j => links[j].q);
      const tot = Math.max(qin, qout);
      if (!ins.length) { for (const j of outs) links[j].srcRate = links[j].q; continue; }
      if (!outs.length) { for (const i of ins) links[i].exitFrac = 1; continue; }
      const eps = o.slack * tot + 1e-6;
      const E = qin - qout + eps > eps ? qin - qout + eps : eps;   // cột "ra khỏi mạng"
      const Ssrc = qout - qin + eps > eps ? qout - qin + eps : eps; // hàng "nguồn"
      const R = ins.length + 1, Cc = outs.length + 1;
      const T = new Float64Array(R * Cc);
      for (let a = 0; a < ins.length; a++) {
        const li = links[ins[a]];
        for (let b = 0; b < outs.length; b++) {
          const lj = links[outs[b]];
          if (lj.v === li.u && outs.length > 1) continue; // quay đầu
          T[a * Cc + b] = U.angleDiff(li.brg, lj.brg) < 30 ? o.wThrough : o.wTurn;
        }
        T[a * Cc + outs.length] = 0.15;
      }
      for (let b = 0; b < outs.length; b++) T[ins.length * Cc + b] = 0.15;
      const rowT = ins.map(i => links[i].q).concat([Ssrc]);
      const colT = outs.map(j => links[j].q).concat([E]);
      for (let it = 0; it < o.iters; it++) {
        for (let a = 0; a < R; a++) {
          let s = 0; for (let b = 0; b < Cc; b++) s += T[a * Cc + b];
          const f = s > 0 ? rowT[a] / s : 0; for (let b = 0; b < Cc; b++) T[a * Cc + b] *= f;
        }
        for (let b = 0; b < Cc; b++) {
          let s = 0; for (let a = 0; a < R; a++) s += T[a * Cc + b];
          const f = s > 0 ? colT[b] / s : 0; for (let a = 0; a < R; a++) T[a * Cc + b] *= f;
        }
      }
      for (let a = 0; a < ins.length; a++) {
        const li = links[ins[a]];
        let rs = 0; for (let b = 0; b < Cc; b++) rs += T[a * Cc + b];
        if (rs <= 0) { li.exitFrac = 1; continue; }
        const ex = T[a * Cc + outs.length] / rs;
        li.exitFrac = ex;
        for (let b = 0; b < outs.length; b++) {
          const v = T[a * Cc + b];
          if (v <= 0) continue;
          li.turn.push({ j: outs[b], p: v / rs / Math.max(1e-9, 1 - ex) });
          links[outs[b]].supply += v;
        }
      }
      for (let b = 0; b < outs.length; b++) links[outs[b]].srcRate += T[ins.length * Cc + b];
    }
    for (const l of links) {
      l.upShare = l.q > 0 ? U.clamp(l.supply / l.q, 0, 1) : 0; // phần lưu lượng đến từ nút thượng lưu
    }
  };

  /* ── Kiểm tra dữ liệu ─────────────────────────────── */
  M.validate = function (project) {
    const P = project.params, issues = [];
    const ids = new Set();
    const nodeById = new Map(project.nodes.map(n => [n.id, n]));
    for (const n of project.nodes) {
      if (ids.has(n.id)) issues.push({ lvl: 'err', obj: n.id, msg: 'Trùng mã nút' });
      ids.add(n.id);
      if (!isFinite(n.lat) || !isFinite(n.lon)) issues.push({ lvl: 'err', obj: n.id, msg: 'Thiếu toạ độ' });
      if (!n.signalized) continue;
      for (const b of project.bands) {
        const pl = n.plans[b.id];
        if (!pl) { issues.push({ lvl: 'err', obj: n.id, msg: `Thiếu giản đồ pha khung ${b.id}` }); continue; }
        const C = M.cycleOf(pl);
        if (C < 30 || C > 240) issues.push({ lvl: 'warn', obj: n.id, msg: `Chu kỳ ${C}s bất thường (${b.id})` });
        pl.phases.forEach((ph, k) => {
          if (ph.y < 3) issues.push({ lvl: 'warn', obj: n.id, msg: `Pha ${k + 1} vàng ${ph.y}s < 3s (${b.id})` });
          if (ph.g < Math.min(P.minGreen, ph.minG || P.minGreen)) issues.push({ lvl: 'warn', obj: n.id, msg: `Pha ${k + 1} xanh ${ph.g}s < tối thiểu (${b.id})` });
        });
      }
    }
    const pair = new Set();
    for (const l of project.links) {
      const nu = nodeById.get(l.u), nv = nodeById.get(l.v);
      if (!nu || !nv) { issues.push({ lvl: 'err', obj: l.id, msg: `Liên kết trỏ tới nút không tồn tại (${l.u}→${l.v})` }); continue; }
      const key = l.u + '>' + l.v;
      if (pair.has(key)) issues.push({ lvl: 'warn', obj: l.id, msg: 'Trùng liên kết cùng chiều' });
      pair.add(key);
      if (nv.signalized) {
        const nPh = (nv.plans[project.bands[0].id] || { phases: [] }).phases.length;
        for (const k of l.phases) if (k >= nPh) issues.push({ lvl: 'err', obj: l.id, msg: `Pha phục vụ ${k + 1} vượt số pha của nút ${nv.id}` });
      }
      for (const b of project.bands) {
        const d = l.data[b.id] || {};
        if (d.q === null || d.q === undefined) issues.push({ lvl: 'info', obj: l.id, msg: `Thiếu lưu lượng khung ${b.id}` });
      }
    }
    return issues;
  };

  /* Bù dữ liệu thiếu: trung bình cùng tên đường → trung vị toàn mạng (đánh dấu src = 'imputed'). */
  M.imputeMissing = function (project) {
    let nq = 0, nv = 0;
    for (const b of project.bands) {
      const byRoad = new Map(); const allQ = [], allV = [];
      for (const l of project.links) {
        const d = l.data[b.id];
        if (!d || d.src === 'imputed') continue;
        const key = l.road || '';
        if (!byRoad.has(key)) byRoad.set(key, { q: [], v: [] });
        if (d.q !== null && d.q !== undefined) { byRoad.get(key).q.push(d.q); allQ.push(d.q); }
        if (d.v !== null && d.v !== undefined) { byRoad.get(key).v.push(d.v); allV.push(d.v); }
      }
      const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const mq = med(allQ), mv = med(allV);
      for (const l of project.links) {
        const d = l.data[b.id] = l.data[b.id] || {};
        const r = byRoad.get(l.road || '');
        if (d.q === null || d.q === undefined) {
          const val = (r && l.road && r.q.length) ? U.mean(r.q) : mq;
          if (val !== null) { d.q = Math.round(val); d.src = 'imputed'; nq++; }
        }
        if (d.v === null || d.v === undefined) {
          const val = (r && l.road && r.v.length) ? U.mean(r.v) : (mv || project.params.vDefault);
          d.v = Math.round(val); nv++;
        }
      }
    }
    return { nq, nv };
  };

  /* Gán pha phục vụ theo hướng tiếp cận: Bắc–Nam → pha 1, Đông–Tây → pha 2 (nút 2 pha).
   * Nút ≥3 pha: pha 1 = Bắc–Nam, pha 2 = Đông, pha 3 = Tây (pha tách hướng). */
  M.autoAssignPhases = function (project, onlyMissing) {
    const nodeById = new Map(project.nodes.map(n => [n.id, n]));
    const b0 = project.bands[0].id;
    for (const l of project.links) {
      if (onlyMissing && l.phases && l.phases.length && l._phaseSet) continue;
      const nu = nodeById.get(l.u), nv = nodeById.get(l.v);
      if (!nu || !nv) continue;
      const brg = U.bearing([nu.lon, nu.lat], [nv.lon, nv.lat]);
      const nPh = nv.plans[b0] ? nv.plans[b0].phases.length : 2;
      const ns = U.angleDiff(brg, 0) < 45 || U.angleDiff(brg, 180) < 45;
      if (nPh <= 2) l.phases = [ns ? 0 : Math.min(1, nPh - 1)];
      else l.phases = [ns ? 0 : (U.angleDiff(brg, 270) < 45 ? 1 : 2)]; // đi về hướng Tây = đến từ phía Đông
    }
  };

  M.stats = function (project) {
    const b = project.bands.map(x => x.id);
    let measured = 0, imputed = 0, missing = 0;
    for (const l of project.links) for (const id of b) {
      const d = l.data[id]; if (!d) { missing++; continue; }
      if (d.q === null || d.q === undefined) missing++; else if (d.src === 'imputed') imputed++; else measured++;
    }
    return {
      nodes: project.nodes.length, signalized: project.nodes.filter(n => n.signalized).length,
      links: project.links.length, measured, imputed, missing,
    };
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
