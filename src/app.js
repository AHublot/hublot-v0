// Contrôleur : routes, rendu, événements. Toute la logique métier est dans actions.js.
import * as A from './actions.js';
import { store, getState, load, mutate, undo, replace, subscribe, snapshots, addSnapshot, autoSnapshot, restoreSnapshot, resetAll } from './store.js';
import { normalizeState, baseLabel, sortBoats, boatStats, sheetOf, sheetItems } from './model.js';
import { esc, parseObservations, todayStr, fmtHM, plural, norm, nowIso, fmtD, fmtDT } from './util.js';
import { ic } from './icons.js';
import { overviewView } from './views/overview.js';
import { boatView } from './views/boat.js';
import { monthlyReport, monthLabel } from './report.js';
import { teamView, checklistView, backupView, accountsView } from './views/pages.js';
import { tickCountdowns } from './views/common.js';
import { boatReport, fleetReport } from './whatsapp.js';
import { voiceSupported, toggleVoice, stopVoice } from './voice.js';
import { demoState } from './demo.js';
import { journalView, journalDays } from './views/journal.js';
import { enginesView } from './views/engines.js';
import { retourView, cobsHint } from './views/retour.js';
import { remote, detect, login, logout, startSync, onRemote, changePassword, importRemote, listAccounts, createAccount, resetAccount, updateAccount, getJournal, refreshResa, syncNow, getMail, saveMail, testMail } from './remote.js';

const $ = (s, r = document) => r.querySelector(s);
const ui = {
  route: { name: 'overview', id: null }, depLater: {}, depKey: '', tab: 'prep', filter: 'all', base: 'all', q: '', view: 'cards', drafts: {},
  add: false, techs: false, banner: false, editRec: false, tplNow: true, confirm: null, obsF: 'all',
  xm: { month: '', boat: 'all' },
  teamEdit: null, cl: null, journal: { entries: null, loaded: false, err: '', who: 'all', type: 'all', boat: 'all', day: '', open: {}, hideResa: (() => { try { return localStorage.getItem('hublot:journalResa') !== 'show'; } catch { return true; } })() }, imp: null, impErr: null, palette: null, accounts: { list: null, loaded: false }, logoutBlock: null,
};
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

// ---- rôles : le technicien a un espace réduit (le serveur applique les mêmes limites) -------
const isTech = () => remote.mode === 'server' && remote.user?.role === 'tech';
const TECH_PAGES = new Set(['overview', 'boat', 'backup', 'retour']); // « backup » = Mon compte pour un technicien
const TECH_ACTS = new Set(['nav', 'open', 'tab', 'filter', 'resetFilters', 'view', 'undo', 'theme', 'palette', 'palRun', 'print', 'copyWA',
  'tgl', 'blk', 'del', 'delp', 'voice', 'obsF', 'banner', 'logout', 'logoutKeep', 'logoutForce', 'confirmNo',
  'pjMore', 'fOpen', 'fClose', 'baseAll', 'depAsk', 'dep', 'retAsk', 'retGo', 'depYes', 'retYes', 'depNo',
  'engDone', 'engFix', 'rSet', 'rOpen', 'rNext', 'rDone', 'rRecapNo', 'rValidate', 'rCancel', 'rCancelNo', 'rCancelYes', 'rPrint', 'rView']);
const TECH_CHG = new Set(['hours', 'baseFilter', 'rNote', 'rBill', 'rNum', 'rText', 'engF']);
const TECH_MAINT = new Set(['date', 'hours', 'notes']);
const TECH_FORMS = new Set(['obs', 'pwd', 'firstPwd', 'login']);

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
  if (/^#\/checklist/.test(h)) return { name: 'checklist' };
  if (/^#\/backup/.test(h)) return { name: 'backup' };
  if (/^#\/accounts/.test(h)) return { name: 'accounts' };
  if (/^#\/journal/.test(h)) return { name: 'journal' };
  if (/^#\/engines/.test(h)) return { name: 'engines' };
  const rm = h.match(/^#\/retour\/([^/]+)(?:\/([^/]+))?/);
  if (rm) return { name: 'retour', id: decodeURIComponent(rm[1]), sheet: rm[2] ? decodeURIComponent(rm[2]) : null };
  return { name: 'overview' };
}
function hashFor(r) {
  if (r.name === 'retour') return `#/retour/${encodeURIComponent(r.id)}${r.sheet ? `/${encodeURIComponent(r.sheet)}` : ''}`;
  return r.name === 'boat' ? `#/boat/${encodeURIComponent(r.id)}/${ui.tab}` : r.name === 'overview' ? '#/' : `#/${r.name}`;
}
const PAGE_RESET = { rRecap: null, rCancel: null, rOpen: null, fsheet: false, clEdit: null, acctEdit: null, techs: false, banner: false, editRec: false, obsF: 'all', confirm: null, add: false, teamEdit: null, imp: null, impErr: null };
function go(name, id = null, tab = null) {
  if (isTech() && !TECH_PAGES.has(name)) { name = 'overview'; id = null; }
  ui.route = { name, id, ...(name === 'retour' ? { sheet: tab || null } : {}) };
  if (name === 'boat') ui.tab = tab || 'prep';
  if (name === 'accounts') loadAccounts();
  if (name === 'journal') loadJournal();
  Object.assign(ui, PAGE_RESET);
  // Chaque changement de page ajoute une entrée à l'historique : le bouton « retour » du
  // téléphone revient à la page précédente (avec sa position de défilement) au lieu de quitter l'appli.
  try {
    const next = hashFor(ui.route);
    if (next !== (location.hash || '#/')) {
      history.replaceState({ y: window.scrollY }, '', location.hash || '#/');
      history.pushState(null, '', next);
    } else history.replaceState(history.state, '', next);
  } catch { /* sandbox */ }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => {
  const r = parseHash();
  ui.route = { name: r.name, id: r.id || null, ...(r.name === 'retour' ? { sheet: r.sheet || null } : {}) };
  if (r.tab) ui.tab = r.tab;
  Object.assign(ui, PAGE_RESET);
  if (r.name === 'accounts' && ui.server) loadAccounts();
  if (r.name === 'journal' && ui.server) loadJournal();
  render();
  let y = 0;
  try { y = history.state?.y || 0; } catch { /* */ }
  window.scrollTo(0, y);
});

// ---- feuille retour : « Signaler le retour » ouvre la feuille (commencée si besoin) ----------------
function openSheet(id) {
  const b = getState().boats.find((x) => x.id === id);
  if (!b) return;
  if (!b.inRental && !b.returnDraft) { toast(`${b.name} est déjà à quai`); return; }
  if (!b.returnDraft) M('', (st) => A.startReturnSheet(st, id, remote.user?.name || ''));
  go('retour', id);
}

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
  return `<button type="button" class="brand brandlink" data-act="nav" data-to="overview" title="Vue d’ensemble"><span class="mark"><img src="icons/logo.svg" alt="" width="96" height="96" decoding="async"></span><span class="bt"><b>Hublot</b><small>ACM Caraïbes</small></span></button>
    <span class="k side-k">${remote.user?.role === 'tech' ? 'Espace technicien' : 'Espace manager'}</span>
    <nav aria-label="Navigation">${nav('overview', 'grid', 'Vue d’ensemble', s.boats.length)}${isTech() ? '' : `${nav('checklist', 'list', 'Liste de préparation', s.templates.length)}${nav('engines', 'engine', 'Moteurs')}${ui.server ? nav('journal', 'history', 'Journal') : ''}${ui.server ? nav('accounts', 'users', 'Comptes', ui.accounts?.list ? ui.accounts.list.filter((u) => !u.disabled).length : null) : ''}`}</nav>
    <div class="grow"></div>
    <div class="sidecard"><span>${ic('wave')}</span><b>Le prochain départ commence ici.</b><small>Une vue claire, un bateau prêt après l’autre.</small></div>
    <button type="button" class="nav small ${ui.route.name === 'backup' ? 'on' : ''}" data-act="nav" data-to="backup">${ic(isTech() ? 'users' : 'download')}<span>${isTech() ? 'Mon compte' : 'Sauvegardes et restauration'}</span></button>
    ${remote.user ? `<div class="who"><span class="avatar">${esc((remote.user.name || '?').slice(0, 2).toUpperCase())}</span><div><b>${esc(remote.user.name)}</b><small>${remote.user.role === 'manager' ? 'Manager' : 'Technicien'}</small></div><button type="button" class="ibtn" data-act="logout" aria-label="Se déconnecter" title="Se déconnecter">${ic('left')}</button></div>` : ''}
    <small class="ver">V3 · ${remote.mode === 'server' ? 'Données partagées' : 'Données sur cet appareil'}</small>`;
}
function syncBadge(t) {
  if (remote.mode !== 'server') {
    return `<span class="sync ${store.persistOk ? '' : 'bad'}" title="${store.persistOk ? 'Enregistré sur cet appareil' : 'Stockage refusé : exporte tes données'}"><i></i><span>${store.persistOk ? (t ? `Enregistré ${esc(fmtHM(t))}` : 'À jour') : 'Non enregistré'}</span></span>`;
  }
  const st = remote.status;
  const [cls, txt, tip] = st === 'offline' ? ['warn', remote.pending ? 'Hors ligne · en attente' : 'Hors ligne', 'Pas de réseau : tes modifications sont gardées sur l’appareil et partiront au retour du réseau.']
    : st === 'error' ? ['bad', 'Synchro en erreur', remote.error || 'Erreur de synchronisation']
      : st === 'readonly' ? ['warn', 'Lecture seule', 'Ce compte ne peut pas modifier les données.']
        : remote.pending ? ['busy', 'Envoi…', 'Envoi des modifications au serveur']
          : ['', remote.lastSync ? `Synchronisé ${esc(fmtHM(remote.lastSync))}` : 'Connexion…', 'Données partagées avec l’équipe'];
  return `<span class="sync ${cls}" title="${esc(tip)}" data-sync><i></i><span>${txt}</span></span>`;
}
function loginHTML() {
  return `<div class="login"><form class="panel loginbox" data-form="login" novalidate>
    <div class="brand"><span class="mark"><img src="icons/logo.svg" alt="" width="96" height="96" decoding="async"></span><div><b>Hublot</b><small>ACM Caraïbes</small></div></div>
    <h1>Connexion</h1>
    <div class="fld"><label class="k" for="lg-e">E-mail</label><input id="lg-e" name="email" type="email" autocomplete="username" required value="${esc(ui.loginEmail || '')}"></div>
    <div class="fld"><label class="k" for="lg-p">Mot de passe</label><input id="lg-p" name="password" type="password" autocomplete="current-password" required></div>
    ${ui.loginErr ? `<p class="t-bad small" role="alert">${esc(ui.loginErr)}</p>` : ''}
    <button class="btn pri wide" type="submit" ${ui.loginBusy ? 'disabled' : ''}>${ui.loginBusy ? 'Connexion…' : 'Se connecter'}</button>
    <p class="mut small">Mot de passe oublié : demande au manager de le réinitialiser.</p>
  </form></div>`;
}
function firstPwdHTML() {
  return `<div class="login"><form class="panel loginbox" data-form="firstPwd" novalidate>
    <div class="brand"><span class="mark"><img src="icons/logo.svg" alt="" width="96" height="96" decoding="async"></span><div><b>Hublot</b><small>ACM Caraïbes</small></div></div>
    <h1>Choisis ton mot de passe</h1>
    <p class="mut small">Bonjour ${esc(remote.user?.name || '')}. Ton mot de passe provisoire ne sert qu’une fois : choisis-en un nouveau (10 caractères minimum).</p>
    <input type="text" name="username" value="${esc(remote.user?.email || '')}" autocomplete="username" hidden>
    <div class="fld"><label class="k" for="fp-c">Mot de passe provisoire</label><input id="fp-c" name="current" type="password" autocomplete="current-password" required></div>
    <div class="fld"><label class="k" for="fp-n">Nouveau mot de passe</label><input id="fp-n" name="next" type="password" autocomplete="new-password" minlength="10" required></div>
    <div class="fld"><label class="k" for="fp-2">Confirmation</label><input id="fp-2" name="next2" type="password" autocomplete="new-password" minlength="10" required></div>
    ${ui.loginErr ? `<p class="t-bad small" role="alert">${esc(ui.loginErr)}</p>` : ''}
    <button class="btn pri wide" type="submit" ${ui.loginBusy ? 'disabled' : ''}>${ui.loginBusy ? 'Enregistrement…' : 'Enregistrer et entrer'}</button>
    <button class="btn ghost wide" type="button" data-act="logoutForce">Me déconnecter</button>
  </form></div>`;
}
function topHTML(s) {
  const r = ui.route;
  const b = r.name === 'boat' ? s.boats.find((x) => x.id === r.id) : null;
  const names = { overview: 'Vue d’ensemble', team: 'Mon équipe', checklist: 'Liste de préparation', engines: 'Moteurs', accounts: 'Comptes', journal: 'Journal', backup: isTech() ? 'Mon compte' : 'Sauvegardes et restauration' };
  const t = store.savedAt;
  return `<div class="trail"><span>${esc(s.baseName)}</span>${ic('chevR')}<b>${esc(b ? b.name : names[r.name] || '')}</b></div>
    <div class="topr">
      ${syncBadge(t)}
      <button type="button" class="btn icon" data-act="undo" aria-label="Annuler la dernière action" title="Annuler la dernière action" ${store.stack.length ? '' : 'disabled'}>${ic('undo')}</button>
      <button type="button" class="btn icon search-btn" data-act="palette" aria-label="Rechercher (Ctrl+K)" title="Rechercher (Ctrl+K)">${ic('search')}<kbd>Ctrl K</kbd></button>
      <button type="button" class="btn icon" data-act="theme" aria-label="Changer de thème" title="Thème : ${theme === 'system' ? 'automatique' : theme === 'dark' ? 'sombre' : 'clair'}">${ic(isDark() ? 'moon' : 'sun')}</button>
    </div>`;
}
function tabbarHTML() {
  const t = (to, icn, label) => `<button type="button" class="${ui.route.name === to || (to === 'overview' && ui.route.name === 'boat') ? 'on' : ''}" data-act="nav" data-to="${to}">${ic(icn)}<span>${label}</span></button>`;
  if (isTech()) return `${t('overview', 'grid', 'Flotte')}${t('backup', 'users', 'Compte')}`;
  return `${t('overview', 'grid', 'Flotte')}${t('checklist', 'list', 'Liste')}${t('engines', 'engine', 'Moteurs')}${ui.server ? `${t('journal', 'history', 'Journal')}${t('accounts', 'users', 'Comptes')}` : ''}${t('backup', 'download', 'Données')}`;
}
function paletteItems(s, q) {
  const items = [
    { label: 'Vue d’ensemble', sub: 'Page', run: () => go('overview'), icon: 'grid' },
    { label: 'Liste de préparation', sub: 'Page', run: () => go('checklist'), icon: 'list' },
    { label: 'Sauvegardes et restauration', sub: 'Page', run: () => go('backup'), icon: 'download' },
    { label: 'Exporter la sauvegarde', sub: 'Action', run: () => doExport(), icon: 'download' },
    { label: 'Changer de thème', sub: 'Action', run: () => cycleTheme(), icon: 'moon' },
    ...sortBoats(s.boats).map((b) => ({ label: b.name, sub: `Bateau · ${baseLabel(b)}`, run: () => go('boat', b.id), icon: 'boat' })),
    { label: 'Rapport Excel du mois', sub: 'Action', run: () => go('backup'), icon: 'file' },
    ...sortBoats(s.boats).map((b) => ({ label: `Signaler le retour · ${b.name}`, sub: 'Action', run: () => openSheet(b.id), icon: 'left' })),
  ];
  const pool = isTech() ? items.filter((i) => i.label === 'Vue d’ensemble' || i.label === 'Changer de thème' || i.sub.startsWith('Bateau') || i.label.startsWith('Nouveau retour')) : items;
  if (ui.server && !isTech()) pool.splice(4, 0, { label: 'Comptes', sub: 'Page', run: () => go('accounts'), icon: 'users' }, { label: 'Journal', sub: 'Page', run: () => go('journal'), icon: 'history' });
  const n = norm(q).trim();
  if (!n) return pool.slice(0, 12);
  const words = n.split(/\s+/);
  const hit = (txt) => { const t = norm(txt); return words.every((w) => t.includes(w)); };
  const out = pool.filter((i) => hit(i.label + ' ' + i.sub));
  // observations en cours et historique des préparations (une seule entrée par titre et par bateau)
  const seen = new Set(), more = [];
  const add = (b, t, sub, tab) => {
    if (!t?.title || !hit(`${t.title} ${b.name} ${sub}`)) return;
    const k = `${b.id}|${tab}|${norm(t.title)}|${sub}`; if (seen.has(k)) return; seen.add(k);
    more.push({ label: t.title, sub: `${sub} · ${b.name}`, run: () => go('boat', b.id, tab), icon: tab === 'prep' ? 'flag' : 'history' });
  };
  sortBoats(s.boats).forEach((b) => {
    [...b.tasks, ...b.pendingOnReturn].filter((t) => !t.template).forEach((t) => add(b, t, t.done ? 'Observation terminée' : 'Observation', 'prep'));
    b.history.forEach((h) => (h.tasks || []).filter((t) => !t.template).forEach((t) => add(b, t, `Historique du ${fmtD(h.date)}`, 'archives')));
  });
  return [...out, ...more].slice(0, 40);
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
  if (ui.logoutBlock) {
    const b = ui.logoutBlock;
    h += `<div class="modalback"><div class="panel modalbox" role="alertdialog" aria-labelledby="lo-t" aria-describedby="lo-d"><h3 id="lo-t">${ic('flag')} Modifications non envoyées</h3>
      <p id="lo-d"><b>${plural(b.blocked, 'modification', 'modifications')}</b> sur ${plural(b.boats, 'bateau', 'bateaux')} ne sont pas encore parties vers le serveur (pas de réseau ?). Si tu te déconnectes maintenant, elles seront perdues.</p>
      <div class="row gap wrap"><button class="btn pri" data-act="logoutKeep" autofocus>Rester connecté</button><button class="btn bad" data-act="logoutForce">Me déconnecter et perdre ces modifications</button></div></div></div>`;
  }
  const dueNow = ui.depKey ? ui.depKey.split(',').map((k) => ({ kind: k[0], b: s.boats.find((x) => x.id === k.slice(2)) })).filter((x) => x.b) : [];
  if (dueNow.length && !ui.logoutBlock) {
    const onlyRet = dueNow.every((x) => x.kind === 'r'), onlyDep = dueNow.every((x) => x.kind === 'd');
    h += `<div class="modalback"><div class="panel modalbox" role="alertdialog" aria-labelledby="dp-t"><h3 id="dp-t">${ic('flag')} ${onlyRet ? (dueNow.length > 1 ? 'Retours à signaler' : 'Retour à signaler') : onlyDep ? (dueNow.length > 1 ? 'Départs à signaler' : 'Départ à signaler') : 'Départs et retours à signaler'}</h3>
      <p class="mut small">${onlyRet ? 'L’heure de retour prévue est passée. Le bateau est-il rentré ?' : 'L’heure prévue est passée. Signaler un départ archive la préparation et reporte les observations non terminées ; signaler un retour relance la préparation.'}</p>
      <ul class="depask">${dueNow.map(({ kind, b }) => `<li><div><b>${esc(b.name)}</b><span class="mut small"> · ${kind === 'd' ? `départ prévu le ${esc(fmtDT(b.departure))}` : `retour prévu le ${esc(fmtDT(b.returnDate))}`}</span></div>
        <div class="row gap wrap"><button class="btn pri sm" type="button" data-act="${kind === 'd' ? 'depYes' : 'retYes'}" data-id="${b.id}">${kind === 'd' ? 'Signaler le départ' : 'Signaler le retour'}</button><button class="btn sm" type="button" data-act="depNo" data-id="${b.id}">Pas encore</button></div></li>`).join('')}</ul></div></div>`;
  }
  if (ui.palette) h += `<dialog class="palette" id="palette" aria-label="Rechercher"><div class="pin">${ic('search')}<input id="pq" placeholder="Bateau, observation, historique ou action" autocomplete="off" value="${esc(ui.palette.q)}" data-pal></div><ul id="plist">${paletteList(s)}</ul><footer class="mut small"><kbd>↑</kbd><kbd>↓</kbd> naviguer <kbd>Entrée</kbd> ouvrir <kbd>Échap</kbd> fermer</footer></dialog>`;
  return h;
}

/** Champ de saisie de la feuille retour en cours d'utilisation (clavier ouvert sur téléphone). */
let pointerDown = false; // doigt posé : ne pas remplacer l'élément qu'on est en train de toucher
const typingSheet = () => { const ae = document.activeElement; return !!(ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'checkbox')) && ae.closest('#view .rwrap')); };
function render() {
  // Pendant la saisie d'une note dans la feuille retour, on ne redessine pas la page (synchro, autre action) :
  // sinon le champ est remplacé, le clavier se ferme et le texte en cours est perdu. On redessine à la sortie du champ.
  if (ui.route.name === 'retour' && (typingSheet() || ui.holdRender || pointerDown)) { ui.deferRender = true; return; }
  ui.deferRender = false;
  const s = getState(), now = new Date();
  ui.isManager = !!ui.server && !isTech();
  const ae = document.activeElement;
  const key = ae && (ae.dataset?.fk ? `[data-fk="${ae.dataset.fk}"]` : ae.id ? `#${CSS.escape(ae.id)}` : ae.dataset?.draft ? `[data-draft="${ae.dataset.draft}"]` : null);
  const sel = ae && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
  const inLayer = ae && ae.closest && ae.closest('dialog');

  ui.server = remote.mode === 'server';
  const first = ui.server && remote.user?.mustChange; // mot de passe provisoire à remplacer
  const gate = ui.server && (!remote.user || first);
  document.body.classList.toggle('auth', gate);
  document.body.classList.toggle('tech', isTech());
  if (gate) {
    const html = first ? firstPwdHTML() : loginHTML();
    if (!$('#view .login')) { $('#side').innerHTML = ''; $('#top').innerHTML = ''; $('#tabbar').innerHTML = ''; $('#layer').innerHTML = ''; $('#view').innerHTML = html; (first ? $('#fp-c') : $('#lg-' + (ui.loginEmail ? 'p' : 'e')))?.focus(); }
    else { const f = $('#view .login'); f.outerHTML = html; }
    return;
  }
  if (isTech() && !TECH_PAGES.has(ui.route.name)) ui.route = { name: 'overview', id: null };
  if (ui.route.name === 'journal' && ui.server && remote.user?.role === 'manager' && !ui.journal.loaded && !ui.journal.busy) { ui.journal.busy = true; loadJournal(); }
  if (ui.route.name === 'checklist' && ui.server && remote.user?.role === 'manager' && !ui.mail?.loaded && !ui.mail?.busy && !ui.mail?.err) loadMail();

  const routeKey = location.hash || '#/';
  const prevBars = routeKey === ui.barRoute ? [...document.querySelectorAll('#view .bar i')].map((i) => i.style.width) : [];
  ui.barRoute = routeKey;

  $('#side').innerHTML = sideHTML(s);
  $('#top').innerHTML = topHTML(s);
  $('#tabbar').innerHTML = tabbarHTML();
  const r = ui.route;
  $('#view').innerHTML = r.name === 'boat' ? boatView(s, ui, r.id, now) : r.name === 'team' ? teamView(s, ui)
    : r.name === 'checklist' ? checklistView(s, ui) : r.name === 'accounts' ? accountsView(s, ui) : r.name === 'retour' ? retourView(s, ui, r.id, r.sheet, remote.user?.name || '') : r.name === 'journal' ? journalView(s, ui, now) : r.name === 'engines' ? enginesView(s, ui, now) : r.name === 'backup' ? backupView(s, ui) : overviewView(s, ui, now);
  document.querySelectorAll('#view [data-draft]').forEach((el) => { if (ui.drafts[el.dataset.draft] != null) el.value = ui.drafts[el.dataset.draft]; });
  document.querySelectorAll('#view textarea[data-parse]').forEach(updateParse);
  tickCountdowns();
  animateBars(prevBars);
  if (ui.fx) checkFx(ui.fx);

  if (!inLayer) $('#layer').innerHTML = layerHTML(s, now);
  const pal = $('#palette'); if (pal && !pal.open) { pal.showModal(); $('#pq')?.focus(); }

  if (key && !inLayer) {
    const t = document.querySelector(key);
    if (t && t !== document.activeElement) { try { t.focus({ preventScroll: true }); if (sel && t.setSelectionRange && t.type !== 'datetime-local' && t.type !== 'date') t.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
  }
}

/** Tâche cochée : la case rebondit, quelques gouttes jaillissent ; catégorie complète : un petit voilier traverse. */
const FX_BOAT = '<svg class="fxboat" viewBox="0 0 22 16" aria-hidden="true"><path d="M11 1v10M11 2l7 8h-7z" fill="#2BB8AB" stroke="#2BB8AB" stroke-linejoin="round"/><path d="M11 3l-5 7h5z" fill="#E5521F"/><path d="M2 11h18l-3 4H5z" fill="#0C2B3D"/></svg>';
function checkFx(tid) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const btn = document.querySelector(`#view [data-act="tgl"][data-tid="${CSS.escape(tid)}"]`);
  const row = btn?.closest('.task');
  if (!row || !row.classList.contains('done')) return;
  row.classList.add('justdone');
  const cols = ['#2BB8AB', '#46A6E0', '#E5521F'];
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('span'), a = (i / 9) * Math.PI * 2 + Math.random() * 0.4, r = 18 + Math.random() * 14;
    d.className = 'fxdrop'; d.style.setProperty('--dx', `${Math.cos(a) * r}px`); d.style.setProperty('--dy', `${Math.sin(a) * r}px`); d.style.background = cols[i % 3];
    btn.appendChild(d); setTimeout(() => d.remove(), 700);
  }
  const cat = row.closest('.tcat');
  if (cat?.classList.contains('ok')) { cat.classList.add('justfull'); cat.querySelector('h4')?.insertAdjacentHTML('beforeend', FX_BOAT); }
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
  // même compteur que la feuille retour : combien d'observations à cocher seront créées
  if (out) out.innerHTML = n ? `<b>${n} observation${n > 1 ? 's' : ''} à cocher</b>` : 'Une ligne = une observation';
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
    data: { checklistVersion: 1, schemaVersion: 2, boats: s.boats, team: s.team, templates: s.templates, tplCats: s.tplCats || {}, returnSheet: s.returnSheet || null, baseName: s.baseName, prefs: s.prefs },
  };
  download(`hublot-${todayStr()}.json`, JSON.stringify(out, null, 2));
}
function exportMonth(s) {
  const month = ui.xm.month || todayStr().slice(0, 7);
  const boat = ui.xm.boat;
  const r = monthlyReport(s, { month, boat });
  if (!r) { toast(`Aucune observation constatée en ${monthLabel(month)}`); return; }
  const who = boat === 'all' ? 'flotte' : slugify(s.boats.find((b) => b.id === boat)?.name || 'bateau');
  download(`observations-${month}-${who}.xlsx`, r.bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
    } catch (e) { ui.imp = null; ui.impErr = e.message === 'Aucun bateau dans ce fichier' ? e.message : 'Ce fichier n’est pas une sauvegarde Hublot.'; }
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
  if (isTech() && !TECH_ACTS.has(a)) return;
  const id = d.id || (ui.route.name === 'boat' ? ui.route.id : null);
  const boat = s.boats.find((b) => b.id === id);
  const nm = boat ? boat.name : '';
  switch (a) {
    case 'nav': e.preventDefault(); go(d.to); break;
    case 'jDay': ui.journal.open[d.v] = !ui.journal.open[d.v]; render(); break;
    case 'jStep': { const days = journalDays(); const i = Math.min(days.length - 1, Math.max(0, Math.max(0, days.findIndex((x) => x.key === ui.journal.day)) + +d.v)); jumpDay(days[i].key); break; }
    case 'jType': ui.journal.type = d.v; render(); break;
    case 'jWho': ui.journal.who = ui.journal.who === d.v ? 'all' : d.v; render(); break;
    case 'open': e.preventDefault(); go('boat', id, d.tab || 'prep'); break;
    case 'tab': ui.tab = d.v; ui.editRec = false; try { history.replaceState(null, '', hashFor(ui.route)); } catch { /* */ } render(); break;
    case 'pjMore': ui.pjAll = !ui.pjAll; render(); break;
    case 'fOpen': ui.fsheet = true; render(); break;
    case 'fClose': ui.fsheet = false; render(); break;
    case 'baseAll': ui.base = 'all'; render(); break;
    case 'filter': ui.filter = d.v; ui.fsheet = false; if (ui.route.name !== 'overview') go('overview'); else render(); break;
    case 'resetFilters': ui.filter = 'all'; ui.base = 'all'; ui.q = ''; ui.drafts.q = ''; render(); break;
    case 'view': ui.view = d.v; ui.fsheet = false; render(); break;
    case 'toggleAdd': ui.add = !ui.add; if (!ui.add) { delete ui.drafts['nb-name']; } if (ui.route.name !== 'overview') go('overview'); render(); if (ui.add) $('#nb-name')?.focus(); break;
    case 'goBackup': go('backup'); break;
    case 'logout': logout().then((r) => { if (r.blocked) ui.logoutBlock = r; else ui.loginErr = ''; render(); }); break;
    case 'depYes': ui.depKey = ''; M(`Départ signalé · ${nm}`, (st) => A.confirmDeparture(st, id)); break;
    case 'retYes': ui.depKey = ''; openSheet(id); break;
    case 'depNo': ui.depLater[id] = Date.now() + 30 * 60000; ui.depKey = ''; render(); toast(`${nm} : je te redemande dans 30 min`); break;
    case 'logoutKeep': ui.logoutBlock = null; render(); break;
    case 'logoutForce': ui.logoutBlock = null; logout({ force: true }).then(() => { ui.loginErr = ''; render(); }); break;
    // comptes (manager)
    case 'acctReset': ui.confirm = 'acct-reset:' + d.uid; render(); break;
    case 'acctResetGo': ui.confirm = null; resetAccount(+d.uid).then((r) => { ui.accounts.created = { email: r.email, password: r.password }; return loadAccounts(); }).catch((err) => { ui.accounts.err = err.message; render(); }); break;
    case 'acctEdit': ui.acctEdit = +d.uid; render(); setTimeout(() => { const el = document.querySelector('.aname input'); if (el) { el.focus(); el.select(); } }); break;
    case 'acctEditNo': ui.acctEdit = null; render(); break;
    case 'acctToggle': updateAccount({ id: +d.uid, disabled: d.off === '1' }).then((r) => { ui.accounts.list = r.users; ui.accounts.err = ''; render(); }).catch((err) => { ui.accounts.err = err.message; render(); }); break;
    case 'acctCopy': try { navigator.clipboard.writeText(d.v).then(() => toast('Mot de passe copié'), () => toast('Sélectionne le mot de passe pour le copier')); } catch { toast('Sélectionne le mot de passe pour le copier'); } break;
    case 'acctDismiss': ui.accounts.created = null; render(); break;
    case 'demo': if (ui.server) break; if (s.boats.length) addSnapshot('Avant démo'); replace(demoState(), 'Flotte de démonstration chargée'); go('overview'); break;
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
    case 'tgl': { const t = boat?.tasks.find((x) => x.id === d.tid); ui.fx = t && !t.done ? d.tid : null; M('', (st) => A.toggleTask(st, id, d.tid, remote.user?.name || '')); ui.fx = null; break; }
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
    case 'depAsk': if (ui.route.name !== 'boat' || ui.route.id !== id) go('boat', id, 'prep'); ui.confirm = 'dep:' + id; render(); break;
    case 'dep': ui.confirm = null; M(`Départ signalé · ${nm}`, (st) => A.confirmDeparture(st, id)); break;
    case 'retAsk': openSheet(id); break;
    case 'resaUse': M('Date de la réservation reprise', (st) => { const b2 = st.boats.find((x) => x.id === id); const f = b2.inRental ? 'returnDate' : 'departure'; b2[f] = d.v; b2.resaDates = { ...(b2.resaDates || {}), [f]: d.v }; }); break;
    case 'resaRefresh': el.disabled = true; toast('Récupération des réservations…'); refreshResa().then((r) => { toast(r.info?.errors?.length ? `Réservations : ${r.info.errors.length} erreur(s)` : `Réservations à jour (${r.info.updated} bateau${r.info.updated > 1 ? 'x' : ''} modifié${r.info.updated > 1 ? 's' : ''})`); syncNow(); }).catch((err) => toast(`Actualisation impossible : ${err.message}`)).finally(() => { el.disabled = false; }); break;
    case 'mailTest': el.disabled = true; ui.mail.msg = 'Envoi de l’e-mail d’essai…'; ui.mail.msgBad = false; render();
      testMail().then((r) => { ui.mail.msg = `E-mail d’essai envoyé à ${r.to.join(', ')}${r.sample ? ` (avec la dernière feuille retour : ${r.sample})` : ''}.`; ui.mail.msgBad = false; })
        .catch((err) => { ui.mail.msg = err.message; ui.mail.msgBad = true; }).finally(() => { render(); }); break;
    case 'rView': go('retour', id, d.sheet); break;
    case 'rSet': {
      M('', (st) => A.setSheetValue(st, id, d.it, d.v));
      // partie terminée sans défaut : on la referme et on ouvre la suivante qui reste à voir
      const st2 = getState(), b2 = st2.boats.find((x) => x.id === id), sh = A.draftSheet(st2, b2?.returnDraft), vals = b2?.returnDraft?.values || {};
      const i = sh.findIndex((x) => x.items.some((it) => it.id === d.it)), x = sh[i];
      if (x && x.items.every((it) => vals[it.id]) && !x.items.some((it) => vals[it.id] === 'def')) {
        const o = ui.rOpen || (ui.rOpen = {});
        o[x.id] = false;
        const nx = sh.slice(i + 1).find((y) => y.items.some((it) => !vals[it.id]));
        if (nx) o[nx.id] = true;
        render();
        const sec2 = nx && document.querySelector(`[data-act="rOpen"][data-v="${nx.id}"]`)?.closest('.rsec');
        if (sec2) window.scrollTo({ top: sec2.getBoundingClientRect().top + window.scrollY - 130, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      break;
    }
    case 'rOpen': { const o = ui.rOpen || (ui.rOpen = {}); o[d.v] = !o[d.v]; render(); break; }
    case 'rNext': {
      // premier point à remplir (sans réponse, ou Défaut sans note), dans l'ordre de la feuille : on ouvre sa partie et on le fait clignoter
      const b3 = s.boats.find((x) => x.id === id); if (!b3?.returnDraft) break;
      const m = A.sheetMissing(s, b3), want = new Set([...m.unseen, ...m.noNote].map((x) => x.id));
      const it = sheetItems(A.draftSheet(s, b3.returnDraft)).find((x) => want.has(x.id)); if (!it) break;
      (ui.rOpen || (ui.rOpen = {}))[it.sec.id] = true; render();
      const el2 = document.getElementById('r-' + it.id);
      if (el2) { el2.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); el2.classList.remove('rflash'); void el2.offsetWidth; el2.classList.add('rflash'); }
      break;
    }
    case 'rDone': ui.rRecap = id; render(); break;
    case 'rRecapNo': ui.rRecap = null; render(); break;
    case 'rValidate': { const r = M(`Retour signalé · ${nm}`, (st) => A.validateReturnSheet(st, id, remote.user?.name || '')); if (r) { ui.rRecap = null; toast(`Retour signalé · ${nm}${r.obs ? ` · ${r.obs} observation${r.obs > 1 ? 's' : ''} créée${r.obs > 1 ? 's' : ''}` : ''}`, { undo: true }); go('boat', id, 'prep'); } break; }
    case 'rCancel': ui.rCancel = id; render(); window.scrollTo(0, 0); break;
    case 'rCancelNo': ui.rCancel = null; render(); break;
    case 'rCancelYes': ui.rCancel = null; M('Feuille retour annulée', (st) => A.cancelReturnSheet(st, id)); go('boat', id, 'prep'); break;
    case 'rPrint': window.print(); break;
    case 'retGo': ui.confirm = null; ui.tab = 'prep'; M(`Retour signalé · ${nm}`, (st) => A.newReturn(st, id)); break;
    // observations
    case 'obsF': ui.obsF = d.v; render(); break;
    case 'xlsMonth': exportMonth(s); break;
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
    case 'clEdit': ui.clEdit = +d.i; render(); setTimeout(() => { const el = document.querySelector('.clren input'); if (el) { el.focus(); el.select(); } }); break;
    case 'clEditNo': ui.clEdit = null; render(); break;
    case 'shOpen': ui.shOpen = { ...(ui.shOpen || {}), [d.v]: !(ui.shOpen || {})[d.v] }; render(); break;
    case 'shSecMv': M('', (st) => A.sheetMoveSection(st, d.sec, +d.v)); break;
    case 'shItMv': M('', (st) => A.sheetMoveItem(st, d.sec, d.it, +d.v)); break;
    case 'shItDel': M('Point retiré de la feuille retour', (st) => A.sheetDeleteItem(st, d.sec, d.it)); break;
    case 'shSecDel': M('Partie retirée de la feuille retour', (st) => A.sheetDeleteSection(st, d.sec)); break;
    case 'shReset': M('Feuille retour d’origine rétablie', (st) => A.sheetReset(st)); break;
    case 'engDone': M('Entretien noté', (st) => A.engDone(st, id, d.type, remote.user?.name || '')); break;
    case 'engFix': ui.engFix = { ...(ui.engFix || {}), [d.k]: !ui.engFix?.[d.k] }; render(); break;
    case 'engTab': ui.engTab = d.v; render(); break;
    case 'engTypeDel': M('Entretien retiré', (st) => A.deleteEngineType(st, d.type)); break;
    case 'engModelDel': M('Modèle retiré', (st) => A.deleteEngineModel(st, d.mid)); break;
    case 'engPartDel': M('Pièce retirée', (st) => A.deleteEnginePart(st, d.mid, d.pid)); break;
    case 'mxOpen': ui.cl = ui.cl === d.v ? null : d.v; render(); break;
    case 'clUp': case 'clDn': ui.clEdit = null; M('', (st) => { const l = st.templates.slice(), i = +d.i, j = a === 'clUp' ? i - 1 : i + 1; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; A.setFleetTemplates(st, l); }); break;
    case 'clDel': ui.clEdit = null; M('Tâche retirée de la liste', (st) => { const l = st.templates.slice(); l.splice(+d.i, 1); A.setFleetTemplates(st, l); }); break;
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
    case 'impReplace': {
      const raw = ui.imp.raw; ui.imp = null;
      if (ui.server) { // le serveur fait une copie de sa base avant de remplacer
        render();
        importRemote(raw).then(() => { toast('Sauvegarde importée pour toute l’équipe'); go('overview'); }).catch((err) => toast(err.message));
        break;
      }
      addSnapshot('Avant import'); try { replace(raw, 'Sauvegarde importée'); } catch (err) { toast(err.message); } break;
    }
    case 'snapRestore': ui.confirm = null; restoreSnapshot(+d.i); break;
    case 'reset': ui.confirm = null; resetAll(); break;
    default: break;
  }
});
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- champs : brouillons, changements, formulaires ------------------------------------------------------
// Redessin mis de côté pendant la saisie : on le fait une fois le geste terminé (jamais au milieu d'un appui,
// sinon le bouton ou le champ touché est remplacé : appui perdu, clavier qui se ferme).
const flushRender = () => { if (ui.deferRender && !ui.holdRender && !pointerDown && !typingSheet()) render(); };
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => { pointerDown = false; setTimeout(flushRender, 300); }, true));
document.addEventListener('focusout', () => setTimeout(flushRender, 300));
/** Une note vient d'être enregistrée parce qu'on a touché un autre champ : on laisse ce champ prendre le clavier avant de redessiner. */
function holdSheet() {
  ui.holdRender = true;
  setTimeout(() => { ui.holdRender = false; flushRender(); }, 80);
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset?.draft) ui.drafts[el.dataset.draft] = el.value;
  if (el.dataset?.chg === 'rText' && el.dataset.f === 'clientObs') { const out = el.closest('.rfree')?.querySelector('[data-cobs-out]'); if (out) out.innerHTML = cobsHint(el.value); }
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
  if (isTech() && !TECH_CHG.has(d.chg) && !(d.chg === 'maint' && TECH_MAINT.has(d.f))) return;
  const id = d.id;
  switch (d.chg) {
    case 'acctRole': updateAccount({ id: +d.uid, role: el.value }).then((r) => { ui.accounts.list = r.users; ui.accounts.err = ''; render(); }).catch((err) => { ui.accounts.err = err.message; loadAccounts(); }); break;
    case 'dep': M('', (st) => A.setDeparture(st, id, el.value)); break;
    case 'ret': M('', (st) => A.setReturnDate(st, id, el.value)); break;
    case 'rNote': holdSheet(); M('', (st) => A.setSheetNote(st, id, d.it, el.value)); break;
    case 'shSec': M('Partie renommée', (st) => A.sheetRenameSection(st, d.sec, el.value)); break;
    case 'shItem': M('Point renommé', (st) => A.sheetRenameItem(st, d.sec, d.it, el.value)); break;
    case 'rBill': M('', (st) => A.setSheetBill(st, id, d.it, el.checked)); break;
    case 'rDiver': M('', (st) => A.setSheetDiver(st, id, el.checked)); break;
    case 'rNum': holdSheet(); M('', (st) => A.setSheetNum(st, id, d.k, el.value)); break;
    case 'rText': holdSheet(); M('', (st) => A.setSheetText(st, id, d.f, el.value)); break;
    case 'base': M('', (st) => A.updateBoat(st, id, { base: el.value, otherBase: el.value === 'Autre' ? st.boats.find((b) => b.id === id).otherBase : '' })); break;
    case 'baseFilter': ui.base = el.value; render(); break;
    case 'jWho': ui.journal.who = el.value; render(); break;
    case 'jBoat': ui.journal.boat = el.value; render(); break;
    case 'jResa': ui.journal.hideResa = el.checked; try { localStorage.setItem('hublot:journalResa', el.checked ? 'hide' : 'show'); } catch { /* */ } render(); break;
    case 'jDate': if (el.value) jumpDay(el.value); break;
    case 'tech': M('', (st) => { const b = st.boats.find((x) => x.id === id); const set = new Set(b.techs); el.checked ? set.add(d.name) : set.delete(d.name); A.setTechs(st, id, [...set]); }); break;
    case 'assign': M('', (st) => A.toggleAssign(st, d.name, id)); break;
    case 'tplCat': M('', (st) => A.setTplCat(st, st.templates[+d.i], el.value)); break;
    case 'tplNow': ui.tplNow = el.checked; break;
    case 'maint': M('', (st) => A.updateMaint(st, id, d.mid, d.f, el.value)); break;
    case 'engF': M('', (st) => A.setEngField(st, id, d.type, d.f, el.value, remote.user?.name || '')); break;
    case 'engModel': M('Modèle de moteur changé', (st) => A.setBoatEngine(st, id, el.value)); break;
    case 'engTypeName': M('', (st) => A.renameEngineType(st, d.type, el.value)); break;
    case 'engModelName': M('', (st) => A.renameEngineModel(st, d.mid, el.value)); break;
    case 'engIv': M('', (st) => A.setEngineIv(st, d.mid, d.type, d.k, el.value)); break;
    case 'engPart': M('', (st) => A.updateEnginePart(st, d.mid, d.pid, d.f, el.value)); break;
    case 'hours': M('', (st) => A.setHours(st, id, d.f, el.value)); break;
    case 'billf': M('', (st) => A.setBillField(st, id, d.tid, d.f, el.value)); break;
    case 'billed': M(el.checked ? 'Refacturé au client' : 'Refacturation annulée', (st) => A.setBilled(st, id, d.tid, el.checked)); break;
    case 'xm': ui.xm = { ...ui.xm, [d.k]: el.value }; render(); break;
    case 'pref': M('Préférence enregistrée', (st) => A.setPref(st, d.k, el.checked)); break;
    case 'baseName': M('', (st) => { st.baseName = el.value.trim() || 'Ma base'; }); break;
    default: break;
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (isTech() && !TECH_FORMS.has(form.dataset.form)) return;
  const fd = new FormData(form), g = (k) => String(fd.get(k) ?? '').trim();
  const id = form.dataset.id || ui.route.id;
  const name = getState().boats.find((b) => b.id === id)?.name || '';
  switch (form.dataset.form) {
    case 'login': {
      ui.loginEmail = g('email'); ui.loginErr = ''; ui.loginBusy = true; render();
      login(g('email'), String(fd.get('password') || ''))
        .then(() => { ui.loginBusy = false; render(); })
        .catch((err) => { ui.loginBusy = false; ui.loginErr = err.status === 401 || err.status === 429 ? err.message : 'Serveur injoignable. Vérifie ta connexion.'; render(); $('#lg-p')?.focus(); });
      return;
    }
    case 'pwd': {
      const cur = String(fd.get('current') || ''), nx = String(fd.get('next') || ''), nx2 = String(fd.get('next2') || '');
      if (nx !== nx2) { ui.pwdMsg = { bad: true, t: 'Les deux nouveaux mots de passe sont différents.' }; render(); return; }
      changePassword(cur, nx).then(() => { ui.pwdMsg = { t: 'Mot de passe changé.' }; form.reset(); render(); })
        .catch((err) => { ui.pwdMsg = { bad: true, t: err.message }; render(); });
      return;
    }
    case 'firstPwd': {
      const cur = String(fd.get('current') || ''), nx = String(fd.get('next') || ''), nx2 = String(fd.get('next2') || '');
      if (nx !== nx2) { ui.loginErr = 'Les deux nouveaux mots de passe sont différents.'; render(); return; }
      ui.loginErr = ''; ui.loginBusy = true; render();
      changePassword(cur, nx).then(() => { ui.loginBusy = false; render(); })
        .catch((err) => { ui.loginBusy = false; ui.loginErr = err.message; render(); });
      return;
    }
    case 'addAccount': {
      ui.accounts.busy = true; ui.accounts.formErr = ''; render();
      createAccount({ name: g('name'), email: g('email'), role: g('role') }).then((r) => {
        ui.accounts.busy = false; ui.accounts.created = { email: r.user.email, password: r.password };
        delete ui.drafts['ac-n']; delete ui.drafts['ac-e'];
        return loadAccounts();
      }).catch((err) => { ui.accounts.busy = false; ui.accounts.formErr = err.message; render(); });
      return;
    }
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
    case 'engTypeAdd': { const l = g('label'); if (l) M('Entretien ajouté', (st) => A.addEngineType(st, l)); break; }
    case 'engModelAdd': { const n = g('name'); if (n) M('Modèle ajouté', (st) => A.addEngineModel(st, n)); break; }
    case 'engPartAdd': { const l = g('label'); if (l) M('Pièce ajoutée', (st) => A.addEnginePart(st, form.dataset.mid, { label: l, ref: g('ref'), qty: g('qty'), type: g('type') })); break; }
    case 'addMaint': { const t = g('title'); if (!t) return; delete ui.drafts[`maint-${id}`]; M('Entretien ajouté', (st) => A.addMaint(st, id, t)); break; }
    case 'addEvent': {
      if (!g('title')) return;
      M('Événement enregistré', (st) => A.addEvent(st, id, { title: g('title'), date: g('date'), category: g('category'), details: g('details'), pinned: !!fd.get('pinned') }));
      break;
    }
    case 'mailSave': {
      saveMail(String(fd.get('to') || '')).then((r) => { delete ui.drafts['mail-to']; ui.mail = { ...ui.mail, to: r.to, msg: r.to.length ? `Enregistré : ${r.to.length} adresse${r.to.length > 1 ? 's' : ''}.` : 'Enregistré : aucun destinataire, aucun e-mail ne partira.', msgBad: false }; render(); })
        .catch((err) => { ui.mail.msg = err.message; ui.mail.msgBad = true; render(); });
      return;
    }
    case 'saveBoat': { if (!g('name')) return; M('Réglages enregistrés', (st) => A.updateBoat(st, id, { name: g('name'), model: g('model'), base: g('base'), otherBase: g('base') === 'Autre' ? g('otherBase') : '' })); break; }
    case 'addMember': { const n = g('name'); if (!n) return; delete ui.drafts.tm; M(`${n} ajouté à l’équipe`, (st) => A.addMember(st, n)); break; }
    case 'clRename': {
      const from = getState().templates[+form.dataset.i], to = g('title');
      if (!from || !to) return;
      if (to === from) { ui.clEdit = null; render(); return; }
      let r = null;
      M('Tâche renommée', (st) => { r = A.renameTemplate(st, from, to); }, { toast: false });
      if (r) ui.clEdit = null;
      if (r) toast(`Tâche renommée${r.prep || r.next ? ` sur ${plural(r.prep + r.next, 'bateau', 'bateaux')}` : ''}`, { undo: true });
      else render();
      break;
    }
    case 'acctName': {
      const uid = +form.dataset.uid, n = g('name'); if (!n) return;
      updateAccount({ id: uid, name: n }).then((r) => {
        ui.accounts.list = r.users; ui.accounts.err = ''; ui.acctEdit = null;
        if (remote.user && remote.user.id === uid) remote.user.name = n;
        toast(`Prénom enregistré : ${n}`); render();
      }).catch((err) => { ui.accounts.err = err.message; render(); });
      break;
    }
    case 'shAddItem': { const t = g('label'); if (!t) return; M('Point ajouté à la feuille retour', (st) => A.sheetAddItem(st, form.dataset.sec, t)); setTimeout(() => document.querySelector(`form[data-form="shAddItem"][data-sec="${form.dataset.sec}"] input`)?.focus()); break; }
    case 'shAddSec': { const t = g('title'); if (!t) return; let nid = ''; M('Partie ajoutée à la feuille retour', (st) => { A.sheetAddSection(st, t); nid = sheetOf(st).at(-1).id; }); ui.shOpen = { ...(ui.shOpen || {}), [nid]: true }; render(); break; }
    case 'addDefTpl': {
      const t = g('title'); if (!t) return; delete ui.drafts['cl-new'];
      M('Tâche ajoutée à la liste', (st) => { if (!st.templates.includes(t)) A.setFleetTemplates(st, [...st.templates, t]); });
      break;
    }
    default: break;
  }
});

// Journal : rechargé à chaque ouverture de la page ; le jour le plus récent avec des actions est ouvert.
/** Réglages des e-mails des feuilles retour (managers, page « Liste de préparation »). */
function loadMail() {
  ui.mail = { ...(ui.mail || {}), busy: true };
  return getMail().then((r) => { ui.mail = { ...ui.mail, ...r, loaded: true, busy: false, err: '' }; render(); })
    .catch((e) => { ui.mail = { ...ui.mail, loaded: false, busy: false, err: `Réglages e-mail indisponibles : ${e.message}` }; render(); });
}
function loadJournal() {
  const j = ui.journal;
  j.busy = true;
  return getJournal().then((r) => {
    j.entries = r.entries || []; j.err = '';
    if (!j.loaded) { const first = j.entries[0] ? todayStr(new Date(j.entries[0].at)) : todayStr(); j.day = first; j.open = { [first]: true }; }
    j.loaded = true; j.busy = false; render();
  }).catch((e) => { j.loaded = true; j.busy = false; j.err = e.message; render(); });
}
function jumpDay(key) {
  const j = ui.journal;
  j.day = key; j.open[key] = true; render();
  const el = document.getElementById('jd-' + key);
  if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function loadAccounts() {
  ui.accounts = ui.accounts || { list: null, loaded: false };
  return listAccounts().then((r) => { ui.accounts.list = r.users; ui.accounts.loaded = true; ui.accounts.err = ''; render(); })
    .catch((e) => { ui.accounts.loaded = true; ui.accounts.err = e.message; render(); });
}

// ---- minuteur : compte à rebours, départs automatiques ---------------------------------------------------
function tick() {
  tickCountdowns();
  const s = getState();
  if (ui.server && (!remote.user || remote.user.mustChange || remote.pending || !remote.lastSync || Date.now() - remote.lastSync > 20000)) return;
  const now = Date.now();
  const due = [...A.dueDepartures(s).map((i) => `d:${i}`), ...A.dueReturns(s).map((i) => `r:${i}`)].filter((k) => !(ui.depLater[k.slice(2)] > now));
  const key = due.join(',');
  if (key !== ui.depKey) { ui.depKey = key; render(); } // la fenêtre de question apparaît (ou disparaît)
}

// ---- démarrage ----------------------------------------------------------------------------------------------
load();
applyTheme();
const r0 = parseHash();
ui.route = { name: r0.name, id: r0.id || null };
if (r0.tab) ui.tab = r0.tab;
onRemote(() => { // état de synchro : barre du haut et menu seulement (les données passent par subscribe)
  if (!remote.user && remote.mode === 'server') { render(); return; }
  if (remote.notice) { toast(remote.notice); remote.notice = ''; }
  const t = $('[data-sync]'); if (t) t.outerHTML = syncBadge(store.savedAt);
  if (ui.route.name === 'backup' && !$('#view').contains(document.activeElement)) render();
});
detect().then(() => {
  ui.server = remote.mode === 'server';
  if (!ui.server) autoSnapshot();
  render();
  if (ui.server && remote.user) startSync();
  if (ui.route.name === 'accounts' && ui.server && remote.user?.role === 'manager') loadAccounts();
  if (ui.route.name === 'journal' && ui.server && remote.user?.role === 'manager') loadJournal();
  tick();
  setInterval(tick, 30000);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => theme === 'system' && render());
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
