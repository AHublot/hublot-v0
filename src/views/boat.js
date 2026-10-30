import { esc, fmtD, fmtDT, fmtWDT, plural, parseLocal } from '../util.js';
import {
  boatStats, boatStatus, maintStatus, maintCounts, baseLabel, tplsOf, pinnedEvents, latestHours,
  observationsOf, obsState, BASES, CATEGORIES, INTERVALS,
} from '../model.js';
import { returnPlan } from '../actions.js';
import { ic } from '../icons.js';
import { pill, bar, cd, empty } from './common.js';
import { boatReport, waLink } from '../whatsapp.js';
import { voiceSupported } from '../voice.js';

export const TABS = [
  ['prep', 'Préparation', 'list'], ['maint', 'Entretiens', 'tool'],
  ['archives', 'Archives & suivi', 'history'], ['reglages', 'Réglages', 'sliders'],
];

function taskRow(b, t, { edit = false, pending = false } = {}) {
  const meta = [];
  if (t.blocked && !t.done) meta.push('<b class="t-bad">Bloquant</b>');
  if (t.carried) meta.push(`Reportée · depuis le ${esc(fmtD(t.origin))}`);
  else if (!t.template && t.origin) meta.push(`Ajoutée le ${esc(fmtD(t.origin))}`);
  if (t.done && t.doneAt) meta.push(`Terminée le ${esc(fmtDT(t.doneAt))}`);
  const chk = pending
    ? `<span class="chk off" aria-hidden="true"></span>`
    : `<button type="button" class="chk" role="checkbox" aria-checked="${!!t.done}" aria-label="${esc(t.title)}" data-act="tgl" data-id="${b.id}" data-tid="${t.id}" data-fk="tgl-${t.id}">${ic('check')}</button>`;
  return `<li class="task ${t.done ? 'done' : ''} ${t.blocked && !t.done ? 'blocked' : ''}">${chk}
    <div class="tbody"><div class="ttl">${esc(t.title)}</div>${meta.length ? `<div class="tmeta">${meta.join('<span>·</span>')}</div>` : ''}</div>
    ${pending ? '' : `<button type="button" class="tbtn ${t.blocked ? 'on' : ''}" data-act="blk" data-id="${b.id}" data-tid="${t.id}" data-fk="blk-${t.id}" aria-pressed="${!!t.blocked}">${ic('flag')}<span>Bloquer</span></button>`}
    <button type="button" class="ibtn" data-act="${pending ? 'delp' : 'del'}" data-id="${b.id}" data-tid="${t.id}" aria-label="Retirer : ${esc(t.title)}">${ic('x')}</button></li>`;
}

function tplEditRow(b, title, i, n) {
  return `<li class="task edit"><span class="num mono">${i + 1}</span><div class="tbody"><div class="ttl">${esc(title)}</div></div>
    <button type="button" class="ibtn" data-act="recUp" data-id="${b.id}" data-i="${i}" aria-label="Monter" ${i ? '' : 'disabled'}>${ic('up')}</button>
    <button type="button" class="ibtn" data-act="recDn" data-id="${b.id}" data-i="${i}" aria-label="Descendre" ${i < n - 1 ? '' : 'disabled'}>${ic('down')}</button>
    <button type="button" class="ibtn" data-act="recDel" data-id="${b.id}" data-i="${i}" aria-label="Retirer de la liste">${ic('trash')}</button></li>`;
}

/** Récapitulatif avant de valider un nouveau retour. */
function retConfirm(s, b) {
  const p = returnPlan(s, b);
  return `<section class="panel retconfirm" aria-label="Valider le nouveau retour"><h3>${ic('left')} Nouveau retour · ${esc(b.name)}</h3>
    <ul>
      <li>${ic('history')}<span>${p.archived ? `La préparation en cours (<b>${plural(p.archived, 'tâche', 'tâches')}</b>${p.obsDone ? `, dont ${plural(p.obsDone, 'observation réglée', 'observations réglées')}` : ''}) part dans <b>Archives &amp; suivi</b>.` : 'Rien à archiver : la préparation est vide.'}</span></li>
      <li>${ic('flag')}<span>${p.kept.length ? `<b>${plural(p.kept.length, 'observation non terminée reste', 'observations non terminées restent')}</b> dans la préparation : ${p.kept.slice(0, 4).map((t) => esc(t.title)).join(' · ')}${p.kept.length > 4 ? ` · +${p.kept.length - 4}` : ''}` : 'Aucune observation en cours à reporter.'}</span></li>
      <li>${ic('list')}<span>Les <b>${p.templates} tâches habituelles</b> repartent à zéro.</span></li>
    </ul>
    <div class="row gap wrap"><button class="btn pri" data-act="retGo" data-id="${b.id}">${ic('check')} Valider le retour</button><button class="btn" data-act="confirmNo">Annuler</button></div></section>`;
}

function header(s, b, ui, now) {
  const st = boatStats(b), stt = boatStatus(b), mc = maintCounts(b, now);
  const dep = !b.inRental && parseLocal(b.departure);
  const report = boatReport(b, now);
  const pins = pinnedEvents(b);
  const techs = b.techs.length ? `<span>${ic('users')} ${esc(b.techs.join(', '))}</span>` : `<span class="mut">${ic('users')} Aucun technicien affecté</span>`;
  return `
  <div class="crumbs"><a href="#/" data-act="nav" data-to="overview">${esc(s.baseName)}</a>${ic('chevR')}<span>${esc(b.name)}</span></div>
  <button type="button" class="back" data-act="nav" data-to="overview">${ic('left')} Toute la flotte</button>
  <div class="boat-head">
    <div><span class="eyebrow">Préparation du ${esc(fmtD(b.cycle))}</span>
      <h1>${esc(b.name)} ${pill(stt)}</h1><p class="mut">${esc(b.model || '—')} · ${esc(baseLabel(b))}</p></div>
    <div class="row gap wrap actions">
      <a class="btn acc" target="_blank" rel="noopener" href="${waLink(report)}" data-act="copyWA" data-kind="boat" data-id="${b.id}">${ic('send')} Exporter pour WhatsApp</a>
      <button class="btn" type="button" data-act="retAsk" data-id="${b.id}">${ic('left')} Nouveau retour</button>
      <button class="btn icon" type="button" data-act="print" aria-label="Imprimer la feuille de préparation" title="Imprimer">${ic('print')}</button>
    </div>
  </div>
  <section class="statcard">
    <div><span class="eyebrow">${b.inRental ? 'Retour prévu' : 'Prochain départ'} · ${esc(baseLabel(b))}</span>
      ${b.inRental
        ? `<b class="sbig">${b.returnDate ? esc(fmtWDT(b.returnDate)) : 'Non renseigné'}</b><span class="mut small">${b.returnDate ? 'dans ' : 'En location depuis '}${b.returnDate ? cd(b.returnDate, now) : esc(fmtDT(b.lastDeparture || b.departure || ''))}</span>`
        : `<b class="sbig">${dep ? esc(fmtWDT(b.departure)) : 'À renseigner'}</b><span class="mut small">${dep ? (dep > now ? 'Dans ' + cd(b.departure, now) : 'Départ dépassé') : 'Aucune date de départ'}</span>`}
    </div>
    <div><span class="eyebrow">Avancement</span><b class="sbig mono">${b.inRental ? '—' : st.pct + ' %'}</b>
      ${b.inRental ? '<span class="mut small">Bateau en location</span>' : `${bar(st.pct, st.blocked ? 'bad' : st.open ? '' : 'ok')}<span class="mut small">${st.done}/${st.total} tâches</span>`}</div>
    <div><span class="eyebrow">Points d’attention</span><b class="sbig ${st.blocked ? 't-bad' : ''}">${plural(st.blocked, 'bloquant', 'bloquants')}</b>
      <span class="mut small">${mc.late} en retard · ${plural(mc.missing, 'date à renseigner', 'dates à renseigner')}</span></div>
  </section>
  <div class="chiprow">
    <span class="tag">${ic('pin')} ${esc(baseLabel(b))}</span>
    ${b.inRental
      ? `<button type="button" class="btn sm" data-act="retAsk" data-id="${b.id}">${ic('left')} Signaler le retour</button>`
      : `<button type="button" class="btn sm ghost" data-act="dep" data-id="${b.id}">${ic('send')} Signaler le départ</button>`}
    <span class="tech">${techs} <button type="button" class="linkbtn" data-act="techs" aria-expanded="${!!ui.techs}">${ui.techs ? 'Fermer' : 'Modifier'}</button></span>
  </div>
  ${ui.confirm === 'ret:' + b.id ? retConfirm(s, b) : ''}
  ${ui.techs ? `<div class="panel techpanel">${s.team.length ? s.team.map((n) => `<label class="ck"><input type="checkbox" data-chg="tech" data-id="${b.id}" data-name="${esc(n)}" ${b.techs.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('') : `<span class="mut">Aucune personne dans l’équipe. <button class="linkbtn" data-act="nav" data-to="team">Ajouter des personnes</button></span>`}</div>` : ''}
  ${pins.length ? `<button type="button" class="banner" data-act="banner" aria-expanded="${!!ui.banner}">${ic('bookmark')}<span><b>À retenir</b> · ${esc(pins[0].title)}${pins.length > 1 ? ` <em>+${pins.length - 1}</em>` : ''}</span>${ic(ui.banner ? 'down' : 'chevR')}</button>
    ${ui.banner ? `<ul class="panel pinlist">${pins.map((e) => `<li><span class="mono mut">${esc(fmtD(e.date))}</span> <b>${esc(e.title)}</b>${e.details ? `<p class="mut small">${esc(e.details)}</p>` : ''}</li>`).join('')}</ul>` : ''}` : ''}
  <div class="tabs" role="tablist">${TABS.map(([k, l, i]) => `<button type="button" role="tab" id="tab-${k}" aria-selected="${ui.tab === k}" class="${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${ic(i)}<span>${l}</span>${k === 'maint' && (mc.late || mc.missing) ? `<sup class="mono ${mc.late ? 'bad' : ''}">${mc.late || mc.missing}</sup>` : ''}</button>`).join('')}</div>`;
}

// ---- Préparation ---------------------------------------------------------------
function tabPrep(s, b, ui, now) {
  const st = boatStats(b);
  const obsDraft = ui.drafts[`obs-${b.id}`] || '';
  const add = `<section class="panel addobs"><div class="ico">${ic('plus')}</div><h3>Ajouter mes observations</h3>
    <p class="mut small">Une tâche par ligne, ou séparée par un point-virgule. Commence par <code>!</code> pour la marquer bloquante.</p>
    <form data-form="obs" data-id="${b.id}">
      <textarea name="obs" rows="6" placeholder="Exemple :&#10;Vérifier la pompe de douche&#10;! Remplacer le feu de navigation" data-draft="obs-${b.id}" data-parse aria-label="Observations">${esc(obsDraft)}</textarea>
      <div class="row between wrap gap"><span class="small mut" data-parse-out></span>
        ${voiceSupported() ? `<button type="button" class="btn sm" data-act="voice" aria-pressed="false">${ic('mic')} Dicter</button>` : `<span class="small mut">Sur mobile, utilise le micro du clavier pour dicter.</span>`}</div>
      <button class="btn pri wide" type="submit" data-submit-label>Préparer les tâches ${ic('right')}</button>
    </form></section>`;
  const last = `<section class="panel lastret"><h3>${ic('left')} Retour de location</h3>
    <p class="mut small">« Nouveau retour » archive la préparation en cours, garde les observations non terminées et relance les tâches habituelles.</p>
    <button class="btn sm" type="button" data-act="retAsk" data-id="${b.id}">${ic('left')} Nouveau retour</button></section>`;

  if (b.inRental) {
    const p = b.pendingOnReturn;
    return `<div class="two"><div class="col"><section class="panel"><div class="phead"><h3>À reprendre au retour</h3><span class="count mono">${p.length}</span></div>
      <p class="mut small">Le bateau est en location. Ces points seront remis dans la préparation au retour, avec les tâches habituelles.</p>
      ${p.length ? `<ul class="tasks">${p.map((t) => taskRow(b, t, { pending: true })).join('')}</ul>` : empty('check', 'Rien en attente', 'Ajoute ici ce qu’il faudra regarder au retour.')}
      <div class="row gap"><button class="btn pri" data-act="retAsk" data-id="${b.id}">${ic('left')} Enregistrer le retour</button></div></section></div>
      <aside class="col">${add}${last}</aside></div>`;
  }
  const rec = b.tasks.filter((t) => t.template);
  const obs = b.tasks.filter((t) => !t.template).sort((a, c) => ((c.blocked && !c.done) - (a.blocked && !a.done)) || (a.done - c.done));
  const tpls = tplsOf(s, b);
  const have = new Set(b.tasks.map((t) => t.template || t.title));
  const missing = tpls.filter((t) => !have.has(t)).length;
  const recPanel = `<section class="panel"><div class="phead"><h3>${ic('list')} Avant le départ</h3><span class="count mono">${st.recOpen} restante${st.recOpen > 1 ? 's' : ''}</span></div>
    <p class="mut small">Les tâches habituelles, relancées à chaque retour.</p>
    ${ui.editRec
      ? `<ul class="tasks">${tpls.map((t, i) => tplEditRow(b, t, i, tpls.length)).join('')}</ul>
        <form class="inl" data-form="addTpl" data-id="${b.id}"><input name="title" placeholder="Nouvelle tâche habituelle" aria-label="Nouvelle tâche habituelle" autocomplete="off" data-draft="tpl-${b.id}"><button class="btn pri" type="submit">Ajouter</button></form>
        <label class="ck"><input type="checkbox" name="now" data-keep-now ${ui.tplNow !== false ? 'checked' : ''} data-chg="tplNow"> Ajouter aussi à la préparation en cours</label>
        <div class="row gap"><button class="btn" data-act="recEdit">${ic('check')} Terminer</button><button class="btn ghost" data-act="recReset" data-id="${b.id}">Reprendre la liste de la flotte</button></div>`
      : `${rec.length ? `<ul class="tasks">${rec.map((t) => taskRow(b, t)).join('')}</ul>` : empty('list', 'Aucune tâche habituelle', 'Définis la liste qui revient à chaque retour.')}
        <div class="row gap wrap"><button class="btn sm" data-act="recEdit">${ic('edit')} Modifier la liste</button>${missing ? `<button class="btn sm" data-act="addMissing" data-id="${b.id}">${ic('plus')} Ajouter les ${missing} manquante${missing > 1 ? 's' : ''}</button>` : ''}</div>`}
  </section>`;
  const obsPanel = `<section class="panel"><div class="phead"><h3>${ic('tool')} Observations ajoutées</h3><span class="count mono">${st.obsOpen} restante${st.obsOpen > 1 ? 's' : ''}</span></div>
    <p class="mut small">Les problèmes et interventions propres à ce bateau.</p>
    ${obs.length ? `<ul class="tasks">${obs.map((t) => taskRow(b, t)).join('')}</ul>${st.obsOpen === 0 ? `<div class="okbar">${ic('check')} Toutes les observations sont traitées.</div>` : ''}`
      : empty('wave', 'Aucune observation', 'Note ce que tu vois sur le bateau avec le champ à droite.')}
  </section>`;
  return `<div class="two"><div class="col">${recPanel}${obsPanel}</div><aside class="col">${add}${last}</aside></div>`;
}

// ---- Entretiens ------------------------------------------------------------------------
function tabMaint(s, b, ui, now) {
  const lh = latestHours(b);
  const items = b.maintenance.map((m) => {
    const ms = maintStatus(m, b, now);
    return `<article class="panel mrow ${ms.key}"><header><h3>${esc(m.title)}</h3><span class="mstat ${ms.key}">${esc(ms.label)}</span>
      <button class="ibtn" data-act="maintDel" data-id="${b.id}" data-mid="${m.id}" aria-label="Retirer ${esc(m.title)}">${ic('trash')}</button></header>
      <div class="grid4">
        <div class="fld"><label class="k" for="md-${m.id}">Dernier contrôle</label><input id="md-${m.id}" type="date" value="${esc(m.date)}" data-chg="maint" data-id="${b.id}" data-mid="${m.id}" data-f="date"></div>
        <div class="fld"><label class="k" for="mi-${m.id}">Échéance</label><select id="mi-${m.id}" data-chg="maint" data-id="${b.id}" data-mid="${m.id}" data-f="intervalDays">${INTERVALS.map((i) => `<option value="${i.v}"${(m.intervalDays || 0) === i.v ? ' selected' : ''}>${i.l}</option>`).join('')}</select></div>
        <div class="fld"><label class="k" for="mh-${m.id}">Heures moteur au contrôle</label><input id="mh-${m.id}" inputmode="decimal" value="${esc(m.hours)}" data-chg="maint" data-id="${b.id}" data-mid="${m.id}" data-f="hours"></div>
        <div class="fld"><label class="k" for="mj-${m.id}">Tous les (h)</label><input id="mj-${m.id}" inputmode="numeric" value="${m.intervalHours || ''}" placeholder="—" data-chg="maint" data-id="${b.id}" data-mid="${m.id}" data-f="intervalHours"></div>
      </div>
      <div class="fld"><label class="k" for="mn-${m.id}">Notes</label><textarea id="mn-${m.id}" rows="2" data-chg="maint" data-id="${b.id}" data-mid="${m.id}" data-f="notes">${esc(m.notes)}</textarea></div></article>`;
  }).join('');
  const evs = [...b.importantEvents].sort((a, c) => (c.pinned - a.pinned) || String(c.date).localeCompare(String(a.date)));
  return `<div class="two even"><section class="col"><div class="phead big"><div><h2>Entretiens</h2><p class="mut small">Les échéances en heures se calculent à partir du dernier relevé moteur.</p></div></div>
    <div class="panel hours"><h3>Relevé moteur</h3>
      <div class="grid2"><div class="fld"><label class="k" for="hp-${b.id}">Bâbord (h)</label><input id="hp-${b.id}" inputmode="decimal" value="${esc(b.hours?.port ?? '')}" placeholder="${lh?.port != null ? esc(lh.port) : ''}" data-chg="hours" data-id="${b.id}" data-f="port"></div>
      <div class="fld"><label class="k" for="hs-${b.id}">Tribord (h)</label><input id="hs-${b.id}" inputmode="decimal" value="${esc(b.hours?.stbd ?? '')}" placeholder="${lh?.stbd != null ? esc(lh.stbd) : ''}" data-chg="hours" data-id="${b.id}" data-f="stbd"></div></div>
      <p class="mut small">${lh ? `Dernier relevé : ${esc([lh.port, lh.stbd].filter((x) => x != null).join(' / '))} h${lh.date ? ` · ${esc(fmtD(lh.date))}` : ''}.` : 'Aucun relevé pour l’instant.'}</p></div>
    ${items || empty('tool', 'Aucun entretien suivi')}
    <form class="inl" data-form="addMaint" data-id="${b.id}"><input name="title" placeholder="Nouvel entretien (ex. Winchs)" aria-label="Nouvel entretien" autocomplete="off" data-draft="maint-${b.id}"><button class="btn pri" type="submit">Ajouter</button></form></section>
    <section class="col"><div class="phead big"><div><h2>Événements importants</h2><p class="mut small">Un événement épinglé apparaît dans « À retenir » en haut de la page.</p></div></div>
    ${evs.length ? `<ul class="panel evl">${evs.map((e) => `<li><div><span class="cat">${esc(e.category || 'Autre')}</span><span class="mono mut small">${esc(fmtD(e.date))}</span>${e.pinned ? '<span class="pinned">Épinglé</span>' : ''}<p>${esc(e.title)}</p>${e.details ? `<p class="mut small">${esc(e.details)}</p>` : ''}</div>
      <div class="row"><button class="ibtn ${e.pinned ? 'on' : ''}" data-act="evPin" data-id="${b.id}" data-eid="${e.id}" aria-pressed="${!!e.pinned}" aria-label="Épingler">${ic('bookmark')}</button><button class="ibtn" data-act="evDel" data-id="${b.id}" data-eid="${e.id}" aria-label="Retirer">${ic('x')}</button></div></li>`).join('')}</ul>` : empty('bookmark', 'Aucun événement', 'Garde ici les remplacements de pièces et les pannes marquantes.')}
    <form class="panel formrow" data-form="addEvent" data-id="${b.id}"><div class="fld"><label class="k" for="ev-t">Événement</label><input id="ev-t" name="title" required autocomplete="off"></div>
      <div class="grid2"><div class="fld"><label class="k" for="ev-d">Date</label><input id="ev-d" type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="fld"><label class="k" for="ev-c">Catégorie</label><select id="ev-c" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></div></div>
      <div class="fld"><label class="k" for="ev-x">Détails</label><textarea id="ev-x" name="details" rows="2"></textarea></div>
      <label class="ck"><input type="checkbox" name="pinned"> Épingler dans « À retenir »</label>
      <div><button class="btn pri" type="submit">Enregistrer l’événement</button></div></form></section></div>`;
}

// ---- Archives & suivi --------------------------------------------------------------------
const ostate = (o) => { const x = obsState(o); return `<span class="ost ${x.key}">${x.label}</span>`; };
function obsLine(o) {
  const meta = [];
  if (o.origin) meta.push(`Constatée le ${esc(fmtD(o.origin))}`);
  if (o.done && o.doneAt) meta.push(`réglée le ${esc(fmtD(o.doneAt))}`);
  if (o.blocked && !o.done) meta.push('<b class="t-bad">bloquante</b>');
  return `<li>${ostate(o)}<div><div class="ttl">${esc(o.title)}</div>${meta.length ? `<div class="tmeta">${meta.join(' · ')}</div>` : ''}</div></li>`;
}
function tabArchives(s, b, ui) {
  const all = observationsOf(b);
  const f = ui.obsF || 'all';
  const nDone = all.filter((o) => o.done).length, nOpen = all.length - nDone;
  const list = all.filter((o) => (f === 'done' ? o.done : f === 'open' ? !o.done : true));
  const seg = (k, l, n) => `<button type="button" class="${f === k ? 'on' : ''}" data-act="obsF" data-v="${k}" aria-pressed="${f === k}">${l} <span class="mono">${n}</span></button>`;
  const hist = b.history.map((e) => {
    const obs = e.tasks.filter((t) => !t.template), rec = e.tasks.filter((t) => t.template);
    const recDone = rec.filter((t) => t.done).length, obsDone = obs.filter((t) => t.done).length;
    const label = e.kind === 'departure' ? `Départ${e.automatic ? ' automatique' : ''}` : e.kind === 'return' ? 'Retour' : 'Archive';
    return `<details class="panel hist"><summary><b>${label}</b><span class="mono mut">${esc(e.at ? fmtDT(e.at) : fmtD(e.date))}</span>
      <span class="mut">${obs.length ? `${obsDone}/${plural(obs.length, 'observation réglée', 'observations réglées')}` : 'Aucune observation'}</span></summary>
      ${obs.length ? `<ul class="obshist">${obs.map((t) => `<li><span class="ost ${t.done ? 'done' : 'carry'}">${t.done ? 'Réglée' : 'Reportée'}</span><div><div class="ttl">${esc(t.title)}</div><div class="tmeta">${t.origin ? `Constatée le ${esc(fmtD(t.origin))}` : ''}${t.done && t.doneAt ? ` · réglée le ${esc(fmtD(t.doneAt))}` : ''}</div></div></li>`).join('')}</ul>` : ''}
      <p class="mut small">Préparation du ${esc(fmtD(e.date))} · tâches habituelles : ${recDone}/${rec.length} terminées.</p></details>`;
  }).join('');
  return `<div class="two"><section class="col">
    <div class="phead big"><div><h2>Observations</h2><p class="mut small">Tout ce qui a été noté sur ${esc(b.name)}, réglé ou non, de la plus récente à la plus ancienne.</p></div>
      <button class="btn" data-act="obsCsv" data-id="${b.id}">${ic('download')} Exporter (CSV)</button></div>
    <div class="seg" role="group" aria-label="Filtrer les observations">${seg('all', 'Toutes', all.length)}${seg('open', 'À traiter', nOpen)}${seg('done', 'Réglées', nDone)}</div>
    ${list.length ? `<ul class="panel obshist">${list.map(obsLine).join('')}</ul>` : empty('wave', 'Aucune observation', f === 'all' ? 'Les observations ajoutées dans la préparation apparaîtront ici.' : 'Rien pour ce filtre.')}
    <div class="phead big"><div><h2>Préparations archivées</h2><p class="mut small">Une archive à chaque départ signalé et à chaque nouveau retour.</p></div><span class="count mono">${b.history.length}</span></div>
    ${hist || empty('history', 'Aucune archive', 'La préparation est archivée au départ et au nouveau retour.')}</section>
    <aside class="col"><div class="phead big"><div><h2>Journal</h2></div><span class="count mono">${b.logs.length}</span></div>
    ${b.logs.length ? `<ul class="panel log">${b.logs.slice(0, 80).map((l) => `<li><time class="mono mut">${esc(fmtDT(l.date))}</time><span>${esc(l.text)}</span></li>`).join('')}</ul>` : empty('history', 'Journal vide')}</aside></div>`;
}

// ---- Réglages -------------------------------------------------------------------------------
function tabReglages(s, b, ui) {
  return `<div class="two even"><section class="col"><form class="panel formrow" data-form="saveBoat" data-id="${b.id}"><h3>Ce bateau</h3>
    <div class="fld"><label class="k" for="st-n">Nom</label><input id="st-n" name="name" value="${esc(b.name)}" required></div>
    <div class="fld"><label class="k" for="st-m">Modèle</label><input id="st-m" name="model" value="${esc(b.model)}"></div>
    <div class="grid2"><div class="fld"><label class="k" for="st-b">Base</label><select id="st-b" name="base"><option value="">Sans base</option>${BASES.map((x) => `<option${b.base === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="fld"><label class="k" for="st-o">Nom de la base si « Autre »</label><input id="st-o" name="otherBase" value="${esc(b.otherBase)}"></div></div>
    <div><button class="btn pri" type="submit">Enregistrer</button></div></form></section>
    <section class="col"><div class="panel formrow"><h3>Zone sensible</h3><p class="mut small">Supprime le bateau, ses archives, ses observations et son journal. Tu peux annuler juste après, ou exporter une sauvegarde avant.</p>
      ${ui.confirm === 'delBoat' ? `<div class="row gap"><button class="btn bad solid" data-act="delBoat" data-id="${b.id}">Oui, supprimer ${esc(b.name)}</button><button class="btn" data-act="confirmNo">Annuler</button></div>` : `<div><button class="btn bad" data-act="confirmAsk" data-v="delBoat">${ic('trash')} Supprimer le bateau</button></div>`}</div></section></div>`;
}

export function boatView(s, ui, id, now = new Date()) {
  const b = s.boats.find((x) => x.id === id);
  if (!b) return `<div class="page-head"><h1>Bateau introuvable</h1></div>${empty('boat', 'Ce bateau n’existe plus', '', `<button class="btn" data-act="nav" data-to="overview">Retour à la flotte</button>`)}`;
  if (!TABS.some((t) => t[0] === ui.tab)) ui.tab = 'prep';
  const body = ui.tab === 'maint' ? tabMaint(s, b, ui, now)
    : ui.tab === 'archives' ? tabArchives(s, b, ui) : ui.tab === 'reglages' ? tabReglages(s, b, ui) : tabPrep(s, b, ui, now);
  return header(s, b, ui, now) + `<div class="tabpane" role="tabpanel" aria-labelledby="tab-${ui.tab}">${body}</div>`;
}
