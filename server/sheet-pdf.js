// PDF d'une feuille retour validée (envoyé par e-mail). Même contenu que la feuille dans Hublot.
import { Pdf, wrap, textWidth } from './pdf.js';
import { sheetObsTitle, clientObsList } from '../src/actions.js';
import { shortDossier } from '../src/model.js';

const C = { ink: '#14212b', mut: '#5d6f7c', line: '#d5dee5', teal: '#0b7f8a', navy: '#0c2b3d', ok: '#1b7f4b', okBg: '#e3f4ea', bad: '#c62f3b', badBg: '#fbe4e6', bill: '#6b3fb4', soft: '#eef4f7', amber: '#a15c00' };
const TZ = 'America/Martinique';
const WD = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** « mar. 10 nov., 09:00 » à partir d'une date locale « AAAA-MM-JJTHH:MM » ou d'un instant ISO. */
export function fmtWhen(v, { year = false } = {}) {
  if (!v) return '';
  let y, mo, d, h, mi;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (m) [, y, mo, d, h, mi] = m.map((x) => (x == null ? x : x));
  else {
    const t = new Date(v); if (Number.isNaN(+t)) return String(v);
    const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t).map((x) => [x.type, x.value]));
    [y, mo, d, h, mi] = [p.year, p.month, p.day, p.hour, p.minute];
  }
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return `${WD[dt.getUTCDay()]} ${+d} ${MO[+mo - 1]}${year ? ` ${y}` : ''}${h != null ? `, ${h}:${mi}` : ''}`;
}
/** Nom du fichier : « Feuille retour - Palomas - 10-11-2026.pdf ». */
export function sheetFileName(boatName, r) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(r.at || Date.now())).map((x) => [x.type, x.value]));
  const safe = String(boatName || 'Bateau').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Feuille retour - ${safe} - ${p.day}-${p.month}-${p.year}.pdf`;
}
const hh = (v) => (v == null || v === '' ? '—' : `${String(v).replace('.', ',')} h`);

/** Défauts (observations créées) et observations du client d'une feuille validée. */
export function sheetFindings(r) {
  const defs = [];
  for (const x of r.sheet || []) for (const it of x.items || []) {
    if (r.values?.[it.id] !== 'def') continue;
    defs.push({ sec: x.title, label: it.label, title: sheetObsTitle({ ...it, sec: x }, r.notes?.[it.id]), bill: !!r.bill?.[it.id] });
  }
  return { defs, client: clientObsList(r.clientObs || '') };
}

export function sheetPdf(boatName, r) {
  const doc = new Pdf({ title: `Feuille retour ${boatName}` });
  const L = 36, R = doc.w - 36, W = R - L, BOTTOM = doc.h - 46;
  let y = 34;
  const { defs, client } = sheetFindings(r);
  const st = r.stay || {};
  const newPage = () => { doc.addPage(); y = 34; };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };

  // En-tête
  doc.text(L, y, 'FEUILLE RETOUR', { size: 8.5, bold: true, color: C.teal });
  doc.textRight(R, y, `Validée le ${fmtWhen(r.at, { year: true })}`, { size: 9, color: C.mut });
  y += 13;
  doc.text(L, y, boatName, { size: 22, bold: true, color: C.navy });
  if (r.by) doc.textRight(R, y + 8, `par ${r.by}`, { size: 9, color: C.mut });
  y += 30;
  doc.rect(L, y, W, 1.6, { fill: C.teal });
  y += 12;

  // Infos du séjour
  const cell = (x, w, label, val) => {
    doc.text(x, y, label.toUpperCase(), { size: 7, bold: true, color: C.mut });
    wrap(val || '—', 10, w - 8, true).slice(0, 2).forEach((l, i) => doc.text(x, y + 10 + i * 12, l, { size: 10, bold: true, color: val ? C.ink : C.mut }));
  };
  const cw = W / 3;
  cell(L, cw, 'Dossier', st.dossier ? `${st.dossier}` : '');
  cell(L + cw, cw, 'Locataire', st.client);
  cell(L + 2 * cw, cw, 'Skipper', st.skipper || (st.client ? 'Sans skipper' : ''));
  y += 36;
  cell(L, cw, 'Séjour', st.dep || st.ret ? `${fmtWhen(st.dep) || '?'} – ${fmtWhen(st.ret) || '?'}` : '');
  const port = r.nums?.hoursPort, stbd = r.nums?.hoursStbd, tp = r.tripHours || {};
  cell(L + cw, cw, 'Heures moteur bâbord', port ? `${hh(port)}${tp.port != null ? ` (séjour ${hh(tp.port)})` : ''}` : '');
  cell(L + 2 * cw, cw, 'Heures moteur tribord', stbd ? `${hh(stbd)}${tp.stbd != null ? ` (séjour ${hh(tp.stbd)})` : ''}` : '');
  y += 38;

  // Uniquement pour le bureau : bien visible, entre le séjour et les défauts
  {
    const txt = String(r.billToday || '').trim();
    const lines = wrap(txt || 'Rien', 11, W - 170, true);
    const h = 30 + lines.length * 14;
    doc.rect(L, y, W, h, { fill: '#fff4dc', r: 6 });
    doc.rect(L, y, 4, h, { fill: '#f5b041' });
    doc.text(L + 14, y + 9, 'BUREAU', { size: 7.5, bold: true, color: C.amber });
    doc.text(L + 14, y + 22, 'À facturer aujourd’hui :', { size: 9, color: C.mut });
    lines.forEach((l, i) => doc.text(L + 118, y + 21 + i * 14, l, { size: 11, bold: true, color: txt ? C.ink : C.mut }));
    const dv = `Plongeur passé : ${r.diver ? 'OUI' : 'NON'}`;
    const dw = textWidth(dv, 10, true) + 20;
    doc.rect(R - dw - 10, y + 8, dw, 20, { fill: r.diver ? C.okBg : '#ffffff', stroke: r.diver ? null : C.line, r: 10 });
    doc.text(R - dw, y + 13.5, dv, { size: 10, bold: true, color: r.diver ? C.ok : C.mut });
    y += h + 12;
  }

  // Défauts
  const block = (title, color, items) => {
    if (!items.length) return;
    ensure(40);
    doc.text(L, y, title, { size: 11.5, bold: true, color: C.navy });
    y += 18;
    for (const it of items) {
      const lines = wrap(it.title, 10, W - 22, true);
      const h = lines.length * 12.5 + (it.sub ? 12 : 0) + 8;
      ensure(h);
      doc.rect(L, y - 1, 3, h - 6, { fill: color });
      lines.forEach((l, i) => doc.text(L + 12, y + i * 12.5, l, { size: 10, bold: true, color: C.ink }));
      let yy = y + lines.length * 12.5;
      if (it.sub) {
        doc.text(L + 12, yy, it.sub, { size: 8.5, color: C.mut });
        if (it.bill) doc.text(L + 12 + textWidth(it.sub, 8.5) + 6, yy, 'À refacturer', { size: 8.5, bold: true, color: C.bill });
        yy += 12;
      }
      y = yy + 8;
    }
    y += 6;
  };
  block('Défauts', C.bad, defs.map((d) => ({ title: d.title, sub: `${d.sec} · ${d.label}`, bill: d.bill })));
  block('Observations du client et autre', C.amber, client.map((o) => ({ title: o.title, sub: o.blocked ? 'Bloquante' : '' })));

  // Détail des points, sur deux colonnes
  ensure(60);
  doc.text(L, y, 'Détail des points', { size: 11.5, bold: true, color: C.navy });
  y += 18;
  const gap = 14, colW = (W - gap) / 2;
  const top = y;
  let col = 0, cy = [top, top];
  const secH = (x) => 22 + x.items.reduce((h, it) => h + 15 + (r.values?.[it.id] === 'def' && it.kind !== 'mix' && r.notes?.[it.id] ? wrap(r.notes[it.id], 8, colW - 20).length * 10 : 0), 0) + 8;
  for (const sec of r.sheet || []) {
    const h = secH(sec);
    col = cy[0] <= cy[1] ? 0 : 1; // dans la colonne la plus courte
    if (cy[col] + h > BOTTOM) {
      if (cy[1 - col] + h <= BOTTOM) col = 1 - col;
      else { newPage(); cy = [y, y]; col = 0; }
    }
    const x0 = L + col * (colW + gap);
    let yy = cy[col];
    const nd = sec.items.filter((it) => r.values?.[it.id] === 'def').length;
    doc.rect(x0, yy, colW, 18, { fill: nd ? C.badBg : C.soft, r: 4 });
    doc.text(x0 + 8, yy + 4.5, sec.title, { size: 9.5, bold: true, color: C.navy });
    doc.textRight(x0 + colW - 8, yy + 5, nd ? `${nd} défaut${nd > 1 ? 's' : ''}` : 'OK', { size: 8.5, bold: true, color: nd ? C.bad : C.ok });
    yy += 22;
    for (const it of sec.items) {
      const v = r.values?.[it.id], mix = it.kind === 'mix';
      const lab = wrap(it.label, 8.5, colW - 70)[0];
      doc.text(x0 + 8, yy + 2, lab, { size: 8.5, color: C.ink });
      const badge = v === 'ok' ? (mix ? 'Fait' : 'OK') : v === 'def' ? (mix ? `À faire · ${String(r.notes?.[it.id] || '').replace('.', ',')} L` : 'Défaut') : '—';
      doc.textRight(x0 + colW - 8, yy + 2, badge, { size: 8.5, bold: true, color: v === 'ok' ? C.ok : v === 'def' ? C.bad : C.mut });
      yy += 13;
      if (v === 'def' && !mix && r.notes?.[it.id]) {
        wrap(r.notes[it.id], 8, colW - 20).forEach((l) => { doc.text(x0 + 14, yy, l, { size: 8, color: C.bad }); yy += 10; });
      }
      doc.line(x0 + 8, yy + 1, x0 + colW - 8, yy + 1, { color: '#e8eef2', lw: 0.4 });
      yy += 2;
    }
    cy[col] = yy + 10;
  }

  // Pied de page
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.ops = ops;
    doc.line(L, doc.h - 34, R, doc.h - 34, { color: C.line });
    doc.text(L, doc.h - 28, 'Hublot · ACM Caraïbes', { size: 7.5, color: C.mut });
    doc.textRight(R, doc.h - 28, `Feuille retour ${boatName}${st.dossier ? ` · dossier ${shortDossier(st.dossier)}` : ''} · page ${i + 1}/${total}`, { size: 7.5, color: C.mut });
  });
  return doc.build();
}
