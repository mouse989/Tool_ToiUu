/* Bộ đánh giá mạng lưới kiểu TRANSYT (mô hình biểu đồ dòng chu kỳ – Cyclic Flow Profile).
 *
 *  - Mỗi nhánh i (u→v) có biểu đồ đến A_i(t) và biểu đồ đi D_i(t) trên lưới 1 s trong một chu kỳ.
 *  - A_j tại vạch dừng = phân tán Robertson( Σ_i p_ij·D_i dịch thời gian βT ) + nguồn đều giữa đoạn,
 *    rồi chuẩn hoá để tổng lưu lượng bằng q_j đo đếm.
 *  - Hàng chờ điểm: Q(t+1) = max(0, Q + A − D), D = min(Q, s) khi xanh hiệu dụng.
 *  - Độ trễ = trễ đều (tích phân hàng chờ) + trễ ngẫu nhiên/quá bão hoà d2 (HCM).
 *  - PI = Σ q·(d + K·h) — chỉ số hiệu suất TRANSYT, K = trọng số phạt dừng (s/lần).
 * Dùng cho tối ưu offset/split (leo đồi) và quét chu kỳ vì nhanh hơn mô phỏng CTM hàng trăm lần. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model, SG = TS.signal;
  const PR = TS.profile = {};

  PR.create = function (net, planFn, opts) {
    const P = net.P;
    const o = Object.assign({ K: P.stopK, alpha: P.alpha, beta: P.beta }, opts || {});
    const links = net.links, N = net.N;
    const nodePlan = new Array(N), nodeC = new Int32Array(N);
    const st = links.map(() => ({}));

    function refreshNode(n) {
      const node = net.nodes[n];
      const pl = node.signalized ? planFn(n) : null;
      nodePlan[n] = pl;
      nodeC[n] = pl ? Math.max(1, Math.round(M.cycleOf(pl))) : 0;
    }
    for (let n = 0; n < N; n++) refreshNode(n);

    function periodOf(l) {
      const Cv = nodeC[l.v] || nodeC[l.u] || 60, Cu = nodeC[l.u];
      if (Cu > Cv && Cu % Cv === 0) return Cu;
      return Cv;
    }

    function buildMask(i) {
      const l = links[i], s = st[i];
      const Tp = s.Tp;
      const pl = nodePlan[l.v];
      const m = s.mask && s.mask.length === Tp ? s.mask : new Uint8Array(Tp);
      if (!pl) { m.fill(1); s.mask = m; s.gFrac = 1; return; }
      const C = nodeC[l.v];
      const ph = l.phases.filter(k => k < pl.phases.length);
      const wins = M.effWindows(pl, ph, P);
      let cnt = 0;
      for (let t = 0; t < Tp; t++) {
        const tc = U.mod(t + 0.5 - pl.offset, C);
        let g = 0;
        for (const w of wins) if (tc >= w[0] && tc < w[1]) { g = 1; break; }
        m[t] = g; cnt += g;
      }
      s.mask = m; s.gFrac = cnt / Tp;
    }

    function initLink(i) {
      const l = links[i], s = st[i];
      s.Tp = periodOf(l);
      s.A = new Float64Array(s.Tp).fill(l.q / 3600);
      s.D = new Float64Array(s.Tp).fill(l.q / 3600);
      s.Q = new Float64Array(s.Tp);
      s.tmp = new Float64Array(s.Tp);
      buildMask(i);
      const Tb = o.beta * l.T;
      s.shift = Math.round(Tb);
      s.F = 1 / (1 + o.alpha * Tb);
    }

    /* Biểu đồ đến tại vạch dừng của nhánh j. */
    function computeArrival(j) {
      const l = links[j], s = st[j], Tp = s.Tp;
      const U0 = s.tmp; U0.fill(0);
      let upTot = 0, uniform = 0;
      for (const i of net.inL[l.u]) {
        const li = links[i];
        let p = 0;
        for (const t of li.turn) if (t.j === j) { p = t.p; break; }
        if (!p) continue;
        const w = p * (1 - li.exitFrac);
        const si = st[i];
        if (Tp % si.Tp === 0) {
          const Di = si.D, Ti = si.Tp;
          for (let t = 0; t < Tp; t++) U0[t] += w * Di[t % Ti];
        } else {
          let m = 0; for (let t = 0; t < si.Tp; t++) m += si.D[t];
          uniform += w * m / si.Tp;
        }
      }
      for (let t = 0; t < Tp; t++) upTot += U0[t];
      upTot += uniform * Tp;
      const target = l.q * Tp / 3600;
      const scale = upTot > target && upTot > 0 ? target / upTot : 1;
      const srcPerBin = Math.max(0, target - upTot * scale) / Tp + uniform * scale;
      // dịch thời gian + phân tán Robertson (lặp vòng 2 chu kỳ để hội tụ tuần hoàn)
      const A = s.A, F = s.F, sh = s.shift;
      let prev = 0;
      for (let t = 0; t < Tp; t++) prev += U0[t] * scale; prev /= Tp;
      for (let rep = 0; rep < 2; rep++) {
        for (let t = 0; t < Tp; t++) {
          const inp = U0[U.mod(t - sh, Tp)] * scale;
          prev = F * inp + (1 - F) * prev;
          A[t] = prev + srcPerBin;
        }
      }
    }

    /* Hàng chờ tại vạch dừng → D, trễ đều, số lần dừng, trễ ngẫu nhiên, PI. */
    function computeQueue(i) {
      const l = links[i], s = st[i], Tp = s.Tp;
      const A = s.A, D = s.D, Q = s.Q, m = s.mask;
      const sat = l.S / 3600;
      let Atot = 0, Gcnt = 0;
      for (let t = 0; t < Tp; t++) { Atot += A[t]; Gcnt += m[t]; }
      const capP = sat * Gcnt;
      const over = Math.max(0, Atot - capP);
      let q = 0, qsum = 0, stops = 0, qmax = 0;
      for (let rep = 0; rep < 2; rep++) {
        q = Math.max(0, q - over);
        const last = rep === 1;
        for (let t = 0; t < Tp; t++) {
          const a = A[t];
          if (last && (q > 0.05 || !m[t])) stops += a;
          q += a;
          const d = m[t] ? Math.min(q, sat) : 0;
          q -= d;
          if (last) { D[t] = d; Q[t] = q; qsum += q; if (q > qmax) qmax = q; }
        }
      }
      const ge = Math.max(1e-3, Gcnt) , C = Tp;
      const h = SG.hcmDelay(l.q, l.S, ge, C, 0);
      const dU = Atot > 1e-9 ? qsum / Atot : 0;
      s.dU = dU; s.d2 = h.d2; s.x = h.x;
      s.d = dU + h.d2;
      s.h = Atot > 1e-9 ? Math.min(1, stops / Atot) : 0;
      s.qmax = qmax + over;                       // pcu (hàng chờ cực đại, gồm phần dư quá bão hoà)
      s.qlen = s.qmax * P.jamSpacing / Math.max(1, l.lanes); // m
      s.occ = s.qlen / l.len;
      s.PI = l.q * (s.d + o.K * s.h) / 3600;      // pcu·h/h (quy đổi)
    }

    const api = {
      net, st, nodePlan, nodeC, opts: o,
      init() { for (let i = 0; i < links.length; i++) initLink(i); },
      fullEval(passes) {
        passes = passes || 3;
        for (let p = 0; p < passes; p++) {
          for (let j = 0; j < links.length; j++) computeArrival(j);
          for (let j = 0; j < links.length; j++) computeQueue(j);
        }
        return api.totals();
      },
      totals() {
        let PI = 0, D = 0, H = 0, Q = 0, spill = 0, xmax = 0, Dcoord = 0, Qc = 0;
        for (let i = 0; i < links.length; i++) {
          const s = st[i], q = links[i].q;
          if (!isFinite(s.d)) continue;
          PI += s.PI; D += s.d * q; H += s.h * q; Q += q;
          if (s.occ >= P.spillThreshold) spill++;
          if (s.x > xmax) xmax = s.x;
          if (links[i].upShare > 0.3) { Dcoord += s.d * q; Qc += q; }
        }
        return {
          PI, delay: Q > 0 ? D / Q : 0, stops: Q > 0 ? H / Q : 0, spill, xmax,
          vehHoursDelay: D / 3600, flow: Q, coordDelay: Qc > 0 ? Dcoord / Qc : 0,
        };
      },
      /* PI cục bộ của tập nhánh. */
      localPI(set) { let s = 0; for (const i of set) s += st[i].PI; return s; },
      affected(nodes) {
        const inS = new Set(), outS = new Set();
        for (const n of nodes) { for (const i of net.inL[n]) inS.add(i); for (const j of net.outL[n]) outS.add(j); }
        return { ins: [...inS], outs: [...outS], all: [...new Set([...inS, ...outS])] };
      },
      /* Tính lại cục bộ sau khi đổi plan của các nút (offset / split). */
      recomputeLocal(nodes, aff) {
        for (const n of nodes) refreshNode(n);
        for (const i of aff.ins) { buildMask(i); computeQueue(i); }
        for (const j of aff.outs) computeArrival(j);
        for (const j of aff.outs) computeQueue(j);
      },
      snapshot(aff) { return aff.all.map(i => [st[i].D.slice(), st[i].A.slice(), st[i].mask.slice(), st[i].d, st[i].h, st[i].PI, st[i].x, st[i].qmax, st[i].qlen, st[i].occ, st[i].dU, st[i].d2]); },
      restore(aff, snap) {
        aff.all.forEach((i, k) => {
          const s = st[i], v = snap[k];
          s.D.set(v[0]); s.A.set(v[1]); s.mask.set(v[2]);
          [s.d, s.h, s.PI, s.x, s.qmax, s.qlen, s.occ, s.dU, s.d2] = v.slice(3);
        });
      },
      refreshNode,
      /* Đổi chu kỳ các nút → khởi tạo lại chu kỳ biểu đồ của các nhánh liên quan. */
      reinit(nodes) {
        for (const n of nodes) refreshNode(n);
        const set = new Set();
        for (const n of nodes) { for (const i of net.inL[n]) set.add(i); for (const j of net.outL[n]) set.add(j); }
        for (const i of set) initLink(i);
        return [...set];
      },
      /* Đánh giá riêng một tập nhánh (các nhánh khác giữ nguyên biểu đồ đi). */
      evalLinks(set, passes) {
        for (let p = 0; p < (passes || 3); p++) {
          for (const j of set) computeArrival(j);
          for (const j of set) computeQueue(j);
        }
        let s = 0; for (const j of set) s += st[j].PI; return s;
      },
      linkResult(i) { const s = st[i]; return { d: s.d, dU: s.dU, d2: s.d2, h: s.h, x: s.x, qmax: s.qmax, qlen: s.qlen, occ: s.occ, PI: s.PI }; },
    };
    api.init();
    return api;
  };

  /* Đánh giá nhanh toàn mạng cho một kịch bản ('base' | 'opt'). */
  PR.evaluateScenario = function (net, scenario, opts) {
    const ev = PR.create(net, (n) => M.getPlan(net.nodes[n], net.band, scenario), opts);
    const tot = ev.fullEval(3);
    return { ev, tot };
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
