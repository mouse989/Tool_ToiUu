/* Tối ưu offset hành lang sóng xanh theo mục tiêu MAXBAND:  max  w_out·b_out + w_in·b_in
 *
 * Bề rộng dải b được tính chính xác (độ phân giải 1 s) là cung giao dài nhất trên vòng chu kỳ của
 * các cửa sổ xanh hiệu dụng đã dịch theo thời gian hành trình t_i = Σ L/v. Thay vì giải MILP
 * (cần bộ giải ngoài), dùng tìm kiếm toạ độ trên offset rời rạc 1 s với nhiều điểm khởi tạo
 * (sóng thuận chiều, sóng ngược chiều, cân bằng, ngẫu nhiên) + tiêu chí phụ là dải cặp nút liền kề
 * để thoát vùng b = 0. Với hành lang ≤ 30 nút, kết quả bằng hoặc sát nghiệm MILP và chạy < 100 ms.
 * Tuỳ chọn quét hệ số vận tốc (±10%) để đề xuất vận tốc khuyến nghị cho biển báo/VMS. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const MB = TS.maxband = {};
  const RES = 1; // s / ô

  /* Dựng hình học hành lang từ chuỗi nút (chỉ số trong net). */
  MB.buildCorridor = function (net, seq) {
    const find = (a, b) => net.outL[a].find(i => net.links[i].v === b);
    const out = [], inn = [], dist = [0];
    for (let k = 0; k + 1 < seq.length; k++) {
      const f = find(seq[k], seq[k + 1]);
      if (f === undefined) return null;
      out.push(f);
      const r = find(seq[k + 1], seq[k]);
      inn.push(r === undefined ? -1 : r);
      dist.push(dist[k] + net.links[f].len);
    }
    const n = seq.length;
    const brg = U.bearing([net.nodes[seq[0]].lon, net.nodes[seq[0]].lat], [net.nodes[seq[n - 1]].lon, net.nodes[seq[n - 1]].lat]);
    const axisPhases = (ni, dirBrg) => {
      let best = null, bd = 1e9;
      for (const i of net.inL[ni]) {
        const d = U.angleDiff(net.links[i].brg, dirBrg);
        if (d < bd) { bd = d; best = i; }
      }
      return best !== null && bd < 50 ? net.links[best].phases : null;
    };
    const phOut = [], phIn = [];
    for (let k = 0; k < n; k++) {
      phOut.push(k > 0 ? net.links[out[k - 1]].phases : (axisPhases(seq[0], brg) || (inn[0] >= 0 ? net.links[inn[0]].phases : [0])));
      phIn.push(k < n - 1 && inn[k] >= 0 ? net.links[inn[k]].phases : (axisPhases(seq[k], (brg + 180) % 360) || phOut[k]));
    }
    const twoWay = inn.every(i => i >= 0);
    return { seq, out, inn, dist, phOut, phIn, twoWay, brg, len: dist[n - 1] };
  };

  function travelTimes(net, corr, vf) {
    const n = corr.seq.length;
    const tOut = [0], tIn = new Array(n).fill(0);
    for (let k = 0; k + 1 < n; k++) tOut.push(tOut[k] + net.links[corr.out[k]].T / vf);
    if (corr.twoWay) for (let k = n - 2; k >= 0; k--) tIn[k] = tIn[k + 1] + net.links[corr.inn[k]].T / vf;
    return { tOut, tIn };
  }

  /* Mặt nạ xanh cơ sở (offset = 0) trên lưới B = C/RES ô, đã dịch −t (quy về mốc xuất phát). */
  function baseMask(plan, phases, P, C, t) {
    const B = Math.round(C / RES);
    const m = new Uint8Array(B);
    const Cn = M.cycleOf(plan);
    const wins = M.effWindows(plan, phases.filter(k => k < plan.phases.length), P);
    for (let b = 0; b < B; b++) {
      const tc = U.mod(b * RES + RES / 2 + t, Cn);
      for (const w of wins) if (tc >= w[0] && tc < w[1]) { m[b] = 1; break; }
    }
    return m;
  }

  function longestRun(m, B) {
    let best = 0, bestStart = 0, cur = 0, start = 0, all = true;
    for (let k = 0; k < 2 * B; k++) {
      if (m[k % B]) { if (cur === 0) start = k; cur++; if (cur > best) { best = cur; bestStart = start; } }
      else { cur = 0; all = false; }
    }
    if (all) return { len: B, start: 0 };
    return { len: Math.min(best, B), start: bestStart % B };
  }

  /* Khởi tạo bộ tính: trả về hàm đánh giá dải theo mảng offset. */
  function setup(net, corr, planFn, C, vf) {
    const P = net.P, n = corr.seq.length, B = Math.round(C / RES);
    const { tOut, tIn } = travelTimes(net, corr, vf);
    const plans = corr.seq.map(ni => planFn(ni));
    // mask theo offset=0; offset θ dịch mask: green(τ) = base(τ − θ)
    const mOut = plans.map((pl, k) => baseMask(pl, corr.phOut[k], P, C, tOut[k]));
    const mIn = plans.map((pl, k) => baseMask(pl, corr.phIn[k], P, C, tIn[k]));
    const Cn = plans.map(pl => M.cycleOf(pl));
    return { P, n, B, tOut, tIn, plans, mOut, mIn, Cn, C };
  }

  /* Dải dài nhất (vòng) của acc[b] & mask[(b − sh) mod B], không cấp phát bộ nhớ. */
  function runAnd(acc, mask, sh, B) {
    let best = 0, cur = 0, all = true;
    for (let k = 0; k < 2 * B; k++) {
      const b = k < B ? k : k - B;
      let i = b - sh; i %= B; if (i < 0) i += B;
      if (acc[b] & mask[i]) { cur++; if (cur > best) best = cur; }
      else { cur = 0; all = false; }
    }
    return all ? B : Math.min(best, B);
  }

  function shiftInto(mask, B, sh, dst) {
    for (let b = 0; b < B; b++) { let i = (b - sh) % B; if (i < 0) i += B; dst[b] = mask[i]; }
    return dst;
  }

  function bandsFor(S, th, corr) {
    const { n, B, mOut, mIn } = S;
    const acc = new Uint8Array(B).fill(1), accI = new Uint8Array(B).fill(1), tmp = new Uint8Array(B);
    const so = new Uint8Array(B), si = new Uint8Array(B), prevO = new Uint8Array(B), prevI = new Uint8Array(B);
    const pairO = [], pairI = [];
    for (let k = 0; k < n; k++) {
      const tb = Math.round(th[k] / RES);
      shiftInto(mOut[k], B, tb, so);
      for (let b = 0; b < B; b++) acc[b] &= so[b];
      if (k > 0) { for (let b = 0; b < B; b++) tmp[b] = prevO[b] & so[b]; pairO.push(longestRun(tmp, B).len * RES); }
      prevO.set(so);
      if (corr.twoWay) {
        shiftInto(mIn[k], B, tb, si);
        for (let b = 0; b < B; b++) accI[b] &= si[b];
        if (k > 0) { for (let b = 0; b < B; b++) tmp[b] = prevI[b] & si[b]; pairI.push(longestRun(tmp, B).len * RES); }
        prevI.set(si);
      }
    }
    const o = longestRun(acc, B), i = corr.twoWay ? longestRun(accI, B) : { len: 0, start: 0 };
    return {
      bOut: o.len * RES, bOutStart: o.start * RES, bIn: i.len * RES, bInStart: i.start * RES,
      pairOut: pairO, pairIn: pairI,
    };
  }

  MB.evaluate = function (net, corr, planFn, C, vf) {
    const S = setup(net, corr, planFn, C, vf || 1);
    const th = corr.seq.map(ni => planFn(ni).offset);
    const r = bandsFor(S, th, corr);
    r.tOut = S.tOut; r.tIn = S.tIn; r.C = C;
    return r;
  };

  /* Tìm kiếm toạ độ: với mỗi nút k, cố định các nút khác, quét toàn bộ offset 0..C_k−1. */
  function coordinateSearch(S, corr, th, o) {
    const { n, B, mOut, mIn } = S;
    const SO = [], SI = [];
    for (let k = 0; k < n; k++) {
      SO.push(shiftInto(mOut[k], B, Math.round(th[k] / RES), new Uint8Array(B)));
      SI.push(shiftInto(mIn[k], B, Math.round(th[k] / RES), new Uint8Array(B)));
    }
    const accO = new Uint8Array(B), accI = new Uint8Array(B);
    const objective = (k, sh) => {
      let v = o.wOut * runAnd(accO, mOut[k], sh, B);
      if (corr.twoWay) v += o.wIn * runAnd(accI, mIn[k], sh, B);
      let pair = 0;
      if (k > 0) { pair += o.wOut * runAnd(SO[k - 1], mOut[k], sh, B); if (corr.twoWay) pair += o.wIn * runAnd(SI[k - 1], mIn[k], sh, B); }
      if (k < n - 1) { pair += o.wOut * runAnd(SO[k + 1], mOut[k], sh, B); if (corr.twoWay) pair += o.wIn * runAnd(SI[k + 1], mIn[k], sh, B); }
      return (v + o.eps * pair / Math.max(1, n - 1)) * RES;
    };
    for (let sweep = 0; sweep < 8; sweep++) {
      let improved = false;
      for (let k = 0; k < n; k++) {
        if ((o.lockFirst && k === 0) || (o.locked && o.locked[k])) continue;
        accO.fill(1); accI.fill(1);
        for (let j = 0; j < n; j++) if (j !== k) for (let b = 0; b < B; b++) { accO[b] &= SO[j][b]; accI[b] &= SI[j][b]; }
        const keep = Math.round(th[k] / RES);
        let bk = keep, bv = objective(k, keep);
        const Ck = Math.round(S.Cn[k] / RES);
        for (let t = 0; t < Ck; t++) {
          if (t === keep) continue;
          const v = objective(k, t);
          if (v > bv + 1e-9) { bv = v; bk = t; }
        }
        if (bk !== keep) {
          th[k] = bk * RES; improved = true;
          shiftInto(mOut[k], B, bk, SO[k]); shiftInto(mIn[k], B, bk, SI[k]);
        }
      }
      if (!improved) break;
    }
    return th;
  }

  /* Tối ưu offset. opts: {wOut, wIn, speedFactors, restarts, seed, lockFirst} */
  MB.optimize = function (net, corr, planFn, C, opts) {
    const o = Object.assign({ wOut: 1, wIn: 1, speedFactors: [1], restarts: 4, seed: 7, eps: 0.08 }, opts || {});
    if (!corr.twoWay) o.wIn = 0;
    const rnd = U.rng(o.seed);
    const total = (S, th) => {
      const r = bandsFor(S, th, corr);
      const pair = U.sum(r.pairOut) * o.wOut + U.sum(r.pairIn) * o.wIn;
      return { v: o.wOut * r.bOut + o.wIn * r.bIn + o.eps * pair / Math.max(1, S.n - 1), r };
    };
    let best = null;
    const S1 = setup(net, corr, planFn, C, 1);
    const { n } = S1;
    const cur = corr.seq.map(ni => planFn(ni).offset);
    const firstGreen = (pl, phs) => { const w = M.effWindows(pl, phs.filter(k => k < pl.phases.length), S1.P); return w.length ? w[0][0] : 0; };
    const alignOut = [], alignIn = [], mid = [];
    for (let k = 0; k < n; k++) {
      const pl = S1.plans[k];
      const ao = U.mod(cur[0] + firstGreen(S1.plans[0], corr.phOut[0]) + S1.tOut[k] - firstGreen(pl, corr.phOut[k]), S1.Cn[k]);
      const ai = U.mod(cur[0] + firstGreen(S1.plans[n - 1], corr.phIn[n - 1]) + S1.tIn[k] - firstGreen(pl, corr.phIn[k]), S1.Cn[k]);
      alignOut.push(Math.round(ao) % S1.Cn[k]); alignIn.push(Math.round(ai) % S1.Cn[k]);
      let dm = ai - ao; if (dm > S1.Cn[k] / 2) dm -= S1.Cn[k]; if (dm < -S1.Cn[k] / 2) dm += S1.Cn[k];
      mid.push(Math.round(U.mod(ao + dm / 2, S1.Cn[k])) % S1.Cn[k]);
    }
    const starts = [cur.map(Math.round), alignOut];
    if (corr.twoWay) starts.push(alignIn, mid);
    for (let r = 0; r < o.restarts; r++) starts.push(corr.seq.map((_, k) => Math.floor(rnd() * S1.Cn[k])));
    if (o.locked) for (const st of starts) for (let k = 0; k < n; k++) if (o.locked[k]) st[k] = Math.round(cur[k]);
    for (const st of starts) {
      const th = coordinateSearch(S1, corr, st.slice(), o);
      const fin = total(S1, th);
      if (!best || fin.v > best.v + 1e-9) best = { v: fin.v, offsets: th.slice(), vf: 1, bands: fin.r, tOut: S1.tOut, tIn: S1.tIn };
    }
    // tinh chỉnh theo hệ số vận tốc (vận tốc khuyến nghị cho đoàn xe)
    for (const vf of o.speedFactors) {
      if (vf === 1) continue;
      const S = setup(net, corr, planFn, C, vf);
      const th = coordinateSearch(S, corr, best.offsets.slice(), o);
      const fin = total(S, th);
      if (fin.v > best.v * 1.03 + 0.5) best = { v: fin.v, offsets: th.slice(), vf, bands: fin.r, tOut: S.tOut, tIn: S.tIn };
    }
    best.C = C;
    best.effOut = best.bands.bOut / C;
    best.effIn = best.bands.bIn / C;
    return best;
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
