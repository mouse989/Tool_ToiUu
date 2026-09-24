/* Bộ điều phối tối ưu toàn mạng (pipeline) và bộ khuyến nghị phương án vận hành.
 *
 *  B1  Phân tích hiện trạng (HCM) + đánh giá TRANSYT kịch bản hiện trạng.
 *  B2  Chu kỳ tự nhiên từng nút (Webster) + split cân bằng bão hoà.
 *  B3  Nhận diện hành lang (tên đường + liên tục hướng).
 *  B4  Phân vùng Louvain theo chỉ số ghép nối & chu kỳ tự nhiên.
 *  B5  Mỗi vùng: quét chu kỳ chung C (đường cong PI(C)), nút nhỏ chạy C/2 (double cycling).
 *  B6  Hành lang trong vùng: chấm GWS → MAXBAND (2 chiều / 1 chiều ưu tiên cao điểm) + vận tốc khuyến nghị.
 *  B7  TRANSYT leo đồi offset (khoá nhóm sóng xanh, dịch cả nhóm) + tinh chỉnh split ±2 s.
 *  B8  Nút độc lập: Webster; đề xuất xe kích hoạt / Max Pressure.
 *  B9  Đánh giá lại + (tuỳ chọn) kiểm chứng CTM cố định vs thích ứng → khuyến nghị phương án. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model, SG = TS.signal, PR = TS.profile, MB = TS.maxband, Z = TS.zoning, SIM = TS.ctm;
  const O = TS.optimizer = {};

  O.DEFAULTS = {
    cycleScanStep: 4, halfCycle: true, splitTuning: true, maxSweeps: 6,
    speedFactors: [0.9, 0.95, 1, 1.05, 1.1], verifyCTM: true, ctmDt: 2, ctmWarmup: 600, ctmDuration: 1800,
    pedWaitPenalty: 0.04, // phạt chu kỳ dài (s trễ/pcu cho mỗi giây C vượt 90 s) — bảo vệ người đi bộ
  };

  const tick = () => U.sleep(0);

  /* Offset khởi tạo theo cây khung trọng số lưu lượng lớn nhất (sóng xanh dọc các nhánh mạnh). */
  function treeOffsets(net, zoneNodes, planOf) {
    const inZ = new Set(zoneNodes), P = net.P;
    const seen = new Set();
    let root = zoneNodes[0], bq = -1;
    for (const n of zoneNodes) { const q = U.sum(net.inL[n], i => net.links[i].q); if (q > bq) { bq = q; root = n; } }
    const firstStart = (pl, phs) => { const w = M.effWindows(pl, phs.filter(k => k < pl.phases.length), P); return w.length ? w[0][0] : 0; };
    const setFrom = (u, l) => {
      const pu = planOf(u), pv = planOf(l.v);
      // pha tại u cấp dòng cho l: pha của nhánh vào u thẳng hàng nhất với l
      let feed = null, bd = 1e9;
      for (const i of net.inL[u]) { const d = U.angleDiff(net.links[i].brg, l.brgStart); if (d < bd) { bd = d; feed = net.links[i].phases; } }
      const depart = pu.offset + firstStart(pu, feed || [0]);
      pv.offset = Math.round(U.mod(depart + l.T - firstStart(pv, l.phases), M.cycleOf(pv))) % M.cycleOf(pv);
    };
    const heapPush = (h, x) => { h.push(x); h.sort((a, b) => b[0] - a[0]); };
    for (const start of [root, ...zoneNodes]) {
      if (seen.has(start)) continue;
      seen.add(start);
      const h = [];
      const pushOut = (u) => { for (const j of net.outL[u]) { const l = net.links[j]; if (inZ.has(l.v) && !seen.has(l.v)) heapPush(h, [l.q, j]); } };
      pushOut(start);
      while (h.length) {
        const [, j] = h.shift();
        const l = net.links[j];
        if (seen.has(l.v)) continue;
        seen.add(l.v);
        setFrom(l.u, l);
        pushOut(l.v);
      }
    }
  }

  /* Leo đồi kiểu TRANSYT trên tập nhóm nút (mỗi nhóm dịch offset cùng nhau). */
  async function hillClimb(ev, groups, work, opts, splitNodes) {
    const P = ev.net.P;
    let totalGain = 0;
    const rnd = U.rng(5);
    for (let sweep = 0; sweep < opts.maxSweeps; sweep++) {
      let improved = 0;
      const order = groups.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const g of order) {
        const aff = g.aff || (g.aff = ev.affected(g.nodes));
        const C = M.cycleOf(work[g.nodes[0]]);
        const steps = [...new Set([Math.round(C / 4), Math.round(C / 8), 5, 2, 1].filter(x => x > 0))];
        const base = ev.localPI(aff.all);
        let bestD = 0, bestV = base;
        const shift = (d) => { for (const n of g.nodes) { const pl = work[n]; pl.offset = U.mod(pl.offset + d, M.cycleOf(pl)); } ev.recomputeLocal(g.nodes, aff); };
        for (const s of steps) for (const d of [s, -s]) {
          shift(d);
          const v = ev.localPI(aff.all);
          if (v < bestV - 1e-9) { bestV = v; bestD = d; }
          shift(-d);
        }
        if (bestD) { shift(bestD); improved++; totalGain += base - bestV; }
      }
      // tinh chỉnh split ±2 s cho nút không khoá sóng xanh
      if (opts.splitTuning && splitNodes) {
        for (const n of splitNodes) {
          const pl = work[n], np = pl.phases.length;
          if (np < 2) continue;
          const aff = ev.affected([n]);
          const base = ev.localPI(aff.all);
          let best = null, bv = base;
          for (let a = 0; a < np; a++) for (let b = 0; b < np; b++) {
            if (a === b) continue;
            const pb = pl.phases[b];
            if (pb.g - 2 < (pb.minG || P.minGreen)) continue;
            pl.phases[a].g += 2; pb.g -= 2; ev.recomputeLocal([n], aff);
            const v = ev.localPI(aff.all);
            if (v < bv - 1e-9) { bv = v; best = [a, b]; }
            pl.phases[a].g -= 2; pb.g += 2; ev.recomputeLocal([n], aff);
          }
          if (best) { pl.phases[best[0]].g += 2; pl.phases[best[1]].g -= 2; ev.recomputeLocal([n], aff); improved++; totalGain += base - bv; }
        }
      }
      ev.fullEval(1);
      await tick();
      if (!improved) break;
    }
    return totalGain;
  }

  /* Chạy toàn bộ pipeline cho một khung giờ. progress(msg, frac). */
  O.run = async function (project, band, userOpts, progress) {
    const opts = Object.assign({}, O.DEFAULTS, userOpts || {});
    const report = (m, f) => { if (progress) progress(m, f); };
    const t0 = Date.now();
    const net = M.buildNet(project, band);
    const P = net.P;
    const N = net.N;
    report('Đánh giá hiện trạng', 0.02); await tick();
    const hcmBase = SG.analyzeNetwork(net, 'base');
    const evBase = PR.evaluateScenario(net, 'base');
    const baseTot = evBase.tot;
    const baseLinks = net.links.map((_, i) => evBase.ev.linkResult(i));

    // B2 Webster từng nút
    report('Chu kỳ tự nhiên Webster từng nút', 0.06); await tick();
    const work = new Array(N).fill(null), cnat = new Array(N).fill(0), cx = new Array(N).fill(0), nodeInfo = new Array(N).fill(null);
    for (let n = 0; n < N; n++) {
      const node = net.nodes[n];
      if (!node.signalized || !net.inL[n].length) continue;
      const r = SG.optimizeNode(net, n, node.plans[band]);
      work[n] = r.plan; work[n].offset = 0;
      cnat[n] = r.C; cx[n] = SG.roundCycle(r.Cx, P);
      nodeInfo[n] = { Y: r.Y, L: r.L, C0: r.C0, Cx: r.Cx, oversat: r.oversat };
    }
    const planOf = (n) => work[n];

    // B3 hành lang
    report('Nhận diện hành lang', 0.1); await tick();
    let corridors = Z.detectCorridors(net);
    const userSeqs = [];
    for (const uc of project.corridors || []) {
      const seq = (uc.nodes || []).map(id => net.nodeIdx.get(String(id))).filter(x => x !== undefined);
      if (seq.length >= 2) userSeqs.push({ seq, road: uc.name || 'Hành lang người dùng', user: true, qMean: 1e9 });
    }
    if (userSeqs.length) {
      // bỏ hành lang tự nhận diện trùng ≥ 60% nút với hành lang người dùng khai báo
      const sets = userSeqs.map(u => new Set(u.seq));
      corridors = corridors.filter(c => !sets.some(s => c.seq.filter(n => s.has(n)).length >= 0.6 * c.seq.length));
      corridors = userSeqs.concat(corridors);
    }

    // B4 phân vùng
    report('Phân vùng Louvain', 0.14); await tick();
    const part = Z.partition(net, cnat, corridors);
    const zoneOf = part.zoneOf;
    const segs = Z.splitByZone(corridors, zoneOf, 3).filter(sg => (sg.user || sg.qMean >= P.gwMinFlow) && sg.seq.every(n => work[n]));

    const ev = PR.create(net, planOf);
    ev.fullEval(3);

    const S_round = (C) => Math.ceil(C / opts.cycleScanStep) * opts.cycleScanStep;
    const corrNodes = new Set(segs.flatMap(s => s.seq));
    const zonesOut = [], corrOut = [];
    const lockedGroupOf = new Int32Array(N).fill(-1);
    const nz = part.zones.length;
    for (let zi = 0; zi < nz; zi++) {
      const z = part.zones[zi];
      const zn = z.nodes.filter(n => work[n]);
      const zres = { id: zi, nodes: zn, isolated: z.isolated || zn.length < 2 };
      if (!zn.length) continue;
      report(`Vùng ${zi + 1}/${nz}: quét chu kỳ`, 0.16 + 0.7 * zi / nz);
      if (zres.isolated) {
        zres.C = Math.max(...zn.map(n => M.cycleOf(work[n])));
        zonesOut.push(zres);
        continue;
      }
      // B5 quét chu kỳ
      const linkSet = [...new Set(zn.flatMap(n => [...net.inL[n], ...net.outL[n]]))];
      const cxs = zn.map(n => cx[n]).sort((a, b) => a - b);
      const Clo = S_round(Math.max(P.Cmin, cxs[Math.floor(cxs.length / 2)]));
      const curve = [];
      const setCycle = (C) => {
        for (const n of zn) {
          const node = net.nodes[n];
          let half = opts.halfCycle && C / 2 >= P.Cmin && cx[n] <= C / 2 && cnat[n] <= C / 2 + 6 && !corrNodes.has(n);
          let r = SG.optimizeNode(net, n, node.plans[band], half ? C / 2 : C);
          if (half && r.C !== C / 2) { half = false; r = SG.optimizeNode(net, n, node.plans[band], C); }
          work[n] = r.plan; work[n].half = half || undefined; work[n].offset = 0;
        }
        treeOffsets(net, zn, planOf);
      };
      let bestC = null, bestPI = Infinity;
      for (let C = Math.min(Clo, P.Cmax); C <= P.Cmax; C += opts.cycleScanStep) {
        setCycle(C);
        ev.reinit(zn);
        const pi = ev.evalLinks(linkSet, 3);
        let q = 0, d = 0, h = 0;
        for (const i of linkSet) { const s = ev.st[i]; q += net.links[i].q; d += s.d * net.links[i].q; h += s.h * net.links[i].q; }
        const penal = opts.pedWaitPenalty * Math.max(0, C - 90) * q / 3600;
        curve.push({ C, PI: pi, delay: q ? d / q : 0, stops: q ? h / q : 0 });
        if (pi + penal < bestPI) { bestPI = pi + penal; bestC = C; }
      }
      zres.curve = curve;
      zres.C = bestC;
      setCycle(bestC);
      ev.reinit(zn);
      ev.evalLinks(linkSet, 3);
      zres.nHalf = zn.filter(n => work[n].half).length;
      await tick();

      // B6 hành lang sóng xanh trong vùng
      report(`Vùng ${zi + 1}/${nz}: sóng xanh MAXBAND`, 0.16 + 0.7 * (zi + 0.4) / nz);
      const groups = [];
      const zsegs = segs.filter(s => s.zone === zi);
      const fixedNodes = new Set();
      for (const sg of zsegs) {
        const corr = MB.buildCorridor(net, sg.seq);
        if (!corr) continue;
        const g = Z.gws(net, corr, planOf, bestC);
        const qOut = U.sum(corr.out, i => net.links[i].q), qIn = corr.twoWay ? U.sum(corr.inn, i => net.links[i].q) : 0;
        const co = { zone: zi, road: sg.road, seq: sg.seq, ids: sg.seq.map(n => net.nodes[n].id), len: corr.len, twoWay: corr.twoWay, gws: g, qOut, qIn, C: bestC };
        // dải sóng xanh hiện trạng (chỉ có nghĩa khi các nút đang chạy chung chu kỳ)
        const baseCs = new Set(sg.seq.map(n => M.cycleOf(net.nodes[n].plans[band])));
        if (baseCs.size === 1) {
          const Cb = [...baseCs][0];
          const before = MB.evaluate(net, corr, (n) => net.nodes[n].plans[band], Cb);
          co.before = { bOut: before.bOut, bIn: before.bIn, C: Cb };
        } else co.before = { bOut: 0, bIn: 0, C: null, mixed: true };
        if (g.cls !== 'none') {
          let wOut = 1, wIn = 1;
          if (g.cls === 'two') { const k = qOut > 0 ? U.clamp(qIn / qOut, 0.4, 2.5) : 1; wIn = k; }
          else { if (qIn > qOut) { wOut = 0.15; wIn = 1; co.priority = 'in'; } else { wOut = 1; wIn = 0.15; co.priority = 'out'; } }
          const locked = sg.seq.map(n => fixedNodes.has(n));
          const r = MB.optimize(net, corr, planOf, bestC, { wOut, wIn, speedFactors: opts.speedFactors, locked: locked.some(x => x) ? locked : null });
          sg.seq.forEach((n, k) => { work[n].offset = r.offsets[k]; fixedNodes.add(n); });
          co.after = { bOut: r.bands.bOut, bIn: r.bands.bIn, bOutStart: r.bands.bOutStart, bInStart: r.bands.bInStart };
          co.vf = r.vf; co.vAdvice = Math.round(U.mean(corr.out, i => net.links[i].vkmh) * r.vf);
          co.effOut = r.bands.bOut / bestC; co.effIn = r.bands.bIn / bestC;
        } else {
          const cur = MB.evaluate(net, corr, planOf, bestC);
          co.after = { bOut: cur.bOut, bIn: cur.bIn };
        }
        corrOut.push(co);
      }
      // nhóm khoá: các nút sóng xanh liên thông dịch cùng nhau
      const gid = new Map();
      const seqs = corrOut.filter(c => c.zone === zi && c.gws.cls !== 'none').map(c => c.seq);
      const parent = new Map();
      const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      for (const s of seqs) for (const n of s) if (!parent.has(n)) parent.set(n, n);
      for (const s of seqs) for (let k = 1; k < s.length; k++) { const a = find(s[0]), b = find(s[k]); if (a !== b) parent.set(b, a); }
      for (const n of zn) {
        if (parent.has(n)) { const r = find(n); if (!gid.has(r)) { gid.set(r, groups.length); groups.push({ nodes: [] }); } groups[gid.get(r)].nodes.push(n); lockedGroupOf[n] = gid.get(r); }
        else groups.push({ nodes: [n] });
      }
      ev.reinit(zn);
      ev.evalLinks(linkSet, 3);
      const piBeforeHC = ev.localPI(linkSet);
      // B7 TRANSYT
      report(`Vùng ${zi + 1}/${nz}: TRANSYT leo đồi offset`, 0.16 + 0.7 * (zi + 0.7) / nz);
      const splitNodes = zn.filter(n => !fixedNodes.has(n));
      await hillClimb(ev, groups, work, opts, splitNodes);
      ev.evalLinks(linkSet, 2);
      zres.piAfterHC = ev.localPI(linkSet);
      zres.piBeforeHC = piBeforeHC;
      zres.greenWaveNodes = fixedNodes.size;
      zonesOut.push(zres);
      await tick();
    }

    // B8 kết quả, ghi plan tối ưu vào dự án
    report('Tổng hợp & đánh giá phương án', 0.88); await tick();
    for (let n = 0; n < N; n++) {
      if (!work[n]) continue;
      const pl = work[n];
      pl.offset = Math.round(U.mod(pl.offset, M.cycleOf(pl))) % M.cycleOf(pl);
      net.nodes[n].opt[band] = pl;
    }
    let evOpt = PR.evaluateScenario(net, 'opt');
    let optLinks = net.links.map((_, i) => evOpt.ev.linkResult(i));
    const aggZ = (z, arr) => { const ls = [...new Set(z.nodes.flatMap(n => net.inL[n]))]; let q = 0, d = 0, h = 0, pi = 0, sp = 0; for (const i of ls) { const l = net.links[i]; q += l.q; d += arr[i].d * l.q; h += arr[i].h * l.q; pi += arr[i].PI; if (arr[i].occ >= P.spillThreshold) sp++; } return { q, delay: q ? d / q : 0, stops: q ? h / q : 0, PI: pi, spill: sp }; };
    // không đề xuất phương án kém hơn hiện trạng: vùng nào PI đề xuất > PI hiện trạng thì giữ giản đồ hiện trạng
    let reverted = 0;
    for (const z of zonesOut) {
      if (aggZ(z, optLinks).PI > aggZ(z, baseLinks).PI * 1.001) {
        for (const n of z.nodes) { net.nodes[n].opt[band] = U.deepClone(net.nodes[n].plans[band]); }
        z.keptBase = true; z.nHalf = 0; z.C = Math.max(...z.nodes.map(n => M.cycleOf(net.nodes[n].plans[band]))); reverted++;
      }
    }
    if (reverted) { evOpt = PR.evaluateScenario(net, 'opt'); optLinks = net.links.map((_, i) => evOpt.ev.linkResult(i)); }
    const optTot = evOpt.tot;
    const hcmOpt = SG.analyzeNetwork(net, 'opt');

    // chỉ tiêu theo vùng
    for (const z of zonesOut) {
      const ls = [...new Set(z.nodes.flatMap(n => net.inL[n]))];
      z.base = aggZ(z, baseLinks); z.opt = aggZ(z, optLinks);
      const xs = ls.map(i => optLinks[i].x);
      z.xmax = xs.length ? Math.max(...xs) : 0;
      // biến động nhu cầu giữa các khung giờ
      const qb = project.bands.map(b => U.sum(ls, i => U.num(net.links[i].ref.data[b.id] && net.links[i].ref.data[b.id].q, 0))).filter(x => x > 0);
      const mq = U.mean(qb);
      z.demandCV = mq > 0 ? Math.sqrt(U.mean(qb, x => (x - mq) ** 2)) / mq : 0;
    }

    // B9 kiểm chứng CTM (tuỳ chọn): cố định tối ưu vs thích ứng cho vùng ứng viên
    const cand = [];
    for (const z of zonesOut) {
      const reasons = [];
      if (z.isolated) reasons.push('nút độc lập, ghép nối yếu với lân cận');
      if (z.xmax > 0.95) reasons.push(`có nhánh quá bão hoà (x = ${z.xmax.toFixed(2)})`);
      if (!z.isolated && z.piBeforeHC > 0 && (z.piBeforeHC - z.piAfterHC) / z.piBeforeHC < 0.03 && !z.greenWaveNodes) reasons.push('lợi ích phối hợp offset thấp (< 3% PI)');
      z.adaptiveReasons = reasons;
      if (reasons.length) cand.push(z);
    }
    let ctm = null;
    if (opts.verifyCTM) {
      report('Kiểm chứng CTM: phương án cố định tối ưu', 0.9); await tick();
      const cfg = { scenario: 'opt', dt: opts.ctmDt, warmup: opts.ctmWarmup, duration: opts.ctmDuration };
      const rFixed = SIM.runBatch(net, Object.assign({ mode: 'fixed' }, cfg)).res;
      let rAd = null;
      if (cand.length) {
        report('Kiểm chứng CTM: thích ứng Max Pressure tại vùng ứng viên', 0.95); await tick();
        const modes = {};
        for (const z of cand) for (const n of z.nodes) modes[n] = z.isolated ? 'mp' : 'cmp';
        rAd = SIM.runBatch(net, Object.assign({ mode: 'fixed', modes }, cfg)).res;
        // so sánh theo vùng trên chỉ tiêu trễ liên kết
        for (const z of cand) {
          const ls = [...new Set(z.nodes.flatMap(n => net.inL[n]))];
          const dF = U.sum(ls, i => rFixed.perLink[i].delay), dA = U.sum(ls, i => rAd.perLink[i].delay);
          z.ctmFixedDelayH = dF / 3600; z.ctmAdaptDelayH = dA / 3600;
          z.adaptiveGain = dF > 0 ? (dF - dA) / dF : 0;
        }
      }
      const strip = (r) => { if (!r) return null; const c = Object.assign({}, r); delete c.perLink; return c; };
      ctm = { fixed: strip(rFixed), adaptive: strip(rAd) };
    }

    // khuyến nghị
    const recs = O.recommend(net, zonesOut, corrOut, opts);
    for (const z of zonesOut) {
      z.ids = z.nodes.map(n => net.nodes[n].id);
      z.strategy = (recs.find(r => r.kind === 'zone' && r.zone === z.id) || {}).strategy;
      delete z.nodes;
    }
    const res = {
      band, time: new Date().toISOString(), ms: Date.now() - t0,
      base: baseTot, opt: optTot, hcmBase: hcmBase.avgDelay, hcmOpt: hcmOpt.avgDelay,
      zones: zonesOut, corridors: corrOut.map(c => Object.assign({}, c, { seq: undefined })),
      zoneOf: Array.from(zoneOf).map(z => z), nodeIds: net.nodes.map(n => n.id), ctm, recs,
      nodeInfo: nodeInfo.map((x, n) => x && { id: net.nodes[n].id, Cnat: cnat[n], Cx: cx[n], oversat: x.oversat }),
      baseLinks: baseLinks.map(r => ({ d: r.d, x: r.x, occ: r.occ })), optLinks: optLinks.map(r => ({ d: r.d, x: r.x, occ: r.occ })),
    };
    project.results = project.results || {};
    project.results[band] = res;
    report('Hoàn tất', 1);
    return res;
  };

  /* Bộ luật khuyến nghị phương án vận hành. */
  O.recommend = function (net, zones, corrs, opts) {
    const recs = [];
    const name = (n) => net.nodes[n].name;
    for (const z of zones) {
      const zc = corrs.filter(c => c.zone === z.id);
      const two = zc.filter(c => c.gws.cls === 'two'), one = zc.filter(c => c.gws.cls === 'one');
      let strategy, text;
      const dImp = z.base && z.base.delay > 0 ? (z.base.delay - z.opt.delay) / z.base.delay : 0;
      const adaptOk = z.adaptiveGain !== undefined ? z.adaptiveGain > 0.05 : null;
      const keep = z.keptBase ? ' Giản đồ cố định: GIỮ HIỆN TRẠNG (phương án tính lại không tốt hơn trên mô hình).' : '';
      if (z.isolated) {
        strategy = adaptOk === false ? 'isolated-fixed' : 'isolated-adaptive';
        text = adaptOk === false
          ? `Nút độc lập: chạy cố định theo Webster (C = ${z.C}s) theo từng khung giờ; thích ứng không cải thiện đáng kể trên mô phỏng.`
          : `Nút độc lập: đề xuất điều khiển THÍCH ỨNG (xe kích hoạt / Max Pressure) — ${z.adaptiveReasons.join('; ')}.` + (z.adaptiveGain !== undefined ? ` CTM: giảm trễ ${(z.adaptiveGain * 100).toFixed(0)}%.` : '');
      } else if (adaptOk) {
        strategy = 'coord-adaptive';
        text = `Vùng phối hợp C = ${z.C}s kết hợp THÍCH ỨNG split theo áp lực (Max Pressure chu kỳ cố định, kiểu SCOOT): ${z.adaptiveReasons.join('; ')}. CTM: giảm thêm ${(z.adaptiveGain * 100).toFixed(0)}% trễ so với cố định.`;
      } else if (two.length || one.length) {
        strategy = 'coord-greenwave';
        text = `Vùng phối hợp C = ${z.C}s với ${two.length} hành lang sóng xanh 2 chiều, ${one.length} hành lang 1 chiều; offset còn lại tối ưu TRANSYT.`;
      } else {
        strategy = 'coord-transyt';
        text = `Vùng phối hợp C = ${z.C}s, offset tối ưu TRANSYT (không có trục đủ điều kiện sóng xanh).`;
      }
      recs.push({ kind: 'zone', zone: z.id, strategy, text: text + keep, gain: dImp, nodes: z.nodes.length });
    }
    for (const c of corrs) {
      if (c.gws.cls === 'none') {
        recs.push({ kind: 'corridor', zone: c.zone, road: c.road, strategy: 'none', text: `${c.road}: GWS = ${c.gws.gws.toFixed(0)} < ${net.P.gwsOneWay} — không khả thi sóng xanh dài (${weakest(c.gws)}); điều khiển theo vùng/TRANSYT hoặc tách cụm ngắn.` });
      } else {
        const dir = c.gws.cls === 'two' ? '2 chiều' : `1 chiều ưu tiên ${c.priority === 'in' ? 'chiều về' : 'chiều đi'} (${c.ids[0]}${c.priority === 'in' ? ' ← ' : ' → '}${c.ids[c.ids.length - 1]})`;
        recs.push({ kind: 'corridor', zone: c.zone, road: c.road, strategy: c.gws.cls, text: `${c.road}: sóng xanh ${dir}, GWS = ${c.gws.gws.toFixed(0)}, dải ${c.after.bOut.toFixed(0)}s/${c.after.bIn.toFixed(0)}s trên C = ${c.C}s (${c.before.mixed ? 'hiện trạng chưa chung chu kỳ' : `hiện trạng ${c.before.bOut.toFixed(0)}s/${c.before.bIn.toFixed(0)}s trên C = ${c.before.C}s`}). Vận tốc khuyến nghị ${c.vAdvice} km/h.` });
      }
    }
    // cảnh báo nút quá bão hoà
    void name; void opts;
    return recs;
  };

  function weakest(g) {
    const parts = [['khoảng cách nút không đồng điều với C', g.phiDist], ['dòng rẽ vào/ra lớn', g.phiTurn], ['năng lực không đồng nhất / cổ chai', g.phiCap], ['chiều dài đoạn bất lợi', g.phiGeom]];
    parts.sort((a, b) => a[1] - b[1]);
    return parts[0][0];
  }

  O.STRATEGY_LABEL = {
    'coord-greenwave': 'Phối hợp + sóng xanh',
    'coord-transyt': 'Phối hợp vùng (TRANSYT)',
    'coord-adaptive': 'Phối hợp + thích ứng',
    'isolated-adaptive': 'Độc lập – thích ứng',
    'isolated-fixed': 'Độc lập – cố định',
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
