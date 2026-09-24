/* Mô phỏng trung mô mạng lưới bằng Mô hình Truyền Ô (Cell Transmission Model – Daganzo 1994/95).
 *
 *  - Mỗi liên kết chia thành các ô dài ≥ v_f·Δt. Biểu đồ cơ bản tam giác: v_f (đo đếm), Q = S (bão hoà),
 *    mật độ kẹt k_j = số làn / cự ly kẹt, vận tốc sóng lùi w = Q / (k_j − Q/v_f).
 *  - Dòng giữa hai ô: y = min(gửi_i, nhận_{i+1}); gửi = min(n·v_fΔt/ℓ, QΔt), nhận = min(QΔt, δ(N − n)).
 *  - Tại nút: nhánh chỉ được xả khi xanh hiệu dụng; phân nhánh theo tỷ lệ rẽ với ràng buộc FIFO — khi một
 *    nhánh ra bị lấp đầy, dòng xả bị chặn (tái hiện TRÀN NGƯỢC và khoá nút lan truyền).
 *  - Điều khiển: 'fixed' (giản đồ cố định), 'actuated' (xe kích hoạt: minG/maxG + ngắt khi hết hàng chờ),
 *    'mp' (Max Pressure không chu kỳ — Varaiya 2013, áp lực chuẩn hoá theo sức chứa),
 *    'cmp' (Max Pressure theo chu kỳ cố định: giữ C và offset để còn phối hợp, split mỗi chu kỳ theo áp lực,
 *    thay đổi tối đa ±4 s/chu kỳ theo tinh thần bộ tối ưu split của SCOOT). */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const SIM = TS.ctm = {};

  SIM.MODES = { fixed: 'Cố định (giản đồ pha)', actuated: 'Xe kích hoạt (Actuated)', mp: 'Max Pressure (thích ứng)', cmp: 'Max Pressure chu kỳ cố định (phối hợp + thích ứng)', cact: 'Phối hợp – xe kích hoạt (trả xanh sớm cho pha chính)' };

  SIM.create = function (net, cfg) {
    const P = net.P;
    const c = Object.assign({ scenario: 'base', dt: 1, mode: null, demandMul: 1, noiseCV: 0, seed: 1, warmup: 900, duration: 3600, mpHyst: 0.05, mpMinG: null }, cfg || {});
    const dt = c.dt;
    const links = net.links, NL = links.length;
    // ── ô ──
    const c0 = new Int32Array(NL), nc = new Int32Array(NL);
    let NC = 0;
    for (let i = 0; i < NL; i++) {
      const l = links[i];
      const k = Math.max(1, Math.floor(l.len / (l.vms * dt)));
      c0[i] = NC; nc[i] = k; NC += k;
    }
    const n = new Float64Array(NC), Nmax = new Float64Array(NC), Qc = new Float64Array(NC), fr = new Float64Array(NC), del = new Float64Array(NC), ncrit = new Float64Array(NC);
    const cellLen = new Float64Array(NL), satStep = new Float64Array(NL);
    for (let i = 0; i < NL; i++) {
      const l = links[i];
      const cl = l.len / nc[i];
      cellLen[i] = cl;
      const Q = l.S / 3600;                    // pcu/s
      const kj = l.lanes / P.jamSpacing;       // pcu/m
      const kc = Q / l.vms;
      const w = Q / Math.max(1e-6, kj - kc);   // m/s
      satStep[i] = Q * dt;
      for (let k = 0; k < nc[i]; k++) {
        const x = c0[i] + k;
        Nmax[x] = kj * cl;
        Qc[x] = Q * dt;
        fr[x] = Math.min(1, l.vms * dt / cl);
        del[x] = Math.min(1, w * dt / cl);
        ncrit[x] = kc * cl;
      }
    }
    const yflow = new Float64Array(NC);
    const stopped = new Uint8Array(NC);          // dòng ra khỏi ô trong bước (để ước tính vận tốc)
    const buf = new Float64Array(NL);            // hàng đợi nguồn (xe chờ vào mạng)
    const srcRate = new Float64Array(NL);
    for (let i = 0; i < NL; i++) srcRate[i] = links[i].srcRate / 3600 * c.demandMul;
    const noiseF = new Float64Array(NL).fill(1);
    // điểm phát sinh / thu hút giữa đoạn (ô giữa); nhánh vào từ biên mạng phát xe từ ô đầu
    const sm = new Int32Array(NL), sinkF = new Float64Array(NL), theta = new Float64Array(NL);
    for (let i = 0; i < NL; i++) {
      sm[i] = links[i].entry ? c0[i] : c0[i] + Math.floor(nc[i] / 2);
      sinkF[i] = links[i].sinkFrac || 0;
      theta[i] = links[i].lanes >= 2 ? U.clamp(P.fifo ?? 0.5, 0, 1) : 1;
    }
    const Ttot = c.total || (c.warmup + c.duration);
    const demandF = (tt) => c.profile === 'peak' ? 0.7 + 0.3 * Math.sin(Math.PI * U.clamp(tt / Ttot, 0, 1)) : 1;
    const srcInj = new Float64Array(NL), rJ = new Float64Array(NL);

    const rnd = U.rng(c.seed);

    // ── bộ điều khiển ──
    const ctrl = [];
    for (let v = 0; v < net.N; v++) {
      const node = net.nodes[v];
      if (!node.signalized || !net.inL[v].length) { ctrl.push(null); continue; }
      const plan = U.deepClone(M.getPlan(node, net.band, c.scenario));
      const mode = (c.modes && c.modes[v]) || c.mode || node.control || 'fixed';
      const C = M.cycleOf(plan);
      const st = { v, plan, mode, C, coord: 0, endAt: [], k: 0, part: 'g', tIn: 0, g: plan.phases.map(p => p.g), gCur: plan.phases[0].g, press: new Float64Array(plan.phases.length), pressN: 0, next: 0, lastCycle: -1 };
      if (mode === 'cact') {
        // pha phối hợp = pha phục vụ lưu lượng lớn nhất; mốc kết thúc xanh (force-off) cố định trong chu kỳ
        const fl = plan.phases.map((_, k) => U.sum(net.inL[v], i => (links[i].phases.includes(k) ? links[i].q : 0)));
        st.coord = fl.indexOf(Math.max(...fl));
        let tt = 0; st.endAt = plan.phases.map(ph => { const e = tt + ph.g; tt += ph.g + ph.y + ph.ar; return e; });
      }
      if (mode === 'fixed' || mode === 'cmp' || mode === 'cact') {
        const pa = M.phaseAt(plan, 0);
        st.k = pa.k; st.part = pa.part;
        const ph = plan.phases[pa.k];
        st.tIn = (pa.part === 'g' ? ph.g : pa.part === 'y' ? ph.y : ph.ar) - pa.rem;
      }
      ctrl.push(st);
    }
    // nhánh → bộ đếm pha
    const greenNow = new Uint8Array(NL), sigState = new Uint8Array(NL); // 0 đỏ, 1 xanh, 2 vàng

    const occArr = new Float64Array(NL);        // tỷ lệ chiếm dụng liên kết, cập nhật mỗi bước
    const linkOcc = (i) => occArr[i];

    function phasePressure(st, k) {
      let p = 0;
      for (const i of net.inL[st.v]) {
        const l = links[i];
        if (!l.phases.includes(k)) continue;
        let down = 0;
        for (const t of l.turn) down += t.p * linkOcc(t.j);
        p += l.S * (linkOcc(i) - (1 - l.exitFrac) * down);
      }
      return p / 3600;
    }

    function demandOnPhase(st, k) {
      // có hàng chờ gần vạch dừng (2 ô cuối) trên các nhánh của pha?
      for (const i of net.inL[st.v]) {
        const l = links[i];
        if (!l.phases.includes(k)) continue;
        const last = c0[i] + nc[i] - 1;
        const q = n[last] + (nc[i] > 1 ? n[last - 1] : 0);
        if (q > 0.6 * (ncrit[last] + (nc[i] > 1 ? ncrit[last - 1] : 0))) return true;
      }
      return false;
    }

    function vehiclesNear(st, k) {
      // có xe trong ~3 ô cuối của nhánh do pha phục vụ (tương đương đầu dò kéo dài xanh)
      for (const i of net.inL[st.v]) {
        const l = links[i]; if (!l.phases.includes(k)) continue;
        const b = c0[i] + nc[i] - 1; let s = 0;
        for (let x = b; x >= Math.max(c0[i], b - 2); x--) s += n[x];
        if (s > 0.3) return true;
      }
      return false;
    }

    function advanceController(st, t) {
      const pl = st.plan, phs = pl.phases, np = phs.length;
      if (st.mode === 'fixed') {
        const pa = M.phaseAt(pl, t);
        const ph = phs[pa.k];
        st.k = pa.k; st.part = pa.part;
        st.tIn = (pa.part === 'g' ? ph.g : pa.part === 'y' ? ph.y : ph.ar) - pa.rem;
        return;
      }
      st.tIn += dt;
      const ph = phs[st.k];
      if (st.mode === 'cmp' || st.mode === 'cact') {
        // chu kỳ cố định; cmp: tích luỹ áp lực để phân split cho chu kỳ kế
        if (st.mode === 'cmp' && Math.round(t) % 5 === 0) {
          for (let k = 0; k < np; k++) st.press[k] += Math.max(0, phasePressure(st, k));
          st.pressN++;
        }
        const cyc = Math.floor((t - pl.offset) / st.C);
        if (cyc !== st.lastCycle) {
          st.lastCycle = cyc;
          if (st.pressN > 0) {
            const avail = st.C - U.sum(phs, p => p.y + p.ar);
            const w = Array.from(st.press, x => Math.max(x / st.pressN, 1e-4));
            const W = U.sum(w);
            const tgt = w.map(x => x / W * avail);
            const ng = st.g.map((g, k) => U.clamp(Math.round(tgt[k]), g - 4, g + 4));
            for (let k = 0; k < np; k++) ng[k] = Math.max(ng[k], phs[k].minG || P.minGreen);
            let diff = avail - U.sum(ng);
            for (let it = 0; diff !== 0 && it < 200; it++) {
              const k = it % np;
              if (diff > 0) { ng[k]++; diff--; } else if (ng[k] > (phs[k].minG || P.minGreen)) { ng[k]--; diff++; }
            }
            st.g = ng;
          }
          st.press.fill(0); st.pressN = 0;
          const cont = st.k === 0 && st.part === 'g';
          st.k = 0; st.part = 'g'; st.early = false; st.noLost = cont; st.tIn = U.mod(t - pl.offset, st.C);
          return;
        }
        if (st.mode !== 'cact' && st.part === 'g' && !st.early && st.tIn >= st.g[st.k]) { st.part = 'y'; st.tIn = 0; st.noLost = false; }
        else if (st.mode === 'cact' && st.part === 'g' && !st.early && (st.tIn >= 0.5 * st.g[st.k] || st.k !== st.coord) && U.mod(t - pl.offset, st.C) >= st.endAt[st.k] && U.mod(t - pl.offset, st.C) < st.endAt[st.k] + 30) { st.part = 'y'; st.tIn = 0; st.noLost = false; } // force-off cố định
        else if (st.mode === 'cact' && st.part === 'g' && st.k !== st.coord && st.tIn >= (ph.minG || P.minGreen) && !vehiclesNear(st, st.k)) { st.part = 'y'; st.tIn = 0; } // pha phụ hết xe → trả xanh sớm
        else if (st.part === 'y' && st.tIn >= ph.y) { st.part = 'ar'; st.tIn = 0; }
        else if (st.part === 'ar' && st.tIn >= ph.ar) {
          if (st.k >= np - 1) { st.k = 0; st.part = 'g'; st.tIn = 0; st.early = true; } // trả xanh sớm cho pha chính (pha 1) đến hết chu kỳ
          else { st.k = st.k + 1; st.part = 'g'; st.tIn = 0; }
        }
        return;
      }
      if (st.part === 'g') {
        const minG = c.mpMinG || ph.minG || P.minGreen;
        const maxG = ph.maxG || P.maxGreen;
        if (st.tIn < minG) return;
        if (st.mode === 'actuated') {
          if (st.tIn >= maxG || !demandOnPhase(st, st.k)) { st.part = 'y'; st.tIn = 0; st.next = (st.k + 1) % np; }
        } else { // mp
          if (Math.round(st.tIn) % 3 !== 0 && st.tIn < maxG) return; // chu kỳ quyết định 3 s
          let best = st.k, bp = phasePressure(st, st.k);
          const cur = bp;
          for (let k = 0; k < np; k++) if (k !== st.k) { const p = phasePressure(st, k); if (p > bp) { bp = p; best = k; } }
          if (st.tIn >= maxG && best === st.k) { best = (st.k + 1) % np; }
          if (best !== st.k && (bp - cur > c.mpHyst * Math.max(1e-3, Math.abs(cur)) || st.tIn >= maxG)) { st.part = 'y'; st.tIn = 0; st.next = best; }
        }
      } else if (st.part === 'y' && st.tIn >= ph.y) { st.part = 'ar'; st.tIn = 0; }
      else if (st.part === 'ar' && st.tIn >= ph.ar) { st.k = st.next; st.part = 'g'; st.tIn = 0; }
    }

    function updateSignals(t) {
      for (const st of ctrl) if (st) advanceController(st, t);
      for (let i = 0; i < NL; i++) {
        const st = ctrl[links[i].v];
        if (!st) { greenNow[i] = 1; sigState[i] = 1; continue; }
        const served = links[i].phases.includes(st.k);
        if (!served) { greenNow[i] = 0; sigState[i] = 0; continue; }
        if (st.part === 'g') { greenNow[i] = (st.tIn >= P.lostStart || st.noLost || st.early) ? 1 : 0; sigState[i] = 1; }
        else if (st.part === 'y') { greenNow[i] = st.tIn < P.greenExt ? 1 : 0; sigState[i] = 2; }
        else { greenNow[i] = 0; sigState[i] = 0; }
      }
    }

    // ── chỉ tiêu ──
    const K = {
      vht: new Float64Array(NL), vkt: new Float64Array(NL), stops: new Float64Array(NL), exits: 0, entries: 0,
      spillSec: new Float64Array(NL), spillEv: new Float64Array(NL), qmax: new Float64Array(NL), bufWait: 0, out: new Float64Array(NL),
      inNode: new Float64Array(NL), src: new Float64Array(NL), sink: new Float64Array(NL), exitNode: new Float64Array(NL),
    };
    const spillNow = new Uint8Array(NL);
    const series = [];
    let acc = { vht: 0, vkt: 0, exits: 0, entries: 0, stops: 0, arr: 0, t0: 0 };
    let vehStart = null;
    let t = 0;
    const inflowFirst = new Float64Array(NL);
    const sendLast = new Float64Array(NL);
    const recv = new Float64Array(NL), dem = new Float64Array(NL);
    const recorders = [];

    const vehNow = () => { let v = 0; for (let x = 0; x < NC; x++) v += n[x]; return v; };
    function step() {
      const measuring = t >= c.warmup;
      if (measuring && vehStart === null) vehStart = vehNow();
      if (c.noiseCV > 0 && Math.round(t) % 300 === 0) for (let i = 0; i < NL; i++) noiseF[i] = Math.max(0, 1 + c.noiseCV * rnd.normal());
      updateSignals(t);
      // 1) dòng trong liên kết (tại ô giữa: một phần xe rời mạng — vào nhà, cơ quan, bãi đỗ — không chiếm ô sau)
      for (let i = 0; i < NL; i++) {
        const a = c0[i], b = a + nc[i] - 1;
        for (let x = a; x < b; x++) {
          const s = Math.min(n[x] * fr[x], Qc[x]);
          let r = Math.min(Qc[x + 1], del[x + 1] * (Nmax[x + 1] - n[x + 1]));
          if (x + 1 === sm[i] && sinkF[i] > 0) r = r / (1 - sinkF[i]);
          yflow[x] = Math.max(0, Math.min(s, r));
        }
        const s = greenNow[i] ? Math.min(n[b] * fr[b], Qc[b], satStep[i]) : 0;
        sendLast[i] = s;
        recv[i] = Math.max(0, Math.min(Qc[a], del[a] * (Nmax[a] - n[a]))); // khả năng nhận của ô đầu
        if (sm[i] === a && sinkF[i] > 0) recv[i] /= (1 - sinkF[i]);
        dem[i] = 0; inflowFirst[i] = 0; srcInj[i] = 0;
      }
      // 2) nút: nhu cầu tới từng nhánh ra; FIFO mềm theo số làn (1 hướng tắc không chặn hoàn toàn nhánh nhiều làn)
      for (let i = 0; i < NL; i++) {
        if (sendLast[i] <= 0) continue;
        for (const tr of links[i].turn) dem[tr.j] += sendLast[i] * tr.p;
      }
      for (let j = 0; j < NL; j++) rJ[j] = dem[j] > recv[j] && dem[j] > 0 ? recv[j] / dem[j] : 1;
      for (let i = 0; i < NL; i++) {
        const b = c0[i] + nc[i] - 1;
        const l = links[i];
        if (sendLast[i] <= 0) { yflow[b] = 0; continue; }
        if (!l.turn.length) { // nhánh ra biên mạng: rời mạng tại vạch dừng
          yflow[b] = sendLast[i];
          if (measuring) { K.exits += sendLast[i]; acc.exits += sendLast[i]; K.exitNode[i] += sendLast[i]; K.out[i] += sendLast[i]; }
          continue;
        }
        let fifo = 1;
        for (const tr of l.turn) fifo = Math.min(fifo, rJ[tr.j]);
        let f = 0;
        for (const tr of l.turn) {
          const ph = theta[i] * fifo + (1 - theta[i]) * rJ[tr.j];
          const fij = sendLast[i] * tr.p * ph;
          inflowFirst[tr.j] += fij; f += fij;
          if (measuring) { K.inNode[tr.j] += fij; acc.arr += fij; }
        }
        yflow[b] = f;
        if (measuring) K.out[i] += f;
      }
      // 3) rời mạng & phát sinh giữa đoạn
      const dmf = demandF(t);
      for (let i = 0; i < NL; i++) {
        const a = c0[i], m = sm[i];
        let sink = 0, inM;
        if (m === a) { sink = inflowFirst[i] * sinkF[i]; inflowFirst[i] -= sink; inM = inflowFirst[i]; }
        else { sink = yflow[m - 1] * sinkF[i]; inM = yflow[m - 1] - sink; }
        if (measuring && sink > 0) { K.exits += sink; acc.exits += sink; K.sink[i] += sink; }
        buf[i] += srcRate[i] * noiseF[i] * dmf * dt;
        const room = Math.max(0, Math.min(Qc[m], del[m] * (Nmax[m] - n[m])) - inM);
        const inj = Math.min(buf[i], room);
        buf[i] -= inj; srcInj[i] = inj;
        if (measuring) { K.entries += inj; acc.entries += inj; acc.arr += inj; K.src[i] += inj; K.bufWait += buf[i] * dt; }
      }
      // 4) cập nhật ô + chỉ tiêu
      for (let i = 0; i < NL; i++) {
        const a = c0[i], b = a + nc[i] - 1, cl = cellLen[i];
        let occ = 0, cap = 0;
        // ô "đứng": có xe nhưng dòng ra < 30% khả năng chạy tự do (đèn đỏ hoặc đuôi hàng chờ)
        if (measuring) for (let x = a; x <= b; x++) stopped[x] = n[x] > 0.05 * Math.max(ncrit[x], 0.2) && yflow[x] < 0.3 * n[x] * fr[x] ? 1 : 0;
        for (let x = a; x <= b; x++) {
          let inflow = x === a ? inflowFirst[i] : yflow[x - 1];
          if (x === sm[i]) { if (x > a) inflow *= (1 - sinkF[i]); inflow += srcInj[i]; }
          // số lần dừng: xe đang chạy nhập vào ô đứng (gia nhập hàng chờ / gặp đèn đỏ)
          if (measuring && inflow > 0 && stopped[x] && (x === a || !stopped[x - 1])) { K.stops[i] += inflow; acc.stops += inflow; }
          n[x] += inflow - yflow[x];
          if (n[x] < 0) n[x] = 0;
          occ += n[x]; cap += Nmax[x];
        }
        occArr[i] = cap > 0 ? occ / cap : 0;
        if (measuring) {
          K.vht[i] += occ * dt;
          let vk = 0; for (let x = a; x <= b; x++) vk += yflow[x] * cl;
          K.vkt[i] += vk;
          acc.vht += occ * dt; acc.vkt += vk;
          const sp = cap > 0 && occ / cap >= P.spillThreshold;
          if (sp) K.spillSec[i] += dt;
          if (sp && !spillNow[i]) K.spillEv[i]++;
          spillNow[i] = sp ? 1 : 0;
        } else spillNow[i] = cap > 0 && occ / cap >= P.spillThreshold ? 1 : 0;
      }
      for (const r of recorders) r.capture(t);
      t += dt;
      if (Math.round(t) % 60 === 0 && measuring) {
        const span = t - Math.max(acc.t0, c.warmup) || 60;
        let veh = 0; for (let x = 0; x < NC; x++) veh += n[x];
        let bufT = 0; for (let i = 0; i < NL; i++) bufT += buf[i];
        let sp = 0; for (let i = 0; i < NL; i++) sp += spillNow[i];
        series.push({ t, veh, buf: bufT, speed: acc.vht > 0 ? acc.vkt / acc.vht * 3.6 : 0, thr: acc.exits / span * 3600, inr: acc.entries / span * 3600, stopRate: acc.arr > 0 ? acc.stops / acc.arr : 0, spill: sp });
        acc = { vht: 0, vkt: 0, exits: 0, entries: 0, stops: 0, arr: 0, t0: t };
      }
    }

    function queueLen(i) {
      // hàng chờ = các ô liên tiếp tắc tính từ vạch dừng (m)
      const a = c0[i], b = a + nc[i] - 1;
      let L = 0;
      for (let x = b; x >= a; x--) { if (n[x] > 1.5 * ncrit[x]) L += cellLen[i]; else break; }
      return L;
    }

    const api = {
      net, cfg: c, links, c0, nc, n, Nmax, ncrit, yflow, cellLen, sigState, spillNow, buf, ctrl, series, K,
      get t() { return t; },
      step,
      run(until) { while (t < until) step(); },
      queueLen,
      linkOcc,
      /* Ghi mật độ theo ô cho danh sách liên kết (biểu đồ thời gian – khoảng cách). */
      record(linkIdxs, horizon) {
        const cells = [];
        for (const i of linkIdxs) for (let k = 0; k < nc[i]; k++) cells.push(c0[i] + k);
        const H = Math.round(horizon / dt);
        const data = new Float32Array(cells.length * H);
        const sig = new Uint8Array(linkIdxs.length * H);
        const rec = { linkIdxs, cells, H, data, sig, t0: t, count: 0,
          capture(tt) {
            const row = rec.count % H;
            for (let k = 0; k < cells.length; k++) data[row * cells.length + k] = n[cells[k]] / Math.max(1e-6, Nmax[cells[k]]);
            for (let k = 0; k < linkIdxs.length; k++) sig[row * linkIdxs.length + k] = sigState[linkIdxs[k]];
            rec.count++; rec.tLast = tt;
          } };
        recorders.push(rec);
        return rec;
      },
      stopRecording() { recorders.length = 0; },
      /* Kết quả tổng hợp sau thời gian đo. */
      vehNow,
      /* Chỉ số đánh giá toàn mạng tại thời điểm hiện tại (luỹ kế từ đầu kỳ đo). */
      netMetrics() {
        let arr = 0, stops = 0, delay = 0, vkt = 0, queued = 0, qmaxM = 0, qmaxI = -1, spill = 0, onroad = 0;
        const linkDelay = new Float64Array(NL);
        for (let i = 0; i < NL; i++) {
          arr += K.inNode[i] + K.src[i]; stops += K.stops[i];
          const d = Math.max(0, K.vht[i] - K.vkt[i] / links[i].vms);
          linkDelay[i] = d; delay += d; vkt += K.vkt[i];
          const a = c0[i], b = a + nc[i] - 1;
          let qm = 0;
          for (let x = b; x >= a; x--) { if (n[x] > 1.5 * ncrit[x]) { queued += n[x]; qm += cellLen[i]; } else break; }
          for (let x = a; x <= b; x++) onroad += n[x];
          if (qm > qmaxM) { qmaxM = qm; qmaxI = i; }
          spill += spillNow[i];
        }
        let bufNow = 0; for (let i = 0; i < NL; i++) bufNow += buf[i];
        return { t, span: Math.max(1, t - c.warmup), entries: K.entries, exits: K.exits, onroad, bufNow, arr, stops, delay: delay + K.bufWait, vkt, queued, qmaxM, qmaxI, spill, linkDelay };
      },
      /* Cân bằng xe của một vùng (tập nút): vào qua biên + phát sinh bên trong, ra qua biên + kết thúc chuyến bên trong. */
      zoneBalance(nodeSet) {
        let inB = 0, outB = 0, src = 0, sink = 0, inside = 0;
        for (let i = 0; i < NL; i++) {
          const l = links[i], inV = nodeSet.has(l.v), inU = nodeSet.has(l.u);
          if (inV && !inU) inB += K.inNode[i];
          if (inU && !inV) outB += K.inNode[i];
          if (inV) {
            src += K.src[i]; sink += K.sink[i] + K.exitNode[i];
            for (let k = 0; k < nc[i]; k++) inside += n[c0[i] + k];
          }
        }
        return { inB, outB, src, sink, inside, span: Math.max(1, t - c.warmup) };
      },
      results() {
        const span = Math.max(1, t - c.warmup);
        let vht = 0, vkt = 0, freeT = 0, stops = 0, spillSec = 0, spillEv = 0;
        const perLink = [];
        for (let i = 0; i < NL; i++) {
          const l = links[i];
          const ft = K.vkt[i] / l.vms;
          const dl = Math.max(0, K.vht[i] - ft);
          vht += K.vht[i]; vkt += K.vkt[i]; freeT += ft; stops += K.stops[i]; spillSec += K.spillSec[i]; spillEv += K.spillEv[i];
          perLink.push({ delay: dl, out: K.out[i], stops: K.stops[i], spillSec: K.spillSec[i], vht: K.vht[i], vkt: K.vkt[i] });
        }
        const delayTot = Math.max(0, vht - freeT) + K.bufWait;
        const served = K.exits;
        return {
          span, vht: vht / 3600, vkt: vkt / 1000, delayVehH: delayTot / 3600,
          avgSpeed: vht > 0 ? vkt / vht * 3.6 : 0,
          delayPerVehKm: vkt > 0 ? delayTot / (vkt / 1000) : 0,   // s/pcu·km
          stopsPerVehKm: vkt > 0 ? stops / (vkt / 1000) : 0,
          stopRatio: (() => { let a = 0; for (let i = 0; i < NL; i++) a += K.inNode[i] + K.src[i]; return a > 0 ? stops / a : 0; })(),
          throughput: served / span * 3600, entries: K.entries, exits: K.exits,
          accum: vehStart === null ? 0 : vehNow() - vehStart,          // xe tích luỹ thêm trong mạng trong kỳ đo
          bufEnd: U.sum(Array.from(buf)),                              // xe đang chờ vào mạng cuối kỳ
          spillLinkMin: spillSec / 60, spillEvents: spillEv, bufWaitH: K.bufWait / 3600,
          perLink,
        };
      },
    };
    return api;
  };

  /* Chạy mô phỏng đồng bộ (dùng cho đánh giá A/B, không hoạt ảnh). */
  SIM.runBatch = function (net, cfg) {
    const s = SIM.create(net, cfg);
    s.run(s.cfg.warmup + s.cfg.duration);
    return { sim: s, res: s.results() };
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
