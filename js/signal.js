/* Tính toán tín hiệu cho nút đơn: Webster, phân bổ split cân bằng bão hoà, khoảng chuyển tiếp ITE,
 * độ trễ HCM (Highway Capacity Manual, dạng d1 + d2) và mức phục vụ LOS. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const S = TS.signal = {};

  S.LOS_THRESH = [10, 20, 35, 55, 80];
  S.los = function (d, x) {
    if (x > 1.0) return 'F';
    const t = S.LOS_THRESH;
    return d <= t[0] ? 'A' : d <= t[1] ? 'B' : d <= t[2] ? 'C' : d <= t[3] ? 'D' : d <= t[4] ? 'E' : 'F';
  };

  S.phaseLost = (ph, P) => P.lostStart + ph.y + ph.ar - Math.min(P.greenExt, ph.y);
  S.planLost = (plan, P) => U.sum(plan.phases, ph => S.phaseLost(ph, P));

  /* Tỷ số dòng tới hạn của từng pha: y_k = max_{nhánh do pha k phục vụ} q/S. */
  S.criticalRatios = function (net, n, nPh) {
    const y = new Array(nPh).fill(0), crit = new Array(nPh).fill(-1);
    for (const i of net.inL[n]) {
      const l = net.links[i];
      const ph = l.phases.filter(k => k < nPh);
      if (!ph.length) continue;
      const r = l.q / l.S / ph.length;
      for (const k of ph) if (r > y[k]) { y[k] = r; crit[k] = i; }
    }
    return { y, crit, Y: U.sum(y) };
  };

  /* Chu kỳ Webster C0 = (1.5L + 5)/(1 − Y) và chu kỳ tối thiểu để x ≤ x_target. */
  S.websterCycle = function (L, Y, P) {
    let C0, Cx;
    if (Y >= 0.95) C0 = P.Cmax; else C0 = (1.5 * L + 5) / (1 - Y);
    if (Y >= P.vcTarget) Cx = P.Cmax; else Cx = L / (1 - Y / P.vcTarget);
    return { C0, Cx, oversat: Y >= 0.95 };
  };

  S.roundCycle = (C, P) => U.clamp(Math.round(C / P.cycleStep) * P.cycleStep, P.Cmin, P.Cmax);

  /* Phân bổ xanh theo nguyên lý cân bằng độ bão hoà (equi-saturation) cho chu kỳ C.
   * Giữ nguyên y/ar của từng pha, bảo đảm minG và tổng đúng bằng C (làm tròn 1 s). */
  S.equisatSplits = function (plan, yk, C, P) {
    const phs = plan.phases;
    const IG = U.sum(phs, ph => ph.y + ph.ar);
    const minG = phs.map(ph => Math.max(ph.minG || P.minGreen, 5));
    let avail = C - IG;
    if (avail < U.sum(minG)) { avail = U.sum(minG); C = avail + IG; }
    const w = yk.map(v => Math.max(v, 1e-3));
    let g = new Array(phs.length).fill(0), fixed = new Array(phs.length).fill(false);
    // lặp: pha nào dưới minG thì cố định ở minG, phân phối lại phần còn lại
    for (let it = 0; it < phs.length + 1; it++) {
      const freeW = U.sum(w.filter((_, k) => !fixed[k]));
      const freeA = avail - U.sum(g.filter((_, k) => fixed[k]));
      let changed = false;
      for (let k = 0; k < phs.length; k++) {
        if (fixed[k]) continue;
        g[k] = freeW > 0 ? w[k] / freeW * freeA : freeA / phs.length;
      }
      for (let k = 0; k < phs.length; k++) if (!fixed[k] && g[k] < minG[k]) { g[k] = minG[k]; fixed[k] = true; changed = true; }
      if (!changed) break;
    }
    // làm tròn giữ tổng
    const gi = g.map(Math.floor);
    let rem = Math.round(avail - U.sum(gi));
    const order = g.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0]);
    for (let t = 0; t < order.length && rem > 0; t++, rem--) gi[order[t][1]]++;
    return { C, g: gi };
  };

  /* Tối ưu nút đơn lẻ: C Webster (hoặc C cho trước) + split cân bằng bão hoà. Trả về plan mới. */
  S.optimizeNode = function (net, n, basePlan, Cfixed) {
    const P = net.P;
    const plan = U.deepClone(basePlan);
    const nPh = plan.phases.length;
    const { y, Y } = S.criticalRatios(net, n, nPh);
    const L = S.planLost(plan, P);
    const w = S.websterCycle(L, Y, P);
    let C = Cfixed || S.roundCycle(Math.max(w.C0, w.Cx), P);
    const r = S.equisatSplits(plan, y, C, P);
    r.g.forEach((g, k) => { plan.phases[k].g = g; });
    return { plan, C: r.C, Y, L, C0: w.C0, Cx: w.Cx, oversat: w.oversat, y };
  };

  /* Khoảng chuyển tiếp theo ITE: Y = t + v/(2a + 2gG); R = (W + Lxe)/v. */
  S.iteIntergreen = function (vkmh, W, opts) {
    const o = Object.assign({ t: 1.0, a: 3.0, grade: 0, Lveh: 5 }, opts || {});
    const v = Math.max(vkmh, 15) / 3.6;
    const Y = o.t + v / (2 * o.a + 2 * 9.81 * o.grade);
    const R = (W + o.Lveh) / v;
    return { y: U.clamp(Math.ceil(Y), 3, 5), ar: U.clamp(Math.ceil(R), 1, 4), yRaw: Y, rRaw: R };
  };

  S.applyITE = function (net, n, plan) {
    const node = net.nodes[n];
    const nPh = plan.phases.length;
    const vmax = new Array(nPh).fill(0);
    for (const i of net.inL[n]) for (const k of net.links[i].phases) if (k < nPh) vmax[k] = Math.max(vmax[k], net.links[i].vkmh);
    plan.phases.forEach((ph, k) => {
      const r = S.iteIntergreen(vmax[k] || net.P.vDefault, node.width || 20);
      ph.y = r.y; ph.ar = r.ar;
    });
    return plan;
  };

  /* Độ trễ HCM cho một nhánh: d1 (đều) + d2 (ngẫu nhiên & quá bão hoà), T = 0.25 h, k = 0.5, I = 1. */
  S.hcmDelay = function (q, Sflow, ge, C, PF) {
    const lam = U.clamp(ge / C, 0.01, 1);
    const c = Sflow * lam;
    const x = c > 0 ? q / c : 9;
    const d1 = 0.5 * C * (1 - lam) ** 2 / (1 - Math.min(1, x) * lam);
    const T = 0.25, k = 0.5, I = 1;
    const d2 = c > 0 ? 900 * T * ((x - 1) + Math.sqrt((x - 1) ** 2 + 8 * k * I * x / (c * T))) : 999;
    return { x, c, d1, d2, d: d1 * (PF === undefined ? 1 : PF) + d2 };
  };

  /* Phân tích một nút theo giản đồ pha cho trước. */
  S.analyzeNode = function (net, n, plan) {
    const P = net.P;
    const C = M.cycleOf(plan);
    const res = { n, C, links: [], delay: 0, q: 0, xmax: 0 };
    for (const i of net.inL[n]) {
      const l = net.links[i];
      const ph = l.phases.filter(k => k < plan.phases.length);
      const ge = Math.max(1, M.effGreen(plan, ph, P));
      const h = S.hcmDelay(l.q, l.S, ge, C);
      res.links.push({ i, ge, x: h.x, d: h.d, d1: h.d1, d2: h.d2, los: S.los(h.d, h.x) });
      res.delay += h.d * l.q; res.q += l.q; res.xmax = Math.max(res.xmax, h.x);
    }
    res.delay = res.q > 0 ? res.delay / res.q : 0;
    res.los = S.los(res.delay, 0);
    const cr = S.criticalRatios(net, n, plan.phases.length);
    res.Y = cr.Y; res.L = S.planLost(plan, P);
    const w = S.websterCycle(res.L, res.Y, P);
    res.Cw = S.roundCycle(Math.max(w.C0, w.Cx), P);
    return res;
  };

  S.analyzeNetwork = function (net, scenario) {
    const out = []; let D = 0, Q = 0;
    for (let n = 0; n < net.N; n++) {
      const node = net.nodes[n];
      if (!node.signalized || !net.inL[n].length) { out.push(null); continue; }
      const a = S.analyzeNode(net, n, M.getPlan(node, net.band, scenario));
      out.push(a); D += a.delay * a.q; Q += a.q;
    }
    return { nodes: out, avgDelay: Q > 0 ? D / Q : 0 };
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
