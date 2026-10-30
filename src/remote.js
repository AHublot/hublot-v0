// Synchronisation avec le serveur Cap Départ.
// - Servie par le serveur (VPS) : connexion obligatoire, données partagées, copie locale pour le hors-ligne.
// - Servie ailleurs (GitHub Pages, fichier local) : aucun serveur détecté, l'application reste 100 % locale.
import { store, applyRemote, clearLocal, onPersist } from './store.js';
import { normalizeBoat, DEFAULT_TEMPLATES } from './model.js';

const KEY = 'capdepart:sync';
export const remote = { mode: 'local', user: null, status: 'idle', version: 0, lastSync: null, error: '', pending: false };
let synced = { boats: {}, meta: '' }; // empreinte de ce que le serveur a, par bateau
const listeners = new Set();
export const onRemote = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

// empreinte courte d'un texte (cyrb53)
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const hb = (b) => hash(JSON.stringify(b));
const metaOf = (s) => ({ baseName: s.baseName, team: s.team, templates: s.templates, prefs: s.prefs });
const hm = (s) => hash(JSON.stringify(metaOf(s)));

const LS = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* */ } },
  del() { try { localStorage.removeItem(KEY); } catch { /* */ } },
};
const save = () => LS.set({ version: remote.version, boats: synced.boats, meta: synced.meta, user: remote.user });

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('api/' + path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CapDepart': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* pas du JSON */ }
  if (!r.ok) { const e = new Error(data?.error || `Erreur ${r.status}`); e.status = r.status; throw e; }
  return data;
}

function adopt(user, cache) {
  remote.user = user;
  if (cache && cache.user && cache.user.id === user.id) {
    remote.version = cache.version || 0;
    synced = { boats: cache.boats || {}, meta: cache.meta || '' };
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
    if (cache?.user) {
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
export async function logout() {
  try { await api('logout', { method: 'POST' }); } catch { /* déjà déconnecté */ }
  LS.del();
  clearLocal();
  remote.user = null; remote.version = 0; synced = { boats: {}, meta: '' };
  stop();
  notify();
}
export const changePassword = (current, next) => api('password', { method: 'POST', body: { current, next } });
/** Import d'une sauvegarde côté serveur (copie de la base avant), puis récupération. */
export async function importRemote(raw) {
  await syncNow(); // envoie d'abord ce qui attendait
  await api('import', { method: 'POST', body: raw });
  await syncNow();
}

function diff() {
  const s = store.state, now = {}, boats = [];
  s.boats.forEach((b) => { const h = hb(b); now[b.id] = h; if (synced.boats[b.id] !== h) boats.push(b); });
  const deleted = Object.keys(synced.boats).filter((id) => !(id in now));
  const mh = hm(s);
  return { boats, deleted, now, mh, meta: mh !== synced.meta ? metaOf(s) : null };
}
export const hasPending = () => { const d = diff(); return !!(d.boats.length || d.deleted.length || d.meta); };

async function push() {
  const d = diff();
  if (!d.boats.length && !d.deleted.length && !d.meta) return false;
  await api('sync', { method: 'POST', body: { meta: d.meta, boats: d.boats, deleted: d.deleted } });
  d.boats.forEach((b) => { synced.boats[b.id] = d.now[b.id]; });
  d.deleted.forEach((id) => { delete synced.boats[id]; });
  if (d.meta) synced.meta = d.mh;
  save();
  return true;
}

async function pull() {
  const d = await api('changes?since=' + remote.version);
  let changed = 0;
  if (d.meta || d.boats.length || d.deleted.length) {
    applyRemote((st) => {
      if (d.meta && hash(JSON.stringify(d.meta)) !== synced.meta) { // sinon : notre propre envoi qui revient
        const incoming = { baseName: d.meta.baseName || 'Ma base', team: d.meta.team || [], templates: d.meta.templates?.length ? d.meta.templates : DEFAULT_TEMPLATES.slice(), prefs: { autoDeparture: true, ...(d.meta.prefs || {}) } };
        const localDirty = synced.meta && hm(st) !== synced.meta;
        const ih = hash(JSON.stringify(incoming));
        if (!localDirty && hm(st) !== ih) { Object.assign(st, incoming); changed++; }
        synced.meta = ih; // si la version locale était modifiée, elle reste « à envoyer »
      }
      const idx = new Map(st.boats.map((b, i) => [b.id, i]));
      d.boats.forEach((raw, i) => {
        if (hb(raw) === synced.boats[raw.id]) return; // notre propre envoi qui revient
        const nb = normalizeBoat(raw, st.boats.length + i);
        const h = hb(nb), at = idx.get(nb.id);
        const local = at != null ? st.boats[at] : null;
        const localDirty = local && synced.boats[nb.id] && hb(local) !== synced.boats[nb.id];
        if (!localDirty && (!local || hb(local) !== h)) {
          if (local) st.boats[at] = nb; else { idx.set(nb.id, st.boats.length); st.boats.push(nb); }
          changed++;
        }
        synced.boats[nb.id] = h;
      });
      d.deleted.forEach((id) => {
        const at = st.boats.findIndex((b) => b.id === id);
        const localDirty = at >= 0 && synced.boats[id] && hb(st.boats[at]) !== synced.boats[id];
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

let busy = false, again = false, timer = null, debounce = null;
/** Récupère ce qui a changé ailleurs, puis envoie ce qui a changé ici. */
export async function syncNow() {
  if (remote.mode !== 'server' || !remote.user) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    // d'abord récupérer (les modifications locales non envoyées sont gardées), puis envoyer
    await pull();
    try { if (await push()) await pull(); } catch (e) { if (e.status !== 403) throw e; remote.status = 'readonly'; }
    if (remote.status !== 'readonly') remote.status = 'ok';
    remote.lastSync = new Date(); remote.error = '';
  } catch (e) {
    if (e.status === 401) { remote.user = null; remote.status = 'auth'; stop(); }
    else { remote.status = e.status ? 'error' : 'offline'; remote.error = e.message; }
  } finally {
    busy = false;
    remote.pending = hasPending();
    notify();
    if (again) { again = false; syncNow(); }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(syncNow, 15000);
}
function stop() { clearInterval(timer); timer = null; }

/** À appeler une fois au démarrage, en mode serveur. */
export function startSync() {
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
}
