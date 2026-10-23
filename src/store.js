// État de l'application, enregistrement local, annulation et sauvegardes automatiques.
// Le stockage est isolé derrière ce fichier : pour partager les données entre plusieurs personnes,
// il suffira de remplacer persist()/load() par un adaptateur serveur (voir README).
import { emptyState, normalizeState } from './model.js';
import { nowIso } from './util.js';

const KEY = 'capdepart:v2';
const SNAPS = 'capdepart:snaps';
const mem = new Map();
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); mem.delete(k); return true; } catch { mem.set(k, v); return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } mem.delete(k); },
};

export const store = { state: emptyState(), savedAt: null, persistOk: true, stack: [], subs: new Set() };
export const getState = () => store.state;

function emit(info = {}) { store.subs.forEach((fn) => fn(info)); }
export function subscribe(fn) { store.subs.add(fn); return () => store.subs.delete(fn); }

function persist() {
  store.persistOk = ls.set(KEY, JSON.stringify(store.state));
  store.savedAt = new Date();
}

export function load() {
  const raw = ls.get(KEY);
  if (raw) {
    try { store.state = normalizeState(JSON.parse(raw)); } catch { store.state = emptyState(); }
  }
  return store.state;
}

/** Applique une modification, l'enregistre, et garde l'état précédent pour « Annuler ». */
export function mutate(label, fn, { toast = true } = {}) {
  const before = JSON.stringify(store.state);
  const result = fn(store.state);
  store.state.updatedAt = nowIso();
  persist();
  if (label) {
    store.stack.push({ label, before });
    if (store.stack.length > 30) store.stack.shift();
  }
  emit({ label, toast: toast && !!label });
  return result;
}

export function undo() {
  const last = store.stack.pop();
  if (!last) return false;
  store.state = JSON.parse(last.before);
  persist();
  emit({ label: `Annulé : ${last.label}`, toast: true, noUndo: true });
  return true;
}

export function replace(newState, label) {
  const before = JSON.stringify(store.state);
  store.state = normalizeState(newState);
  persist();
  store.stack.push({ label, before });
  emit({ label, toast: true });
}

// ---- sauvegardes locales ------------------------------------------------------
export function snapshots() {
  try { return JSON.parse(ls.get(SNAPS) || '[]'); } catch { return []; }
}
export function addSnapshot(label) {
  if (!store.state.boats.length) return;
  const list = snapshots();
  list.unshift({ at: nowIso(), label, boats: store.state.boats.length, json: JSON.stringify(store.state) });
  let keep = 6;
  while (keep > 0) {
    if (ls.set(SNAPS, JSON.stringify(list.slice(0, keep)))) return;
    keep -= 2;
  }
}
export function autoSnapshot() {
  const last = snapshots()[0];
  if (!last || Date.now() - new Date(last.at).getTime() > 12 * 36e5) addSnapshot('Automatique');
}
export function restoreSnapshot(i) {
  const snap = snapshots()[i];
  if (!snap) return false;
  const data = JSON.parse(snap.json);
  addSnapshot('Avant restauration');
  replace(data, 'Sauvegarde restaurée');
  return true;
}
export function resetAll() {
  addSnapshot('Avant réinitialisation');
  replace(emptyState(), 'Données effacées');
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { load(); emit({}); }
  });
}
