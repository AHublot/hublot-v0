// Petit générateur de PDF, sans dépendance : texte (Helvetica, accents français), rectangles, traits.
// Suffit pour une feuille retour lisible et légère (quelques dizaines de Ko).

// Largeurs des caractères (Helvetica et Helvetica-Bold, en millièmes de corps), de l'espace (32) au tilde (126).
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Caractères hors ASCII de l'encodage WinAnsi (cp1252) : code, largeur normale, largeur grasse
const EXTRA = { '€': [0x80, 556, 556], '…': [0x85, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500], '”': [0x94, 333, 500], '•': [0x95, 350, 350], '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], 'Œ': [0x8c, 1000, 1000], 'œ': [0x9c, 944, 944], '«': [0xab, 556, 556], '»': [0xbb, 556, 556], '°': [0xb0, 400, 400], '×': [0xd7, 584, 584], 'Æ': [0xc6, 1000, 1000], 'æ': [0xe6, 889, 889], '·': [0xb7, 278, 278] };
const SPACES = /[   ]/g;

function glyph(ch, bold) {
  const c = ch.codePointAt(0);
  if (c >= 32 && c <= 126) return [c, (bold ? W_BOLD : W_REG)[c - 32]];
  if (EXTRA[ch]) return [EXTRA[ch][0], EXTRA[ch][bold ? 2 : 1]];
  if (c >= 0xa0 && c <= 0xff) { // lettres accentuées : largeur de la lettre de base
    const base = ch.normalize('NFD')[0];
    const b = base.codePointAt(0);
    return [c, b >= 32 && b <= 126 ? (bold ? W_BOLD : W_REG)[b - 32] : 556];
  }
  return [63, 556]; // « ? »
}
/** Largeur d'un texte, en points. */
export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str).replace(SPACES, ' ')) w += glyph(ch, bold)[1];
  return (w * size) / 1000;
}
/** Coupe un texte en lignes de largeur maximale `max` (points). */
export function wrap(str, size, max, bold = false) {
  const out = [];
  for (const para of String(str || '').replace(SPACES, ' ').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (textWidth(t, size, bold) <= max || !line) line = t;
      else { out.push(line); line = word; }
      while (textWidth(line, size, bold) > max && line.length > 1) { // mot trop long : on le coupe
        let i = line.length - 1;
        while (i > 1 && textWidth(line.slice(0, i), size, bold) > max) i--;
        out.push(line.slice(0, i)); line = line.slice(i);
      }
    }
    out.push(line);
  }
  return out;
}
function encode(str, bold) {
  let s = '';
  for (const ch of String(str).replace(SPACES, ' ')) {
    const [c] = glyph(ch, bold);
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s;
}
const rgb = (hex) => { const h = String(hex).replace('#', ''); return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' '); };
const n = (v) => (Math.round(v * 100) / 100).toString();

/** Document A4 ; coordonnées en points depuis le haut à gauche. */
export class Pdf {
  constructor({ width = 595.28, height = 841.89, title = '' } = {}) {
    this.w = width; this.h = height; this.title = title; this.pages = []; this.addPage();
  }
  addPage() { this.ops = []; this.pages.push(this.ops); return this; }
  text(x, y, str, { size = 10, bold = false, color = '#14212b' } = {}) {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(color)} rg ${n(x)} ${n(this.h - y - size * 0.8)} Td (${encode(str, bold)}) Tj ET`);
    return this;
  }
  textRight(xRight, y, str, o = {}) { return this.text(xRight - textWidth(str, o.size || 10, o.bold), y, str, o); }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.6, r = 0 } = {}) {
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    const pre = `${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${n(lw)} w ` : ''}`;
    const Y = this.h - y - h;
    if (!r) { this.ops.push(`${pre}${n(x)} ${n(Y)} ${n(w)} ${n(h)} re ${paint}`); return this; }
    const k = r * 0.5523; // coins arrondis (courbes de Bézier)
    this.ops.push(`${pre}${n(x + r)} ${n(Y)} m ${n(x + w - r)} ${n(Y)} l ${n(x + w - r + k)} ${n(Y)} ${n(x + w)} ${n(Y + r - k)} ${n(x + w)} ${n(Y + r)} c ${n(x + w)} ${n(Y + h - r)} l ${n(x + w)} ${n(Y + h - r + k)} ${n(x + w - r + k)} ${n(Y + h)} ${n(x + w - r)} ${n(Y + h)} c ${n(x + r)} ${n(Y + h)} l ${n(x + r - k)} ${n(Y + h)} ${n(x)} ${n(Y + h - r + k)} ${n(x)} ${n(Y + h - r)} c ${n(x)} ${n(Y + r)} l ${n(x)} ${n(Y + r - k)} ${n(x + r - k)} ${n(Y)} ${n(x + r)} ${n(Y)} c h ${paint}`);
    return this;
  }
  line(x1, y1, x2, y2, { color = '#d5dee5', lw = 0.6 } = {}) {
    this.ops.push(`${rgb(color)} RG ${n(lw)} w ${n(x1)} ${n(this.h - y1)} m ${n(x2)} ${n(this.h - y2)} l S`);
    return this;
  }
  /** Le fichier PDF (Buffer). */
  build() {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = this.pages.map((ops) => {
      const body = ops.join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(this.w)} ${n(this.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${encode(this.title)}) /Producer (Hublot) >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
