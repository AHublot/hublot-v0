// ---- Journal (manager) : qui a fait quoi, jour par jour, sur les 7 derniers jours ----------
import { esc, initials, pad, todayStr, addDays } from '../util.js';
import { ic } from '../icons.js';
import { JOURNAL_DAYS } from '../journal-events.js';

const KINDS = {
  done: { icon: 'check', cls: 'k-ok', verb: 'a coché', group: 'tasks' },
  undone: { icon: 'undo', cls: 'k-mut', verb: 'a décoché', group: 'tasks' },
  added: { icon: 'plus', cls: 'k-new', verb: 'a ajouté l’observation', group: 'added' },
  blocked: { icon: 'alert', cls: 'k-bad', verb: 'a marqué bloquant', group: 'added' },
  unblocked: { icon: 'alert', cls: 'k-mut', verb: 'a retiré le blocage de', group: 'other' },
  removed: { icon: 'trash', cls: 'k-mut', verb: 'a retiré', group: 'other' },
  renamed: { icon: 'edit', cls: 'k-mut', verb: 'a renommé en', group: 'other' },
  dep: { icon: 'flag', cls: 'k-rent', verb: 'a signalé le départ', group: 'moves', bare: true },
  ret: { icon: 'boat', cls: 'k-rent', verb: 'a signalé le retour', group: 'moves', bare: true },
  sheet: { icon: 'list', cls: 'k-rent', verb: 'a rempli la feuille retour', group: 'moves', bare: true },
  hours: { icon: 'tool', cls: 'k-mut', verb: 'a noté les heures moteur', group: 'other', bare: true },
  maint: { icon: 'tool', cls: 'k-mut', verb: 'a mis à jour l’entretien', group: 'other' },
  event: { icon: 'bookmark', cls: 'k-mut', verb: 'a noté l’événement', group: 'other' },
  date: { icon: 'calendar', cls: 'k-mut', verb: 'a modifié le', group: 'other' },
};
const TYPES = [['all', 'Tout'], ['tasks', 'Cochées'], ['added', 'Ajoutées'], ['moves', 'Départs et retours'], ['other', 'Autres']];
const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MO = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const kindOf = (k) => KINDS[k] || { icon: 'more', cls: 'k-mut', verb: 'a modifié', group: 'other' };
const isAdded = (x) => x.kind === 'added' || x.kind === 'blocked';

/** Les 7 jours affichés, du plus récent au plus ancien. */
export function journalDays(now = new Date()) {
  return Array.from({ length: JOURNAL_DAYS }, (_, i) => {
    const d = addDays(now, -i);
    const date = `${d.getDate() === 1 ? '1er' : d.getDate()} ${MO[d.getMonth()]}`;
    return { key: todayStr(d), label: i === 0 ? 'Aujourd’hui' : i === 1 ? 'Hier' : WD[d.getDay()][0].toUpperCase() + WD[d.getDay()].slice(1), date: i < 2 ? `${WD[d.getDay()]} ${date}` : date };
  });
}

export function journalView(s, ui, now = new Date()) {
  const j = ui.journal;
  const days = journalDays(now);
  // Mises à jour automatiques des réservations (dates, options) : masquables, masquées par défaut
  const RESA = 'Réservations';
  const nResa = (j.entries || []).filter((x) => x.name === RESA).length;
  const all = (j.entries || []).filter((x) => !(j.hideResa && x.name === RESA)).map((x) => { const d = new Date(x.at); return { ...x, day: todayStr(d), t: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; });
  const people = [...new Set(all.map((x) => x.name || '?'))].sort((a, b) => a.localeCompare(b, 'fr'));
  const boats = [...new Set(all.map((x) => x.boat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const keep = (x) => (j.who === 'all' || (x.name || '?') === j.who) && (j.type === 'all' || kindOf(x.kind).group === j.type) && (j.boat === 'all' || x.boat === j.boat);
  const exists = new Set(s.boats.map((b) => b.id));
  const focus = Math.max(0, days.findIndex((d) => d.key === j.day));

  const row = (x) => {
    const k = kindOf(x.kind);
    const what = x.kind === 'date' ? `${esc((x.note || 'départ prévu').toLowerCase())} <q>${esc(x.what)}</q>` : k.bare ? '' : `<q>${esc(x.what)}</q>`;
    const note = x.kind === 'date' ? '' : x.note;
    const boat = x.boat ? (exists.has(x.boatId) ? `<button class="jboat" type="button" data-act="open" data-id="${esc(x.boatId)}"><i class="jcat" aria-hidden="true"></i>${esc(x.boat)}</button>` : `<span class="jboat"><i class="jcat" aria-hidden="true"></i>${esc(x.boat)}</span>`) : '';
    return `<li class="jrow ${k.cls}"><span class="jt mono">${x.t}</span><span class="jic ${k.cls}">${ic(k.icon)}</span>
      <div class="jtx"><p><b>${esc(x.name || '?')}</b> ${k.verb} ${what}</p>
      <p class="small mut">${boat}${note ? ` · ${esc(note)}` : ''}${x.role === 'manager' ? ' · <span class="jrole">Manager</span>' : ''}</p></div></li>`;
  };
  const sum = (items) => {
    const by = {};
    items.forEach((x) => { const o = by[x.name || '?'] || (by[x.name || '?'] = { done: 0, added: 0, other: 0 }); if (x.kind === 'done') o.done++; else if (isAdded(x)) o.added++; else o.other++; });
    return Object.entries(by).sort((a, b) => b[1].done - a[1].done || a[0].localeCompare(b[0], 'fr')).map(([n, o]) => `<button type="button" class="jwho ${j.who === n ? 'on' : ''}" data-act="jWho" data-v="${esc(n)}" aria-pressed="${j.who === n}"><span class="avatar">${esc(initials(n))}</span><span><b>${esc(n)}</b><small>${o.done} cochée${o.done > 1 ? 's' : ''} · ${o.added} ajoutée${o.added > 1 ? 's' : ''}${o.other ? ` · ${o.other} autre${o.other > 1 ? 's' : ''}` : ''}</small></span></button>`).join('');
  };
  const day = (d, i) => {
    const mine = all.filter((x) => x.day === d.key);
    const items = mine.filter(keep);
    const open = !!j.open[d.key] && mine.length > 0;
    const done = mine.filter((x) => x.kind === 'done').length, added = mine.filter(isAdded).length, who = new Set(mine.map((x) => x.name)).size;
    return `<section class="panel jday ${open ? 'open' : ''}" id="jd-${d.key}">
      <button type="button" class="jhead" data-act="jDay" data-v="${d.key}" aria-expanded="${open}" ${mine.length ? '' : 'disabled'}><div><h3>${d.label} <span class="mut">${d.date}</span></h3>
        <p class="small mut">${mine.length ? `${mine.length} action${mine.length > 1 ? 's' : ''} · <b class="t-ok">${done} cochée${done > 1 ? 's' : ''}</b> · ${added} ajoutée${added > 1 ? 's' : ''} · ${who} personne${who > 1 ? 's' : ''}` : 'Aucune action'}</p></div>${mine.length ? ic('down', 'jchev') : ''}</button>
      ${open ? `<div class="jsum">${sum(mine)}</div>${items.length ? `<ol class="jlist">${items.map(row).join('')}</ol>` : '<p class="mut small jnone">Rien pour ce filtre.</p>'}` : ''}</section>`;
  };

  return `<div class="page-head"><div><h1>Journal</h1><p class="mut">Qui a fait quoi sur la flotte, jour par jour, sur les ${JOURNAL_DAYS} derniers jours. Visible seulement par les managers.</p></div>
      <div class="row gap jnav"><button class="btn icon" type="button" data-act="jStep" data-v="1" aria-label="Jour précédent" ${focus >= days.length - 1 ? 'disabled' : ''}>${ic('left')}</button><label class="jdate"><span class="k">Aller au</span><input type="date" data-chg="jDate" value="${days[focus].key}" min="${days[days.length - 1].key}" max="${days[0].key}"></label><button class="btn icon" type="button" data-act="jStep" data-v="-1" aria-label="Jour suivant" ${focus === 0 ? 'disabled' : ''}>${ic('right')}</button></div></div>
    <div class="jtools panel">
      <div class="seg jtype">${TYPES.map(([v, l]) => `<button type="button" class="${j.type === v ? 'on' : ''}" data-act="jType" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="row gap jsel"><select data-chg="jWho" aria-label="Personne"><option value="all">Toutes les personnes</option>${people.map((p) => `<option value="${esc(p)}" ${j.who === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <select data-chg="jBoat" aria-label="Bateau"><option value="all">Tous les bateaux</option>${boats.map((b) => `<option value="${esc(b)}" ${j.boat === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      <label class="ck jresa"><input type="checkbox" data-chg="jResa" ${j.hideResa ? 'checked' : ''}> Masquer les réservations${nResa ? ` <span class="mut mono">${nResa}</span>` : ''}</label>
    </div>
    ${j.err ? `<p class="t-bad small" role="alert">${esc(j.err)}</p>` : ''}
    ${j.loaded ? `<div class="jdays">${days.map(day).join('')}</div>` : '<p class="mut small">Chargement…</p>'}`;
}
