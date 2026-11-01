import { esc, fmtWDT, fmtDT, fmtD, plural, parseLocal, utcLabel, startOfDay, addDays, fmtMonth, norm } from '../util.js';
import {
  boatStats, boatStatus, maintCounts, missingDates, fleetStats, FILTERS, matchFilter, sortBoats, nextDepartures,
  baseLabel, BASES, pinnedEvents,
} from '../model.js';
import { ic } from '../icons.js';
import { pill, bar, cd, empty } from './common.js';
import { fleetReport, waLink } from '../whatsapp.js';

/** « Le point du jour » : départs à préparer et retours des prochains jours, chaque ligne ouvre le bateau. */
function hero(s, now) {
  const day0 = startOfDay(now), horizon = addDays(day0, 4);
  const dw = (d) => {
    const n = Math.round((startOfDay(d) - day0) / 864e5);
    return n < 0 ? 'En retard' : n === 0 ? 'Auj.' : n === 1 ? 'Demain' : `Dans ${n} j`;
  };
  const deps = s.boats.filter((b) => !b.inRental && b.departure && parseLocal(b.departure) < horizon)
    .map((b) => ({ b, st: boatStats(b), d: parseLocal(b.departure) })).sort((x, y) => x.d - y.d);
  const todo = deps.filter((x) => x.st.open > 0).slice(0, 3);
  const rets = s.boats.filter((b) => b.inRental && b.returnDate && parseLocal(b.returnDate) >= day0 && parseLocal(b.returnDate) < horizon)
    .sort((x, y) => parseLocal(x.returnDate) - parseLocal(y.returnDate)).slice(0, 3);
  const chip = (id, name, when, info, hot) => `<button type="button" class="pj2-row ${hot ? 'hot' : ''}" data-act="open" data-id="${id}"><b class="pj2-n">${esc(name)}</b><span class="pj2-w">${esc(when)}</span><span class="pj2-i">${info}</span></button>`;
  const dRows = todo.map(({ b, st, d }, i) => chip(b.id, b.name, dw(d), `${st.open} à finir${st.blocked ? ' · <i>bloquant</i>' : ''}`, i === 0 && d < addDays(day0, 1) && st.pct < 50)).join('');
  const rRows = rets.map((b) => chip(b.id, b.name, dw(parseLocal(b.returnDate)), 'retour')).join('');
  return `<section class="hero pj2"><h2>Le point du jour <span>· ${esc(fmtWDT(now).split(',')[0])}</span></h2>
    <div class="pj2-grid"><div><h3>${ic('boat')} Départs</h3>${dRows || '<p class="mut small">Rien à préparer</p>'}</div>
    <div><h3>${ic('left')} Retours</h3>${rRows || '<p class="mut small">Aucun retour prévu</p>'}</div></div></section>`;
}

function kpis(f, ui) {
  const k = (key, icn, n, label, sub, tone = '') => `<button type="button" class="kpi ${tone} ${ui.filter === key ? 'on' : ''}" data-act="filter" data-v="${key}">
    <span class="kico">${ic(icn)}</span><span class="kbody"><b class="mono">${n}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</span></button>`;
  return `<section class="kpis" aria-label="Indicateurs">
    ${k('all', 'boat', f.count, 'Bateaux suivis', f.rental ? `${f.rental} en location` : '')}
    ${k('obs', 'list', f.obsOpen, 'Observations à traiter', 'hors tâches habituelles')}
    ${k('blocked', 'flag', f.blocked, f.blocked > 1 ? 'Tâches bloquantes' : 'Tâche bloquante', f.blockedBoats ? `${plural(f.blockedBoats, 'bateau', 'bateaux')} concerné${f.blockedBoats > 1 ? 's' : ''}` : '', f.blocked ? 'bad' : '')}
    ${k('late', 'tool', f.late, 'Entretiens en retard', f.missing ? `${f.missing} date${f.missing > 1 ? 's' : ''} à renseigner` : '', f.late ? 'warn' : '')}
  </section>`;
}

function card(b, now) {
  const st = boatStats(b), stt = boatStatus(b), mc = maintCounts(b, now), miss = missingDates(b, now);
  const dep = !b.inRental && parseLocal(b.departure);
  const notes = [];
  if (!b.inRental) {
    notes.push(`<span>${plural(st.obsOpen, 'observation', 'observations')} à traiter</span>`);
    if (st.blocked) notes.push(`<span class="t-bad">${ic('flag')} ${plural(st.blocked, 'bloquant', 'bloquants')}</span>`);
  } else {
    const n = b.pendingOnReturn.length;
    notes.push(`<span>${n ? plural(n, 'point à reprendre', 'points à reprendre') + ' au retour' : 'Rien en attente pour le retour'}</span>`);
  }
  if (mc.late) notes.push(`<button type="button" class="chipbtn t-warn" data-act="open" data-id="${b.id}" data-tab="maint">${ic('tool')} ${plural(mc.late, 'entretien en retard', 'entretiens en retard')}</button>`);
  if (miss) notes.push(`<button type="button" class="chipbtn t-mut" data-act="open" data-id="${b.id}" data-tab="maint">${plural(miss, 'date à renseigner', 'dates à renseigner')}</button>`);
  const when = b.inRental
    ? `<div class="fld"><label class="k" for="r-${b.id}">Retour prévu</label><input id="r-${b.id}" type="datetime-local" value="${esc(b.returnDate)}" data-chg="ret" data-id="${b.id}"></div>`
    : `<div class="fld"><label class="k" for="d-${b.id}">Prochain départ · heure locale</label><input id="d-${b.id}" type="datetime-local" value="${esc(b.departure)}" data-chg="dep" data-id="${b.id}"></div>`;
  const foot = b.inRental
    ? `<span class="mut small">${ic('clock')} Parti ${b.lastDeparture ? esc(fmtDT(b.lastDeparture)) : ''}</span>`
    : dep ? `<span class="small">${ic('clock')} ${dep > now ? 'Départ dans' : 'Départ'} ${cd(b.departure, now)}</span>` : `<span class="mut small">Pas de départ planifié</span>`;
  return `<article class="bcard ${stt.key}${b.base === 'Martinique' ? '' : ' other'}" data-open="${b.id}">
    <header><span class="bico">${ic('boat')}</span><h3>${esc(b.name)}</h3>${pill(stt)}</header>
    <div class="fld"><label class="k" for="b-${b.id}">Base</label>
      <select id="b-${b.id}" data-chg="base" data-id="${b.id}">
        <option value="">Sans base</option>${BASES.map((x) => `<option${b.base === x ? ' selected' : ''}>${x}</option>`).join('')}
      </select>${b.base === 'Autre' && b.otherBase ? `<span class="mut small">${esc(b.otherBase)}</span>` : ''}</div>
    ${when}
    ${b.inRental ? '' : `<div class="prep"><div class="row between small"><span class="mut">Préparation ${st.done}/${st.total}</span><b class="mono">${st.pct} %</b></div>${bar(st.pct, st.blocked ? 'bad' : st.open ? '' : 'ok')}</div>`}
    <div class="notes small">${notes.join('')}</div>
    <div class="foot">${foot}</div>
    <footer>
      <button type="button" class="btn sm ${b.inRental ? '' : 'ghost'}" data-act="${b.inRental ? 'ret' : 'dep'}" data-id="${b.id}">${ic(b.inRental ? 'left' : 'send')} ${b.inRental ? 'Signaler le retour' : 'Signaler le départ'}</button>
      <button type="button" class="btn sm link icon" data-act="open" data-id="${b.id}" aria-label="Ouvrir ${esc(b.name)}" title="Ouvrir">${ic('right')}</button>
    </footer>
  </article>`;
}

function board(boats, now) {
  const DAYS = 21;
  const t0 = startOfDay(now);
  let head = '<span class="bh-name k">Bateau</span>';
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(t0, i), w = d.getDay();
    head += `<span class="bh ${w === 0 || w === 6 ? 'we' : ''} ${i === 0 ? 'td' : ''}"><em>${i === 0 || d.getDate() === 1 ? esc(fmtMonth(d)) : ''}</em>${'dlmmjvs'[w]}<b>${d.getDate()}</b></span>`;
  }
  head += '<span class="bh-end k">Départ</span>';
  const groups = {};
  boats.forEach((b) => (groups[baseLabel(b)] ||= []).push(b));
  const order = (l) => ({ Martinique: 0, Guadeloupe: 1, 'Sans base': 9 }[l] ?? 5);
  let rows = '';
  Object.keys(groups).sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'fr')).forEach((g) => {
    rows += `<div class="bgroup k">${esc(g)}</div>`;
    groups[g].forEach((b) => {
      const st = boatStats(b);
      const dep = !b.inRental && b.departure ? Math.round((startOfDay(parseLocal(b.departure)) - t0) / 864e5) : null;
      const open = b.inRental && !b.returnDate;
      const end = b.inRental ? (b.returnDate ? Math.min(DAYS - 1, Math.max(0, Math.round((startOfDay(parseLocal(b.returnDate)) - t0) / 864e5))) : DAYS - 1) : -1;
      let cells = '';
      for (let j = 0; j < DAYS; j++) {
        const w = addDays(t0, j).getDay();
        let cls = 'bc' + (w === 0 || w === 6 ? ' we' : ''), txt = '';
        if (b.inRental && j <= end) cls = 'bc rent' + (open ? ' open' : '') + (j === end && !open ? ' last' : '');
        else if (dep === j) { cls = 'bc dep'; txt = st.open; }
        cells += `<span class="${cls}">${txt}</span>`;
      }
      const tail = b.inRental ? (b.returnDate ? `retour ${esc(fmtD(b.returnDate))}` : 'retour ?') : b.departure ? esc(fmtDT(b.departure)) : '—';
      rows += `<button type="button" class="brow" data-act="open" data-id="${b.id}" aria-label="${esc(b.name)}"><span class="bn"><b>${esc(b.name)}</b><span class="mono mut">${b.inRental ? 'en location' : `${st.done}/${st.total}${st.blocked ? ` · ${st.blocked} bloq.` : ''}`}</span></span>${cells}<span class="bd mono">${tail}</span></button>`;
    });
  });
  return `<div class="board"><div class="bgrid"><div class="bhead">${head}</div>${rows}</div></div>
    <div class="legend small mut"><span><i class="sw rent"></i>en location, retour prévu</span><span><i class="sw rent open"></i>retour non renseigné</span><span><i class="sw dep"></i>départ · tâches restantes</span></div>`;
}

export function overviewView(s, ui, now = new Date()) {
  if (!s.boats.length) {
    return `<div class="page-head"><h1>Vue d’ensemble</h1></div>
      ${empty('boat', 'Aucun bateau pour l’instant', 'Importe ta sauvegarde, charge la flotte de démonstration ou ajoute un premier bateau.',
        `<div class="row center wrap gap"><button class="btn pri" data-act="goBackup">${ic('upload')} Importer une sauvegarde</button>${ui.server ? '' : `<button class="btn" data-act="demo">${ic('wave')} Charger la démo</button>`}<button class="btn" data-act="toggleAdd">${ic('plus')} Ajouter un bateau</button></div>`)}
      ${ui.add ? addForm(ui) : ''}`;
  }
  const f = fleetStats(s.boats, now);
  const q = norm(ui.q);
  const base = ui.base;
  const bases = [...new Set(s.boats.map(baseLabel))];
  let list = sortBoats(s.boats).filter((b) => matchFilter(b, ui.filter, now) && (base === 'all' || baseLabel(b) === base) && (!q || norm(b.name + ' ' + baseLabel(b)).includes(q)));
  const counts = Object.fromEntries(FILTERS.map((x) => [x.key, s.boats.filter((b) => matchFilter(b, x.key, now)).length]));
  const body = !list.length
    ? empty('search', 'Aucun bateau pour ce filtre', 'Change de filtre ou efface la recherche.', `<button class="btn" data-act="resetFilters">Tout afficher</button>`)
    : ui.filter === 'obs' ? obsOverview(list, now)
    : ui.view === 'board' ? board(list, now) : `<div class="fleet">${list.map((b) => card(b, now)).join('')}</div>`;
  return `<div class="page-head"><div><h1>Vue d’ensemble</h1><p class="mut">${esc(s.baseName)} · ${esc(utcLabel())}</p></div>
      <div class="row gap wrap"><a class="btn" target="_blank" rel="noopener" href="${waLink(fleetReport(s, now))}" data-act="copyWA" data-kind="fleet">${ic('send')} Point flotte WhatsApp</a>
      <button class="btn pri" data-act="toggleAdd">${ic('plus')} Ajouter un bateau</button></div></div>
    ${ui.add ? addForm(ui) : ''}
    ${hero(s, now)}
    ${kpis(f, ui)}
    <section class="fleet-head">
      <div><h2>${ui.filter === 'obs' ? 'Observations à traiter' : 'La flotte'} <span class="count mono">${list.length}</span></h2><p class="mut small">${ui.filter === 'obs' ? 'Les points notés hors tâches habituelles, bateau par bateau. Coche pour les régler.' : 'Martinique d’abord (par date de départ), puis les bateaux en location, puis les autres bases.'}</p>${ui.filter === 'obs' ? `<button type="button" class="btn sm" data-act="nav" data-to="backup">${ic('file')} Rapport Excel du mois</button>` : ''}</div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Affichage"><button type="button" class="${ui.view === 'cards' ? 'on' : ''}" data-act="view" data-v="cards" aria-pressed="${ui.view === 'cards'}">${ic('grid')} Cartes</button><button type="button" class="${ui.view === 'board' ? 'on' : ''}" data-act="view" data-v="board" aria-pressed="${ui.view === 'board'}">${ic('calendar')} Planning</button></div>
        ${bases.length > 1 ? `<select aria-label="Base" data-chg="baseFilter"><option value="all">Toutes les bases</option>${bases.map((x) => `<option${base === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
        <label class="search">${ic('search')}<input type="search" placeholder="Rechercher un bateau" value="${esc(ui.q)}" data-draft="q" data-live="q" aria-label="Rechercher un bateau"></label>
      </div>
    </section>
    <div class="chips" role="group" aria-label="Filtres">${FILTERS.map((x) => `<button type="button" class="chip ${ui.filter === x.key ? 'on' : ''}" data-act="filter" data-v="${x.key}" aria-pressed="${ui.filter === x.key}">${x.label} <span class="mono">${counts[x.key]}</span></button>`).join('')}</div>
    ${body}`;
}


/** Clic sur « Observations à traiter » : les problèmes de chaque bateau, regroupés, plutôt que les cartes. */
function obsOverview(boats, now) {
  const rows = boats.map((b) => ({ b, items: b.tasks.filter((t) => !t.template && !t.done).sort((x, y) => (y.blocked ? 1 : 0) - (x.blocked ? 1 : 0)) }))
    .filter((r) => r.items.length);
  if (!rows.length) return empty('check', 'Aucune observation à traiter', 'Tout ce qui a été noté est réglé.');
  return `<div class="obsgrid">${rows.map(({ b, items }) => {
    const st = boatStatus(b), nb = items.filter((t) => t.blocked).length;
    return `<article class="panel obscard ${nb ? 'has-block' : ''}">
      <header><div class="grow"><h3><a href="#/boat/${b.id}/prep" data-act="open" data-id="${b.id}">${esc(b.name)}</a></h3>
        <p class="mut small">${b.departure ? `${ic('clock')} Départ ${esc(fmtDT(b.departure))} · ${cd(b.departure, now)}` : 'Pas de départ planifié'}</p></div>
        ${pill(st)}</header>
      <p class="small mut"><b class="${nb ? 't-bad' : ''}">${plural(items.length, 'observation', 'observations')}</b>${nb ? ` dont ${plural(nb, 'bloquante', 'bloquantes')}` : ''}</p>
      <ul class="obslist">${items.map((t) => `<li class="${t.blocked ? 'blocked' : ''}"><button type="button" class="chk" role="checkbox" aria-checked="false" aria-label="${esc(t.title)}" data-act="tgl" data-id="${b.id}" data-tid="${t.id}" data-fk="tgl-${t.id}">${ic('check')}</button><span>${esc(t.title)}${t.blocked ? ' <em class="t-bad">bloquant</em>' : ''}${t.bill ? ' <em class="t-bill">à refacturer</em>' : ''}${t.origin ? `<small class="mut"> · notée le ${esc(fmtD(t.origin))}</small>` : ''}</span></li>`).join('')}</ul>
      <footer><button type="button" class="btn sm" data-act="open" data-id="${b.id}">Ouvrir le bateau ${ic("right")}</button></footer></article>`;
  }).join('')}</div>`;
}

export function addForm(ui) {
  return `<form class="panel formrow" data-form="addBoat"><h3>Nouveau bateau</h3>
    <div class="grid3">
      <div class="fld"><label class="k" for="nb-name">Nom</label><input id="nb-name" name="name" required autocomplete="off" data-draft="nb-name"></div>
      <div class="fld"><label class="k" for="nb-model">Modèle</label><input id="nb-model" name="model" value="Catamaran de location" data-draft="nb-model"></div>
      <div class="fld"><label class="k" for="nb-base">Base</label><select id="nb-base" name="base" data-draft="nb-base"><option value="">Sans base</option>${BASES.map((x) => `<option>${x}</option>`).join('')}</select></div>
    </div>
    <div class="row gap"><button class="btn pri" type="submit">Créer le bateau</button><button class="btn" type="button" data-act="toggleAdd">Annuler</button></div></form>`;
}
