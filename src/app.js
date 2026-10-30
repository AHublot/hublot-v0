// Contrôleur : routes, rendu, événements. Toute la logique métier est dans actions.js.
import * as A from './actions.js';
import { store, getState, load, mutate, undo, replace, subscribe, snapshots, addSnapshot, autoSnapshot, restoreSnapshot, resetAll } from './store.js';
import { normalizeState, baseLabel, sortBoats, boatStats } from './model.js';
import { esc, parseObservations, todayStr, fmtHM, plural, norm, nowIso } from './util.js';
import { ic } from './icons.js';
import { overviewView } from './views/overview.js';
import { boatView } from './views/boat.js';
import { collectObservations, observationsCsv } from './exports.js';
import { teamView, checklistView, backupView } from './views/pages.js';
import { tickCountdowns } from './views/common.js';
import { boatReport, fleetReport } from './whatsapp.js';
import { voiceSupported, toggleVoice, stopVoice } from './voice.js';
import { demoState } from './demo.js';

const $ = (s, r = document) => r.querySelector(s);
const ui = {
  route: { name: 'overview', id: null }, tab: 'prep', filter: 'all', base: 'all', q: '', view: 'cards', drafts: {},
  add: false, techs: false, banner: false, editRec: false, tplNow: true, confirm: null, obsF: 'all',
  ox: { boat: 'all', status: 'all', from: '', to: '', bill: 'all' },
  teamEdit: null, cl: null, imp: null, impErr: null, palette: null,
};
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// ---- thème --------------------------------------------------------------------------
let theme = LS.get('capdepart:theme') || 'system';
function applyTheme() {
  const r = document.documentElement;
  if (theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', theme);
}
const isDark = () => theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

// ---- routes ---------------------------------------------------------------------------
const TAB_KEYS = ['prep', 'maint', 'archives', 'reglages'];
function parseHash() {
  let h = '';
  try { h = location.hash || ''; } catch { /* ignore */ }
  const m = h.match(/^#\/boat\/([^/]+)(?:\/(\w+))?/);
  if (m) return { name: 'boat', id: decodeURIComponent(m[1]), tab: TAB_KEYS.includes(m[2]) ? m[2] : 'prep' };
  if (/^#\/team/.test(h)) return { name: 'team' };
  if (/^#\/checklist/.test(h)) return { name: 'checklist' };
  if (/^#\/backup/.test(h)) return { name: 'backup' };
  return { name: 'overview' };
}
function hashFor(r) {
  return r.name === 'boat' ? `#/boat/${encodeURIComponent(r.id)}/${ui.tab}` : r.name === 'overview' ? '#/' : `#/${r.name}`;
}
function go(name, id = null, tab = null) {
  ui.route = { name, id };
  if (name === 'boat') ui.tab = tab || 'prep';
  Object.assign(ui, { techs: false, banner: false, editRec: false, obsF: 'all', confirm: null, add: false, teamEdit: null, imp: null, impErr: null });
  try { history.replaceState(null, '', hashFor(ui.route)); } catch { /* sandbox */ }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => {
  const r = parseHash();
  ui.route = { name: r.name, id: r.id || null };
  if (r.tab) ui.tab = r.tab;
  render();
});

// ---- mutations avec message d'erreur ------------------------------------------------------
function M(label, fn, opts) {
  try { return mutate(label, fn, opts); } catch (e) { toast(`Action impossible : ${e.message}`); return undefined; }
}

// ---- toasts -------------------------------------------------------------------------------------
function toast(msg, { undo: canUndo = false } = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${canUndo ? `<button type="button" data-act="undo">${ic('undo')} Annuler</button>` : ''}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), canUndo ? 7000 : 3800);
  while (box.children.length > 1) box.firstChild.remove();
}
subscribe((info) => {
  if (info.label && info.toast) toast(info.label, { undo: !info.noUndo });
  render();
});

// ---- rendu --------------------------------------------------------------------------------------
function sideHTML(s) {
  const nav = (to, icn, label, n) => `<button type="button" class="nav ${ui.route.name === to || (to === 'overview' && ui.route.name === 'boat') ? 'on' : ''}" data-act="nav" data-to="${to}" ${ui.route.name === to ? 'aria-current="page"' : ''}>${ic(icn)}<span>${label}</span>${n != null ? `<em class="mono">${n}</em>` : ''}</button>`;
  return `<div class="brand"><span class="mark"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M9 24h14l-2 3H11z" fill="var(--side)"/><path d="M16 6v15M16 7l7 11h-7z" fill="none" stroke="var(--side)" stroke-width="2" stroke-linejoin="round"/></svg></span><div><b>Cap Départ</b><small>Gestion de flotte</small></div></div>
    <span class="k side-k">Espace manager</span>
    <nav aria-label="Navigation">${nav('overview', 'grid', 'Vue d’ensemble', s.boats.length)}${nav('team', 'users', 'Mon équipe', s.team.length)}${nav('checklist', 'list', 'Liste avant départ', s.templates.length)}</nav>
    <div class="grow"></div>
    <div class="sidecard"><span>${ic('wave')}</span><b>Le prochain départ commence ici.</b><small>Une vue claire, un bateau prêt après l’autre.</small></div>
    <button type="button" class="nav small ${ui.route.name === 'backup' ? 'on' : ''}" data-act="nav" data-to="backup">${ic('download')}<span>Sauvegardes et restauration</span></button>
    <small class="ver">V2 · Espace privé</small>`;
}
function topHTML(s) {
  const r = ui.route;
  const b = r.name === 'boat' ? s.boats.find((x) => x.id === r.id) : null;
  const names = { overview: 'Vue d’ensemble', team: 'Mon équipe', checklist: 'Liste avant départ', backup: 'Sauvegardes et restauration' };
  const t = store.savedAt;
  return `<div class="trail"><span>${esc(s.baseName)}</span>${ic('chevR')}<b>${esc(b ? b.name : names[r.name] || '')}</b></div>
    <div class="topr">
      <span class="sync ${store.persistOk ? '' : 'bad'}" title="${store.persistOk ? 'Enregistré sur cet appareil' : 'Stockage refusé : exporte tes données'}"><i></i>${store.persistOk ? (t ? `Enregistré ${esc(fmtHM(t))}` : 'À jour') : 'Non enregistré'}</span>
      <button type="button" class="btn icon" data-act="undo" aria-label="Annuler la dernière action" title="Annuler la dernière action" ${store.stack.length ? '' : 'disabled'}>${ic('undo')}</button>
      <button type="button" class="btn icon search-btn" data-act="palette" aria-label="Rechercher (Ctrl+K)" title="Rechercher (Ctrl+K)">${ic('search')}<kbd>Ctrl K</kbd></button>
      <button type="button" class="btn icon" data-act="theme" aria-label="Changer de thème" title="Thème : ${theme === 'system' ? 'automatique' : theme === 'dark' ? 'sombre' : 'clair'}">${ic(isDark() ? 'moon' : 'sun')}</button>
    </div>`;
}
function tabbarHTML() {
  const t = (to, icn, label) => `<button type="button" class="${ui.route.name === to || (to === 'overview' && ui.route.name === 'boat') ? 'on' : ''}" data-act="nav" data-to="${to}">${ic(icn)}<span>${label}</span></button>`;
  return `${t('overview', 'grid', 'Flotte')}${t('team', 'users', 'Équipe')}${t('checklist', 'list', 'Liste')}${t('backup', 'download', 'Données')}`;
}
function paletteItems(s, q) {
  const items = [
    { label: 'Vue d’ensemble', sub: 'Page', run: () => go('overview'), icon: 'grid' },
    { label: 'Mon équipe', sub: 'Page', run: () => go('team'), icon: 'users' },
    { label: 'Liste avant départ', sub: 'Page', run: () => go('checklist'), icon: 'list' },
    { label: 'Sauvegardes et restauration', sub: 'Page', run: () => go('backup'), icon: 'download' },
    { label: 'Exporter la sauvegarde', sub: 'Action', run: () => doExport(), icon: 'download' },
    { label: 'Changer de thème', sub: 'Action', run: () => cycleTheme(), icon: 'moon' },
    ...sortBoats(s.boats).map((b) => ({ label: b.name, sub: `Bateau · ${baseLabel(b)}`, run: () => go('boat', b.id), icon: 'boat' })),
    { label: 'Exporter toutes les observations (CSV)', sub: 'Action', run: () => exportObs(getState(), {}, 'flotte'), icon: 'download' },
    ...sortBoats(s.boats).map((b) => ({ label: `Nouveau retour · ${b.name}`, sub: 'Action', run: () => { go('boat', b.id, 'prep'); ui.confirm = 'ret:' + b.id; render(); }, icon: 'left' })),
  ];
  const n = norm(q).trim();
  return n ? items.filter((i) => norm(i.label + ' ' + i.sub).includes(n)) : items.slice(0, 12);
}
const paletteList = (s) => {
  const list = paletteItems(s, ui.palette.q);
  ui.palette.items = list;
  ui.palette.i = Math.min(ui.palette.i, Math.max(0, list.length - 1));
  return list.length
    ? list.map((it, i) => `<li><button type="button" class="${i === ui.palette.i ? 'on' : ''}" data-act="palRun" data-i="${i}">${ic(it.icon)}<span>${esc(it.label)}</span><em>${esc(it.sub)}</em></button></li>`).join('')
    : '<li class="mut pad">Aucun résultat</li>';
};

function layerHTML(s, now) {
  let h = '';
  if (ui.palette) h += `<dialog class="palette" id="palette" aria-label="Rechercher"><div class="pin">${ic('search')}<input id="pq" placeholder="Bateau, page ou action" autocomplete="off" value="${esc(ui.palette.q)}" data-pal></div><ul id="plist">${paletteList(s)}</ul><footer class="mut small"><kbd>↑</kbd><kbd>↓</kbd> naviguer <kbd>Entrée</kbd> ouvrir <kbd>Échap</kbd> fermer</footer></dialog>`;
  return h;
}

function render() {
  const s = getState(), now = new Date();
  const ae = document.activeElement;
  const key = ae && (ae.dataset?.fk ? `[data-fk="${ae.dataset.fk}"]` : ae.id ? `#${CSS.escape(ae.id)}` : ae.dataset?.draft ? `[data-draft="${ae.dataset.draft}"]` : null);
  const sel = ae && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
  const inLayer = ae && ae.closest && ae.closest('dialog');

  const routeKey = location.hash || '#/';
  const prevBars = routeKey === ui.barRoute ? [...document.querySelectorAll('#view .bar i')].map((i) => i.style.width) : [];
  ui.barRoute = routeKey;

  $('#side').innerHTML = sideHTML(s);
  $('#top').innerHTML = topHTML(s);
  $('#tabbar').innerHTML = tabbarHTML();
  const r = ui.route;
  $('#view').innerHTML = r.name === 'boat' ? boatView(s, ui, r.id, now) : r.name === 'team' ? teamView(s, ui)
    : r.name === 'checklist' ? checklistView(s, ui) : r.name === 'backup' ? backupView(s, ui) : overviewView(s, ui, now);
  document.querySelectorAll('#view [data-draft]').forEach((el) => { if (ui.drafts[el.dataset.draft] != null) el.value = ui.drafts[el.dataset.draft]; });
  document.querySelectorAll('#view textarea[data-parse]').forEach(updateParse);
  tickCountdowns();
  animateBars(prevBars);

  if (!inLayer) $('#layer').innerHTML = layerHTML(s, now);
  const pal = $('#palette'); if (pal && !pal.open) { pal.showModal(); $('#pq')?.focus(); }

  if (key && !inLayer) {
    const t = document.querySelector(key);
    if (t && t !== document.activeElement) { try { t.focus({ preventScroll: true }); if (sel && t.setSelectionRange && t.type !== 'datetime-local' && t.type !== 'date') t.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
  }
}

/** Les barres de préparation partent de leur ancienne valeur (ou de 0 à l'arrivée sur une page) et glissent vers la nouvelle. */
function animateBars(prev) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('#view .bar i').forEach((el, n) => {
    const to = el.style.width;
    const from = prev[n] != null ? prev[n] : '0%';
    if (from === to) return;
    el.style.transition = 'none'; el.style.width = from;
    el.getBoundingClientRect();
    el.style.transition = ''; el.style.width = to;
  });
}

function updateParse(ta) {
  const form = ta.closest('form');
  const n = parseObservations(ta.value).length;
  const out = form.querySelector('[data-parse-out]');
  const btn = form.querySelector('[data-submit-label]');
  if (out) out.textContent = n ? `${plural(n, 'tâche détectée', 'tâches détectées')}` : '';
  if (btn) btn.innerHTML = `${n > 1 ? `Préparer ${n} tâches` : n === 1 ? 'Préparer la tâche' : 'Préparer les tâches'} ${ic('right')}`;
  if (btn) btn.disabled = !n;
}

// ---- export / import ------------------------------------------------------------------------------
function download(name, text, type = 'application/json') {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`${name} exporté`);
  } catch { toast('Export impossible dans ce contexte'); }
}
function doExport() {
  const s = getState();
  const out = {
    format: 'cap-depart-backup', version: 1, savedAt: nowIso(),
    data: { checklistVersion: 1, schemaVersion: 2, boats: s.boats, team: s.team, templates: s.templates, baseName: s.baseName, prefs: s.prefs },
  };
  download(`cap-depart-${todayStr()}.json`, JSON.stringify(out, null, 2));
}
function exportObs(s, filter, label) {
  const rows = collectObservations(s, filter);
  if (!rows.length) { toast('Aucune observation à exporter pour ce choix'); return; }
  download(`observations-${slugify(label)}-${todayStr()}.csv`, observationsCsv(rows), 'text/csv;charset=utf-8');
}
function readImport(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const raw = JSON.parse(r.result);
      const n = normalizeState(raw);
      ui.imp = { raw, name: file.name, boats: n.boats.length, team: n.team.length };
      ui.impErr = null;
    } catch (e) { ui.imp = null; ui.impErr = e.message === 'Aucun bateau dans ce fichier' ? e.message : 'Ce fichier n’est pas une sauvegarde Cap Départ.'; }
    render();
  };
  r.readAsText(file);
}

// ---- thème / palette --------------------------------------------------------------------------------
function cycleTheme() {
  theme = theme === 'system' ? (isDark() ? 'light' : 'dark') : theme === 'dark' ? 'light' : 'dark';
  LS.set('capdepart:theme', theme); applyTheme(); render();
}
function openPalette() { ui.palette = { q: '', i: 0, items: [] }; render(); }
function closePalette() { ui.palette = null; $('#layer').innerHTML = layerHTML(getState(), new Date()); }

// ---- clics -------------------------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const dlg = e.target;
  if (dlg instanceof HTMLDialogElement && dlg.open) { // clic sur le fond
    if (dlg.id === 'palette') { closePalette(); return; }
  }
  const el = e.target.closest('[data-act]');
  if (!el) {
    const card = e.target.closest('[data-open]');
    if (card && !e.target.closest('input,select,textarea,a,button,label')) go('boat', card.dataset.open);
    return;
  }
  const a = el.dataset.act, d = el.dataset, s = getState();
  const id = d.id || (ui.route.name === 'boat' ? ui.route.id : null);
  const boat = s.boats.find((b) => b.id === id);
  const nm = boat ? boat.name : '';
  switch (a) {
    case 'nav': e.preventDefault(); go(d.to); break;
    case 'open': e.preventDefault(); go('boat', id, d.tab || 'prep'); break;
    case 'tab': ui.tab = d.v; ui.editRec = false; try { history.replaceState(null, '', hashFor(ui.route)); } catch { /* */ } render(); break;
    case 'filter': ui.filter = d.v; if (ui.route.name !== 'overview') go('overview'); else render(); break;
    case 'resetFilters': ui.filter = 'all'; ui.base = 'all'; ui.q = ''; ui.drafts.q = ''; render(); break;
    case 'view': ui.view = d.v; render(); break;
    case 'toggleAdd': ui.add = !ui.add; if (!ui.add) { delete ui.drafts['nb-name']; } if (ui.route.name !== 'overview') go('overview'); render(); if (ui.add) $('#nb-name')?.focus(); break;
    case 'goBackup': go('backup'); break;
    case 'demo': if (s.boats.length) addSnapshot('Avant démo'); replace(demoState(), 'Flotte de démonstration chargée'); go('overview'); break;
    case 'undo': undo(); break;
    case 'theme': cycleTheme(); break;
    case 'palette': openPalette(); break;
    case 'palRun': { const it = ui.palette?.items?.[+d.i]; closePalette(); it?.run(); break; }
    case 'print': window.print(); break;
    case 'copyWA': {
      const text = d.kind === 'fleet' ? fleetReport(s) : boat ? boatReport(boat) : '';
      try { navigator.clipboard?.writeText(text).then(() => toast('Message copié, prêt à coller')); } catch { /* le lien WhatsApp s'ouvre quand même */ }
      return; // laisse le lien s'ouvrir
    }
    // tâches
    case 'tgl': M('', (st) => A.toggleTask(st, id, d.tid)); break;
    case 'blk': M('', (st) => A.toggleBlock(st, id, d.tid)); break;
    case 'bill': M('', (st) => A.toggleBill(st, id, d.tid)); setTimeout(() => document.getElementById(`hrs-${d.tid}`)?.focus(), 0); break;
    case 'del': M(`Tâche retirée`, (st) => A.deleteTask(st, id, d.tid)); break;
    case 'delp': M(`Point retiré`, (st) => A.deletePending(st, id, d.tid)); break;
    case 'voice': { const ta = el.closest('form').querySelector('textarea'); toggleVoice(ta, el); break; }
    // liste récurrente
    case 'recEdit': ui.editRec = !ui.editRec; render(); break;
    case 'recUp': M('', (st) => A.moveBoatTemplate(st, id, +d.i, -1)); break;
    case 'recDn': M('', (st) => A.moveBoatTemplate(st, id, +d.i, 1)); break;
    case 'recDel': M('Tâche habituelle retirée de la liste', (st) => A.removeBoatTemplate(st, id, +d.i)); break;
    case 'recReset': M('Liste remise à celle de la flotte', (st) => A.resetBoatTemplates(st, id)); break;
    case 'addMissing': M('Tâches habituelles ajoutées', (st) => A.addMissingTemplates(st, id)); break;
    // départ / retour
    case 'dep': M(`Départ signalé · ${nm}`, (st) => A.confirmDeparture(st, id)); break;
    case 'retAsk': if (ui.route.name !== 'boat' || ui.route.id !== id) go('boat', id, 'prep'); ui.confirm = 'ret:' + id; render(); break;
    case 'retGo': ui.confirm = null; ui.tab = 'prep'; M(`Nouveau retour · ${nm}`, (st) => A.newReturn(st, id)); break;
    // observations
    case 'obsF': ui.obsF = d.v; render(); break;
    case 'obsCsv': exportObs(s, { boat: id }, nm); break;
    case 'obsCsvAll': exportObs(s, {}, 'flotte'); break;
    case 'obsCsvBill': exportObs(s, { boat: id, bill: 'bill' }, `${nm}-a-refacturer`); break;
    case 'obsCsvF': exportObs(s, ui.ox, ui.ox.boat === 'all' ? 'flotte' : (s.boats.find((b) => b.id === ui.ox.boat)?.name || 'bateau')); break;
    // en-tête bateau
    case 'techs': ui.techs = !ui.techs; render(); break;
    case 'banner': ui.banner = !ui.banner; render(); break;
    // entretiens et événements
    case 'maintDel': M('Entretien retiré', (st) => A.deleteMaint(st, id, d.mid)); break;
    case 'evPin': M('', (st) => A.toggleEventPin(st, id, d.eid)); break;
    case 'evDel': M('Événement retiré', (st) => A.deleteEvent(st, id, d.eid)); break;
    // confirmations en deux temps
    case 'confirmAsk': ui.confirm = d.v; render(); break;
    case 'confirmNo': ui.confirm = null; render(); break;
    case 'delBoat': ui.confirm = null; go('overview'); M(`${nm} supprimé`, (st) => A.deleteBoat(st, id)); break;
    // équipe
    case 'memberDel': M(`${d.name} retiré de l’équipe`, (st) => A.removeMember(st, d.name)); break;
    case 'teamEdit': ui.teamEdit = ui.teamEdit === d.name ? null : d.name; render(); break;
    // liste de la flotte
    case 'mxOpen': ui.cl = ui.cl === d.v ? null : d.v; render(); break;
    case 'clUp': case 'clDn': M('', (st) => { const l = st.templates.slice(), i = +d.i, j = a === 'clUp' ? i - 1 : i + 1; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; A.setFleetTemplates(st, l); }); break;
    case 'clDel': M('Tâche retirée de la liste', (st) => { const l = st.templates.slice(); l.splice(+d.i, 1); A.setFleetTemplates(st, l); }); break;
    case 'clDefault': M('Liste d’origine rétablie', (st) => A.setFleetTemplates(st, A.DEFAULT_TEMPLATES.slice())); break;
    case 'clAddAll': { let n = 0; M('Tâches manquantes ajoutées aux préparations en cours', (st) => { n = A.addMissingToAll(st); }); break; }
    case 'clApply': ui.confirm = null; M('Liste appliquée à toute la flotte', (st) => A.applyTemplatesToFleet(st)); break;
    // sauvegardes
    case 'export': doExport(); break;
    case 'pickImport': $('#importFile')?.click(); break;
    case 'impNo': ui.imp = null; render(); break;
    case 'impMerge': {
      const raw = ui.imp.raw; ui.imp = null; addSnapshot('Avant import');
      M('Sauvegarde fusionnée', (st) => {
        const n = normalizeState(raw);
        n.boats.forEach((b) => { const i = st.boats.findIndex((x) => x.id === b.id); if (i >= 0) st.boats[i] = b; else st.boats.push(b); });
        n.team.forEach((t) => A.addMember(st, t));
      });
      break;
    }
    case 'impReplace': { const raw = ui.imp.raw; ui.imp = null; addSnapshot('Avant import'); try { replace(raw, 'Sauvegarde importée'); } catch (err) { toast(err.message); } break; }
    case 'snapRestore': ui.confirm = null; restoreSnapshot(+d.i); break;
    case 'reset': ui.confirm = null; resetAll(); break;
    default: break;
  }
});
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- champs : brouillons, changements, formulaires ------------------------------------------------------
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset?.draft) ui.drafts[el.dataset.draft] = el.value;
  if (el.dataset?.live === 'q') { ui.q = el.value; render(); }
  if (el.matches?.('textarea[data-parse]')) updateParse(el);
  if (el.id === 'pq' && ui.palette) { ui.palette.q = el.value; ui.palette.i = 0; $('#plist').innerHTML = paletteList(getState()); }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.palette ? closePalette() : openPalette(); return; }
  if (e.target.id === 'pq' && ui.palette) {
    const n = ui.palette.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); ui.palette.i = (ui.palette.i + 1) % Math.max(1, n); $('#plist').innerHTML = paletteList(getState()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ui.palette.i = (ui.palette.i - 1 + n) % Math.max(1, n); $('#plist').innerHTML = paletteList(getState()); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = ui.palette.items[ui.palette.i]; closePalette(); it?.run(); }
  }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && ui.route.name === 'overview') { e.preventDefault(); $('[data-live="q"]')?.focus(); }
});
document.addEventListener('close', (e) => {
  if (e.target.id === 'palette') { ui.palette = null; $('#layer').innerHTML = ''; }
}, true);

document.addEventListener('change', (e) => {
  const el = e.target, d = el.dataset;
  if (el.id === 'importFile') { readImport(el.files?.[0]); return; }
  if (d.quick) { const f = el.form.elements[d.quick]; if (f) f.value = el.value; return; }
  if (!d.chg) return;
  const id = d.id;
  switch (d.chg) {
    case 'dep': M('', (st) => A.setDeparture(st, id, el.value)); break;
    case 'ret': M('', (st) => A.setReturnDate(st, id, el.value)); break;
    case 'base': M('', (st) => A.updateBoat(st, id, { base: el.value, otherBase: el.value === 'Autre' ? st.boats.find((b) => b.id === id).otherBase : '' })); break;
    case 'baseFilter': ui.base = el.value; render(); break;
    case 'tech': M('', (st) => { const b = st.boats.find((x) => x.id === id); const set = new Set(b.techs); el.checked ? set.add(d.name) : set.delete(d.name); A.setTechs(st, id, [...set]); }); break;
    case 'assign': M('', (st) => A.toggleAssign(st, d.name, id)); break;
    case 'tplNow': ui.tplNow = el.checked; break;
    case 'maint': M('', (st) => A.updateMaint(st, id, d.mid, d.f, el.value)); break;
    case 'hours': M('', (st) => A.setHours(st, id, d.f, el.value)); break;
    case 'billf': M('', (st) => A.setBillField(st, id, d.tid, d.f, el.value)); break;
    case 'ox': ui.ox = { ...ui.ox, [d.k]: el.value }; render(); break;
    case 'pref': M('Préférence enregistrée', (st) => A.setPref(st, d.k, el.checked)); break;
    case 'baseName': M('', (st) => { st.baseName = el.value.trim() || 'Ma base'; }); break;
    default: break;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form), g = (k) => String(fd.get(k) ?? '').trim();
  const id = form.dataset.id || ui.route.id;
  const name = getState().boats.find((b) => b.id === id)?.name || '';
  switch (form.dataset.form) {
    case 'addBoat': {
      if (!g('name')) return;
      ['nb-name', 'nb-model', 'nb-base'].forEach((k) => delete ui.drafts[k]);
      ui.add = false;
      const nid = M(`${g('name')} ajouté`, (st) => A.addBoat(st, { name: g('name'), model: g('model'), base: g('base') }));
      if (nid) go('boat', nid, 'prep');
      break;
    }
    case 'obs': {
      const items = parseObservations(g('obs'));
      if (!items.length) return;
      delete ui.drafts[`obs-${id}`];
      stopVoice();
      M(`${plural(items.length, 'tâche ajoutée', 'tâches ajoutées')} · ${name}`, (st) => A.addObservations(st, id, items));
      $('#view textarea[data-parse]')?.focus();
      break;
    }
    case 'addTpl': {
      const t = g('title'); if (!t) return;
      delete ui.drafts[`tpl-${id}`];
      const alsoNow = ui.tplNow !== false;
      const ok = M('Tâche habituelle ajoutée', (st) => A.addBoatTemplate(st, id, t, alsoNow));
      if (ok === false) toast('Cette tâche est déjà dans la liste');
      break;
    }
    case 'addMaint': { const t = g('title'); if (!t) return; delete ui.drafts[`maint-${id}`]; M('Entretien ajouté', (st) => A.addMaint(st, id, t)); break; }
    case 'addEvent': {
      if (!g('title')) return;
      M('Événement enregistré', (st) => A.addEvent(st, id, { title: g('title'), date: g('date'), category: g('category'), details: g('details'), pinned: !!fd.get('pinned') }));
      break;
    }
    case 'saveBoat': { if (!g('name')) return; M('Réglages enregistrés', (st) => A.updateBoat(st, id, { name: g('name'), model: g('model'), base: g('base'), otherBase: g('base') === 'Autre' ? g('otherBase') : '' })); break; }
    case 'addMember': { const n = g('name'); if (!n) return; delete ui.drafts.tm; M(`${n} ajouté à l’équipe`, (st) => A.addMember(st, n)); break; }
    case 'addDefTpl': {
      const t = g('title'); if (!t) return; delete ui.drafts['cl-new'];
      M('Tâche ajoutée à la liste', (st) => { if (!st.templates.includes(t)) A.setFleetTemplates(st, [...st.templates, t]); });
      break;
    }
    default: break;
  }
});

// ---- minuteur : compte à rebours, départs automatiques ---------------------------------------------------
function tick() {
  tickCountdowns();
  const s = getState();
  const due = A.dueDepartures(s);
  if (due.length) {
    const names = due.map((i) => s.boats.find((b) => b.id === i).name).join(', ');
    M(`Départ automatique : ${names}`, (st) => due.forEach((i) => A.confirmDeparture(st, i, { auto: true })));
  }
}

// ---- démarrage ----------------------------------------------------------------------------------------------
load();
applyTheme();
const r0 = parseHash();
ui.route = { name: r0.name, id: r0.id || null };
if (r0.tab) ui.tab = r0.tab;
autoSnapshot();
render();
tick();
setInterval(tick, 30000);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => theme === 'system' && render());
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
