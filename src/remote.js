import { store, applyRemote, clearLocal, onPersist } from './store.js';
import { normalizeBoat, DEFAULT_TEMPLATES } from './model.js';
import { diffBoat, applyOps, same, withoutStamps } from './merge.js';

const KEY = 'capdepart:sync';
export const remote = { mode: 'local', user: null, status: 'idle', version: 0, lastSync: null, error: '', pending: false, notice: '' };
// boats : pour chaque bateau, la dernière version connue du serveur (sert à calculer ce qui a changé ici)
let synced = { boats: {}, meta: '' };
const listeners = new Set();
export const onRemote = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());
const isManager = () => remote.user?.role === 'manager';
const clone = (v) => JSON.parse(JSON.stringify(v));

// empreinte courte d'un texte (cyrb53)
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const metaOf = (s) => ({ baseName: s.baseName, team: s.team, templates: s.templates, prefs: s.prefs, tplCats: s.tplCats || {} });
const hm = (s) => hash(JSON.stringify(metaOf(s)));

const LS = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* */ } },
  del() { try { localStorage.removeItem(KEY); } catch { /* */ } },
};
const save = () => LS.set({ v: 2, version: remote.version, boats: synced.boats, meta: synced.meta, user: remote.user });

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('api/' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Hublot': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* pas du JSON */ }
  if (!r.ok) { const e = new Error(data?.error || `Erreur ${r.status}`); e.status = r.status; e.code = data?.code; throw e; }
  return data;
}

function adopt(user, cache) {
  remote.user = user;
  if (cache && cache.user && cache.user.id === user.id) {
    if (cache.v === 2) { remote.version = cache.version || 0; synced = { boats: cache.boats || {}, meta: cache.meta || '' }; }
    else { remote.version = 0; synced = { boats: {}, meta: '' }; } // ancien format : on repart de la version du serveur
  } else { // autre compte sur cet appareil : on repart de la base
    clearLocal();
    remote.version = 0;
    synced = { boats: {}, meta: '' };
  }
  save();
}

/** Le serveur est-il là ? Qui est connecté ? */
export async function detect() {
  const cache = LS.get();
  try {
    const r = await fetch('api/me', { credentials: 'same-origin', cache: 'no-store' });
    const json = (r.headers.get('content-type') || '').includes('application/json');
    if (!json) { remote.mode = 'local'; return remote; }
    remote.mode = 'server';
    if (r.status === 401) { remote.user = null; return remote; }
    adopt((await r.json()).user, cache);
  } catch { // pas de réseau : si on était connecté ici, on continue hors ligne
    if (cache?.user && cache.v === 2) {
      remote.mode = 'server'; remote.user = cache.user; remote.version = cache.version || 0;
      synced = { boats: cache.boats || {}, meta: cache.meta || '' }; remote.status = 'offline';
    } else remote.mode = 'local';
  }
  return remote;
}

export async function login(email, password) {
  const d = await api('login', { method: 'POST', body: { email, password } });
  adopt(d.user, LS.get());
  start();
  await syncNow();
  return d.user;
}

/**
 * Déconnexion. Envoie d'abord ce qui attend ; s'il reste des modifications non envoyées (pas de réseau),
 * ne déconnecte pas et renvoie { blocked: n }. `force` : déconnecte quand même (ces modifications sont perdues).
 */
export async function logout({ force = false } = {}) {
  if (!force && remote.user && remote.mode === 'server') {
    await syncNow();
    if (hasPending()) await syncNow();
    const info = pendingInfo();
    if (info.changes) return { blocked: info.changes, boats: info.boats };
  }
  try { await api('logout', { method: 'POST' }); } catch { /* déjà déconnecté */ }
  LS.del();
  clearLocal();
  remote.user = null; remote.version = 0; synced = { boats: {}, meta: '' };
  stop();
  notify();
  return { blocked: 0 };
}
export async function changePassword(current, next) {
  await api('password', { method: 'POST', body: { current, next } });
  if (remote.user?.mustChange) { remote.user = { ...remote.user, mustChange: false }; save(); startSync(); }
}
/** Import d'une sauvegarde côté serveur (copie de la base avant), puis récupération. */
export async function importRemote(raw) {
  await syncNow(); // envoie d'abord ce qui attendait
  await api('import', { method: 'POST', body: raw });
  await syncNow();
}
// ---- comptes (manager) ----
export const listAccounts = () => api('users');
export const createAccount = (body) => api('users', { method: 'POST', body });
export const resetAccount = (id) => api('users/reset', { method: 'POST', body: { id } });
export const updateAccount = (body) => api('users/update', { method: 'POST', body });

/** Ce qui attend d'être envoyé. */
function diff() {
  const s = store.state, mgr = isManager();
  const patches = [], fulls = [];
  s.boats.forEach((b) => {
    const base = synced.boats[b.id];
    if (!base) { if (mgr) fulls.push(b); return; }
    if (same(base, b)) return;
    const ops = diffBoat(base, b);
    if (ops.length) patches.push({ id: b.id, ops });
  });
  const have = new Set(s.boats.map((b) => b.id));
  const deleted = mgr ? Object.keys(synced.boats).filter((id) => !have.has(id)) : [];
  const mh = hm(s);
  return { patches, fulls, deleted, mh, meta: mgr && mh !== synced.meta ? metaOf(s) : null };
}
export const hasPending = () => { const d = diff(); return !!(d.patches.length || d.fulls.length || d.deleted.length || d.meta); };
export function pendingInfo() {
  const d = diff();
  const changes = d.patches.reduce((n, p) => n + p.ops.filter((o) => o.a !== 'logs').length, 0) + d.fulls.length + d.deleted.length + (d.meta ? 1 : 0);
  return { changes, boats: d.patches.filter((p) => p.ops.some((o) => o.a !== 'logs')).length + d.fulls.length + d.deleted.length };
}

/** Envoie ce qui a changé ici. Renvoie null s'il n'y avait rien, sinon la liste des bateaux refusés ou disparus. */
async function push() {
  const d = diff();
  if (!d.patches.length && !d.fulls.length && !d.deleted.length && !d.meta) return null;
  const snaps = {};
  const mine = new Map(store.state.boats.map((b) => [b.id, b]));
  d.patches.forEach((p) => { snaps[p.id] = clone(mine.get(p.id)); });
  d.fulls.forEach((b) => { snaps[b.id] = clone(b); });
  const r = await api('sync', { method: 'POST', body: { meta: d.meta, boats: d.fulls, patches: d.patches, deleted: d.deleted } });
  Object.keys(snaps).forEach((id) => { synced.boats[id] = snaps[id]; });
  d.deleted.forEach((id) => { delete synced.boats[id]; });
  if (d.meta) synced.meta = d.mh;
  save();
  return r.rejected || [];
}

/** Bateaux refusés (droits) ou disparus : on reprend la version du serveur. */
async function resolveRejected(ids) {
  for (const id of ids) {
    const r = await api('boat?id=' + encodeURIComponent(id));
    const nb = r.boat ? normalizeBoat(r.boat, 0) : null;
    applyRemote((st) => {
      const at = st.boats.findIndex((b) => b.id === id);
      if (!nb) { if (at >= 0) st.boats.splice(at, 1); } else if (at >= 0) st.boats[at] = nb; else st.boats.push(nb);
    }, { clearUndo: false });
    if (nb) synced.boats[id] = clone(nb); else delete synced.boats[id];
  }
  save();
}

async function pull() {
  const d = await api('changes?since=' + remote.version);
  let changed = 0;
  if (d.meta || d.boats.length || d.deleted.length) {
    applyRemote((st) => {
      if (d.meta && hash(JSON.stringify(d.meta)) !== synced.meta) { // sinon : notre propre envoi qui revient
        const incoming = { baseName: d.meta.baseName || 'Ma base', team: d.meta.team || [], templates: d.meta.templates?.length ? d.meta.templates : DEFAULT_TEMPLATES.slice(), prefs: { autoDeparture: true, ...(d.meta.prefs || {}) }, tplCats: d.meta.tplCats || {} };
        const localDirty = synced.meta && hm(st) !== synced.meta;
        const ih = hash(JSON.stringify(incoming));
        if (!localDirty && hm(st) !== ih) { Object.assign(st, incoming); changed++; }
        synced.meta = ih; // si la version locale était modifiée, elle reste « à envoyer »
      }
      const idx = new Map(st.boats.map((b, i) => [b.id, i]));
      d.boats.forEach((raw, i) => {
        const nb = normalizeBoat(raw, st.boats.length + i);
        const base = synced.boats[nb.id];
        if (base && same(base, nb)) return; // rien de neuf : notre propre envoi qui revient
        const at = idx.get(nb.id), local = at != null ? st.boats[at] : null;
        if (!local) {
          if (base) return; // supprimé ici, la suppression est en attente d'envoi
          idx.set(nb.id, st.boats.length); st.boats.push(nb); changed++;
        } else if (!base || same(base, local)) { // rien en attente ici : on prend la version du serveur
          if (!same(local, nb)) { st.boats[at] = nb; if (!same(withoutStamps(local), withoutStamps(nb))) changed++; }
        } else { // modifications en attente ici : on les rejoue par-dessus la version du serveur
          const merged = normalizeBoat(applyOps(nb, diffBoat(base, local)), at);
          if (!same(merged, local)) { st.boats[at] = merged; if (!same(withoutStamps(merged), withoutStamps(local))) changed++; }
        }
        synced.boats[nb.id] = clone(nb);
      });
      d.deleted.forEach((id) => {
        const at = st.boats.findIndex((b) => b.id === id);
        const base = synced.boats[id];
        const localDirty = at >= 0 && base && !same(base, st.boats[at]) && isManager();
        if (at >= 0 && !localDirty) { st.boats.splice(at, 1); changed++; }
        delete synced.boats[id];
      });
    }, { clearUndo: false });
  }
  remote.version = d.version;
  save();
  if (changed) store.stack = []; // ne pas annuler par erreur le travail d'un autre poste
  return changed;
}

let running = null, again = false, timer = null, debounce = null;
/** Récupère ce qui a changé ailleurs, puis envoie ce qui a changé ici. */
export function syncNow() {
  if (remote.mode !== 'server' || !remote.user || remote.user.mustChange) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      // d'abord récupérer (les modifications locales non envoyées sont gardées), puis envoyer
      await pull();
      try {
        const rejected = await push();
        if (rejected) {
          if (rejected.length) { await resolveRejected(rejected); remote.notice = 'Certaines modifications ne sont pas autorisées pour ce compte : elles ont été annulées.'; }
          await pull();
        }
      } catch (e) { if (e.status !== 403) throw e; remote.status = 'readonly'; }
      if (remote.status !== 'readonly') remote.status = 'ok';
      remote.lastSync = new Date(); remote.error = '';
    } catch (e) {
      if (e.status === 401) { remote.user = null; remote.status = 'auth'; stop(); }
      else if (e.code === 'must_change') { remote.user = { ...remote.user, mustChange: true }; remote.status = 'auth'; stop(); }
      else { remote.status = e.status ? 'error' : 'offline'; remote.error = e.message; }
    } finally {
      running = null;
      remote.pending = hasPending();
      notify();
      if (again) { again = false; syncNow(); }
    }
  })();
  return running;
}

function start() {
  if (timer) return;
  timer = setInterval(syncNow, 15000);
}
function stop() { clearInterval(timer); timer = null; }

/** À appeler une fois au démarrage, en mode serveur. */
export function startSync() {
  if (remote.user?.mustChange) return;
  start();
  syncNow();
}

onPersist(() => {
  if (remote.mode !== 'server' || !remote.user) return;
  remote.pending = true;
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, 600);
});
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  // fermer l'onglet avec des modifications non envoyées : le navigateur demande confirmation
  window.addEventListener('beforeunload', (e) => { if (remote.mode === 'server' && remote.user && hasPending()) { e.preventDefault(); e.returnValue = ''; } });
}
