/* Nhận diện hành lang, chấm điểm khả thi sóng xanh GWS và phân vùng điều khiển (Louvain).
 *
 * Phân vùng: đồ thị vô hướng giữa các nút có đèn, trọng số
 *     w_uv = I_uv · exp(−|C_u − C_v| / τ) · β_hl,   I_uv = (q_uv + q_vu) / L_uv   (chỉ số ghép nối, pcu/h/m)
 * β_hl = 1.5 nếu u, v liền kề trên cùng hành lang. Louvain tối đa modularity có tham số độ phân giải γ,
 * sau đó chia nhỏ vùng quá lớn (γ tăng dần) và gộp vùng quá nhỏ vào vùng lân cận ghép nối mạnh nhất. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const Z = TS.zoning = {};

  const normRoad = (s) => U.normKey(s || '');

  /* ── Nhận diện hành lang theo tên đường + tính liên tục hướng ── */
  Z.detectCorridors = function (net, opts) {
    const o = Object.assign({ maxTurn: 38, minNodes: 3, maxNodes: 30 }, opts || {});
    const { links } = net;
    const succ = new Array(links.length).fill(-1), hasPred = new Uint8Array(links.length);
    for (const a of links) {
      const ra = normRoad(a.road);
      let best = -1, bd = 1e9;
      for (const j of net.outL[a.v]) {
        const b = links[j];
        if (b.v === a.u) continue;
        const d = U.angleDiff(a.brg, b.brgStart);
        const same = ra && normRoad(b.road) === ra;
        const lim = same ? o.maxTurn : (ra ? -1 : 18);
        if (d <= lim && d < bd) { bd = d; best = j; }
      }
      if (best >= 0) {
        // chỉ nhận nếu a cũng là tiền nhiệm "thẳng nhất" của best (tránh rẽ nhánh chữ Y)
        succ[a.idx] = best;
      }
    }
    const predCount = new Int32Array(links.length);
    for (let i = 0; i < links.length; i++) if (succ[i] >= 0) predCount[succ[i]]++;
    for (let i = 0; i < links.length; i++) if (succ[i] >= 0 && predCount[succ[i]] > 1) {
      // nhiều tiền nhiệm: giữ cái thẳng nhất
      const j = succ[i];
      let bi = -1, bd = 1e9;
      for (let k = 0; k < links.length; k++) if (succ[k] === j) { const d = U.angleDiff(links[k].brg, links[j].brgStart); if (d < bd) { bd = d; bi = k; } }
      for (let k = 0; k < links.length; k++) if (succ[k] === j && k !== bi) succ[k] = -1;
    }
    for (let i = 0; i < links.length; i++) if (succ[i] >= 0) hasPred[succ[i]] = 1;
    const chains = [], used = new Uint8Array(links.length);
    const walk = (s) => {
      const seq = [links[s].u]; let i = s; const seen = new Set([links[s].u]);
      while (i >= 0 && !used[i]) {
        used[i] = 1;
        if (seen.has(links[i].v)) break;
        seq.push(links[i].v); seen.add(links[i].v);
        i = succ[i];
      }
      return seq;
    };
    for (let i = 0; i < links.length; i++) if (!hasPred[i] && !used[i]) chains.push(walk(i));
    for (let i = 0; i < links.length; i++) if (!used[i]) chains.push(walk(i)); // vòng khép kín
    // bỏ chiều trùng: giữ một chiều cho mỗi cặp hành lang hai chiều
    const out = [], seenKey = new Set();
    for (const seq0 of chains) {
      const seq = seq0.filter(n => net.nodes[n].signalized || n === seq0[0] || n === seq0[seq0.length - 1]);
      if (seq0.length < o.minNodes) continue;
      const a = seq0[0], b = seq0[seq0.length - 1];
      const road = links[net.outL[seq0[0]].find(j => links[j].v === seq0[1])].road || '';
      const key = [Math.min(a, b), Math.max(a, b), normRoad(road)].join('|');
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      void seq;
      for (let s = 0; s < seq0.length; s += o.maxNodes - 1) {
        const part = seq0.slice(s, s + o.maxNodes);
        if (part.length >= o.minNodes) out.push({ seq: part, road });
      }
    }
    // xếp hạng theo lưu lượng trung bình
    for (const c of out) {
      const qs = [];
      for (let k = 0; k + 1 < c.seq.length; k++) {
        const f = net.outL[c.seq[k]].find(j => links[j].v === c.seq[k + 1]);
        const r = net.outL[c.seq[k + 1]].find(j => links[j].v === c.seq[k]);
        qs.push(links[f].q + (r !== undefined ? links[r].q : 0));
      }
      c.qMean = U.mean(qs);
    }
    out.sort((a, b) => b.qMean - a.qMean);
    return out;
  };

  /* ── Chỉ số khả thi sóng xanh GWS ∈ [0,100] ── */
  Z.gws = function (net, corr, planFn, C) {
    const P = net.P, { links } = net, n = corr.seq.length;
    // Φ_dist: độ đồng điều khoảng cách T ≈ k·C/2
    let ed = 0, wq = 0;
    for (let k = 0; k + 1 < n; k++) {
      const f = links[corr.out[k]], r = corr.inn[k] >= 0 ? links[corr.inn[k]] : null;
      const T = r ? (f.T + r.T) / 2 : f.T;
      const ratio = T / (C / 2);
      const e = Math.abs(ratio - Math.round(ratio));
      const w = f.q + (r ? r.q : 0);
      ed += e * w; wq += w;
    }
    const phiDist = corr.twoWay ? 100 * (1 - 2 * (wq > 0 ? ed / wq : 0)) : 100;
    // Φ_turn: tỷ lệ dòng xuyên suốt dọc trục
    const thr = [];
    const through = (a, b) => {
      const la = links[a], lb = links[b];
      const t = la.turn.find(x => x.j === b);
      if (!t || lb.q <= 0) return 0;
      return U.clamp(t.p * la.q * (1 - la.exitFrac) / lb.q, 0, 1);
    };
    for (let k = 1; k + 1 < n; k++) {
      thr.push(through(corr.out[k - 1], corr.out[k]));
      if (corr.twoWay) thr.push(through(corr.inn[k], corr.inn[k - 1]));
    }
    const phiTurn = thr.length ? 100 * U.mean(thr) : 100;
    // Φ_cap: đồng nhất năng lực (xanh trục) & không có nút cổ chai
    const gs = [], xs = [];
    for (let k = 0; k < n; k++) {
      const ni = corr.seq[k], pl = planFn(ni);
      if (!pl) continue;
      const Cn = M.cycleOf(pl);
      gs.push(M.effGreen(pl, corr.phOut[k], P) / Cn);
      if (k > 0) { const l = links[corr.out[k - 1]]; xs.push(l.q / Math.max(1, l.S * M.effGreen(pl, l.phases, P) / Cn)); }
    }
    const gmin = Math.min(...gs), gmax = Math.max(...gs);
    const fracOk = xs.length ? xs.filter(x => x <= 0.9).length / xs.length : 1;
    const phiCap = 100 * (0.5 * (gmax > 0 ? gmin / gmax : 0) + 0.5 * fracOk);
    // Φ_geom: chiều dài đoạn phù hợp duy trì đoàn xe
    const lsc = [];
    for (let k = 0; k + 1 < n; k++) {
      const L = links[corr.out[k]].len;
      let s = 1;
      if (L < 120) s = U.clamp((L - 40) / 80, 0, 1);
      else if (L > 800) s = U.clamp(1 - (L - 800) / 700, 0, 1);
      lsc.push(s);
    }
    const phiGeom = 100 * U.mean(lsc);
    const gws = 0.35 * phiDist + 0.30 * phiTurn + 0.20 * phiCap + 0.15 * phiGeom;
    let cls;
    if (gws >= P.gwsTwoWay && corr.twoWay) cls = 'two';
    else if (gws >= P.gwsOneWay) cls = 'one';
    else cls = 'none';
    return { gws, phiDist, phiTurn, phiCap, phiGeom, cls, xmax: xs.length ? Math.max(...xs) : 0 };
  };

  /* ── Louvain ─────────────────────────────────────────── */
  function louvain(nodesList, adj, gamma, seed) {
    // adj: Map<node, Map<node, w>> (vô hướng, đối xứng)
    const rnd = U.rng(seed || 1);
    let comm = new Map(nodesList.map(n => [n, n]));
    let graph = { nodes: nodesList.slice(), adj };
    const membership = new Map(nodesList.map(n => [n, n]));
    for (let level = 0; level < 10; level++) {
      const { nodes, adj: A } = graph;
      const k = new Map(); let m2 = 0;
      for (const u of nodes) { let s = 0; const a = A.get(u); if (a) for (const [, w] of a) s += w; k.set(u, s); m2 += s; }
      if (m2 <= 0) break;
      const c = new Map(nodes.map(u => [u, u]));
      const tot = new Map(nodes.map(u => [u, k.get(u)]));
      let moved = true, anyMove = false, it = 0;
      const order = nodes.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      while (moved && it++ < 30) {
        moved = false;
        for (const u of order) {
          const cu = c.get(u), ku = k.get(u);
          const wTo = new Map();
          const a = A.get(u);
          if (a) for (const [v, w] of a) { if (v === u) continue; const cv = c.get(v); wTo.set(cv, (wTo.get(cv) || 0) + w); }
          tot.set(cu, tot.get(cu) - ku);
          let best = cu, bestGain = (wTo.get(cu) || 0) - gamma * tot.get(cu) * ku / m2;
          for (const [cv, w] of wTo) {
            const gain = w - gamma * tot.get(cv) * ku / m2;
            if (gain > bestGain + 1e-12) { bestGain = gain; best = cv; }
          }
          tot.set(best, tot.get(best) + ku);
          if (best !== cu) { c.set(u, best); moved = true; anyMove = true; }
        }
      }
      if (!anyMove) break;
      for (const [orig, sup] of membership) membership.set(orig, c.get(sup));
      // gộp
      const nn = [...new Set(c.values())];
      const nA = new Map(nn.map(x => [x, new Map()]));
      for (const u of nodes) {
        const a = A.get(u); if (!a) continue;
        const cu = c.get(u);
        for (const [v, w] of a) {
          const cv = c.get(v);
          const row = nA.get(cu);
          row.set(cv, (row.get(cv) || 0) + w);
        }
      }
      graph = { nodes: nn, adj: nA };
    }
    comm = membership;
    return comm;
  }

  /* Phân vùng toàn mạng. cnat[n] = chu kỳ tự nhiên (Webster) của từng nút. corridors: danh sách seq. */
  Z.partition = function (net, cnat, corridors, opts) {
    const P = net.P;
    const o = Object.assign({ gamma: P.zoneResolution, maxSize: P.maxZoneSize, minSize: P.minZoneSize, seed: 11 }, opts || {});
    const sig = [];
    for (let n = 0; n < net.N; n++) if (net.nodes[n].signalized && net.inL[n].length) sig.push(n);
    const corrPair = new Set();
    for (const c of corridors || []) for (let k = 0; k + 1 < c.seq.length; k++) corrPair.add(Math.min(c.seq[k], c.seq[k + 1]) + '-' + Math.max(c.seq[k], c.seq[k + 1]));
    const adj = new Map(sig.map(n => [n, new Map()]));
    const coup = new Map(); // chỉ số ghép nối thô, để quyết định nút độc lập
    const addW = (a, b, w) => { adj.get(a).set(b, (adj.get(a).get(b) || 0) + w); };
    const seenPair = new Map();
    for (const l of net.links) {
      if (!adj.has(l.u) || !adj.has(l.v)) continue;
      const a = Math.min(l.u, l.v), b = Math.max(l.u, l.v), key = a + '-' + b;
      const e = seenPair.get(key) || { q: 0, L: l.len };
      e.q += l.q; e.L = Math.min(e.L, l.len);
      seenPair.set(key, e);
    }
    for (const [key, e] of seenPair) {
      const [a, b] = key.split('-').map(Number);
      if (e.L > P.maxCouplingDist) continue;
      const I = e.q / Math.max(50, e.L);
      coup.set(key, I);
      let w = I * Math.exp(-Math.abs((cnat[a] || 90) - (cnat[b] || 90)) / P.zoneCycleTol);
      if (corrPair.has(key)) w *= 1.5;
      addW(a, b, w); addW(b, a, w);
    }
    let memb = louvain(sig, adj, o.gamma, o.seed);
    // gom nhóm
    const groups = () => { const g = new Map(); for (const [n, c] of memb) { if (!g.has(c)) g.set(c, []); g.get(c).push(n); } return g; };
    // chia vùng quá lớn
    for (let pass = 0; pass < 4; pass++) {
      let split = false;
      for (const [cid, mem] of groups()) {
        if (mem.length <= o.maxSize) continue;
        const set = new Set(mem);
        const sub = new Map(mem.map(n => [n, new Map([...adj.get(n)].filter(([v]) => set.has(v)))]));
        const sm = louvain(mem, sub, o.gamma * (1.6 + pass * 0.6), o.seed + pass + 1);
        const labels = new Set(sm.values());
        if (labels.size <= 1) {
          // chia đôi theo toạ độ nếu Louvain không tách được
          const axis = (() => { const xs = mem.map(n => net.nodes[n].lon), ys = mem.map(n => net.nodes[n].lat); return (Math.max(...xs) - Math.min(...xs)) > (Math.max(...ys) - Math.min(...ys)) ? 'lon' : 'lat'; })();
          const sorted = mem.slice().sort((a, b) => net.nodes[a][axis] - net.nodes[b][axis]);
          sorted.forEach((n, i) => memb.set(n, i < sorted.length / 2 ? cid : 'x' + cid + '_' + pass));
        } else for (const [n, lab] of sm) memb.set(n, 's' + cid + '_' + pass + '_' + lab);
        split = true;
      }
      if (!split) break;
    }
    // gộp vùng quá nhỏ vào vùng lân cận mạnh nhất (nếu ghép nối đủ)
    for (let pass = 0; pass < 3; pass++) {
      const g = groups();
      for (const [cid, mem] of g) {
        if (mem.length >= o.minSize) continue;
        const toW = new Map();
        for (const n of mem) for (const [v, w] of adj.get(n)) {
          const cv = memb.get(v); if (cv === cid) continue;
          const key = Math.min(n, v) + '-' + Math.max(n, v);
          if ((coup.get(key) || 0) < P.couplingLow) continue;
          toW.set(cv, (toW.get(cv) || 0) + w);
        }
        let best = null, bw = 0;
        for (const [cv, w] of toW) { const size = (groups().get(cv) || []).length; if (w > bw && size + mem.length <= o.maxSize) { bw = w; best = cv; } }
        if (best !== null) for (const n of mem) memb.set(n, best);
      }
    }
    // đánh số vùng: vùng ≥ minSize → Z01..; còn lại → độc lập
    const g = groups();
    const zonesList = [...g.values()].sort((a, b) => b.length - a.length);
    const zoneOf = new Int32Array(net.N).fill(-1);
    const zones = [];
    for (const mem of zonesList) {
      const isolated = mem.length < o.minSize && mem.length <= 2 && !mem.some(n => [...adj.get(n)].some(([v]) => (coup.get(Math.min(n, v) + '-' + Math.max(n, v)) || 0) >= P.couplingHigh));
      const id = zones.length;
      zones.push({ id, nodes: mem.sort((a, b) => a - b), isolated });
      for (const n of mem) zoneOf[n] = id;
    }
    return { zones, zoneOf, coupling: coup };
  };

  /* Cắt hành lang theo biên vùng → các đoạn nằm gọn trong một vùng (cần chung chu kỳ). */
  Z.splitByZone = function (corridors, zoneOf, minNodes) {
    const out = [];
    for (const c of corridors) {
      let cur = [c.seq[0]];
      for (let k = 1; k < c.seq.length; k++) {
        if (zoneOf[c.seq[k]] === zoneOf[cur[0]] && zoneOf[c.seq[k]] >= 0) cur.push(c.seq[k]);
        else { if (cur.length >= (minNodes || 3)) out.push({ seq: cur, road: c.road, zone: zoneOf[cur[0]], qMean: c.qMean, user: c.user }); cur = [c.seq[k]]; }
      }
      if (cur.length >= (minNodes || 3)) out.push({ seq: cur, road: c.road, zone: zoneOf[cur[0]], qMean: c.qMean, user: c.user });
    }
    return out;
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
