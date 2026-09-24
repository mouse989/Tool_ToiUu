/* Nạp các module (script cổ điển) vào Node để kiểm thử động cơ tính toán. */
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.TS = globalThis.TS || {};
const ORDER = ['util', 'model', 'signal', 'profile', 'maxband', 'zoning', 'ctm', 'demo', 'optimizer', 'io', 'osm', 'aiopt'];
for (const f of ORDER) {
  const p = path.join(__dirname, '..', 'js', f + '.js');
  if (fs.existsSync(p)) vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
module.exports = globalThis.TS;
