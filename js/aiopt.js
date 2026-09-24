/* Tối ưu nâng cao bằng CHẠY THỬ – HIỆU CHỈNH LẶP (simulation-in-the-loop).
 *
 * Mô phỏng CTM là "thước đo" thống nhất. Mục tiêu J (xe·h tương đương):
 *     J = tổng trễ (xe·h) + K·số lần dừng/3600 + 0,2·(nhánh·phút tràn ngược) + thời gian chờ vào mạng
 *
 * 1) SPSA (Simultaneous Perturbation Stochastic Approximation – Spall 1992): mỗi vòng chỉ cần 2 lần chạy
 *    mô phỏng bất kể số biến (offset + thời lượng xanh của hàng trăm nút), nên phù hợp mạng 500 nút.
 *    Biến được chiếu về miền khả thi: xanh ≥ xanh min, Σxanh = C − Σ(vàng + đỏ), offset ∈ [0, C).
 * 2) Cố vấn LLM (Claude): đọc bảng chỉ số các nút kém nhất, đề xuất điều chỉnh split/offset kèm lý do;
 *    MỌI đề xuất được mô phỏng kiểm chứng, chỉ nhận khi J giảm (LLM không bao giờ ghi thẳng vào tủ).
 * Chu kỳ vùng giữ nguyên (đã chọn bởi bộ tối ưu TRANSYT) để không phá phối hợp sóng xanh. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model, SIM = TS.ctm;
  const AI = TS.aiopt = {};

  AI.DEFAULTS = { iters: 30, warmup: 300, duration: 900, dt: 2, scope: 'all', a: 2, c: 2, maxStep: 4, block: 0.15, seed: 3 };

  /* Chiếu vector xanh về miền khả thi và làm tròn giữ tổng. */
  AI.projectGreens = function (g, minG, avail) {
    const n = g.length;
    let x = g.map((v, k) => Math.max(minG[k], v));
    for (let it = 0; it < 20; it++) {
      const s = U.sum(x), diff = avail - s;
      if (Math.abs(diff) < 1e-6) break;
      const free = x.map((v, k) => (diff < 0 ? v - minG[k] : 1));
      const tot = U.sum(free);
      if (tot <= 1e-9) break;
      x = x.map((v, k) => Math.max(minG[k], v + diff * free[k] / tot));
    }
    const r = x.map(Math.floor);
    let rem = Math.round(avail - U.sum(r));
    const ord = x.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0]);
    for (let t = 0; rem > 0 && t < n * 3; t++, rem--) r[ord[t % n][1]]++;
    for (let t = 0; rem < 0 && t < n * 3; t++) { const k = ord[n - 1 - (t % n)][1]; if (r[k] > minG[k]) { r[k]--; rem++; } }
    return r;
  };

  function ensureOpt(project, band) {
    for (const n of project.nodes) if (n.signalized && !n.opt[band] && n.plans[band]) n.opt[band] = U.deepClone(n.plans[band]);
  }

  /* Đánh giá J bằng CTM (kịch bản đề xuất, điều khiển cố định). */
  AI.evaluate = function (project, band, o, net) {
    net = net || M.buildNet(project, band);
    const P = project.params;
    const { res } = SIM.runBatch(net, { scenario: 'opt', mode: 'fixed', dt: o.dt, warmup: o.warmup, duration: o.duration });
    const stops = U.sum(res.perLink, l => l.stops);
    const J = res.delayVehH + P.stopK * stops / 3600 + 0.2 * res.spillLinkMin;
    return { J, res, stops };
  };

  /* Chọn tập nút tham gia. */
  function pickNodes(project, band, o, net, baseEval) {
    const ids = [];
    net.nodes.forEach((nd, i) => { if (nd.signalized && net.inL[i].length && nd.opt[band]) ids.push(i); });
    if (o.scope === 'all' || !baseEval) return ids;
    // nút kém nhất theo trễ mô phỏng/xe + các nút kề
    const score = ids.map(n => { let d = 0, q = 0; for (const i of net.inL[n]) { d += baseEval.res.perLink[i].delay; q += baseEval.res.perLink[i].out; } return [n, q > 0 ? d / q : 0]; }).sort((a, b) => b[1] - a[1]);
    const k = Math.max(5, Math.round(ids.length * (o.scope === 'worst10' ? 0.1 : 0.25)));
    const set = new Set(score.slice(0, k).map(x => x[0]));
    for (const n of [...set]) for (const i of net.inL[n]) { const u = net.links[i].u; if (ids.includes(u)) set.add(u); }
    return [...set];
  }

  /* SPSA trên offset + thời lượng xanh. progress(info), shouldStop() */
  AI.runSPSA = async function (project, band, userOpts, progress, shouldStop) {
    const o = Object.assign({}, AI.DEFAULTS, userOpts || {});
    ensureOpt(project, band);
    const net = M.buildNet(project, band);
    const P = project.params;
    const rnd = U.rng(o.seed);
    const t0 = Date.now();
    const start = AI.evaluate(project, band, o, net);
    const nodesIdx = pickNodes(project, band, o, net, start);
    // biến: [offset, g_0 … g_{m-1}] cho từng nút
    const vars = [];
    for (const n of nodesIdx) {
      const pl = net.nodes[n].opt[band];
      const C = M.cycleOf(pl);
      vars.push({ n, kind: 'off', C, x: pl.offset, scale: o.c });
      pl.phases.forEach((ph, k) => vars.push({ n, kind: 'g', k, x: ph.g, scale: o.c * 0.7 }));
    }
    const snapshot = () => nodesIdx.map(n => U.deepClone(net.nodes[n].opt[band]));
    const restore = (snap) => nodesIdx.forEach((n, i) => { net.nodes[n].opt[band] = U.deepClone(snap[i]); });
    const apply = (x) => {
      let vi = 0;
      for (const n of nodesIdx) {
        const pl = net.nodes[n].opt[band];
        const C = M.cycleOf(pl), IG = U.sum(pl.phases, ph => ph.y + ph.ar);
        pl.offset = Math.round(U.mod(x[vi++], C)) % C;
        const g = pl.phases.map(() => x[vi++]);
        const minG = pl.phases.map(ph => Math.max(ph.minG || P.minGreen, 5));
        const r = AI.projectGreens(g, minG, C - IG);
        r.forEach((v, k) => { pl.phases[k].g = v; });
      }
    };
    let x = vars.map(v => v.x);
    let best = { J: start.J, snap: snapshot(), it: 0, x: vars.map(v => v.x) };
    const trace = [{ it: 0, J: start.J, best: start.J }];
    let a0 = null;
    const A = Math.max(2, Math.round(o.iters * 0.1));
    if (progress) progress({ it: 0, iters: o.iters, J: start.J, best: best.J, start: start.J, nVars: vars.length, nNodes: nodesIdx.length, trace });
    for (let it = 1; it <= o.iters; it++) {
      if (shouldStop && shouldStop()) break;
      const ck = 1 / Math.pow(it, 0.101);
      // nhiễu đồng thời trên một khối biến ngẫu nhiên (theo nút) — giảm nhiễu gradient khi số biến lớn
      const act = new Set(nodesIdx.filter(() => rnd() < o.block));
      if (!act.size) act.add(nodesIdx[Math.floor(rnd() * nodesIdx.length)]);
      const delta = vars.map(v => (act.has(v.n) ? (rnd() < 0.5 ? -1 : 1) : 0));
      const xp = x.map((v, i) => v + ck * vars[i].scale * delta[i]);
      const xm = x.map((v, i) => v - ck * vars[i].scale * delta[i]);
      apply(xp); const Jp = AI.evaluate(project, band, o, net).J;
      if (Jp < best.J) best = { J: Jp, snap: snapshot(), it, x: xp.slice() };
      await U.sleep(0);
      apply(xm); const Jm = AI.evaluate(project, band, o, net).J;
      if (Jm < best.J) best = { J: Jm, snap: snapshot(), it, x: xm.slice() };
      const ghat = vars.map((v, i) => (delta[i] ? (Jp - Jm) / (2 * ck * v.scale * delta[i]) : 0));
      if (a0 === null) { const gm = Math.max(1e-9, Math.max(...ghat.map(Math.abs))); a0 = o.a * Math.pow(A + 1, 0.602) / gm; }
      const ak = a0 / Math.pow(it + A, 0.602);
      x = x.map((v, i) => v - U.clamp(ak * ghat[i], -o.maxStep, o.maxStep));
      let Jc = null;
      if (it % 5 === 0 || it === o.iters) {
        apply(x); Jc = AI.evaluate(project, band, o, net).J;
        if (Jc < best.J) { best = { J: Jc, snap: snapshot(), it }; best.x = x.slice(); }
        else if (Jc > best.J * 1.01 && best.x) x = best.x.slice(); // đi lệch → quay về nghiệm tốt nhất
      }
      trace.push({ it, J: Math.min(Jp, Jm, Jc ?? Infinity), best: best.J });
      if (progress) progress({ it, iters: o.iters, J: Math.min(Jp, Jm), best: best.J, start: start.J, nVars: vars.length, nNodes: nodesIdx.length, trace });
      await U.sleep(0);
    }
    restore(best.snap);
    const fin = AI.evaluate(project, band, o, net);
    return { method: 'SPSA', start: start.J, final: fin.J, gain: (start.J - fin.J) / start.J, startRes: start.res, finalRes: fin.res, trace, nNodes: nodesIdx.length, nVars: vars.length, bestIt: best.it, ms: Date.now() - t0 };
  };

  /* ── Cố vấn LLM (Claude) ─────────────────────────────── */
  AI.LLM_SYSTEM = `Bạn là kỹ sư điều khiển đèn tín hiệu giao thông đô thị (TP.HCM, dòng xe hỗn hợp xe máy – ô tô).
Bạn nhận bảng chỉ số mô phỏng CTM của các nút giao kém nhất và giản đồ pha hiện tại. Nhiệm vụ: đề xuất tối đa 8 điều chỉnh
để giảm tổng trễ, số lần dừng và tràn ngược. Mọi đề xuất sẽ được mô phỏng kiểm chứng; đề xuất làm xấu đi sẽ bị loại.
Ràng buộc bắt buộc:
- Giữ nguyên chu kỳ C của nút (tổng xanh = C − tổng vàng − tổng đỏ toàn phần), giữ nguyên vàng và đỏ toàn phần.
- Xanh mỗi pha ≥ xanh tối thiểu (minG) của pha đó.
- Offset là số nguyên trong [0, C).
- Ưu tiên: dồn xanh cho pha có nhánh x cao / hàng chờ dài; chỉnh offset để giảm dừng giữa các nút liền kề trên cùng trục;
  giảm xanh nút hạ lưu đang tràn ngược chỉ khi có lý do (điều tiết dòng vào).
Chỉ trả lời bằng MỘT đối tượng JSON, không kèm văn bản khác, theo dạng:
{"analysis":"nhận định ngắn bằng tiếng Việt","actions":[{"node":"<mã nút>","type":"split","greens":[g1,g2,...],"reason":"..."},{"node":"<mã nút>","type":"offset","offset":<số>,"reason":"..."}]}`;

  AI.buildContext = function (project, band, ev, net, topN) {
    const P = project.params;
    const rows = [];
    net.nodes.forEach((nd, n) => {
      if (!nd.signalized || !net.inL[n].length || !nd.opt[band]) return;
      let d = 0, q = 0, sp = 0;
      for (const i of net.inL[n]) { d += ev.res.perLink[i].delay; q += ev.res.perLink[i].out; sp += ev.res.perLink[i].spillSec; }
      rows.push({ n, dpv: q > 0 ? d / q : 0, spill: sp });
    });
    rows.sort((a, b) => b.dpv - a.dpv);
    const pick = rows.slice(0, topN || 15);
    const nodes = pick.map(r => {
      const nd = net.nodes[r.n], pl = nd.opt[band], C = M.cycleOf(pl);
      return {
        node: nd.id, name: nd.name, C, offset: pl.offset,
        phases: pl.phases.map((ph, k) => ({ phase: k + 1, g: ph.g, y: ph.y, ar: ph.ar, minG: ph.minG || P.minGreen })),
        simDelay_s_per_veh: +r.dpv.toFixed(1), spill_link_min: +(r.spill / 60).toFixed(1),
        approaches: net.inL[r.n].map(i => {
          const l = net.links[i], ge = M.effGreen(pl, l.phases, P);
          return { from: net.nodes[l.u].id, dir: U.approachName(l.brg), road: l.road, q_pcu_h: Math.round(l.q), S_pcu_h: Math.round(l.S), phases: l.phases.map(k => k + 1), x: +(l.q / Math.max(1, l.S * ge / C)).toFixed(2), sim_delay_veh_h: +(ev.res.perLink[i].delay / 3600).toFixed(2), travel_s: Math.round(l.T) };
        }),
        downstream: net.outL[r.n].map(j => net.nodes[net.links[j].v].id),
      };
    });
    return { band, network: { J: +ev.J.toFixed(1), delay_veh_h: +ev.res.delayVehH.toFixed(1), avg_speed_kmh: +ev.res.avgSpeed.toFixed(1), stop_ratio: +(ev.res.stopRatio || 0).toFixed(2), spill_link_min: +ev.res.spillLinkMin.toFixed(0) }, worst_nodes: nodes };
  };

  function parseJSON(text) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e <= s) throw new Error('Phản hồi không có JSON');
    return JSON.parse(text.slice(s, e + 1));
  }

  let sdkPromise = null;
  AI.loadSDK = function () {
    if (!sdkPromise) sdkPromise = import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm').then(m => m.default || m.Anthropic);
    return sdkPromise;
  };

  /* Gọi Claude qua SDK chính thức (@anthropic-ai/sdk, chạy trong trình duyệt). */
  AI.askClaude = async function (apiKey, model, messages) {
    const Anthropic = await AI.loadSDK();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const req = { model: model || 'claude-opus-5', max_tokens: 16000, system: AI.LLM_SYSTEM, messages, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } };
    let resp;
    if ((model || 'claude-opus-5') === 'claude-opus-5') {
      resp = await client.beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req));
    } else resp = await client.messages.create(req);
    if (resp.stop_reason === 'refusal') throw new Error('Mô hình từ chối yêu cầu' + (resp.stop_details && resp.stop_details.explanation ? ': ' + resp.stop_details.explanation : ''));
    const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { text, content: resp.content, usage: resp.usage };
  };

  /* Vòng lặp: LLM đề xuất → áp từng đề xuất → CTM kiểm chứng → nhận/loại → phản hồi kết quả cho LLM. */
  AI.runLLM = async function (project, band, userOpts, progress, shouldStop, askFn) {
    const o = Object.assign({ rounds: 3, topN: 15, model: 'claude-opus-5' }, AI.DEFAULTS, userOpts || {});
    ensureOpt(project, band);
    const net = M.buildNet(project, band);
    const P = project.params;
    const ask = askFn || ((msgs) => AI.askClaude(o.apiKey, o.model, msgs));
    const t0 = Date.now();
    let cur = AI.evaluate(project, band, o, net);
    const start = cur.J;
    const trace = [{ it: 0, J: start, best: start }];
    const log = [];
    const messages = [];
    let step = 0;
    for (let round = 1; round <= o.rounds; round++) {
      if (shouldStop && shouldStop()) break;
      const ctx = AI.buildContext(project, band, cur, net, o.topN);
      const prompt = (round === 1 ? 'Dữ liệu mạng lưới hiện tại (JSON):\n' : 'Kết quả vòng trước đã áp dụng. Dữ liệu mới (JSON):\n') + JSON.stringify(ctx);
      messages.push({ role: 'user', content: prompt });
      if (progress) progress({ round, rounds: o.rounds, msg: `Vòng ${round}: đang hỏi mô hình…`, trace, log });
      const r = await ask(messages);
      messages.push({ role: 'assistant', content: r.content || r.text });
      let plan;
      try { plan = parseJSON(r.text); } catch (e) { log.push({ round, kind: 'err', text: 'Không đọc được JSON: ' + e.message }); messages.push({ role: 'user', content: 'Phản hồi trước không phải JSON hợp lệ. Hãy trả lại đúng một đối tượng JSON.' }); continue; }
      log.push({ round, kind: 'analysis', text: plan.analysis || '' });
      const feedback = [];
      for (const a of (plan.actions || []).slice(0, 8)) {
        if (shouldStop && shouldStop()) break;
        const n = net.nodeIdx.get(String(a.node));
        const nd = n !== undefined ? net.nodes[n] : null;
        if (!nd || !nd.opt[band]) { feedback.push({ node: a.node, result: 'bỏ qua: không có nút có đèn này' }); continue; }
        const pl = nd.opt[band], C = M.cycleOf(pl), keep = U.deepClone(pl);
        if (a.type === 'split' && Array.isArray(a.greens) && a.greens.length === pl.phases.length) {
          const IG = U.sum(pl.phases, ph => ph.y + ph.ar);
          const r2 = AI.projectGreens(a.greens.map(Number), pl.phases.map(ph => ph.minG || P.minGreen), C - IG);
          r2.forEach((v, k) => { pl.phases[k].g = v; });
        } else if (a.type === 'offset' && isFinite(a.offset)) pl.offset = Math.round(U.mod(+a.offset, C)) % C;
        else { feedback.push({ node: a.node, result: 'bỏ qua: sai định dạng' }); continue; }
        const ev = AI.evaluate(project, band, o, net);
        step++;
        const dJ = ev.J - cur.J;
        const ok = dJ < -1e-6;
        if (ok) cur = ev; else nd.opt[band] = keep;
        const item = { round, node: a.node, type: a.type, reason: a.reason || '', dJ, ok, value: a.type === 'split' ? pl.phases.map(p => p.g).join('/') : pl.offset };
        log.push(Object.assign({ kind: 'action' }, item));
        feedback.push({ node: a.node, type: a.type, accepted: ok, delta_J: +dJ.toFixed(2) });
        trace.push({ it: step, J: ev.J, best: cur.J });
        if (progress) progress({ round, rounds: o.rounds, msg: `Vòng ${round}: kiểm chứng ${a.node} (${ok ? 'nhận' : 'loại'})`, trace, log });
        await U.sleep(0);
      }
      messages.push({ role: 'user', content: 'Kết quả kiểm chứng mô phỏng các đề xuất (delta_J âm là tốt): ' + JSON.stringify(feedback) });
    }
    return { method: 'LLM', start, final: cur.J, gain: (start - cur.J) / start, finalRes: cur.res, trace, log, ms: Date.now() - t0 };
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
