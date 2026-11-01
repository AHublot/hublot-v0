import { esc, initials, plural, fmtDT, fmtD, norm } from '../util.js';
import { boatStats, baseLabel, sortBoats, DEFAULT_TEMPLATES, TPL_CATS, TPL_OTHER, tplCatOf } from '../model.js';
import { monthsAvailable, monthTotals, monthLabel } from '../report.js';
import { ic } from '../icons.js';
import { bar, empty } from './common.js';
import { snapshots, store } from '../store.js';
import { remote } from '../remote.js';

// ---- Mon équipe -------------------------------------------------------------------
export function teamView(s, ui) {
  const boats = sortBoats(s.boats);
  const unassigned = boats.filter((b) => !b.techs.length && !b.inRental);
  const card = (n) => {
    const mine = boats.filter((b) => b.techs.includes(n));
    const open = mine.reduce((a, b) => a + (b.inRental ? 0 : boatStats(b).open), 0);
    const blocked = mine.reduce((a, b) => a + (b.inRental ? 0 : boatStats(b).blocked), 0);
    const edit = ui.teamEdit === n;
    return `<article class="panel member"><header><span class="avatar">${esc(initials(n))}</span><div><h3>${esc(n)}</h3>
      <p class="mut small">${plural(mine.length, 'bateau', 'bateaux')} · ${plural(open, 'tâche restante', 'tâches restantes')}${blocked ? ` · <b class="t-bad">${blocked} bloquant${blocked > 1 ? 's' : ''}</b>` : ''}</p></div>
      <button class="ibtn" data-act="memberDel" data-name="${esc(n)}" aria-label="Retirer ${esc(n)}">${ic('trash')}</button></header>
      <div class="chipwrap">${mine.length ? mine.map((b) => `<button class="chip sm" data-act="open" data-id="${b.id}">${esc(b.name)}</button>`).join('') : '<span class="mut small">Aucun bateau affecté</span>'}</div>
      <button class="linkbtn" data-act="teamEdit" data-name="${esc(n)}" aria-expanded="${edit}">${edit ? 'Fermer' : 'Modifier les affectations'}</button>
      ${edit ? `<div class="assign">${boats.map((b) => `<label class="ck"><input type="checkbox" data-chg="assign" data-name="${esc(n)}" data-id="${b.id}" ${b.techs.includes(n) ? 'checked' : ''}> ${esc(b.name)} <span class="mut small">${esc(baseLabel(b))}</span></label>`).join('')}</div>` : ''}</article>`;
  };
  return `<div class="page-head"><div><h1>Mon équipe</h1><p class="mut">${plural(s.team.length, 'personne', 'personnes')} · ${plural(unassigned.length, 'bateau sans technicien', 'bateaux sans technicien')}</p></div></div>
    <form class="panel formrow inl" data-form="addMember"><div class="fld grow"><label class="k" for="tm">Ajouter une personne</label><input id="tm" name="name" placeholder="Prénom" autocomplete="off" data-draft="tm"></div><button class="btn pri" type="submit">${ic('plus')} Ajouter</button></form>
    ${s.team.length ? `<div class="members">${s.team.map(card).join('')}</div>` : empty('users', 'Personne dans l’équipe', 'Ajoute les techniciens pour leur affecter des bateaux.')}
    ${unassigned.length ? `<section class="panel"><h3>Sans technicien</h3><div class="chipwrap">${unassigned.map((b) => `<button class="chip sm" data-act="open" data-id="${b.id}">${esc(b.name)}</button>`).join('')}</div></section>` : ''}`;
}

// ---- Liste avant départ ------------------------------------------------------------------
function renameForm(s, t, i) {
  const prep = s.boats.filter((b) => b.tasks.some((x) => x.template === t)).length;
  const next = s.boats.filter((b) => b.inRental && (b.templates?.length ? b.templates : s.templates).includes(t)).length;
  const what = [prep ? `${plural(prep, 'préparation en cours', 'préparations en cours')}` : '', next ? `la liste du prochain retour (${plural(next, 'bateau', 'bateaux')} en location)` : ''].filter(Boolean).join(' et ');
  return `<form class="clren" data-form="clRename" data-i="${i}"><input name="title" value="${esc(t)}" aria-label="Nouvel intitulé" autocomplete="off" required>
    <p class="mut small">${what ? `Change aussi ${what}.` : 'Aucun bateau ne l’utilise pour l’instant.'} Les réponses déjà données (cochée, par qui, bloquée, notes) sont gardées.</p>
    <div class="row gap"><button class="btn pri sm" type="submit">Enregistrer</button><button class="btn sm" type="button" data-act="clEditNo">Annuler</button></div></form>`;
}
export function checklistView(s, ui) {
  const list = s.templates;
  const prepBoats = s.boats.filter((b) => !b.inRental);
  const rows = list.map((title) => {
    const have = prepBoats.filter((b) => b.tasks.some((t) => t.template === title));
    const done = have.filter((b) => b.tasks.find((t) => t.template === title)?.done);
    const todo = have.filter((b) => !done.includes(b));
    const pct = have.length ? Math.round((100 * done.length) / have.length) : 0;
    const open = ui.cl === title;
    return `<li class="mx"><button type="button" class="mxhead" data-act="mxOpen" data-v="${esc(title)}" aria-expanded="${open}"><span class="mxt">${esc(title)}</span><span class="mono mut">${done.length}/${have.length}</span>${bar(pct, pct === 100 ? 'ok' : '')}</button>
      ${open ? `<div class="mxbody">${todo.length ? `<span class="k">Reste à faire</span><div class="chipwrap">${todo.map((b) => `<button class="chip sm" data-act="open" data-id="${b.id}">${esc(b.name)}</button>`).join('')}</div>` : '<p class="mut small">Fait sur tous les bateaux concernés.</p>'}</div>` : ''}</li>`;
  }).join('');
  return `<div class="page-head"><div><h1>Liste avant départ</h1><p class="mut">Les tâches habituelles de toute la flotte. Chaque bateau garde sa propre copie, modifiable depuis sa page.</p></div></div>
    <div class="two even"><section class="col"><div class="panel"><div class="phead"><h3>Liste de la flotte</h3><span class="count mono">${list.length}</span></div>
      <ol class="tasks">${list.map((t, i) => `<li class="task edit${ui.clEdit === i ? ' renaming' : ''}"><span class="num mono">${i + 1}</span>${ui.clEdit === i ? renameForm(s, t, i) : `<div class="tbody"><button type="button" class="ttl clttl" data-act="clEdit" data-i="${i}" title="Modifier l’intitulé" aria-label="Modifier : ${esc(t)}">${esc(t)} ${ic('edit')}</button></div>`}
        <select class="catsel" data-chg="tplCat" data-i="${i}" aria-label="Catégorie : ${esc(t)}">${[...TPL_CATS, TPL_OTHER].map((c) => `<option${tplCatOf(s, t) === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <button class="ibtn" data-act="clUp" data-i="${i}" aria-label="Monter" ${i ? '' : 'disabled'}>${ic('up')}</button><button class="ibtn" data-act="clDn" data-i="${i}" aria-label="Descendre" ${i < list.length - 1 ? '' : 'disabled'}>${ic('down')}</button><button class="ibtn" data-act="clDel" data-i="${i}" aria-label="Retirer">${ic('trash')}</button></li>`).join('')}</ol>
      <form class="inl" data-form="addDefTpl"><input name="title" placeholder="Nouvelle tâche pour toute la flotte" aria-label="Nouvelle tâche" autocomplete="off" data-draft="cl-new"><button class="btn pri" type="submit">Ajouter</button></form>
      <div class="actions-col">
        <button class="btn" data-act="clAddAll">${ic('plus')} Ajouter les tâches manquantes aux préparations en cours</button>
        ${ui.confirm === 'clApply' ? `<div class="row gap wrap"><span class="small">Remplace la liste habituelle des ${s.boats.length} bateaux.</span><button class="btn bad solid" data-act="clApply">Appliquer</button><button class="btn" data-act="confirmNo">Annuler</button></div>` : `<button class="btn" data-act="confirmAsk" data-v="clApply">Appliquer cette liste à tous les bateaux</button>`}
        ${list.join() !== DEFAULT_TEMPLATES.join() ? `<button class="btn ghost" data-act="clDefault">Reprendre la liste d’origine</button>` : ''}
      </div></div></section>
    <section class="col"><div class="panel"><div class="phead"><h3>Suivi par tâche</h3><span class="mut small">${plural(prepBoats.length, 'bateau', 'bateaux')} en préparation</span></div>
      <p class="mut small">Où en est chaque tâche habituelle sur la flotte ? Ouvre une ligne pour voir les bateaux concernés.</p>
      ${rows ? `<ul class="matrix">${rows}</ul>` : empty('list', 'Liste vide')}</div></section></div>`;
}

// ---- Export des observations (refacturation) ---------------------------------------------------
function obsExportPanel(s, ui) {
  const months = monthsAvailable(s);
  const month = ui.xm.month && months.includes(ui.xm.month) ? ui.xm.month : months[0];
  const t = monthTotals(s, month, ui.xm.boat);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const h = String(Math.round(t.hours * 100) / 100).replace('.', ',');
  return `<div class="panel obsexport"><h3>${ic('file')} Rapport mensuel des observations</h3>
    <p class="mut small">Un fichier Excel : une feuille de synthèse, puis une feuille par bateau. Les observations à refacturer (heures, matériel, refacturé au client) sont mises en évidence, les autres sont listées plus discrètement.</p>
    <div class="grid2">
      <div class="fld"><label class="k" for="xm-m">Mois de constat</label><select id="xm-m" data-chg="xm" data-k="month">${months.map((m) => opt(m, monthLabel(m).replace(/^./, (c) => c.toUpperCase()), month)).join('')}</select></div>
      <div class="fld"><label class="k" for="xm-b">Bateau</label><select id="xm-b" data-chg="xm" data-k="boat">${opt('all', 'Toute la flotte', ui.xm.boat)}${sortBoats(s.boats).map((b) => opt(b.id, b.name, ui.xm.boat)).join('')}</select></div>
    </div>
    <div class="xmstats">${t.obs
      ? `<span><b>${plural(t.obs, 'observation', 'observations')}</b> sur ${plural(t.boats, 'bateau', 'bateaux')}</span><span class="t-bill"><b>${t.bill}</b> à refacturer${t.hours ? ` · ${h} h` : ''}</span><span class="t-ok"><b>${t.billed}</b> refacturée${t.billed > 1 ? 's' : ''} au client</span>`
      : '<span class="mut">Aucune observation constatée ce mois-ci.</span>'}</div>
    <div class="row gap wrap"><button class="btn pri" data-act="xlsMonth" ${t.obs ? '' : 'disabled'}>${ic('download')} Exporter en Excel</button></div></div>`;
}

// ---- Compte (mode serveur) ---------------------------------------------------------------
function accountPanel(ui) {
  const u = remote.user, m = ui.pwdMsg;
  return `<div class="panel account"><h3>${ic('users')} Mon compte</h3>
    <p><b>${esc(u.name)}</b> <span class="mut">· ${esc(u.email)} · ${u.role === 'manager' ? 'Manager' : 'Technicien'}</span></p>
    <form class="formrow" data-form="pwd" autocomplete="on">
      <input type="text" name="username" value="${esc(u.email)}" autocomplete="username" hidden>
      <div class="fld"><label class="k" for="pw-c">Mot de passe actuel</label><input id="pw-c" name="current" type="password" autocomplete="current-password" required></div>
      <div class="grid2"><div class="fld"><label class="k" for="pw-n">Nouveau mot de passe</label><input id="pw-n" name="next" type="password" autocomplete="new-password" minlength="10" required></div>
      <div class="fld"><label class="k" for="pw-2">Confirmation</label><input id="pw-2" name="next2" type="password" autocomplete="new-password" minlength="10" required></div></div>
      ${m ? `<p class="small ${m.bad ? 't-bad' : 't-ok'}" role="status">${esc(m.t)}</p>` : ''}
      <div class="row gap wrap"><button class="btn" type="submit">Changer le mot de passe</button><button class="btn ghost" type="button" data-act="logout">${ic('left')} Se déconnecter</button></div>
    </form></div>`;
}

// ---- Sauvegardes et restauration ----------------------------------------------------------
export function backupView(s, ui) {
  if (remote.user?.role === 'tech') { // le technicien n'a que son compte
    return `<div class="page-head"><div><h1>Mon compte</h1><p class="mut">Ton mot de passe et ta déconnexion.</p></div></div><div class="one">${accountPanel(ui)}</div>`;
  }
  const snaps = snapshots();
  const imp = ui.imp;
  return `<div class="page-head"><div><h1>Sauvegardes et restauration</h1><p class="mut">${ui.server ? 'Les données sont partagées sur le serveur avec ton équipe, qui en garde une copie chaque jour. Tu peux aussi exporter un fichier.' : 'Tes données sont enregistrées sur cet appareil. Exporte un fichier pour les garder ailleurs ou les ouvrir sur un autre appareil.'}</p></div></div>
    <div class="two even"><section class="col">
      <div class="panel"><h3>${ic('download')} Exporter</h3><p class="mut small">Un fichier JSON avec les bateaux, leurs observations et archives, l’équipe et les listes. Même format que l’ancienne sauvegarde.</p>
        <div class="row gap wrap"><button class="btn pri" data-act="export">${ic('download')} Exporter la sauvegarde</button></div>
        <p class="small mut">${ui.server ? (remote.lastSync ? `Dernière synchronisation : ${esc(fmtDT(remote.lastSync.toISOString()))}.` : '') : store.savedAt ? `Dernier enregistrement local : ${esc(fmtDT(store.savedAt.toISOString()))}.` : 'Rien d’enregistré pour l’instant.'}${store.persistOk ? '' : ' <b class="t-bad">Le stockage du navigateur est refusé : exporte avant de fermer la page.</b>'}</p></div>
      ${obsExportPanel(s, ui)}
      <div class="panel"><h3>${ic('upload')} Importer</h3><p class="mut small">Choisis une sauvegarde Hublot (.json). Rien n’est modifié avant ta confirmation.</p>
        <input type="file" id="importFile" accept=".json,application/json" hidden><button class="btn" data-act="pickImport">${ic('upload')} Choisir un fichier</button>
        ${imp ? `<div class="importbox"><p><b>${plural(imp.boats, 'bateau', 'bateaux')}</b> et <b>${plural(imp.team, 'personne', 'personnes')}</b> dans « ${esc(imp.name)} ».</p>
          <div class="row gap wrap"><button class="btn pri" data-act="impMerge">Fusionner avec la flotte actuelle</button><button class="btn bad solid" data-act="impReplace">${ui.server ? 'Remplacer les données de toute l’équipe' : 'Remplacer toutes les données'}</button><button class="btn" data-act="impNo">Annuler</button></div>
          <p class="small mut">Fusionner : les bateaux de même identifiant sont remplacés, les autres sont conservés. Une copie de sécurité est faite avant.</p></div>` : ''}
        ${ui.impErr ? `<p class="t-bad small">${esc(ui.impErr)}</p>` : ''}</div></section>
    <section class="col">
      ${ui.server && remote.user ? accountPanel(ui) : ''}
      ${ui.server ? '' : `<div class="panel"><div class="phead"><h3>${ic('history')} Copies automatiques</h3><span class="count mono">${snaps.length}</span></div>
        <p class="mut small">Une copie est gardée à l’ouverture (toutes les 12 h) et avant chaque import ou restauration.</p>
        ${snaps.length ? `<ul class="snaps">${snaps.map((x, i) => `<li><div><b class="mono">${esc(fmtDT(x.at))}</b><span class="mut small"> · ${esc(x.label)} · ${plural(x.boats, 'bateau', 'bateaux')}</span></div>${ui.confirm === 'snap' + i ? `<div class="row gap"><button class="btn sm bad solid" data-act="snapRestore" data-i="${i}">Restaurer</button><button class="btn sm" data-act="confirmNo">Annuler</button></div>` : `<button class="btn sm" data-act="confirmAsk" data-v="snap${i}">Restaurer</button>`}</li>`).join('')}</ul>` : '<p class="mut small">Pas encore de copie.</p>'}</div>`}
      <div class="panel"><h3>Préférences</h3>
        <label class="ck"><input type="checkbox" data-chg="pref" data-k="autoDeparture" ${s.prefs.autoDeparture ? 'checked' : ''}> Me demander de signaler le départ à l’heure prévue</label>
        <div class="fld"><label class="k" for="bn">Nom de la base</label><input id="bn" value="${esc(s.baseName)}" data-chg="baseName"></div></div>
      <div class="panel"><h3>Zone sensible</h3><p class="mut small">${ui.server ? 'Efface toute la flotte pour toute l’équipe. Le serveur garde ses copies quotidiennes.' : 'Charge une flotte fictive pour essayer l’application, ou efface tout. Une copie de sécurité est faite avant.'}</p>
        <div class="row gap wrap">${ui.server ? '' : '<button class="btn" data-act="demo">Charger la démo</button>'}
        ${ui.confirm === 'reset' ? `<button class="btn bad solid" data-act="reset">Oui, tout effacer</button><button class="btn" data-act="confirmNo">Annuler</button>` : `<button class="btn bad" data-act="confirmAsk" data-v="reset">Tout effacer</button>`}</div></div></section></div>`;
}

// ---- Comptes (manager) -------------------------------------------------------------------
const ago = (iso) => {
  if (!iso) return 'Jamais connecté';
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? 'Connecté aujourd’hui' : d === 1 ? 'Dernière connexion hier' : `Dernière connexion il y a ${d} jours`;
};
export function accountsView(s, ui) {
  const a = ui.accounts || {};
  const list = a.list || [];
  const created = a.created;
  const rows = list.map((u) => {
    const me = remote.user && u.id === remote.user.id;
    const ask = ui.confirm === 'acct-reset:' + u.id;
    return `<li class="acct ${u.disabled ? 'off' : ''}"><span class="avatar">${esc((u.name || u.email).slice(0, 2).toUpperCase())}</span>
      <div class="ainfo"><b>${esc(u.name || u.email.split('@')[0])}${me ? ' <span class="mut">(toi)</span>' : ''}</b><span class="mut small">${esc(u.email)}</span>
        <span class="small mut">${u.disabled ? 'Compte désactivé' : u.mustChange ? 'Doit choisir son mot de passe à la première connexion' : esc(ago(u.lastLogin))}</span></div>
      <div class="arole"><select data-chg="acctRole" data-uid="${u.id}" aria-label="Rôle de ${esc(u.name || u.email)}" ${me ? 'disabled' : ''}><option value="tech"${u.role === 'tech' ? ' selected' : ''}>Technicien</option><option value="manager"${u.role === 'manager' ? ' selected' : ''}>Manager</option></select></div>
      <div class="aact">${ask
        ? `<span class="small">Nouveau mot de passe provisoire ?</span><button class="btn sm bad solid" data-act="acctResetGo" data-uid="${u.id}">Oui</button><button class="btn sm" data-act="confirmNo">Non</button>`
        : `<button class="btn sm" data-act="acctReset" data-uid="${u.id}">Nouveau mot de passe</button>${me ? '' : `<button class="btn sm ${u.disabled ? '' : 'ghost'}" data-act="acctToggle" data-uid="${u.id}" data-off="${u.disabled ? 0 : 1}">${u.disabled ? 'Réactiver' : 'Désactiver'}</button>`}`}</div></li>`;
  }).join('');
  return `<div class="page-head"><div><h1>Comptes</h1><p class="mut">${plural(list.filter((u) => !u.disabled).length, 'compte actif', 'comptes actifs')} · les techniciens cochent les tâches, ajoutent des observations, notent les heures moteur et les entretiens.</p></div></div>
    ${created ? `<div class="panel okbox" role="status"><h3>${ic('check')} Compte prêt : ${esc(created.email)}</h3>
      <p class="small">Donne-lui ce mot de passe provisoire. <b>Il ne sera plus affiché.</b> À sa première connexion, il devra en choisir un nouveau.</p>
      <div class="pwbox"><code id="tmp-pw">${esc(created.password)}</code><button class="btn sm" data-act="acctCopy" data-v="${esc(created.password)}">${ic('file')} Copier</button></div>
      <div class="row gap"><button class="btn" data-act="acctDismiss">J’ai noté le mot de passe</button></div></div>` : ''}
    <div class="acctpage"><section class="col"><div class="panel"><div class="phead"><h3>Personnes</h3><span class="count mono">${list.length}</span></div>
      ${a.err ? `<p class="t-bad small" role="alert">${esc(a.err)}</p>` : ''}
      ${a.loaded ? (rows ? `<ul class="acctlist">${rows}</ul>` : empty('users', 'Aucun compte')) : '<p class="mut small">Chargement…</p>'}</div></section>
    <section class="col"><form class="panel formrow" data-form="addAccount"><h3>${ic('plus')} Ajouter un compte</h3>
      <div class="fld"><label class="k" for="ac-n">Prénom</label><input id="ac-n" name="name" autocomplete="off" required data-draft="ac-n"></div>
      <div class="fld"><label class="k" for="ac-e">E-mail (sert d’identifiant)</label><input id="ac-e" name="email" type="email" autocomplete="off" required data-draft="ac-e"></div>
      <div class="fld"><label class="k" for="ac-r">Rôle</label><select id="ac-r" name="role"><option value="tech">Technicien</option><option value="manager">Manager</option></select></div>
      <p class="mut small">Technicien : cocher et bloquer des tâches, ajouter des observations, noter les heures moteur et les entretiens. Le reste (retours, refacturation, dates, équipe, listes, comptes) reste réservé au manager.</p>
      ${a.formErr ? `<p class="t-bad small" role="alert">${esc(a.formErr)}</p>` : ''}
      <div><button class="btn pri" type="submit" ${a.busy ? 'disabled' : ''}>Créer le compte</button></div></form></section></div>`;
}
