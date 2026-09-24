/* Kiểm thử động cơ tính toán (chạy: node test/run-tests.js hoặc npm test). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TS = require('./load.js');
const { util: U, model: M, signal: SG, maxband: MB, zoning: Z, ctm: SIM, profile: PR, io: IO, demo: D, optimizer: OPT } = TS;

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);

/* Mạng 1 hành lang thẳng n nút cách đều L mét, hai chiều, 2 pha. */
function corridorProject(n, L, q, C, g1) {
  const p = M.newProject('test');
  for (let k = 0; k < n; k++) {
    const lon = 106.7 + k * L / 109000;
    p.nodes.push({ id: 'A' + k, name: 'A' + k, lat: 10.77, lon, plans: { am: { offset: 0, phases: [{ g: g1, y: 3, ar: 2 }, { g: C - g1 - 10, y: 3, ar: 2 }] } } });
  }
  for (let k = 0; k + 1 < n; k++) {
    p.links.push({ u: 'A' + k, v: 'A' + (k + 1), road: 'Trục', L, lanes: 2, phases: [0], data: { am: { q, v: 36 } } });
    p.links.push({ u: 'A' + (k + 1), v: 'A' + k, road: 'Trục', L, lanes: 2, phases: [0], data: { am: { q, v: 36 } } });
  }
  p.bands = [{ id: 'am', label: 'am' }];
  return M.normalizeProject(p);
}

test('Webster: C0 = (1.5L+5)/(1−Y)', () => {
  const P = M.DEFAULT_PARAMS;
  const r = SG.websterCycle(10, 0.5, P);
  near(r.C0, 40, 1e-9);
  assert.strictEqual(SG.websterCycle(10, 0.97, P).C0, P.Cmax);
});

test('Split cân bằng bão hoà: tổng đúng C, tôn trọng xanh tối thiểu', () => {
  const plan = { offset: 0, phases: [{ g: 30, y: 3, ar: 2, minG: 15 }, { g: 30, y: 3, ar: 2, minG: 15 }, { g: 20, y: 3, ar: 2, minG: 15 }] };
  const r = SG.equisatSplits(plan, [0.4, 0.2, 0.02], 100, M.DEFAULT_PARAMS);
  assert.strictEqual(r.g.reduce((a, b) => a + b, 0) + 15, 100);
  assert.ok(r.g[2] >= 15, 'minG');
  assert.ok(r.g[0] > r.g[1], 'tỷ lệ theo y');
});

test('HCM d1: x → 0 cho d1 = 0.5·C·(1−λ)²', () => {
  const h = SG.hcmDelay(1e-6, 1800, 45, 90);
  near(h.d1, 0.5 * 90 * 0.25, 1e-3);
  assert.strictEqual(SG.los(9, 0.5), 'A');
  assert.strictEqual(SG.los(60, 0.9), 'E');
  assert.strictEqual(SG.los(20, 1.05), 'F');
});

test('ITE: v=50 km/h → vàng 4 s', () => {
  const r = SG.iteIntergreen(50, 20);
  assert.strictEqual(r.y, 4);
  assert.ok(r.ar >= 1 && r.ar <= 4);
});

test('Tỷ lệ rẽ Furness bảo toàn lưu lượng nhánh', () => {
  const p = D.generate({ rows: 5, cols: 6, seed: 3 });
  const net = M.buildNet(p, 'am');
  for (const l of net.links) {
    const sumP = l.turn.reduce((a, t) => a + t.p, 0);
    if (l.turn.length) near(sumP, 1, 1e-6, 'Σp');
  }
  // lưu lượng đến nhánh j (thượng lưu + nguồn) ≈ q_j
  let err = 0, tot = 0;
  for (const l of net.links) { err += Math.abs(l.supply + l.srcRate - l.q); tot += l.q; }
  assert.ok(err / tot < 0.02, 'sai số cân bằng ' + (err / tot));
});

test('MAXBAND: hành lang 1 chiều đạt dải = xanh hiệu dụng nhỏ nhất', () => {
  const p = corridorProject(6, 300, 600, 90, 40);
  const net = M.buildNet(p, 'am');
  const corr = MB.buildCorridor(net, [0, 1, 2, 3, 4, 5]);
  const r = MB.optimize(net, corr, (n) => p.nodes[n].plans.am, 90, { wOut: 1, wIn: 0 });
  near(r.bands.bOut, 40, 1, 'bOut'); // xanh hiệu dụng = g (l1 = e = 2 s)
});

test('MAXBAND: hai chiều, khoảng cách = C/2·v → đạt dải hai chiều lớn', () => {
  // v = 36 km/h = 10 m/s, C = 90 → L = 450 m cho T = C/2
  const p = corridorProject(5, 450, 600, 90, 40);
  const net = M.buildNet(p, 'am');
  const corr = MB.buildCorridor(net, [0, 1, 2, 3, 4]);
  const r = MB.optimize(net, corr, (n) => p.nodes[n].plans.am, 90, { wOut: 1, wIn: 1 });
  assert.ok(r.bands.bOut >= 35 && r.bands.bIn >= 35, `b = ${r.bands.bOut}/${r.bands.bIn}`);
  const g = Z.gws(net, corr, (n) => p.nodes[n].plans.am, 90);
  assert.ok(g.phiDist > 95, 'Φdist ' + g.phiDist);
});

test('TRANSYT: offset sóng xanh giảm trễ so với offset ngược pha (trục 1 chiều)', () => {
  const p = corridorProject(6, 300, 900, 90, 45);
  p.links = p.links.filter((l, i) => i % 2 === 0); // chỉ giữ chiều đi
  const net = M.buildNet(p, 'am');
  const T = net.links[0].T * p.params.beta; // thời gian dịch đầu đoàn xe (Robertson)
  const good = [], bad = [];
  for (let k = 0; k < 6; k++) { good.push(Math.round(k * T) % 90); bad.push(Math.round(k * T + 45 * (k % 2)) % 90); }
  const ev = (offs) => PR.create(net, (n) => Object.assign({}, p.nodes[n].plans.am, { offset: offs[n] })).fullEval(3);
  const a = ev(good), b = ev(bad);
  assert.ok(a.delay < b.delay * 0.8, `trễ ${a.delay} vs ${b.delay}`);
  assert.ok(a.stops < b.stops, `dừng ${a.stops} vs ${b.stops}`);
});

test('CTM: bảo toàn xe (vào = ra + trong mạng)', () => {
  const p = D.generate({ rows: 4, cols: 5, seed: 5 });
  const net = M.buildNet(p, 'am');
  const sim = SIM.create(net, { scenario: 'base', dt: 2, warmup: 0, duration: 600 });
  sim.run(600);
  let inside = 0; for (let x = 0; x < sim.n.length; x++) inside += sim.n[x];
  const r = sim.results();
  near(r.entries, sim.K.exits + inside, 1e-6 * r.entries + 1e-6, 'bảo toàn');
});

test('CTM: cân bằng vào/ra và lưu lượng vạch dừng khớp số đo khi chưa bão hoà', () => {
  const p = D.generate({ rows: 5, cols: 6, seed: 12 });
  for (const l of p.links) l.data.am.q = Math.round(l.data.am.q * 0.6);
  for (const n of p.nodes) { const r = SG.optimizeNode(M.buildNet(p, 'am'), p.nodes.indexOf(n), n.plans.am); n.plans.am = r.plan; }
  const net = M.buildNet(p, 'am');
  const { res, sim } = SIM.runBatch(net, { scenario: 'base', dt: 1, warmup: 1200, duration: 1800 });
  near(res.exits / res.entries, 1, 0.03, 'vào ≈ ra');
  let err = 0, tot = 0;
  net.links.forEach((l, i) => { err += Math.abs(sim.K.out[i] / 1800 * 3600 - l.q); tot += l.q; });
  assert.ok(err / tot < 0.1, 'sai lệch lưu lượng vạch dừng ' + (err / tot));
});

test('CTM: nhánh hạ lưu đầy chặn xả (tràn ngược)', () => {
  const p = corridorProject(3, 200, 1500, 60, 25);
  // nút cuối đỏ gần như toàn bộ cho trục → hàng chờ lan ngược
  p.nodes[2].plans.am.phases = [{ g: 5, y: 3, ar: 2 }, { g: 110, y: 3, ar: 2 }];
  const net = M.buildNet(p, 'am');
  const sim = SIM.create(net, { scenario: 'base', dt: 1, warmup: 0, duration: 1200 });
  sim.run(1200);
  const r = sim.results();
  assert.ok(r.spillLinkMin > 1, 'phải có tràn ngược: ' + r.spillLinkMin);
});

test('Max Pressure chạy được và giữ an toàn vàng/đỏ', () => {
  const p = D.generate({ rows: 3, cols: 3, seed: 8 });
  const net = M.buildNet(p, 'am');
  const sim = SIM.create(net, { scenario: 'base', mode: 'mp', dt: 1, warmup: 0 });
  let lastK = sim.ctrl.map(c => c && c.k), sawYellow = false;
  for (let t = 0; t < 900; t++) {
    sim.step();
    sim.ctrl.forEach((c, i) => {
      if (!c) return;
      if (c.part === 'y') sawYellow = true;
      if (c.k !== lastK[i]) assert.strictEqual(c.part, 'g', 'đổi pha phải qua vàng/đỏ');
      lastK[i] = c.k;
    });
  }
  assert.ok(sawYellow);
});

test('Louvain tách 2 cụm nối yếu', () => {
  const p = M.newProject('t'); p.bands = [{ id: 'am', label: 'am' }];
  const add = (id, lon, lat) => p.nodes.push({ id, name: id, lon, lat, plans: { am: { offset: 0, phases: [{ g: 30, y: 3, ar: 2 }, { g: 30, y: 3, ar: 2 }] } } });
  for (let k = 0; k < 4; k++) { add('L' + k, 106.70 + (k % 2) * 0.003, 10.77 + Math.floor(k / 2) * 0.003); add('R' + k, 106.72 + (k % 2) * 0.003, 10.77 + Math.floor(k / 2) * 0.003); }
  const link = (a, b, q) => { p.links.push({ u: a, v: b, lanes: 2, data: { am: { q, v: 30 } } }); p.links.push({ u: b, v: a, lanes: 2, data: { am: { q, v: 30 } } }); };
  for (const s of ['L', 'R']) { link(s + 0, s + 1, 1500); link(s + 2, s + 3, 1500); link(s + 0, s + 2, 1500); link(s + 1, s + 3, 1500); }
  link('L1', 'R0', 50);
  M.normalizeProject(p);
  const net = M.buildNet(p, 'am');
  const part = Z.partition(net, new Array(net.N).fill(90), [], { minSize: 2, gamma: 1 });
  const zl = net.nodes.map((n, i) => part.zoneOf[i]);
  const zL = new Set(net.nodes.map((n, i) => n.id[0] === 'L' ? zl[i] : null).filter(x => x !== null));
  const zR = new Set(net.nodes.map((n, i) => n.id[0] === 'R' ? zl[i] : null).filter(x => x !== null));
  assert.strictEqual(zL.size, 1); assert.strictEqual(zR.size, 1);
  assert.notStrictEqual([...zL][0], [...zR][0]);
});

test('CSV: xuất → nhập lại giữ nguyên dữ liệu', () => {
  const p = D.generate({ rows: 3, cols: 3, seed: 4 });
  const q = M.newProject('rt'); q.bands = p.bands;
  IO.importNodesCSV(q, IO.nodesCSV(p));
  IO.importPlansCSV(q, IO.plansCSV(p));
  IO.importLinksCSV(q, IO.linksCSV(p));
  assert.strictEqual(q.nodes.length, p.nodes.length);
  assert.strictEqual(q.links.length, p.links.length);
  assert.strictEqual(M.cycleOf(q.nodes[4].plans.pm), M.cycleOf(p.nodes[4].plans.pm));
  assert.strictEqual(q.links[7].data.am.q, p.links[7].data.am.q);
  assert.deepStrictEqual(q.links[7].phases, p.links[7].phases);
});

test('CSV hướng tiếp cận: quy đổi pcu từ số đếm phân loại', () => {
  const p = D.generate({ rows: 3, cols: 3, seed: 4 });
  const txt = 'ma_nut,huong,khung_gio,xe_may,o_to,xe_tai,xe_buyt,thoi_gian_dem_phut\nN0202,Bắc,am,100,20,0,0,15\n';
  const r = IO.importApproachCSV(p, txt);
  assert.strictEqual(r.ok, 1);
  const l = p.links.find(x => x.v === 'N0202' && x.u === 'N0302');
  assert.strictEqual(l.data.am.q, (100 * 0.3 + 20) * 4);
});

test('Nhập Green Zone Player: trích DATA từ index.html', () => {
  const html = '<script>\nconst DATA = {"nodes":{"A":{"lon":106.7,"lat":10.77,"s1":"X","s2":"Y","flash":false,"bands":{"am_x":{"g":[37,37],"ig":[5,5],"g_old":[35,35],"theta":12}}},"B":{"lon":106.703,"lat":10.77,"s1":"X","s2":"Z","flash":false,"bands":{"am_x":{"g":[37,37],"ig":[5,5],"g_old":[35,35],"theta":40}}}},"links":[{"u":"A","v":"B","L":330,"road":"X","geom":[[106.7,10.77],[106.703,10.77]],"bands":{"am_x":{"pu":1,"pv":1,"q":500,"qm":"du_same_road"}}}],"boundary":[],"corridors":{},"meta":{"bands":{"am_x":"Sáng"},"pcu_per_q":0.001,"sat_pcu_s":1.2,"v_kmh":30}}, META = DATA.meta;\n</script>';
  const p = IO.fromGreenZone(IO.extractGreenZoneData(html));
  assert.strictEqual(p.nodes.length, 2);
  assert.strictEqual(M.cycleOf(p.nodes[0].plans.am_x), 80);
  assert.strictEqual(M.cycleOf(p.nodes[0].opt.am_x), 84);
  assert.strictEqual(p.nodes[1].opt.am_x.offset, 40);
  assert.strictEqual(p.links[0].data.am_x.q, 1800); // 500 × 0.001 pcu/s × 3600
});

test('OSM: gộp nút đường đôi, rút gọn nút bậc 2, gán đèn lệch tâm, pha theo trục', () => {
  const fx = require('./osm-fixture.js')();
  const { project: p, stats } = TS.osm.buildProject(fx.data, { poly: fx.poly, R: 30 });
  assert.strictEqual(p.nodes.length, 5, 'số nút giao bậc ≥ 3');
  assert.strictEqual(stats.signals, 2);
  assert.ok(!p.links.some(l => l.road === 'Ngoài vùng'), 'cắt theo đa giác');
  assert.ok(!p.links.some(l => l.road === 'Hẻm'), 'lọc cấp đường');
  const mid = p.nodes.find(n => n.name.includes('Đại lộ A') && n.signalized);
  const ins = p.links.filter(l => l.v === mid.id);
  assert.strictEqual(ins.length, 4);
  const avenue = ins.filter(l => l.road === 'Đại lộ A');
  assert.strictEqual(avenue.length, 2);
  assert.ok(avenue.every(l => l.phases[0] === 0) && ins.filter(l => l.road !== 'Đại lộ A').every(l => l.phases[0] === 1), 'trục chính pha 1, trục phụ pha 2');
  assert.ok(avenue.every(l => l.lanes === 3), 'số làn một chiều của đường đôi');
  // phố một chiều oneway=-1 chỉ có một chiều
  assert.strictEqual(p.links.filter(l => l.road === 'Phố C').length, 2);
  const net = M.buildNet(p, 'am');
  const r = SIM.runBatch(net, { scenario: 'base', dt: 2, warmup: 300, duration: 600 }).res;
  assert.ok(r.exits > 0 && isFinite(r.delayVehH));
});

test('AI: chiếu xanh khả thi; SPSA không làm xấu; vòng LLM chỉ nhận đề xuất tốt hơn', async () => {
  const g = TS.aiopt.projectGreens([10, 80, 3], [15, 15, 15], 90);
  assert.strictEqual(g.reduce((a, b) => a + b, 0), 90); assert.ok(g.every(x => x >= 15));
  const p = D.generate({ rows: 4, cols: 5, seed: 9 });
  await OPT.run(p, 'am', { verifyCTM: false });
  const r = await TS.aiopt.runSPSA(p, 'am', { iters: 6, duration: 600 });
  assert.ok(r.final <= r.start + 1e-9, `SPSA ${r.final} > ${r.start}`);
  for (const n of p.nodes) { const pl = n.opt.am; const C = M.cycleOf(pl); assert.ok(pl.offset >= 0 && pl.offset < C); for (const ph of pl.phases) assert.ok(ph.g >= (ph.minG || p.params.minGreen)); }
  const mock = async (msgs) => {
    const ctx = JSON.parse(msgs[msgs.length - 1].content.split('\n').slice(1).join('\n'));
    const n = ctx.worst_nodes[0];
    const t = JSON.stringify({ analysis: 'thử', actions: [{ node: n.node, type: 'offset', offset: (n.offset + 7) % n.C, reason: 'r' }, { node: 'KHONG_CO', type: 'split', greens: [1], reason: 'x' }] });
    return { text: t, content: [{ type: 'text', text: t }] };
  };
  const r2 = await TS.aiopt.runLLM(p, 'am', { rounds: 2, duration: 600 }, null, null, mock);
  assert.ok(r2.final <= r2.start + 1e-9);
  assert.ok(r2.log.filter(x => x.kind === 'action').every(x => x.ok === (x.dJ < 0)));
});

test('Pipeline tối ưu 150 nút: đề xuất tốt hơn hiện trạng', async () => {
  const p = D.generate({ rows: 10, cols: 15, seed: 7 });
  const r = await OPT.run(p, 'am', { verifyCTM: true, ctmDuration: 900, ctmWarmup: 300 });
  assert.ok(r.opt.delay < r.base.delay, `trễ ${r.opt.delay} ≥ ${r.base.delay}`);
  assert.ok(r.zones.length >= 2);
  assert.ok(r.recs.length >= r.zones.length);
  for (const n of p.nodes) {
    const o = n.opt.am;
    assert.ok(o, 'mọi nút có đề xuất');
    for (const ph of o.phases) assert.ok(ph.g >= Math.min(p.params.minGreen, ph.minG || 99) - 1e-9, 'xanh tối thiểu');
  }
  // chu kỳ trong một vùng phải đồng nhất (hoặc bằng ½)
  for (const z of r.zones) {
    if (z.isolated) continue;
    const cs = z.ids.map(id => M.cycleOf(p.nodes.find(n => n.id === id).opt.am));
    for (const c of cs) assert.ok(c === z.C || c * 2 === z.C, `C ${c} trong vùng C=${z.C}`);
  }
  // CTM: phương án đề xuất không làm tăng trễ
  const net = M.buildNet(p, 'am');
  const a = SIM.runBatch(net, { scenario: 'base', dt: 2, warmup: 300, duration: 900 }).res;
  const b = SIM.runBatch(net, { scenario: 'opt', dt: 2, warmup: 300, duration: 900 }).res;
  assert.ok(b.delayVehH < a.delayVehH, `CTM ${b.delayVehH} ≥ ${a.delayVehH}`);
});

(async () => {
  for (const [name, fn] of tests) {
    const t0 = Date.now();
    try { await fn(); pass++; console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); }
    catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})();
void fs; void path; void U;
