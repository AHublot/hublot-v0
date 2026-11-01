// Fusion des modifications d'un bateau, tâche par tâche.
// Utilisé par le serveur (appliquer ce qu'un poste envoie) et par le navigateur (garder ses
// modifications non envoyées quand un autre poste a modifié le même bateau).
// Module pur : aucune dépendance, aucun accès au navigateur ni au disque.

/** Listes d'éléments suivis un par un. La valeur dit où s'ajoute un nouvel élément. */
export const LISTS = { tasks: 'end', pendingOnReturn: 'end', maintenance: 'end', importantEvents: 'end', fiches: 'end', history: 'start' };
const LOG_MAX = 200;
/** Champs posés par le serveur : un poste ne peut pas les imposer. */
export const STAMPS = ['doneBy', 'addedBy', 'by'];

export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
export const same = (a, b) => stable(a) === stable(b);
const clone = (v) => JSON.parse(JSON.stringify(v));
const keyOf = (it) => (it && it.id != null ? `i${it.id}` : `j${stable(it)}`);

/** Opérations qui font passer `base` à `cur`. */
export function diffBoat(base, cur) {
  const ops = [];
  const a0 = base || {}, b0 = cur || {};
  for (const k of new Set([...Object.keys(a0), ...Object.keys(b0)])) {
    if (k === 'id') continue;
    const a = a0[k], b = b0[k];
    if (k === 'logs') { // journal : on ne fait qu'ajouter
      const have = new Set((a || []).map(stable));
      (b || []).forEach((e) => { if (!have.has(stable(e))) ops.push({ op: 'add', a: 'logs', item: e }); });
    } else if (k in LISTS) diffItems(k, a || [], b || [], ops);
    else if (!same(a, b)) ops.push(b === undefined ? { op: 'unset', k } : { op: 'set', k, v: b });
  }
  return ops;
}
function diffItems(k, a, b, ops) {
  const am = new Map(a.map((it) => [keyOf(it), it]));
  const bm = new Map(b.map((it) => [keyOf(it), it]));
  for (const [key, it] of bm) {
    const old = am.get(key);
    if (!old) ops.push({ op: 'add', a: k, key, item: it });
    else if (!same(old, it)) {
      const set = {}, unset = [];
      for (const f of new Set([...Object.keys(old), ...Object.keys(it)])) {
        if (!(f in it)) unset.push(f); else if (!same(old[f], it[f])) set[f] = it[f];
      }
      ops.push({ op: 'upd', a: k, key, set, unset });
    }
  }
  for (const key of am.keys()) if (!bm.has(key)) ops.push({ op: 'del', a: k, key });
}

/** Applique des opérations à un bateau (copie). `by` : nom de l'auteur, posé par le serveur uniquement. */
export function applyOps(boat, ops, { by = '' } = {}) {
  const b = clone(boat);
  let logsTouched = false;
  for (const o of ops) {
    if (o.op === 'set') { if (o.k !== 'id') b[o.k] = clone(o.v); continue; }
    if (o.op === 'unset') { delete b[o.k]; continue; }
    if (!Array.isArray(b[o.a])) b[o.a] = [];
    const list = b[o.a];
    if (o.a === 'logs') {
      if (o.op === 'add' && !list.some((e) => same(e, o.item))) { list.push(clone(o.item)); logsTouched = true; }
      continue;
    }
    const i = list.findIndex((it) => keyOf(it) === o.key);
    if (o.op === 'add') {
      if (i >= 0) continue; // déjà là (envoi rejoué)
      const it = clone(o.item);
      if (by && (o.a === 'tasks' || o.a === 'pendingOnReturn') && !it.addedBy) it.addedBy = by;
      if (LISTS[o.a] === 'start') list.unshift(it); else list.push(it);
    } else if (o.op === 'upd') {
      if (i < 0) continue; // retiré entre-temps par quelqu'un d'autre
      const t = list[i];
      const set = { ...o.set }, unset = (o.unset || []).slice();
      if (by) { STAMPS.forEach((f) => { delete set[f]; }); }
      Object.assign(t, clone(set));
      unset.filter((f) => f !== 'id' && !(by && STAMPS.includes(f))).forEach((f) => { delete t[f]; });
      if (by && o.a === 'tasks' && 'done' in set) { if (set.done) t.doneBy = by; else delete t.doneBy; }
      if (by && o.a === 'maintenance' && ['date', 'hours', 'notes'].some((f) => f in set)) t.by = by;
    } else if (o.op === 'del') {
      if (i >= 0) list.splice(i, 1);
    }
  }
  if (logsTouched && Array.isArray(b.logs)) {
    b.logs.sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
    b.logs = b.logs.slice(0, LOG_MAX);
  }
  return b;
}

// ---- droits ----------------------------------------------------------------------------
const TECH_TASK = new Set(['done', 'doneAt', 'blocked', 'title']);
const TECH_MAINT = new Set(['date', 'hours', 'notes']);

/**
 * Un technicien peut : cocher / bloquer / renommer une observation, ajouter ou retirer ses observations,
 * noter les heures moteur, renseigner les entretiens, écrire au journal. Le reste est réservé au manager.
 */
export function deniedOps(role, ops, boat) {
  if (role === 'manager') return [];
  return ops.filter((o) => !techMay(o, boat));
}
function techMay(o, boat) {
  if (o.op === 'set') return o.k === 'hours';
  if (o.op === 'unset') return false;
  if (o.a === 'logs') return o.op === 'add';
  const list = Array.isArray(boat?.[o.a]) ? boat[o.a] : [];
  const cur = list.find((it) => keyOf(it) === o.key);
  if (o.a === 'tasks' || o.a === 'pendingOnReturn') {
    if (o.op === 'add') return !o.item || !o.item.template;
    if (o.op === 'del') return !cur || !cur.template;
    if (o.op === 'upd') {
      if (o.a !== 'tasks') return false;
      const fields = [...Object.keys(o.set || {}), ...(o.unset || [])].filter((f) => !STAMPS.includes(f));
      if (cur?.template && fields.includes('title')) return false;
      return fields.every((f) => TECH_TASK.has(f));
    }
    return false;
  }
  if (o.a === 'maintenance' && o.op === 'upd') {
    return [...Object.keys(o.set || {}), ...(o.unset || [])].filter((f) => !STAMPS.includes(f)).every((f) => TECH_MAINT.has(f));
  }
  return false;
}

/** Même contenu, aux champs d'auteur près (pour ne pas annuler l'historique « Annuler » à chaque retour du serveur). */
export function withoutStamps(boat) {
  const b = clone(boat);
  const strip = (t) => { STAMPS.forEach((f) => { delete t[f]; }); return t; };
  ['tasks', 'pendingOnReturn', 'maintenance'].forEach((k) => (b[k] || []).forEach(strip));
  (b.history || []).forEach((h) => (h.tasks || []).forEach(strip));
  return b;
}
