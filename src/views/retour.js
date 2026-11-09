// ---- Feuille retour (MAQUETTE) : pense-bête du tour du bateau, chaque Défaut devient une observation ----
import { esc } from '../util.js';
import { ic } from '../icons.js';

export const SHEET = [
  { id: 'mbd', title: 'Cale moteur bâbord', num: { k: 'hb', label: 'Heures moteur', unit: 'h' }, items: ['Gasoil', 'Huile', 'Embase', 'Refroidissement', 'Courroie', 'Gatte et cale', 'Filtre eau de mer'] },
  { id: 'mtd', title: 'Cale moteur tribord', num: { k: 'ht', label: 'Heures moteur', unit: 'h' }, items: ['Gasoil', 'Huile', 'Embase', 'Refroidissement', 'Courroie', 'Gatte et cale', 'Filtre eau de mer'] },
  { id: 'bat', title: 'Batteries et barre', items: ['Cosses de batteries', 'Palonnier', 'Drosses', 'Axe et mèche de safran'] },
  { id: 'plo', title: 'Plomberie', items: ['Pompe de cale', 'Pompe eau', 'Pompe eau de mer', 'WC bâbord', 'WC tribord', 'Douchette'] },
  { id: 'cui', title: 'Cuisine', items: ['Gaz'] },
  { id: 'des', title: 'Dessalinisateur', items: ['Fonctionnement', 'Filtre'] },
  { id: 'ele', title: 'Électronique', items: ['Pilote', 'GPS', 'Répétiteur', 'Info vent', 'Info sonde'] },
  { id: 'coq', title: 'Coque et pont', items: ['Hublots', 'Fissures coque et pont', 'Poutre avant', 'Jupes', 'Fonds'] },
  { id: 'gre', title: 'Gréement', items: ['Spinlock', 'Poulies', 'Drisses', 'Écoutes', 'Winchs', 'Vit de mulet', 'Drosse d’enrouleur'] },
  { id: 'voi', title: 'Voiles et toiles', items: ['Grand-voile', 'Génois', 'Lazy bag', 'Bimini', 'Coussins'] },
  { id: 'mou', title: 'Mouillage', items: ['Guindeau', 'Ancre et manille'] },
  { id: 'ann', title: 'Annexe', num: { k: 'mel', label: 'Mélange', unit: 'L' }, items: ['Annexe', 'Moteur hors-bord', 'Hélice hors-bord'] },
  { id: 'inv', title: 'Inventaire', items: ['Amarres', 'Pompe annexe', 'Mouillage annexe', 'Pare-battages', 'Écope', 'Gilets'] },
  { id: 'opt', title: 'Options du séjour', items: ['Paddle'] },
];

// État de démonstration : cales faites, une partie en cours avec un défaut.
export function demoRetour() {
  const v = {};
  const all = (sid, val = 'ok') => SHEET.find((x) => x.id === sid).items.forEach((_, i) => (v[`${sid}.${i}`] = val));
  all('mbd'); all('mtd'); all('bat'); all('plo'); all('cui');
  v['mtd.4'] = 'def';
  v['des.0'] = 'ok';
  all('ele'); all('coq');
  return {
    v, open: {},
    notes: { 'mtd.4': 'Courroie tribord à remplacer', 'voi.2': 'La fermeture éclair est cassée' },
    bill: { 'voi.2': true },
    num: { hb: '1182', ht: '1176', mel: '' },
    free: '',
    pre: { 'voi.0': 'ok', 'voi.1': 'ok', 'voi.2': 'def' },
  };
}

export function retourStats(r) {
  let done = 0, total = 0, defs = 0;
  SHEET.forEach((s) => s.items.forEach((_, i) => { total++; const x = r.v[`${s.id}.${i}`]; if (x) done++; if (x === 'def') defs++; }));
  return { done, total, defs };
}

export function retourView(s, ui) {
  const r = ui.retour || (ui.retour = (() => { const d = demoRetour(); Object.assign(d.v, d.pre); return d; })());
  const st = retourStats(r);
  const sec = (x) => {
    const keys = x.items.map((_, i) => `${x.id}.${i}`);
    const n = keys.filter((k) => r.v[k]).length, d = keys.filter((k) => r.v[k] === 'def').length;
    const full = n === keys.length;
    const open = r.open[x.id] ?? !full;
    const state = full && !d ? `<span class="rs-ok">${ic('check')} OK</span>` : d ? `<span class="rs-def">${d} défaut${d > 1 ? 's' : ''}</span>` : `<span class="mut">${n} / ${keys.length}</span>`;
    const row = (it, i) => {
      const k = `${x.id}.${i}`, val = r.v[k];
      return `<li class="rrow ${val || 'todo'}" id="r-${k.replace('.', '-')}">
        <span class="rlab">${esc(it)}</span>
        <span class="rbtn" role="group" aria-label="${esc(it)}">
          <button type="button" class="ok ${val === 'ok' ? 'on' : ''}" data-act="rSet" data-k="${k}" data-v="ok" aria-pressed="${val === 'ok'}">OK</button>
          <button type="button" class="def ${val === 'def' ? 'on' : ''}" data-act="rSet" data-k="${k}" data-v="def" aria-pressed="${val === 'def'}">Défaut</button>
        </span>
        ${val === 'def' ? `<div class="rnote"><textarea rows="2" data-inp="rNote" data-k="${k}" placeholder="Décris le défaut : il deviendra une observation">${esc(r.notes[k] || '')}</textarea>
          <label class="rbill"><input type="checkbox" ${r.bill[k] ? 'checked' : ''} data-chg="rBill" data-k="${k}"> À refacturer</label></div>` : ''}
      </li>`;
    };
    return `<section class="panel rsec ${open ? 'open' : ''} ${full && !d ? 'done' : ''}">
      <div class="rhead"><button type="button" class="rtgl" data-act="rOpen" data-v="${x.id}" aria-expanded="${open}"><h3>${esc(x.title)}</h3>${state}${ic('down', 'jchev')}</button>
</div>
      ${open ? `${x.num ? `<label class="rnum"><span>${x.num.label}</span><input inputmode="decimal" value="${esc(r.num[x.num.k] || '')}" placeholder="—"><em>${x.num.unit}</em></label>` : ''}
        <ul class="rlist">${x.items.map(row).join('')}</ul>` : ''}
    </section>`;
  };
  const pct = Math.round((st.done / st.total) * 100);
  return `<div class="rwrap">
    <div class="rtop">
      <a href="#/" class="btn ghost icon" aria-label="Retour">${ic('left')}</a>
      <div><p class="k">Feuille retour</p><h1>Hoedic</h1></div>
    </div>
    <section class="panel rinfo">
      <dl>
        <div><dt>Dossier</dt><dd class="mono">ACM-2026-5629</dd></div>
        <div><dt>Locataire</dt><dd>Durand</dd></div>
        <div><dt>Skipper</dt><dd class="mut">Sans skipper</dd></div>
        <div><dt>Retour</dt><dd>sam. 14/11 · 9 h · Le Marin</dd></div>
        <div><dt>Technicien</dt><dd>Anthony</dd></div>
      </dl>
    </section>
    <div class="rprog" aria-label="Avancement"><div><b>${st.done} / ${st.total}</b> points vus${st.defs ? ` · <b class="t-bad">${st.defs} défaut${st.defs > 1 ? 's' : ''}</b>` : ''}</div><i><span style="width:${pct}%"></span></i></div>
    <div class="rsecs">${SHEET.map(sec).join('')}</div>
    <section class="panel rfree"><h3>Note libre</h3><textarea rows="3" placeholder="Ex. matériel utilisé, remarque pour la refacturation…"></textarea><p class="small mut">Reprise dans l’export Excel.</p></section>
    <div class="rbar">${st.done < st.total
      ? `<div class="small"><b>Encore ${st.total - st.done} point${st.total - st.done > 1 ? 's' : ''} à voir</b><br><span class="mut">${st.defs} défaut${st.defs > 1 ? 's' : ''} pour l’instant</span></div><button type="button" class="btn" data-act="rNext">Point suivant ${ic('down')}</button>`
      : `<div class="small"><b>Tous les points sont vus</b><br><span class="mut">${st.defs} observation${st.defs > 1 ? 's' : ''} ${st.defs > 1 ? 'seront créées' : 'sera créée'}</span></div><button type="button" class="btn pri" data-act="rDone">Valider le retour</button>`}</div>
  </div>`;
}

export function retourRecap(s, ui) {
  const r = ui.retour;
  const defs = [];
  SHEET.forEach((x) => x.items.forEach((it, i) => { const k = `${x.id}.${i}`; if (r.v[k] === 'def') defs.push({ sec: x.title, it, note: r.notes[k] || it, bill: !!r.bill[k] }); }));
  const st = retourStats(r);
  return `<div class="sheet-back"></div><div class="rrecap panel" role="dialog" aria-label="Valider le retour">
    <h2>Valider le retour de Hoedic ?</h2>
    <p class="mut small">Dossier ACM-2026-5629 · Durand · ${st.total} points vus</p>
    <p class="k">Observations créées</p>
    <ul class="rlist2">${defs.map((d) => `<li><span class="jic k-new">${ic('plus')}</span><div><p>${esc(d.note)}</p><p class="small mut">${esc(d.sec)} · ${esc(d.it)}${d.bill ? ' · <span class="jrole">À refacturer</span>' : ''}</p></div></li>`).join('')}</ul>
    <p class="small mut">Heures moteur notées : bâbord 1182 h · tribord 1176 h. La feuille sera rangée dans les archives du bateau (PDF possible).</p>
    <div class="row gap"><button type="button" class="btn">Modifier</button><button type="button" class="btn pri">Valider</button></div>
  </div>`;
}
