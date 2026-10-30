// Rapport mensuel des observations (Excel) : une feuille de synthèse, puis une feuille par bateau.
// Le mois d'une observation est celui de son constat. À refacturer en évidence, le reste plus discret.
import { buildXlsx, sheetName } from './xlsx.js';
import { observationsOf, obsState, baseLabel, sortBoats } from './model.js';
import { todayStr } from './util.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (ym) => (/^\d{4}-\d{2}$/.test(ym || '') ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '');
const localDay = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? todayStr(d) : ''; };
/** Jour de constat (ou de règlement s'il manque). */
const seenDay = (o) => o.origin || localDay(o.doneAt) || '';
const n1 = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
const hoursOf = (o) => { const v = Number(o.hours); return Number.isFinite(v) && v > 0 ? v : 0; };

/** Observations du mois, par bateau (bateaux sans observation inclus). */
export function monthData(s, month, boat = 'all') {
  return sortBoats(s.boats).filter((b) => boat === 'all' || b.id === boat).map((b) => {
    const items = observationsOf(b).filter((o) => seenDay(o).slice(0, 7) === month)
      .sort((x, y) => seenDay(x).localeCompare(seenDay(y)) || x.title.localeCompare(y.title, 'fr'));
    const bill = items.filter((o) => o.bill);
    return {
      b, items, bill, basic: items.filter((o) => !o.bill),
      done: items.filter((o) => o.done).length,
      billed: bill.filter((o) => o.billed).length,
      hours: bill.reduce((a, o) => a + hoursOf(o), 0),
    };
  });
}

/** Mois proposés : ceux qui ont des observations, plus le mois en cours, du plus récent au plus ancien. */
export function monthsAvailable(s, now = new Date()) {
  const set = new Set([todayStr(now).slice(0, 7)]);
  s.boats.forEach((b) => observationsOf(b).forEach((o) => { const d = seenDay(o); if (d) set.add(d.slice(0, 7)); }));
  return [...set].sort().reverse();
}

export function monthTotals(s, month, boat = 'all') {
  const d = monthData(s, month, boat);
  return {
    obs: d.reduce((a, x) => a + x.items.length, 0),
    bill: d.reduce((a, x) => a + x.bill.length, 0),
    billed: d.reduce((a, x) => a + x.billed, 0),
    hours: d.reduce((a, x) => a + x.hours, 0),
    boats: d.filter((x) => x.items.length).length,
  };
}

// ---- styles ----------------------------------------------------------------
const NAVY = '0C2B3D', INK = '1F2D38', MUT = '6B7C88', SOFT = '8A99A5', VIOLET = '6A3DB8', VBG = 'F3EDFD', VBG2 = 'FBF9FF', VLINE = 'DCCDF6',
  GREEN = '12804F', GBG = 'DDF3E8', ORANGE = 'B4410F', OBG = 'FFEBDD', GREY = 'EEF3F6', LINE = 'E3EAEF';
const bill = (x = {}) => ({ fill: VBG2, border: 'all', borderColor: VLINE, align: { v: 'top', wrap: true, ...(x.align || {}) }, font: { color: INK, ...(x.font || {}) }, numFmt: x.numFmt });
const basic = (x = {}) => ({ border: 'bottom', borderColor: LINE, align: { v: 'top', wrap: true, ...(x.align || {}) }, font: { color: MUT, ...(x.font || {}) }, numFmt: x.numFmt });
const STYLES = {
  title: { font: { b: true, sz: 18, color: NAVY } },
  sub: { font: { sz: 10, color: MUT } },
  summary: { font: { sz: 10.5, color: INK }, align: { wrap: true } },
  secBill: { font: { b: true, sz: 11, color: 'FFFFFF' }, fill: VIOLET, align: { indent: 1 } },
  secBasic: { font: { b: true, sz: 11, color: '4F6574' }, fill: GREY, align: { indent: 1 } },
  hdrBill: { font: { b: true, sz: 9, color: VIOLET }, fill: VBG, border: 'bottom', borderColor: 'C6AEF2', align: { wrap: true } },
  hdrBillC: { font: { b: true, sz: 9, color: VIOLET }, fill: VBG, border: 'bottom', borderColor: 'C6AEF2', align: { h: 'center', wrap: true } },
  hdrBasic: { font: { b: true, sz: 9, color: SOFT }, border: 'bottom', borderColor: 'D3DDE4', align: { wrap: true } },
  hdrBasicC: { font: { b: true, sz: 9, color: SOFT }, border: 'bottom', borderColor: 'D3DDE4', align: { h: 'center', wrap: true } },
  bTitle: bill({ font: { b: true } }),
  bTxt: bill(),
  bDate: bill({ numFmt: 'dd/mm/yyyy', align: { h: 'center' } }),
  bNum: bill({ numFmt: '0.0#', align: { h: 'center' }, font: { b: true } }),
  bDone: bill({ font: { color: GREEN, b: true }, align: { h: 'center' } }),
  bOpen: bill({ font: { color: ORANGE, b: true }, align: { h: 'center' } }),
  bYes: { fill: GBG, border: 'all', borderColor: VLINE, font: { b: true, color: GREEN }, align: { h: 'center', v: 'top', wrap: true } },
  bTodo: { fill: 'FFE3E5', border: 'all', borderColor: VLINE, font: { b: true, color: 'C7283A' }, align: { h: 'center', v: 'top', wrap: true } },
  totLbl: { font: { b: true, color: VIOLET }, align: { h: 'right' } },
  totNum: { font: { b: true, color: VIOLET, sz: 11 }, fill: VBG, numFmt: '0.0#', align: { h: 'center' }, border: 'all', borderColor: VLINE },
  kTxt: basic(),
  kDate: basic({ numFmt: 'dd/mm/yyyy', align: { h: 'center' } }),
  kSt: basic({ align: { h: 'center' } }),
  kNote: basic({ font: { i: true, color: 'B23A48' } }),
  none: { font: { i: true, color: SOFT }, align: { indent: 1 } },
  // synthèse
  sHdr: { font: { b: true, sz: 9.5, color: 'FFFFFF' }, fill: NAVY, align: { h: 'center', wrap: true } },
  sHdrL: { font: { b: true, sz: 9.5, color: 'FFFFFF' }, fill: NAVY, align: { wrap: true, indent: 1 } },
  sHdrBill: { font: { b: true, sz: 9.5, color: 'FFFFFF' }, fill: VIOLET, align: { h: 'center', wrap: true } },
  sName: { font: { b: true, color: '1C69B4' }, border: 'bottom', borderColor: LINE, align: { indent: 1 } },
  sNameZ: { font: { color: SOFT }, border: 'bottom', borderColor: LINE, align: { indent: 1 } },
  sTxt: { font: { color: MUT }, border: 'bottom', borderColor: LINE },
  sNum: { border: 'bottom', borderColor: LINE, align: { h: 'center' } },
  sZero: { font: { color: 'B8C4CC' }, border: 'bottom', borderColor: LINE, align: { h: 'center' } },
  sBill: { font: { b: true, color: VIOLET }, fill: VBG, border: 'bottom', borderColor: VLINE, align: { h: 'center' } },
  sBillH: { font: { b: true, color: VIOLET }, fill: VBG, border: 'bottom', borderColor: VLINE, numFmt: '0.0#', align: { h: 'center' } },
  sTodo: { font: { b: true, color: ORANGE }, border: 'bottom', borderColor: LINE, align: { h: 'center' } },
  sTotL: { font: { b: true, color: NAVY }, fill: GREY, border: 'top', borderColor: NAVY, align: { indent: 1 } },
  sTot: { font: { b: true, color: NAVY }, fill: GREY, border: 'top', borderColor: NAVY, align: { h: 'center' } },
  sTotH: { font: { b: true, color: NAVY }, fill: GREY, border: 'top', borderColor: NAVY, numFmt: '0.0#', align: { h: 'center' } },
  legendBill: { font: { b: true, color: VIOLET }, fill: VBG, align: { indent: 1 } },
  legendBasic: { font: { color: MUT }, fill: GREY, align: { indent: 1 } },
};

const C = (v, s, x = {}) => ({ v, s, ...x });
const D = (day, s) => (day ? { date: day, s } : { v: '', s });

function boatSheet(name, x, month, baseName, today) {
  const rows = [], merges = [];
  const add = (cells, ht) => { rows.push({ cells, ht }); return rows.length; };
  const span = (r, a = 'A', z = 'G') => merges.push(`${a}${r}:${z}${r}`);
  span(add([C(x.b.name, 'title')], 32));
  span(add([C(`Observations ${/^[aeiouyéè]/.test(monthLabel(month)) ? 'd’' : 'de '}${monthLabel(month)} · ${baseLabel(x.b)}${x.b.model ? ' · ' + x.b.model : ''} · ${baseName} · exporté le ${today}`, 'sub')], 18));
  const parts = [`${x.items.length} observation${x.items.length > 1 ? 's' : ''}`];
  if (x.bill.length) parts.push(`${x.bill.length} à refacturer${x.hours ? ` (${n1(x.hours)} h)` : ''}`, `${x.billed} refacturée${x.billed > 1 ? 's' : ''} au client`);
  parts.push(`${x.basic.length} courante${x.basic.length > 1 ? 's' : ''}`, `${x.done} réglée${x.done > 1 ? 's' : ''}`);
  span(add([C(parts.join('   ·   '), 'summary')], 20));
  add([], 10);

  // À refacturer
  span(add([C(`À REFACTURER  ·  ${x.bill.length}`, 'secBill')], 24));
  if (x.bill.length) {
    add([C('Constatée le', 'hdrBillC'), C('Observation', 'hdrBill'), C('Statut', 'hdrBillC'), C('Réglée le', 'hdrBillC'), C('Heures', 'hdrBillC'), C('Matériel', 'hdrBill'), C('Refacturé au client', 'hdrBillC')], 28);
    const first = rows.length + 1;
    x.bill.forEach((o) => {
      const st = obsState(o);
      add([D(o.origin, 'bDate'), C(o.title, 'bTitle'), C(st.label, o.done ? 'bDone' : 'bOpen'), D(localDay(o.doneAt), 'bDate'),
        hoursOf(o) ? C(hoursOf(o), 'bNum') : C('', 'bNum'), C(o.material || '', 'bTxt'),
        o.billed ? C(`Oui${o.billedAt ? ' · ' + localDay(o.billedAt).split('-').reverse().slice(0, 2).join('/') : ''}`, 'bYes') : C('Non', 'bTodo')],
      Math.max(22, 15 * Math.ceil(Math.max(o.title.length / 46, (o.material || '').length / 30, 1)) + 7));
    });
    const last = rows.length;
    const r = add([null, null, null, C('Total heures', 'totLbl'), C(x.hours, 'totNum', { f: `SUM(E${first}:E${last})` })], 22);
    merges.push(`A${r}:C${r}`);
  } else {
    span(add([C('Aucune observation à refacturer ce mois-ci.', 'none')], 22));
  }
  add([], 14);

  // Observations courantes
  span(add([C(`OBSERVATIONS COURANTES  ·  ${x.basic.length}`, 'secBasic')], 22));
  if (x.basic.length) {
    const h = add([C('Constatée le', 'hdrBasicC'), C('Observation', 'hdrBasic'), C('Statut', 'hdrBasicC'), C('Réglée le', 'hdrBasicC'), C('Remarque', 'hdrBasic')], 22);
    merges.push(`E${h}:G${h}`);
    x.basic.forEach((o) => {
      const r = add([D(o.origin, 'kDate'), C(o.title, 'kTxt'), C(obsState(o).label, 'kSt'), D(localDay(o.doneAt), 'kDate'),
        C(o.blocked && !o.done ? 'Bloquante' : '', 'kNote'), C('', 'kNote'), C('', 'kNote')], Math.max(19, 14 * Math.ceil(o.title.length / 48) + 5));
      merges.push(`E${r}:G${r}`);
    });
  } else {
    span(add([C('Aucune autre observation ce mois-ci.', 'none')], 20));
  }
  return { name, cols: [13, 48, 14, 13, 10, 32, 17], rows, merges, tabColor: x.bill.length ? VIOLET : 'A9B8C2' };
}

function summarySheet(data, names, month, scope, baseName, today) {
  const rows = [], merges = [];
  const add = (cells, ht) => { rows.push({ cells, ht }); return rows.length; };
  const span = (r) => merges.push(`A${r}:I${r}`);
  span(add([C(`Observations · ${monthLabel(month).replace(/^./, (c) => c.toUpperCase())}`, 'title')], 34));
  span(add([C(`${baseName} · ${scope} · mois de constat · exporté le ${today}`, 'sub')], 18));
  add([], 10);
  add([C('Bateau', 'sHdrL'), C('Base', 'sHdr'), C('Observations', 'sHdr'), C('Réglées', 'sHdr'), C('Non réglées', 'sHdr'),
    C('À refacturer', 'sHdrBill'), C('Heures à refacturer', 'sHdrBill'), C('Refacturées au client', 'sHdrBill'), C('Reste à refacturer', 'sHdrBill')], 34);
  const first = rows.length + 1;
  data.forEach((x) => {
    const has = x.items.length > 0;
    const num = (v, st = 'sNum') => C(v, v ? st : 'sZero');
    add([C(x.b.name, has ? 'sName' : 'sNameZ', names.get(x.b.id) ? { link: `'${names.get(x.b.id).replace(/'/g, "''")}'!A1` } : {}),
      C(baseLabel(x.b), 'sTxt'), num(x.items.length), num(x.done), num(x.items.length - x.done),
      num(x.bill.length, 'sBill'), x.hours ? C(x.hours, 'sBillH') : C(0, 'sZero'), num(x.billed, 'sBill'), num(x.bill.length - x.billed, 'sTodo')], 21);
  });
  const last = rows.length;
  const sum = (col, k) => C(data.reduce((a, x) => a + k(x), 0), col === 'G' ? 'sTotH' : 'sTot', { f: `SUM(${col}${first}:${col}${last})` });
  add([C('Total', 'sTotL'), C('', 'sTot'), sum('C', (x) => x.items.length), sum('D', (x) => x.done), sum('E', (x) => x.items.length - x.done),
    sum('F', (x) => x.bill.length), sum('G', (x) => x.hours), sum('H', (x) => x.billed), sum('I', (x) => x.bill.length - x.billed)], 24);
  add([], 16);
  let r = add([C('Violet : observations à refacturer (heures, matériel, suivi « refacturé au client »).', 'legendBill')], 20); span(r);
  r = add([C('Gris : observations courantes, pour mémoire.', 'legendBasic')], 20); span(r);
  r = add([C('Clique sur un nom de bateau pour ouvrir sa feuille.', 'sub')], 18); span(r);
  return { name: 'Synthèse', cols: [26, 16, 13, 11, 12, 13, 13, 14, 14], rows, merges, tabColor: NAVY };
}

/** Classeur Excel du mois. Renvoie null s'il n'y a aucune observation. */
export function monthlyReport(s, { month, boat = 'all' }, now = new Date()) {
  const data = monthData(s, month, boat);
  const withObs = data.filter((x) => x.items.length);
  if (!withObs.length) return null;
  const today = todayStr(now).split('-').reverse().join('/');
  const used = new Set(['synthèse']);
  const names = new Map();
  const boatSheets = withObs.map((x) => { const n = sheetName(x.b.name, used); names.set(x.b.id, n); return boatSheet(n, x, month, s.baseName, today); });
  const scope = boat === 'all' ? `${data.length} bateaux` : data[0].b.name;
  const ordered = boat === 'all' ? [...withObs, ...data.filter((x) => !x.items.length)] : withObs;
  const sheets = [summarySheet(ordered, names, month, scope, s.baseName, today), ...boatSheets];
  const bytes = buildXlsx({ sheets, styles: STYLES, title: `Observations ${monthLabel(month)}` });
  return { bytes, sheets: sheets.length, count: withObs.reduce((a, x) => a + x.items.length, 0) };
}
