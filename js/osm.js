/* Dựng mạng lưới từ OpenStreetMap trong một vùng đa giác.
 *
 *  1. Tải dữ liệu qua Overpass API (lọc theo vùng `poly:`) hoặc đọc file .osm (XML) / .json (Overpass).
 *  2. Lấy các đường `highway` theo cấp chọn, cắt theo đa giác, tách tại điểm giao nhau.
 *  3. GỘP NÚT: các điểm giao cách nhau < R (đường đôi, dải phân cách) gộp thành một nút giao.
 *  4. Rút gọn các điểm nối bậc 2 không có đèn (đường đổi tên, điểm gấp khúc) → một liên kết.
 *  5. Nhánh có hướng theo `oneway`; số làn từ `lanes`, `lanes:forward/backward`, `width` hoặc mặc định theo cấp.
 *  6. Đèn: nút OSM `highway=traffic_signals` (thường đặt ở vạch dừng, lệch tâm vài chục mét) gán về nút giao gần nhất.
 *  7. Gán pha theo TRỤC: các nhánh vào được nhóm theo phương (mod 180°), trục chính (nhiều làn) = pha 1. */
(function (TS) {
  'use strict';
  const U = TS.util, M = TS.model;
  const OSM = TS.osm = {};

  OSM.CLASSES = {
    motorway: { label: 'Cao tốc', lanes: 2, v: 60, q: 1500, rank: 7 },
    trunk: { label: 'Quốc lộ / trục chính', lanes: 3, v: 45, q: 1500, rank: 6 },
    primary: { label: 'Đường chính (primary)', lanes: 2, v: 40, q: 1100, rank: 5 },
    secondary: { label: 'Đường cấp 2 (secondary)', lanes: 2, v: 35, q: 800, rank: 4 },
    tertiary: { label: 'Đường cấp 3 (tertiary)', lanes: 1, v: 30, q: 500, rank: 3 },
    unclassified: { label: 'Đường không phân cấp', lanes: 1, v: 25, q: 250, rank: 2 },
    residential: { label: 'Đường khu dân cư', lanes: 1, v: 25, q: 200, rank: 1 },
    living_street: { label: 'Đường nội bộ', lanes: 1, v: 15, q: 80, rank: 0 },
  };
  OSM.DEFAULT_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
  OSM.ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

  const classOf = (hw) => {
    if (!hw) return null;
    const base = hw.replace(/_link$/, '');
    return OSM.CLASSES[base] ? base : null;
  };

  /* poly: [[lon, lat], ...] */
  OSM.buildQuery = function (poly, classes) {
    const cls = [];
    for (const c of classes) { cls.push(c); if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(c)) cls.push(c + '_link'); }
    const ps = poly.map(p => `${p[1].toFixed(6)} ${p[0].toFixed(6)}`).join(' ');
    return `[out:json][timeout:180];
(
  way["highway"~"^(${cls.join('|')})$"]["area"!="yes"](poly:"${ps}");
  node["highway"="traffic_signals"](poly:"${ps}");
);
out body;
>;
out skel qt;`;
  };

  OSM.fetchOverpass = async function (query, onStatus) {
    let lastErr = null;
    for (const url of OSM.ENDPOINTS) {
      try {
        if (onStatus) onStatus('Đang tải từ ' + new URL(url).host + '…');
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const js = await res.json();
        if (!js.elements) throw new Error('Phản hồi không hợp lệ');
        return js;
      } catch (e) { lastErr = e; }
    }
    throw new Error('Không tải được dữ liệu OSM (' + (lastErr ? lastErr.message : '') + '). Kiểm tra mạng hoặc dùng "Nhập file OSM".');
  };

  /* Đọc file .osm (XML) → cùng cấu trúc JSON của Overpass. */
  OSM.parseXML = function (text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const els = [];
    const tagsOf = (el) => { const t = {}; for (const k of el.getElementsByTagName('tag')) t[k.getAttribute('k')] = k.getAttribute('v'); return t; };
    for (const n of doc.getElementsByTagName('node')) els.push({ type: 'node', id: +n.getAttribute('id'), lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'), tags: tagsOf(n) });
    for (const w of doc.getElementsByTagName('way')) els.push({ type: 'way', id: +w.getAttribute('id'), nodes: [...w.getElementsByTagName('nd')].map(x => +x.getAttribute('ref')), tags: tagsOf(w) });
    return { elements: els };
  };
  OSM.parseFile = function (text) {
    const t = text.trim();
    if (t.startsWith('{')) return JSON.parse(t);
    return OSM.parseXML(t);
  };

  OSM.pointInPoly = function (pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  OSM.polyAreaKm2 = function (poly) {
    const m = poly.map(p => U.project(p[0], p[1]));
    let a = 0; for (let i = 0; i < m.length; i++) { const p = m[i], q = m[(i + 1) % m.length]; a += p[0] * q[1] - q[0] * p[1]; }
    const lat = U.mean(poly, p => p[1]) * Math.PI / 180;
    return Math.abs(a) / 2 * Math.cos(lat) ** 2 / 1e6;
  };

  function parseNum(s) { if (s === undefined || s === null) return null; const m = String(s).match(/[\d.]+/); return m ? +m[0] : null; }
  function onewayOf(tags) {
    const o = (tags.oneway || '').toLowerCase();
    if (o === 'yes' || o === 'true' || o === '1') return 1;
    if (o === '-1' || o === 'reverse') return -1;
    if (o === 'no' || o === 'false' || o === '0') return 0;
    if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
    if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
    return 0;
  }
  function lanesOf(tags, cls, oneway) {
    const L = parseNum(tags.lanes), fw = parseNum(tags['lanes:forward']), bw = parseNum(tags['lanes:backward']);
    const w = parseNum(tags.width);
    const def = OSM.CLASSES[cls].lanes;
    let f, b;
    if (oneway) { f = L || (w ? Math.max(1, Math.round(w / 3.25)) : def); b = f; }
    else {
      f = fw || (L ? Math.max(1, Math.ceil(L / 2)) : (w ? Math.max(1, Math.round(w / 2 / 3.25)) : def));
      b = bw || (L ? Math.max(1, Math.floor(L / 2)) || 1 : f);
    }
    return { f: U.clamp(f, 1, 8), b: U.clamp(b, 1, 8), width: w };
  }

  /* Dựng dự án từ dữ liệu OSM. opts: {poly, classes, R, keepMidSignals, defaultFlows, name} */
  OSM.buildProject = function (data, opts) {
    const o = Object.assign({ classes: OSM.DEFAULT_CLASSES, R: 30, keepMidSignals: false, defaultFlows: true, name: 'Mạng OSM' }, opts || {});
    const nodes = new Map(), ways = [], sigNodes = [];
    for (const e of data.elements || []) {
      if (e.type === 'node') {
        nodes.set(e.id, { lon: e.lon, lat: e.lat, tags: e.tags || {} });
      }
    }
    for (const e of data.elements || []) {
      if (e.type === 'way' && e.tags && classOf(e.tags.highway) && o.classes.includes(classOf(e.tags.highway)) && e.tags.area !== 'yes') ways.push(e);
      if (e.type === 'node' && e.tags && e.tags.highway === 'traffic_signals') sigNodes.push(e.id);
    }
    const poly = o.poly && o.poly.length >= 3 ? o.poly : null;
    const inside = new Map();
    const isIn = (id) => {
      if (!poly) return nodes.has(id);
      if (!inside.has(id)) { const n = nodes.get(id); inside.set(id, !!n && OSM.pointInPoly([n.lon, n.lat], poly)); }
      return inside.get(id);
    };
    // 1) các đoạn liên tục nằm trong vùng
    const runs = [];
    for (const w of ways) {
      let cur = [];
      for (const id of w.nodes) {
        if (isIn(id)) cur.push(id);
        else { if (cur.length >= 2) runs.push({ w, ids: cur }); cur = []; }
      }
      if (cur.length >= 2) runs.push({ w, ids: cur });
    }
    // 2) điểm giao: dùng ≥ 2 lần, đầu mút, hoặc đèn giữa đoạn (tuỳ chọn)
    const use = new Map(), endpoint = new Set();
    for (const r of runs) {
      r.ids.forEach((id, k) => { use.set(id, (use.get(id) || 0) + 1); if (k === 0 || k === r.ids.length - 1) endpoint.add(id); });
    }
    const sigSet = new Set(sigNodes);
    const isJ = (id) => (use.get(id) || 0) >= 2 || endpoint.has(id) || (o.keepMidSignals && sigSet.has(id));
    const segs = [];
    for (const r of runs) {
      const cls = classOf(r.w.tags.highway), ow = onewayOf(r.w.tags);
      const ln = lanesOf(r.w.tags, cls, ow);
      let start = 0;
      for (let k = 1; k < r.ids.length; k++) {
        if (isJ(r.ids[k]) || k === r.ids.length - 1) {
          const ids = r.ids.slice(start, k + 1);
          const pts = ids.map(id => { const n = nodes.get(id); return [n.lon, n.lat]; });
          segs.push({ a: ids[0], b: ids[ids.length - 1], pts, len: U.polylineLength(pts), cls, name: r.w.tags.name || r.w.tags.ref || '', fwd: ow >= 0, bwd: ow <= 0, lanesF: ow === -1 ? ln.b : ln.f, lanesB: ow === -1 ? ln.f : ln.b, vmax: parseNum(r.w.tags.maxspeed), wayId: r.w.id, reversed: ow === -1 });
          start = k;
        }
      }
    }
    // chiều oneway=-1: đảo hình học để luôn đi a→b
    for (const s of segs) if (s.reversed) { s.pts.reverse(); [s.a, s.b] = [s.b, s.a]; s.fwd = true; s.bwd = false; }
    // 3) gộp điểm giao gần nhau (đường đôi, nút phức hợp)
    const jids = [...new Set(segs.flatMap(s => [s.a, s.b]))];
    const parent = new Map(jids.map(id => [id, id]));
    const box = new Map(jids.map(id => { const n = nodes.get(id); return [id, [n.lon, n.lat, n.lon, n.lat]]; }));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const diag = (b) => U.haversine([b[0], b[1]], [b[2], b[3]]);
    const unite = (a, b) => {
      const ra = find(a), rb = find(b); if (ra === rb) return;
      const A = box.get(ra), B = box.get(rb);
      const nb = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
      if (diag(nb) > 2.5 * o.R) return; // không gộp quá rộng (chuỗi nút dày dọc một tuyến)
      parent.set(rb, ra); box.set(ra, nb);
    };
    const shortSegs = segs.filter(s => s.len < o.R).sort((a, b) => a.len - b.len);
    for (const s of shortSegs) unite(s.a, s.b);
    // gộp theo khoảng cách (điểm giao không nối trực tiếp nhưng rất gần)
    const cell = o.R / 2 / 111000;
    const grid = new Map();
    for (const id of jids) { const n = nodes.get(id); const k = Math.floor(n.lon / cell) + ':' + Math.floor(n.lat / cell); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); }
    for (const id of jids) {
      const n = nodes.get(id), gx = Math.floor(n.lon / cell), gy = Math.floor(n.lat / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get((gx + dx) + ':' + (gy + dy)) || []) {
        if (j !== id && U.haversine([n.lon, n.lat], [nodes.get(j).lon, nodes.get(j).lat]) < o.R / 2) unite(id, j);
      }
    }
    const cl = new Map(); // gốc → {ids, lon, lat}
    for (const id of jids) { const r = find(id); if (!cl.has(r)) cl.set(r, { ids: [], signal: false }); cl.get(r).ids.push(id); }
    for (const c of cl.values()) { c.lon = U.mean(c.ids, id => nodes.get(id).lon); c.lat = U.mean(c.ids, id => nodes.get(id).lat); }
    // cạnh giữa các cụm
    let edges = [];
    for (const s of segs) {
      const A = find(s.a), B = find(s.b);
      if (A === B) continue;
      const pts = s.pts.slice(); pts[0] = [cl.get(A).lon, cl.get(A).lat]; pts[pts.length - 1] = [cl.get(B).lon, cl.get(B).lat];
      edges.push(Object.assign({}, s, { A, B, pts }));
    }
    // 4) đèn tín hiệu → cụm gần nhất
    const clArr = [...cl.entries()];
    const Rsig = Math.max(40, o.R + 15);
    let sigAssigned = 0, sigLost = 0;
    for (const sid of sigNodes) {
      const n = nodes.get(sid); if (!n) continue;
      if (poly && !OSM.pointInPoly([n.lon, n.lat], poly)) continue;
      let best = null, bd = Rsig;
      for (const [k, c] of clArr) { const d = U.haversine([n.lon, n.lat], [c.lon, c.lat]); if (d < bd) { bd = d; best = k; } }
      if (best !== null) { cl.get(best).signal = true; sigAssigned++; } else sigLost++;
    }
    // 5) rút gọn nút bậc 2 không đèn
    const boundary = new Set();
    for (const [k, c] of cl) if (c.ids.some(id => endpoint.has(id) && (use.get(id) || 0) === 1)) boundary.add(k);
    let changed = true, guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      const inc = new Map();
      edges.forEach((e, i) => { for (const k of [e.A, e.B]) { if (!inc.has(k)) inc.set(k, []); inc.get(k).push(i); } });
      const dead = new Set();
      for (const [k, list] of inc) {
        if (list.length !== 2 || cl.get(k).signal || boundary.has(k)) continue;
        const [i1, i2] = list; if (dead.has(i1) || dead.has(i2)) continue;
        let e1 = edges[i1], e2 = edges[i2];
        // chuẩn hoá: e1 = P→k, e2 = k→Q
        const flip = (e) => Object.assign({}, e, { A: e.B, B: e.A, pts: e.pts.slice().reverse(), fwd: e.bwd, bwd: e.fwd, lanesF: e.lanesB, lanesB: e.lanesF });
        if (e1.B !== k) e1 = flip(e1);
        if (e2.A !== k) e2 = flip(e2);
        if (e1.A === e2.B) continue;
        const fwd = e1.fwd && e2.fwd, bwd = e1.bwd && e2.bwd;
        if (!fwd && !bwd) continue;
        const main = e1.len >= e2.len ? e1 : e2;
        edges[i1] = Object.assign({}, main, { A: e1.A, B: e2.B, pts: e1.pts.concat(e2.pts.slice(1)), len: e1.len + e2.len, fwd, bwd,
          lanesF: Math.min(e1.lanesF, e2.lanesF), lanesB: Math.min(e1.lanesB, e2.lanesB), name: e1.name === e2.name ? e1.name : (main.name || e1.name || e2.name) });
        dead.add(i2); changed = true;
      }
      if (dead.size) edges = edges.filter((_, i) => !dead.has(i));
    }
    // 6) nút & nhánh của dự án
    const p = M.newProject(o.name);
    const used = new Set(edges.flatMap(e => [e.A, e.B]));
    const idOf = new Map();
    const namesAt = new Map();
    for (const e of edges) for (const k of [e.A, e.B]) { if (!namesAt.has(k)) namesAt.set(k, new Map()); if (e.name) namesAt.get(k).set(e.name, (namesAt.get(k).get(e.name) || 0) + OSM.CLASSES[e.cls].rank + 1); }
    let seq = 0;
    for (const k of used) {
      const c = cl.get(k);
      const id = 'O' + String(++seq).padStart(4, '0');
      idOf.set(k, id);
      const nm = [...(namesAt.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 2);
      p.nodes.push({ id, name: nm.length ? nm.join(' × ') : 'Nút ' + id, lat: U.round(c.lat, 6), lon: U.round(c.lon, 6), signalized: c.signal, control: 'fixed',
        width: 20, landuse: boundary.has(k) ? 'cua_ngo' : 'thuong', osm: c.ids.slice(0, 6), plans: {}, opt: {} });
    }
    const pairs = new Map();
    const addLink = (e, dir) => {
      const u = dir ? e.A : e.B, v = dir ? e.B : e.A;
      const key = u + '>' + v, lanes = dir ? e.lanesF : e.lanesB;
      const geom = (dir ? e.pts : e.pts.slice().reverse()).map(q => [U.round(q[0], 6), U.round(q[1], 6)]);
      const C = OSM.CLASSES[e.cls];
      if (pairs.has(key)) { const l = pairs.get(key); l.lanes += lanes; return; } // hai nửa đường song song → cộng làn
      const vk = Math.round(Math.min(e.vmax || C.v, C.v) * 0.85);
      const l = { u: idOf.get(u), v: idOf.get(v), road: e.name, lanes, geom, L: U.round(U.polylineLength(geom), 1), cls: e.cls, data: {}, phases: [0] };
      for (const b of p.bands) {
        const f = b.id === 'night' ? 0.25 : b.id === 'mid' ? 0.8 : 1;
        l.data[b.id] = { q: o.defaultFlows ? Math.round(C.q * lanes / Math.max(1, C.lanes) * f) : null, v: b.id === 'night' ? Math.round(vk * 1.2) : vk, src: o.defaultFlows ? 'imputed' : 'missing' };
      }
      pairs.set(key, l); p.links.push(l);
    };
    for (const e of edges) { if (e.fwd) addLink(e, true); if (e.bwd) addLink(e, false); }
    M.normalizeProject(p);
    for (const n of p.nodes) if (n.signalized) OSM.setupSignal(p, n);
    return { project: p, stats: { ways: ways.length, segs: segs.length, junctions: jids.length, clusters: used.size, links: p.links.length, signals: p.nodes.filter(n => n.signalized).length, sigRaw: sigNodes.length, sigAssigned, sigLost } };
  };

  /* Nhóm nhánh vào theo trục (phương mod 180°) → pha. Trả về mô tả để hiển thị. */
  OSM.axisGroups = function (p, node) {
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    const ins = p.links.filter(l => l.v === node.id && byId.has(l.u));
    if (!ins.length) return { groups: [], ins };
    const ax = ins.map(l => { const u = byId.get(l.u); const b = l.geom && l.geom.length >= 2 ? U.bearingAlong(l.geom, true) : U.bearing([u.lon, u.lat], [node.lon, node.lat]); return { l, brg: b, axis: b % 180, w: (l.lanes || 1) * (OSM.CLASSES[l.cls] ? OSM.CLASSES[l.cls].rank + 1 : 2) }; });
    const d180 = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
    const groups = [];
    for (const a of ax.slice().sort((x, y) => y.w - x.w)) {
      let g = groups.find(gr => d180(gr.axis, a.axis) <= 40);
      if (!g) { g = { axis: a.axis, items: [], w: 0 }; groups.push(g); }
      g.items.push(a); g.w += a.w;
    }
    groups.sort((a, b) => b.w - a.w);
    if (groups.length > 3) { // gom trục thừa vào trục gần nhất
      for (const g of groups.slice(3)) { const t = groups.slice(0, 3).sort((a, b) => d180(a.axis, g.axis) - d180(b.axis, g.axis))[0]; t.items.push(...g.items); }
      groups.length = 3;
    }
    return { groups, ins };
  };

  /* Tạo giản đồ pha (mọi khung giờ) & gán pha cho nhánh vào của nút có đèn. */
  OSM.setupSignal = function (p, node, keepPlans) {
    const P = p.params;
    const { groups } = OSM.axisGroups(p, node);
    const nPh = Math.max(2, groups.length);
    for (const b of p.bands) {
      const cur = node.plans[b.id];
      if (keepPlans && cur && cur.phases.length === nPh) continue;
      node.plans[b.id] = M.defaultPlan(P, nPh, b.id === 'night' ? 60 : (nPh >= 3 ? 110 : 90));
      M.normalizePlan(node.plans[b.id], P);
    }
    groups.forEach((g, k) => { for (const it of g.items) { it.l.phases = [k]; it.l._phaseSet = true; } });
    return groups.map((g, k) => ({ phase: k + 1, approaches: g.items.map(it => ({ from: it.l.u, road: it.l.road, dir: U.approachName(it.brg) })) }));
  };
})(typeof window !== 'undefined' ? window.TS : globalThis.TS);
