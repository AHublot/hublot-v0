// QR code en SVG, écrit pour Hublot (sans dépendance) : mode octets (UTF-8), correction M, versions 1 à 10.
// Sert au wifi du bord (onglet Starlink) : l'appareil photo du téléphone propose de se connecter.

// [code correcteur par bloc, nb blocs groupe 1, octets de données, nb blocs groupe 2, octets de données] — niveau M
const ECC_M = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// Corps de Galois GF(256), polynôme 0x11D
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGenerator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], EXP[i]); }
    g = n;
  }
  return g;
}
function rsRemainder(data, deg) {
  const g = rsGenerator(deg), r = new Array(deg).fill(0);
  for (const d of data) {
    const f = d ^ r.shift();
    r.push(0);
    for (let j = 0; j < deg; j++) r[j] ^= mul(g[j + 1], f);
  }
  return r;
}

/** Matrice du QR code (tableau de lignes de booléens, true = module foncé). */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  const dataCw = (t) => t[1] * t[2] + t[3] * t[4];
  for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(ECC_M[v]) * 8) break;
  if (v > 10) throw new Error('Texte trop long pour le QR code');
  const [ecLen, n1, d1, n2, d2] = ECC_M[v], cap = dataCw(ECC_M[v]) * 8;
  // flux de bits : mode octets, longueur, données, fin, remplissage
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // blocs, codes correcteurs, entrelacement
  const blocks = [];
  let k = 0;
  for (let i = 0; i < n1 + n2; i++) { const len = i < n1 ? d1 : d2; const blk = data.slice(k, k + len); k += len; blocks.push({ d: blk, e: rsRemainder(blk, ecLen) }); }
  const words = [];
  for (let i = 0; i < Math.max(d1, d2); i++) blocks.forEach((b) => { if (i < b.d.length) words.push(b.d[i]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => words.push(b.e[i]));

  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[v], last = al.length - 1;
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formatBits = (mask) => {
    const d = (0 << 3) | mask; // niveau M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  formatBits(0); // réserve les emplacements
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
  }
  // placement des données en zigzag
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < words.length * 8) { m[y][x] = ((words[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
    }
  }
  // masque : on garde celui qui pénalise le moins
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  const apply = (k2) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k2](x, y)) m[y][x] = !m[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const line = (get) => {
      for (let i = 0; i < size; i++) {
        let run = 1;
        for (let j = 1; j <= size; j++) {
          if (j < size && get(i, j) === get(i, j - 1)) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
        for (let j = 0; j + 7 <= size; j++) {
          const s = [0, 1, 2, 3, 4, 5, 6].map((t) => get(i, j + t));
          if (s.join() === 'true,false,true,true,true,false,true') {
            const before = j >= 4 && [1, 2, 3, 4].every((t) => !get(i, j - t));
            const after = j + 11 <= size && [7, 8, 9, 10].every((t) => !get(i, j + t));
            if (before || after) p += 40;
          }
        }
      }
    };
    line((i, j) => m[i][j]); line((i, j) => m[j][i]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    m.forEach((row) => row.forEach((c) => { if (c) dark++; }));
    return p + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  };
  let best = 0, bestP = Infinity;
  for (let k2 = 0; k2 < 8; k2++) {
    apply(k2); formatBits(k2);
    const p = penalty();
    if (p < bestP) { bestP = p; best = k2; }
    apply(k2); // annule
  }
  apply(best); formatBits(best);
  return m;
}

/** Texte « WIFI: » lu par l'appareil photo des téléphones (iPhone et Android) pour se connecter. */
export function wifiQrText(ssid, pass) {
  const e = (x) => String(x || '').replace(/([\\;,:"])/g, '\\$1');
  return pass ? `WIFI:T:WPA;S:${e(ssid)};P:${e(pass)};;` : `WIFI:T:nopass;S:${e(ssid)};;`;
}
/** SVG d'un QR code (modules foncés sur fond blanc, marge de 4 modules). */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const m = qrMatrix(text), q = 4, size = m.length + q * 2;
  let d = '';
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue; } let w = 1; while (x + w < row.length && row[x + w]) w++; d += `M${x + q} ${y + q}h${w}v1h-${w}z`; x += w; } });
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${String(label).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]))}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0c2b3d"/></svg>`;
}

/**
 * Image PNG à partager : titre, QR code, nom du wifi, consigne. Fabriquée d'un coup (sans attente),
 * pour que le partage parte bien du geste de l'utilisateur (iPhone).
 */
export function qrPngFile(text, { title = '', name = '', file = 'wifi.png' } = {}) {
  const m = qrMatrix(text), n = m.length, W = 640, cell = Math.floor(520 / (n + 8)), qs = cell * (n + 8);
  const H = 150 + qs + 130;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0b7f8a'; g.fillRect(0, 0, W, 10);
  g.textAlign = 'center'; g.fillStyle = '#5d6f7c'; g.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText('WIFI À BORD', W / 2, 62);
  g.fillStyle = '#0c2b3d'; g.font = '700 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText(title || 'Starlink', W / 2, 112);
  const x0 = (W - qs) / 2, y0 = 140;
  g.fillStyle = '#0c2b3d';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect(x0 + (x + 4) * cell, y0 + (y + 4) * cell, cell, cell); }));
  g.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText(name, W / 2, y0 + qs + 42);
  g.fillStyle = '#5d6f7c'; g.font = '22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  g.fillText('Scanner avec l’appareil photo pour se connecter', W / 2, y0 + qs + 84);
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], file, { type: 'image/png' });
}
