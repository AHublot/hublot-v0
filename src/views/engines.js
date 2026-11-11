// Page Moteurs (manager) : la flotte par échéance, les périodicités par modèle de moteur, les pièces d'entretien.
import { esc, plural } from '../util.js';
import { engConf, engineModelOf, engUrgency, engCounter, baseLabel, INTERVALS } from '../model.js';
import { ic } from '../icons.js';

const fmtHrs = (v) => (v == null || v === '' ? '—' : `${String(v).replace('.', ',')} h`);
const short = (t) => t.split(/\s+\+\s+/)[0];
const TABS = [['fleet', 'Flotte'], ['models', 'Périodicités'], ['parts', 'Pièces']];

function fleetTab(s, ui, now) {
  const conf = engConf(s);
  const rows = s.boats.map((b) => ({ b, u: engUrgency(s, b, now), home: b.base === 'Martinique' }))
    .sort((x, y) => (y.home - x.home) || (x.u.rank - y.u.rank) || (x.u.left - y.u.left) || x.b.name.localeCompare(y.b.name));
  const all = rows.filter((r) => r.home).flatMap((r) => r.u.items);
  const n = (k) => all.filter((x) => x.key === k).length;
  const blank = (u) => u.items.length && u.items.every((x) => x.key === 'missing');
  const nBlank = rows.filter((r) => r.home && blank(r.u)).length;
  const multi = conf.models.length > 1;
  const cell = (x, t) => {
    if (!x) return `<span class="ecell none"><em class="el">${esc(short(t.label))}</em><b>—</b></span>`;
    const main = x.key === 'missing' ? 'À renseigner' : x.key === 'soon' && x.left != null ? `Dans ${x.left} h` : x.key === 'ok' && x.left != null ? `Dans ${x.left} h` : x.label;
    return `<span class="ecell ${x.key}"><em class="el">${esc(short(t.label))}</em><b>${esc(main)}</b>${x.next != null ? `<small>à ${fmtHrs(x.next)}</small>` : ''}</span>`;
  };
  const head = `<div class="erow ehead" style="--n:${conf.types.length}"><span>Bateau</span>${multi ? '<span>Modèle</span>' : ''}<span>Compteur</span>${conf.types.map((t) => `<span>${esc(t.label)}</span>`).join('')}</div>`;
  const body = rows.map(({ b, u, home }) => {
    const cnt = engCounter(b), model = engineModelOf(s, b);
    const byType = Object.fromEntries(u.items.map((x) => [x.type.id, x]));
    return `<div class="erow ${home ? '' : 'away'} r${u.rank}" style="--n:${conf.types.length}">
      <span class="ename"><button type="button" class="linkbtn" data-act="open" data-id="${b.id}" data-tab="maint">${esc(b.name)}</button>${home ? '' : `<small class="mut">${esc(baseLabel(b))}</small>`}</span>
      ${multi ? `<span class="emodel"><select aria-label="Modèle de moteur de ${esc(b.name)}" data-chg="engModel" data-id="${b.id}">${conf.models.map((m) => `<option value="${esc(m.id)}"${m.id === model.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></span>` : ''}
      <span class="ecnt mono">${cnt ? fmtHrs(cnt.h) : '<small class="mut">pas de relevé</small>'}</span>
      ${blank(u) ? '<span class="ecell missing eall">Rien de renseigné pour l’instant</span>' : conf.types.map((t) => cell(byType[t.id], t)).join('')}
    </div>`;
  }).join('');
  return `<p class="mut small engsum"><b class="t-bad">${plural(n('late'), 'en retard', 'en retard')}</b> · <b class="t-warn">${n('soon')} à prévoir</b> (moins de 30 h, une semaine de location) · ${plural(nBlank, 'bateau', 'bateaux')} sans aucun entretien renseigné · Martinique</p>
    <div class="panel etable">${head}${body}</div>`;
}

function modelsTab(s) {
  const conf = engConf(s);
  const types = `<section class="panel"><div class="phead"><h3>Entretiens suivis</h3><span class="mut small">pour tous les modèles</span></div>
    <ul class="etypes">${conf.types.map((t) => `<li><input value="${esc(t.label)}" aria-label="Nom de l’entretien" data-chg="engTypeName" data-type="${esc(t.id)}"><button type="button" class="ibtn" data-act="engTypeDel" data-type="${esc(t.id)}" aria-label="Retirer ${esc(t.label)}">${ic('trash')}</button></li>`).join('')}</ul>
    <form class="inl" data-form="engTypeAdd"><input name="label" placeholder="Nouvel entretien (ex. Huile d’embase)" aria-label="Nouvel entretien" autocomplete="off"><button class="btn sm" type="submit">${ic('plus')} Ajouter</button></form></section>`;
  const model = (m) => {
    const boats = s.boats.filter((b) => engineModelOf(s, b).id === m.id);
    return `<section class="panel emod"><div class="emodh"><input class="emname" value="${esc(m.name)}" aria-label="Nom du modèle" data-chg="engModelName" data-mid="${esc(m.id)}">
      ${conf.models.length > 1 ? `<button type="button" class="ibtn" data-act="engModelDel" data-mid="${esc(m.id)}" aria-label="Retirer ${esc(m.name)}">${ic('trash')}</button>` : ''}</div>
      <p class="small mut">${boats.length ? `${plural(boats.length, 'bateau', 'bateaux')} : ${esc(boats.map((b) => b.name).join(', '))}` : 'Aucun bateau'}${conf.models[0].id === m.id && conf.models.length > 1 ? ' · modèle par défaut' : ''}</p>
      <div class="eivs">${conf.types.map((t) => {
        const iv = m.iv[t.id] || {};
        return `<div class="eiv"><span>${esc(t.label)}</span><label>Tous les <input inputmode="numeric" value="${iv.h || ''}" placeholder="—" aria-label="${esc(t.label)} : heures" data-chg="engIv" data-mid="${esc(m.id)}" data-type="${esc(t.id)}" data-k="h"> h</label>
          <label>ou <select aria-label="${esc(t.label)} : délai" data-chg="engIv" data-mid="${esc(m.id)}" data-type="${esc(t.id)}" data-k="d">${INTERVALS.map((i) => `<option value="${i.v}"${(iv.d || 0) === i.v ? ' selected' : ''}>${i.v ? i.l : '—'}</option>`).join('')}</select></label></div>`;
      }).join('')}</div>
      <p class="small mut">Laisse les deux vides : cet entretien n’est pas suivi sur ce modèle.</p></section>`;
  };
  return `${types}${conf.models.map(model).join('')}
    <form class="panel inl" data-form="engModelAdd"><input name="name" placeholder="Nouveau modèle de moteur (ex. Yanmar 4JH45)" aria-label="Nouveau modèle de moteur" autocomplete="off"><button class="btn pri sm" type="submit">${ic('plus')} Ajouter</button></form>
    ${conf.models.length > 1 ? '' : '<p class="small mut">Ajoute un modèle par type de moteur de la flotte, puis choisis le modèle de chaque bateau dans l’onglet Flotte.</p>'}`;
}

function partsTab(s) {
  const conf = engConf(s);
  const typeSel = (cur, attrs) => `<select ${attrs}><option value="">Autre</option>${conf.types.map((t) => `<option value="${esc(t.id)}"${cur === t.id ? ' selected' : ''}>${esc(short(t.label))}</option>`).join('')}</select>`;
  return conf.models.map((m) => `<section class="panel eparts"><div class="phead"><h3>${esc(m.name)}</h3><span class="mut small">${plural(m.parts.length, 'pièce', 'pièces')}</span></div>
    ${m.parts.length ? `<div class="eprow ehead"><span>Entretien</span><span>Pièce</span><span>Référence</span><span>Qté</span><span></span></div>` : ''}
    ${m.parts.map((p) => `<div class="eprow">
      ${typeSel(p.type, `aria-label="Entretien" data-chg="engPart" data-mid="${esc(m.id)}" data-pid="${esc(p.id)}" data-f="type"`)}
      <input value="${esc(p.label)}" aria-label="Pièce" data-chg="engPart" data-mid="${esc(m.id)}" data-pid="${esc(p.id)}" data-f="label">
      <input class="mono" value="${esc(p.ref)}" placeholder="Référence" aria-label="Référence" data-chg="engPart" data-mid="${esc(m.id)}" data-pid="${esc(p.id)}" data-f="ref">
      <input inputmode="numeric" value="${esc(p.qty)}" placeholder="1" aria-label="Quantité" data-chg="engPart" data-mid="${esc(m.id)}" data-pid="${esc(p.id)}" data-f="qty">
      <button type="button" class="ibtn" data-act="engPartDel" data-mid="${esc(m.id)}" data-pid="${esc(p.id)}" aria-label="Retirer ${esc(p.label)}">${ic('trash')}</button></div>`).join('')}
    <form class="eprow eadd" data-form="engPartAdd" data-mid="${esc(m.id)}">
      ${typeSel('', 'name="type" aria-label="Entretien"')}
      <input name="label" placeholder="Pièce (ex. Filtre à huile)" aria-label="Pièce" autocomplete="off">
      <input name="ref" class="mono" placeholder="Référence" aria-label="Référence" autocomplete="off">
      <input name="qty" inputmode="numeric" placeholder="1" aria-label="Quantité">
      <button class="btn sm" type="submit" aria-label="Ajouter la pièce">${ic('plus')}</button></form>
  </section>`).join('') + '<p class="small mut">Les pièces liées à un entretien s’affichent sur la fiche du bateau, à côté de cet entretien.</p>';
}

export function enginesView(s, ui, now = new Date()) {
  const tab = TABS.some(([k]) => k === ui.engTab) ? ui.engTab : 'fleet';
  const body = tab === 'models' ? modelsTab(s) : tab === 'parts' ? partsTab(s) : fleetTab(s, ui, now);
  return `<div class="page-head"><div><h1>Moteurs</h1><p class="mut">Vidanges, filtres et impellers de la flotte, au compteur le plus haut des deux moteurs.</p></div></div>
    <div class="seg etabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="engTab" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="epage ${tab}">${body}</div>`;
}
