/* Sinh dữ liệu mẫu GIẢ LẬP quy mô 500 nút (lưới đô thị khu trung tâm TP.HCM, toạ độ gần đúng).
 * Tên đường là tên quy ước (Trục ĐT-xx / BN-xx), KHÔNG phải số liệu thật — chỉ để chạy thử và đào tạo.
 * Hiện trạng cố ý "chưa phối hợp": chu kỳ lệch nhau, offset ngẫu nhiên, split chưa cân theo lưu lượng. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const D = TS.demo = {};

  D.generate = function (opts) {
    const o = Object.assign({ rows: 20, cols: 25, seed: 2026, lon0: 106.655, lat0: 10.745, dLon: 0.0034, dLat: 0.0034 }, opts || {});
    const rnd = U.rng(o.seed);
    const p = M.newProject('Mạng mẫu ' + (o.rows * o.cols) + ' nút (giả lập)');
    const rowCls = (r) => (r % 5 === 2 ? 'A' : r % 5 === 0 ? 'C' : 'L');
    const colCls = (c) => (c % 6 === 3 ? 'A' : c % 6 === 0 ? 'C' : 'L');
    const rowName = (r) => (rowCls(r) === 'A' ? 'Trục ĐT-' : rowCls(r) === 'C' ? 'Đường ĐT-' : 'Hẻm lớn ĐT-') + String(r + 1).padStart(2, '0');
    const colName = (c) => (colCls(c) === 'A' ? 'Trục BN-' : colCls(c) === 'C' ? 'Đường BN-' : 'Hẻm lớn BN-') + String(c + 1).padStart(2, '0');
    const id = (r, c) => 'N' + String(r + 1).padStart(2, '0') + String(c + 1).padStart(2, '0');
    const cx = (o.cols - 1) / 2, cy = (o.rows - 1) / 2;
    const bandIds = p.bands.map(b => b.id);
    // ── nút ──
    const grid = [];
    for (let r = 0; r < o.rows; r++) {
      grid.push([]);
      for (let c = 0; c < o.cols; c++) {
        const lon = o.lon0 + c * o.dLon + (rnd() - 0.5) * 0.0011 + Math.sin(r * 0.7) * 0.0006;
        const lat = o.lat0 + r * o.dLat + (rnd() - 0.5) * 0.0011 + Math.cos(c * 0.5) * 0.0005;
        const cls = [rowCls(r), colCls(c)].sort().join('');
        const width = cls.includes('A') ? 24 : cls.includes('C') ? 18 : 12;
        const node = { id: id(r, c), name: rowName(r) + ' × ' + colName(c), lat: U.round(lat, 6), lon: U.round(lon, 6), signalized: true, control: 'fixed', width, plans: {}, opt: {} };
        const nPh = cls === 'AA' && rnd() < 0.25 ? 3 : 2;
        const baseC = cls === 'AA' ? rnd.pick([100, 110, 120]) : cls.includes('A') ? rnd.pick([80, 90, 100]) : cls.includes('C') ? rnd.pick([70, 80, 90]) : rnd.pick([60, 60, 70]);
        for (const b of bandIds) {
          const C = b === 'night' ? rnd.pick([50, 60]) : b === 'mid' ? Math.max(60, baseC - 10) : baseC;
          const ig = nPh * 5;
          const avail = C - ig;
          const shares = nPh === 2 ? [0.5 + (rnd() - 0.5) * 0.16] : [0.44, 0.28];
          if (nPh === 2) shares.push(1 - shares[0]); else shares.push(1 - shares[0] - shares[1]);
          const g = shares.map(s => Math.max(12, Math.round(s * avail)));
          g[g.length - 1] = Math.max(12, avail - U.sum(g.slice(0, -1)));
          node.plans[b] = { offset: Math.floor(rnd() * C), phases: g.map(x => ({ g: x, y: 3, ar: 2 })) };
        }
        grid[r].push(node);
        p.nodes.push(node);
      }
    }
    // ── liên kết ──
    const addLink = (a, b, road, cls) => {
      const lanes = cls === 'A' ? 3 : cls === 'C' ? 2 : 1;
      const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2;
      const bend = (rnd() - 0.5) * 0.00025;
      const geom = [[a.lon, a.lat], [U.round(mx + bend, 6), U.round(my - bend, 6)], [b.lon, b.lat]];
      p.links.push({ u: a.id, v: b.id, road, lanes, geom, data: {}, _cls: cls });
    };
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
      const a = grid[r][c];
      if (c + 1 < o.cols) {
        const b = grid[r][c + 1], cls = rowCls(r);
        if (!(cls === 'L' && rnd() < 0.07)) {
          const oneway = cls === 'L' && rnd() < 0.25;
          const dir = r % 2 === 0;
          if (!oneway || dir) addLink(a, b, rowName(r), cls);
          if (!oneway || !dir) addLink(b, a, rowName(r), cls);
        }
      }
      if (r + 1 < o.rows) {
        const b = grid[r + 1][c], cls = colCls(c);
        if (!(cls === 'L' && rnd() < 0.07)) {
          const oneway = cls === 'L' && rnd() < 0.25;
          const dir = c % 2 === 0;
          if (!oneway || dir) addLink(a, b, colName(c), cls);
          if (!oneway || !dir) addLink(b, a, colName(c), cls);
        }
      }
    }
    // ── lưu lượng, vận tốc theo khung giờ ──
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    const pos = new Map();
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) pos.set(grid[r][c].id, [r, c]);
    for (const l of p.links) {
      const [ru, cu] = pos.get(l.u), [rv, cv] = pos.get(l.v);
      const du = Math.hypot(ru - cy, cu - cx), dv = Math.hypot(rv - cy, cv - cx);
      const inbound = dv < du; // hướng vào trung tâm
      const hot = 1 + 0.35 * Math.exp(-((rv - cy) ** 2 + (cv - cx) ** 2) / 40);
      const base = (l._cls === 'A' ? 1150 : l._cls === 'C' ? 650 : 280) * (0.8 + 0.4 * rnd()) * hot;
      const vbase = (l._cls === 'A' ? 33 : l._cls === 'C' ? 28 : 23) + (rnd() - 0.5) * 6;
      const measured = rnd() < 0.62;
      for (const b of bandIds) {
        let f = 1, vf = 1;
        if (b === 'am') { f = inbound ? 1.22 : 0.82; vf = 0.85; }
        else if (b === 'pm') { f = inbound ? 0.85 : 1.25; vf = 0.82; }
        else if (b === 'mid') { f = 0.78; vf = 0.95; }
        else if (b === 'night') { f = 0.24; vf = 1.25; }
        l.data[b] = { q: Math.round(base * f * (0.93 + 0.14 * rnd())), v: Math.round(vbase * vf), src: measured ? 'measured' : 'imputed' };
      }
      delete l._cls;
    }
    void byId;
    M.normalizeProject(p);
    M.autoAssignPhases(p);
    return p;
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
