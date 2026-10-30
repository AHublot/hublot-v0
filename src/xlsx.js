// Écriture d'un classeur Excel (.xlsx) sans dépendance : XML SpreadsheetML + archive zip non compressée.
// Assez complet pour un rapport soigné : plusieurs feuilles, styles, largeurs, hauteurs, fusions,
// formules, dates, liens internes, mise en page à l'impression. Sans DOM : testé sous Node.

const enc = new TextEncoder();
const xml = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Numéro de série Excel d'une date 'AAAA-MM-JJ'. */
export function dateSerial(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || '');
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5);
}
export const colName = (i) => { let s = ''; i += 1; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Nom de feuille valide et unique (31 caractères, sans []:*?/\). */
export function sheetName(name, used) {
  let base = String(name || 'Feuille').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Feuille';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${i++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase());
  return n;
}

// ---- styles ---------------------------------------------------------------
// Un style : { font: { b, i, sz, color }, fill: 'RRGGBB', border: 'all' | 'bottom' | 'top', borderColor, align: { h, v, wrap, indent }, numFmt }
function styleTables(defs) {
  const fonts = ['<font><sz val="10"/><color rgb="FF1F2D38"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const idx = (list, x) => { let i = list.indexOf(x); if (i < 0) { list.push(x); i = list.length - 1; } return i; };
  const ids = {};
  Object.entries(defs).forEach(([key, d]) => {
    const f = d.font || {};
    const font = `<font>${f.b ? '<b/>' : ''}${f.i ? '<i/>' : ''}<sz val="${f.sz || 10}"/><color rgb="FF${f.color || '1F2D38'}"/><name val="Calibri"/><family val="2"/></font>`;
    const fontId = idx(fonts, font);
    const fillId = d.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${d.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    let borderId = 0;
    if (d.border) {
      const c = `<color rgb="FF${d.borderColor || 'D5E0E7'}"/>`;
      const side = (n, on) => (on ? `<${n} style="thin">${c}</${n}>` : `<${n}/>`);
      const all = d.border === 'all';
      borderId = idx(borders, `<border>${side('left', all)}${side('right', all)}${side('top', all || d.border === 'top')}${side('bottom', all || d.border === 'bottom')}<diagonal/></border>`);
    }
    let numFmtId = 0;
    if (d.numFmt) { const i = numFmts.indexOf(d.numFmt); numFmtId = 164 + (i < 0 ? numFmts.push(d.numFmt) - 1 : i); }
    const a = d.align || {};
    const align = a.h || a.v || a.wrap || a.indent
      ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''} vertical="${a.v || 'center'}"${a.wrap ? ' wrapText="1"' : ''}${a.indent ? ` indent="${a.indent}"` : ''}/>`
      : '<alignment vertical="center"/>';
    ids[key] = xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${numFmtId ? ' applyNumberFormat="1"' : ''}>${align}</xf>`) - 1;
  });
  const out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(f)}"/>`).join('')}</numFmts>` : '')
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return { xml: out, ids };
}

// ---- feuilles ---------------------------------------------------------------
// Feuille : { name, cols: [largeurs], rows: [{ cells: [cellule], ht }], merges: ['A1:G1'], landscape, tabColor }
// Cellule : null | { v: texte ou nombre, s: style, date: 'AAAA-MM-JJ', f: 'SUM(E7:E9)', link: "'Feuille'!A1" }
function sheetXml(sh, ids) {
  const links = [];
  const rows = sh.rows.map((row, r) => {
    if (!row) return '';
    const cells = (row.cells || []).map((c, ci) => {
      if (!c) return '';
      const ref = colName(ci) + (r + 1);
      const s = c.s != null && ids[c.s] != null ? ` s="${ids[c.s]}"` : '';
      if (c.link) links.push(`<hyperlink ref="${ref}" location="${xml(c.link)}" display="${xml(c.v)}"/>`);
      if (c.f) return `<c r="${ref}"${s}><f>${xml(c.f)}</f>${typeof c.v === 'number' ? `<v>${c.v}</v>` : ''}</c>`;
      if (c.date) { const n = dateSerial(c.date); return n == null ? `<c r="${ref}"${s}/>` : `<c r="${ref}"${s}><v>${n}</v></c>`; }
      if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
      if (c.v == null || c.v === '') return `<c r="${ref}"${s}/>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}"${row.ht ? ` ht="${row.ht}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheetPr>${sh.tabColor ? `<tabColor rgb="FF${sh.tabColor}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="110"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="18" customHeight="1"/>'
    + (sh.cols?.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '')
    + `<sheetData>${rows}</sheetData>`
    + (sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
    + (links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : '')
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + `<pageSetup paperSize="9" orientation="${sh.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>`
    + '</worksheet>';
}

// ---- zip (méthode « stockée ») -------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files, now = new Date()) {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  files.forEach(({ name, data }) => {
    const nameB = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nameB.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nameB, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nameB.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  });
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; all.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}

/** Construit le fichier .xlsx (Uint8Array). */
export function buildXlsx({ sheets, styles = {}, title = '', creator = 'Cap Départ' }) {
  const st = styleTables(styles);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const f = (name, s) => ({ name, data: enc.encode(s) });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zip([
    f('[Content_Types].xml', head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'),
    f('_rels/.rels', head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'),
    f('docProps/core.xml', head + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${xml(title)}</dc:title><dc:creator>${xml(creator)}</dc:creator>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    f('docProps/app.xml', head + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Cap Départ</Application></Properties>'),
    f('xl/workbook.xml', head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + `<sheets>${sheets.map((sh, i) => `<sheet name="${xml(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    f('xl/_rels/workbook.xml.rels', head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    f('xl/styles.xml', st.xml),
    ...sheets.map((sh, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, st.ids))),
  ]);
}
