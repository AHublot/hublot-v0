// ---- Feuille retour : pense-bête du tour du bateau ; chaque Défaut devient une observation -------------
// Deux modes : brouillon en cours (#/retour/<bateau>) et feuille validée en lecture seule (#/retour/<bateau>/<feuille>).
import { esc, fmtWDT } from '../util.js';
import { ic } from '../icons.js';
import { SHEET_NUMS, shortDossier } from '../model.js';
import { sheetMissing, tripHours, sheetObsTitle, draftSheet, clientObsList } from '../actions.js';

const hh = (v) => (v == null || v === '' ? '—' : `${String(v).replace('.', ',')} h`);
const when = (iso) => { try { return fmtWDT(new Date(iso)); } catch { return iso || ''; } };

export function retourView(s, ui, boatId, sheetId, user = '') {
  const b = s.boats.find((x) => x.id === boatId);
  if (!b) return `<div class="rwrap"><p class="mut">Bateau introuvable.</p></div>`;
  const done = sheetId ? (b.returnSheets || []).find((x) => x.id === sheetId) : null;
  if (sheetId && !done) return `<div class="rwrap"><p class="mut">Feuille introuvable.</p></div>`;
  const d = done || b.returnDraft;
  if (!d) {
    return `<div class="rwrap">${top(b, 'Feuille retour')}
      <section class="panel"><p>${b.inRental ? 'Aucune feuille retour en cours pour ce bateau.' : 'Ce bateau est à quai : la feuille retour se remplit quand il rentre de location.'}</p>
      ${b.inRental ? `<div class="row gap"><button type="button" class="btn pri" data-act="retAsk" data-id="${b.id}">${ic('left')} Commencer la feuille retour</button></div>` : ''}</section></div>`;
  }
  const ro = !!done;
  const sheet = ro ? d.sheet : draftSheet(s, d);
  const miss = ro ? null : sheetMissing(s, b, d);
  const total = sheet.reduce((n, x) => n + x.items.length, 0);
  const seen = sheet.reduce((n, x) => n + x.items.filter((it) => d.values[it.id]).length, 0);
  const defs = sheet.reduce((n, x) => n + x.items.filter((it) => d.values[it.id] === 'def').length, 0);
  const trip = ro ? d.tripHours || {} : tripHours(b, d.nums || {});
  const open = ui.rOpen || (ui.rOpen = {});

  const field = (label, f, val, ph = '') => `<div><dt>${label}</dt><dd>${ro ? (val ? esc(val) : '<span class="mut">—</span>') : `<input data-chg="rText" data-id="${b.id}" data-f="${f}" value="${esc(val || '')}" placeholder="${ph}" aria-label="${label}">`}</dd></div>`;
  const info = `<section class="panel rinfo"><dl>
      ${field('Dossier', 'stay.dossier', shortDossier(d.stay?.dossier), 'N°')}
      ${field('Locataire', 'stay.client', d.stay?.client, 'Nom')}
      ${field('Skipper', 'stay.skipper', d.stay?.skipper, 'Sans skipper')}
      ${d.stay?.dep || d.stay?.ret ? `<div><dt>Séjour</dt><dd>${esc(d.stay.dep ? when(d.stay.dep) : '?')} → ${esc(d.stay.ret ? when(d.stay.ret) : '?')}</dd></div>` : ''}
      <div><dt>${ro ? 'Retour validé' : 'Commencée'}</dt><dd>${esc(when(ro ? d.at : d.startedAt))}</dd></div>
      <div><dt>Technicien</dt><dd>${esc((ro ? d.by : d.startedBy) || user || '—')}</dd></div>
    </dl></section>`;

  const row = (it) => {
    const v = d.values[it.id];
    if (ro) {
      const mix = it.kind === 'mix';
      return `<li class="rrow ${v || 'todo'}"><span class="rlab">${esc(it.label)}</span><span class="rbadge ${v || ''}">${v === 'ok' ? (mix ? 'Fait' : 'OK') : v === 'def' ? (mix ? `À faire · ${esc(String(d.notes[it.id] || '').replace('.', ','))} L` : 'Défaut') : '—'}</span>
        ${v === 'def' && !mix ? `<p class="rnote-ro">${esc(d.notes[it.id] || '')}${d.bill[it.id] ? ' <span class="jrole">À refacturer</span>' : ''}</p>` : ''}</li>`;
    }
    const mix = it.kind === 'mix';
    const nonote = v === 'def' && !String(d.notes[it.id] || '').trim();
    return `<li class="rrow ${v || 'todo'} ${mix ? 'mix' : ''} ${nonote ? 'nonote' : ''}" id="r-${esc(it.id)}">
      <span class="rlab">${esc(it.label)}</span>
      <span class="rbtn" role="group" aria-label="${esc(it.label)}">
        <button type="button" class="ok ${v === 'ok' ? 'on' : ''}" data-act="rSet" data-id="${b.id}" data-it="${esc(it.id)}" data-v="ok" aria-pressed="${v === 'ok'}">${mix ? 'Fait' : 'OK'}</button>
        <button type="button" class="def ${v === 'def' ? 'on' : ''}" data-act="rSet" data-id="${b.id}" data-it="${esc(it.id)}" data-v="def" aria-pressed="${v === 'def'}">${mix ? 'À faire' : 'Défaut'}</button>
      </span>
      ${v === 'def' && mix ? `<label class="rnum rmix"><span>Litres à mélanger</span><input inputmode="decimal" data-chg="rNote" data-id="${b.id}" data-it="${esc(it.id)}" value="${esc(d.notes[it.id] || '')}" placeholder="—"><em>L</em></label>` : ''}
      ${v === 'def' && !mix ? `<div class="rnote"><textarea rows="2" data-chg="rNote" data-id="${b.id}" data-it="${esc(it.id)}" placeholder="Décris le défaut : il deviendra une observation">${esc(d.notes[it.id] || '')}</textarea>
        <label class="rbill"><input type="checkbox" ${d.bill[it.id] ? 'checked' : ''} data-chg="rBill" data-id="${b.id}" data-it="${esc(it.id)}"> À refacturer</label></div>` : ''}
    </li>`;
  };
  const sec = (x) => {
    const n = x.items.filter((it) => d.values[it.id]).length, nd = x.items.filter((it) => d.values[it.id] === 'def').length;
    const full = n === x.items.length;
    const isOpen = ro ? true : !!open[x.id]; // toutes les parties fermées à l'ouverture de la feuille
    const p = x.items.length ? Math.round((100 * n) / x.items.length) : 100;
    const left = x.items.length - n + (ro ? 0 : x.items.filter((it) => d.values[it.id] === 'def' && !String(d.notes[it.id] || '').trim()).length);
    const todo = left ? `<span class="rs-todo">${left} à remplir</span>` : '';
    const state = full && !nd ? `<span class="rs-ok">${ic('check')} OK</span>` : `${nd ? `<span class="rs-def">${nd} défaut${nd > 1 ? 's' : ''}</span>` : ''}${ro ? '' : todo}`;
    const nm = x.num && SHEET_NUMS[x.num];
    const numVal = d.nums?.[x.num] || '';
    const numRow = nm ? `<label class="rnum"><span>${nm.label}</span>${ro ? `<b>${numVal ? esc(numVal) : '—'}</b>` : `<input inputmode="decimal" data-chg="rNum" data-id="${b.id}" data-k="${x.num}" value="${esc(numVal)}" placeholder="—">`}<em>${nm.unit}</em></label>
      ${x.num === 'hoursPort' || x.num === 'hoursStbd' ? `<p class="rtrip small mut">Heures du séjour : <b>${hh(x.num === 'hoursPort' ? trip.port : trip.stbd)}</b></p>` : ''}` : '';
    return `<section class="panel rsec ${isOpen ? 'open' : ''} ${full && !nd ? 'done' : ''}">
      <div class="rhead"><button type="button" class="rtgl" ${ro ? 'disabled' : `data-act="rOpen" data-v="${esc(x.id)}"`} aria-expanded="${isOpen}"><h3>${esc(x.title)}</h3>${state}${ro ? '' : ic('down', 'jchev')}</button></div>
      ${ro ? '' : `<i class="rsbar ${nd ? 'def' : full ? 'ok' : ''}" aria-hidden="true"><span style="width:${p}%"></span></i>`}
      ${isOpen ? `${numRow}<ul class="rlist">${x.items.map(row).join('')}</ul>` : ''}
    </section>`;
  };
  const text = (f, label, ph) => (ro && !d[f] ? '' : `<label class="rtext"><span>${label}</span>${ro ? `<p>${esc(d[f])}</p>` : `<textarea rows="2" data-chg="rText" data-id="${b.id}" data-f="${f}" placeholder="${ph}">${esc(d[f] || '')}</textarea>`}</label>`);
  const bureau = ro
    ? `<section class="panel rbureau ro"><p class="k">${ic('euro')}<span>Uniquement pour le bureau</span></p>
        <p><span class="mut small">À facturer aujourd’hui</span><br><b>${d.billToday ? esc(d.billToday) : '<span class="mut">Rien</span>'}</b></p>
        <p class="rdiver ${d.diver ? 'yes' : 'no'}">Plongeur passé : <b>${d.diver ? 'oui' : 'non'}</b></p></section>`
    : `<section class="panel rbureau"><p class="k">${ic('euro')}<span>Uniquement pour le bureau</span><span class="mut">· facultatif</span></p>
        <label class="rtext"><span>À facturer aujourd’hui</span><textarea rows="2" data-chg="rText" data-id="${b.id}" data-f="billToday" placeholder="Ex. : gasoil 40 L, paddle percé, nettoyage supplémentaire">${esc(d.billToday || '')}</textarea></label>
        <label class="rdiverck"><input type="checkbox" data-chg="rDiver" data-id="${b.id}" ${d.diver ? 'checked' : ''}> Plongeur passé</label></section>`;
  const pct = total ? Math.round((seen / total) * 100) : 0;
  // Ce qu'il reste à remplir (points sans réponse + Défauts sans note), en ambre ; vert quand tout est rempli
  const left = ro ? 0 : miss.unseen.length + miss.noNote.length;
  const nObs = defs + (ro ? 0 : clientObsList(d.clientObs).length);
  const bar = ro ? '' : `<div class="rbar">${left
    ? `<div class="small"><b class="rcount todo">${left} à remplir</b><br><span class="mut">« Point suivant » t’y emmène</span></div><button type="button" class="btn" data-act="rNext" data-id="${b.id}">Point suivant ${ic('down')}</button>`
    : `<div class="small"><b class="rcount done">${ic('check')} Tout est rempli</b><br><span class="mut">${nObs} observation${nObs > 1 ? 's' : ''} ${nObs > 1 ? 'seront créées' : 'sera créée'}</span></div><button type="button" class="btn pri" data-act="rDone" data-id="${b.id}">Valider le retour</button>`}</div>`;

  return `<div class="rwrap ${ro ? 'ro' : ''}">
    ${top(b, ro ? 'Feuille retour validée' : 'Feuille retour', ro ? `<button type="button" class="btn sm" data-act="rPrint">${ic('download')} PDF</button>` : `<button type="button" class="btn ghost sm" data-act="rCancel" data-id="${b.id}">Annuler la feuille</button>`)}
    ${ui.rCancel === b.id ? `<section class="panel rcancel" role="alert"><p><b>Annuler cette feuille retour ?</b> Les réponses seront perdues. Le bateau reste en location.</p><div class="row gap"><button type="button" class="btn" data-act="rCancelNo">Garder la feuille</button><button type="button" class="btn bad" data-act="rCancelYes" data-id="${b.id}">Annuler la feuille</button></div></section>` : ''}
    ${info}
    ${ro ? bureau : ''}
    ${ro ? `<p class="small mut">${defs} défaut${defs > 1 ? 's' : ''} · heures du séjour bâbord ${hh(trip.port)}, tribord ${hh(trip.stbd)}</p>` : `<div class="rprog ${left ? 'todo' : 'done'}" aria-label="Avancement"><div>${left ? `<b class="rcount todo">${left} à remplir</b>` : `<b class="rcount done">${ic('check')} Tout est rempli</b>`} <span class="mut small">${seen} / ${total}</span></div><i><span style="width:${pct}%"></span></i></div>`}
    <div class="rsecs">${sheet.map(sec).join('')}</div>
    ${ro && !d.clientObs ? '' : `<section class="panel rfree">
      ${text('clientObs', 'Observations du client et autre', 'Une ligne = une observation à cocher.&#10;Exemple :&#10;Le client signale que le frigo refroidit mal&#10;Coussin de cockpit déchiré')}
      ${ro ? '' : `<p class="small mut" data-cobs-out>${cobsHint(d.clientObs)}</p>`}
    </section>`}
    ${ro ? '' : bureau}
    ${bar}
  </div>${!ro && ui.rRecap === b.id ? recap(s, b, d, sheet, miss, trip) : ''}`;
}

/** Sous la zone « Observations du client et autre » : combien d'observations à cocher seront créées. */
export function cobsHint(text) {
  const n = clientObsList(text).length;
  return n ? `<b>${n} observation${n > 1 ? 's' : ''} à cocher ${n > 1 ? 'seront créées' : 'sera créée'}</b> (une par ligne)` : 'Une ligne = une observation à cocher.';
}
function top(b, kicker, extra = '') {
  return `<div class="rtop"><a href="#/boat/${encodeURIComponent(b.id)}/prep" class="btn ghost icon" aria-label="Retour au bateau">${ic('left')}</a>
    <div class="grow"><p class="k">${kicker}</p><h1>${esc(b.name)}</h1></div>${extra}</div>`;
}

function recap(s, b, d, sheet, miss, trip) {
  const cl = clientObsList(d.clientObs);
  const defs = sheet.flatMap((x) => x.items.filter((it) => d.values[it.id] === 'def').map((it) => ({ sec: x.title, it, note: String(d.notes[it.id] || '').trim() ? sheetObsTitle({ ...it, sec: x }, d.notes[it.id]) : '', bill: !!d.bill[it.id] })));
  return `<div class="sheet-back" data-act="rRecapNo"></div><div class="rrecap panel" role="dialog" aria-label="Valider le retour">
    <h2>Valider le retour de ${esc(b.name)} ?</h2>
    <p class="mut small">${d.stay?.dossier ? `Dossier ${esc(d.stay.dossier)} · ` : ''}${d.stay?.client ? `${esc(d.stay.client)} · ` : ''}${sheet.reduce((n, x) => n + x.items.length, 0)} points vus</p>
    ${miss.noNote.length ? `<p class="t-bad small" role="alert">Décris le défaut avant de valider : ${miss.noNote.map((it) => esc(it.label)).join(', ')}.</p>` : ''}
    <p class="k">${defs.length + cl.length ? `Observations créées (${defs.length + cl.length})` : 'Aucun défaut : aucune observation créée'}</p>
    ${defs.length ? `<ul class="rlist2">${defs.map((x) => `<li><span class="jic k-new">${ic('plus')}</span><div><p>${x.note ? esc(x.note) : '<span class="t-bad">Note manquante</span>'}</p><p class="small mut">${esc(x.sec)} · ${esc(x.it.label)}${x.bill ? ' · <span class="jrole">À refacturer</span>' : ''}</p></div></li>`).join('')}</ul>` : ''}
    ${cl.length ? `<ul class="rlist2">${cl.map((o) => `<li><span class="jic k-new">${ic('plus')}</span><div><p>${esc(o.title)}</p><p class="small mut">Observations du client et autre${o.blocked ? ' · <span class="t-bad">bloquante</span>' : ''}</p></div></li>`).join('')}</ul>` : ''}
    <p class="small mut">Relevé moteur : bâbord ${d.nums?.hoursPort ? esc(d.nums.hoursPort) + ' h' : '—'} · tribord ${d.nums?.hoursStbd ? esc(d.nums.hoursStbd) + ' h' : '—'}. Heures du séjour : bâbord ${hh(trip.port)}, tribord ${hh(trip.stbd)}.<br>La préparation en cours est archivée, comme pour un retour habituel, et la feuille est rangée dans les archives du bateau.</p>
    <div class="row gap"><button type="button" class="btn" data-act="rRecapNo">Modifier</button><button type="button" class="btn pri" data-act="rValidate" data-id="${b.id}" ${miss.noNote.length ? 'disabled' : ''}>Valider</button></div>
  </div>`;
}
