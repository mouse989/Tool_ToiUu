/* Tiện ích chung: hình học trắc địa, số học, CSV, tải file.
 * Mọi module gắn vào không gian tên toàn cục TS để chạy được cả khi mở file:// (không cần build)
 * và nạp được trong Node (test/run-tests.js). */
(function (TS) {
  'use strict';
  const U = TS.util = {};

  const R_EARTH = 6378137;
  U.R_EARTH = R_EARTH;

  /* Khoảng cách trắc địa (m) giữa 2 điểm [lon, lat]. */
  U.haversine = function (a, b) {
    const toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
  };

  U.polylineLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += U.haversine(pts[i - 1], pts[i]);
    return L;
  };

  /* Góc phương vị (độ, 0 = Bắc, theo chiều kim đồng hồ) từ a tới b. */
  U.bearing = function (a, b) {
    const toR = Math.PI / 180;
    const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
    const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  U.angleDiff = function (a, b) {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  };

  /* Hướng tiếp cận (xe ĐẾN nút từ phía nào) theo phương vị của chiều đi. */
  U.approachName = function (brg) {
    // xe chạy theo hướng brg → xe đến từ phía ngược lại
    const from = (brg + 180) % 360;
    const names = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
    return names[Math.round(from / 45) % 8];
  };
  U.approachCode = function (brg) {
    const from = (brg + 180) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(from / 45) % 8];
  };

  /* Web Mercator (EPSG:3857), mét. */
  U.project = function (lon, lat) {
    const x = lon * Math.PI / 180 * R_EARTH;
    const y = Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360)) * R_EARTH;
    return [x, y];
  };
  U.unproject = function (x, y) {
    return [x / R_EARTH * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * 180 / Math.PI];
  };

  U.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  U.mod = (a, n) => ((a % n) + n) % n;
  U.round = (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; };
  U.sum = (arr, f) => { let s = 0; for (let i = 0; i < arr.length; i++) s += f ? f(arr[i], i) : arr[i]; return s; };
  U.mean = (arr, f) => arr.length ? U.sum(arr, f) / arr.length : 0;
  U.gcd = (a, b) => { a = Math.round(Math.abs(a)); b = Math.round(Math.abs(b)); while (b) { [a, b] = [b, a % b]; } return a; };

  /* Bộ sinh số ngẫu nhiên có hạt giống (mulberry32) — để dữ liệu mẫu và kiểm thử tái lập được. */
  U.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const r = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.normal = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return r;
  };

  /* Bao lồi (monotone chain) của tập điểm [x, y]. */
  U.convexHull = function (pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop();
    return lo.concat(up);
  };

  /* ── CSV ─────────────────────────────────────────────── */
  U.parseCSV = function (text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const cnt = (ch) => (firstLine.match(new RegExp('\\' + ch, 'g')) || []).length;
    const delim = cnt(';') > cnt(',') ? ';' : (cnt('\t') > cnt(',') ? '\t' : ',');
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
    if (!rows.length) return { header: [], rows: [] };
    const header = rows[0].map(h => U.normKey(h));
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const o = {};
      header.forEach((h, j) => { o[h] = (rows[r][j] ?? '').trim(); });
      out.push(o);
    }
    return { header, rows: out };
  };

  /* Chuẩn hoá tên cột: bỏ dấu tiếng Việt, chữ thường, khoảng trắng → '_'. */
  U.normKey = function (s) {
    return String(s).trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  };

  U.num = function (s, dflt) {
    if (s === undefined || s === null || s === '') return dflt;
    if (typeof s === 'number') return isFinite(s) ? s : dflt;
    let t = String(s).trim();
    // chấp nhận dấu phẩy thập phân kiểu Việt Nam "12,5"
    if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
    const v = Number(t);
    return isFinite(v) ? v : dflt;
  };

  U.toCSV = function (header, rows) {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
  };

  U.download = function (filename, content, mime) {
    if (typeof document === 'undefined') return;
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  U.readFile = function (file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsText(file, 'utf-8');
    });
  };

  U.sleep = (ms) => new Promise(r => setTimeout(r, ms || 0));

  U.fmt = function (x, d = 0) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return Number(x).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  U.pct = function (x, d = 1) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x > 0 ? '+' : '') + U.fmt(x * 100, d) + '%';
  };

  U.escapeHtml = function (s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  U.deepClone = (o) => JSON.parse(JSON.stringify(o));
})(typeof window !== 'undefined' ? (window.TS = window.TS || {}) : (globalThis.TS = globalThis.TS || {}));
