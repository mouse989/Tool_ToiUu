/* Dữ liệu OSM tự dựng để kiểm thử: lưới 3×3 phố, trục ngang giữa là ĐƯỜNG ĐÔI (2 nửa một chiều cách 24 m),
 * trục dọc giữa có đổi tên giữa đoạn, một phố một chiều, đèn đặt lệch tâm nút ~15 m, một đường bên ngoài vùng. */
module.exports = function makeFixture() {
  const els = []; let nid = 1, wid = 1;
  const node = (lon, lat, tags) => { const id = nid++; els.push({ type: 'node', id, lon, lat, tags: tags || {} }); return id; };
  const way = (ids, tags) => els.push({ type: 'way', id: wid++, nodes: ids, tags });
  const lon0 = 106.70, lat0 = 10.77, d = 0.004; // ~440 m
  const X = [0, 1, 2].map(i => lon0 + i * d), Y = [0, 1, 2].map(j => lat0 + j * d);
  const off = 0.00011; // ~12 m nửa dải phân cách
  // nút giao đơn cho các phố thường
  const J = {};
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (j === 1) { J[i + ',1n'] = node(X[i], Y[1] + off); J[i + ',1s'] = node(X[i], Y[1] - off); }
    else J[i + ',' + j] = node(X[i], Y[j]);
  }
  // trục ngang giữa: đường đôi, nửa bắc đi Tây, nửa nam đi Đông
  way([J['0,1s'], J['1,1s'], J['2,1s']], { highway: 'primary', name: 'Đại lộ A', oneway: 'yes', lanes: '3' });
  way([J['2,1n'], J['1,1n'], J['0,1n']], { highway: 'primary', name: 'Đại lộ A', oneway: 'yes', lanes: '3' });
  // phố ngang dưới & trên
  way([J['0,0'], J['1,0'], J['2,0']], { highway: 'secondary', name: 'Phố B' });
  way([J['0,2'], J['1,2'], J['2,2']], { highway: 'tertiary', name: 'Phố C', oneway: '-1' });
  // phố dọc: cắt đường đôi qua 2 điểm
  for (let i = 0; i < 3; i++) {
    const mid = node(X[i] + 0.00002, (Y[0] + Y[1]) / 2); // điểm gấp khúc giữa đoạn (bậc 2)
    const nm = i === 1 ? 'Phố D' : 'Phố E' + i;
    way([J[i + ',0'], mid], { highway: 'secondary', name: nm });
    way([mid, J[i + ',1s'], J[i + ',1n']], { highway: 'secondary', name: i === 1 ? 'Phố D (nối dài)' : nm });
    way([J[i + ',1n'], J[i + ',2']], { highway: 'secondary', name: i === 1 ? 'Phố D (nối dài)' : nm });
  }
  // đèn lệch tâm nút giao giữa (đặt trên phố dọc, cách tâm ~15 m) và nút (1,0)
  node(X[1], Y[1] - off - 0.00014, { highway: 'traffic_signals' });
  node(X[1] + 0.00012, Y[0], { highway: 'traffic_signals' });
  // đường dân cư (bị lọc khi không chọn residential) & đường ngoài vùng
  const r1 = node(X[0] + 0.001, Y[0]), r2 = node(X[0] + 0.001, Y[0] - 0.002);
  way([r1, r2], { highway: 'residential', name: 'Hẻm' });
  const o1 = node(X[2] + 0.02, Y[0]), o2 = node(X[2] + 0.03, Y[0]);
  way([o1, o2], { highway: 'primary', name: 'Ngoài vùng' });
  const poly = [[X[0] - 0.001, Y[0] - 0.001], [X[2] + 0.001, Y[0] - 0.001], [X[2] + 0.001, Y[2] + 0.001], [X[0] - 0.001, Y[2] + 0.001]];
  return { data: { elements: els }, poly };
};
